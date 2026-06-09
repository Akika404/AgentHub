# AgentAdapter — Claude / Codex 统一适配层

> **实现位置变更（2026-06）**：本适配层的实现已抽到框架无关的共享包
> **`packages/agent-core`**（`src/adapter/*` + `src/workspace/workspace-git.ts` +
> `src/logger.ts`），以便服务器与桌面端「本地执行模式」的 runner 共用同一套执行核心。
> 本目录现在只保留 `index.ts` 这个 re-export barrel（`export * from '@agenthub/agent-core'`），
> 让既有的 `'../adapter/index.js'` import 零改动继续可用。本文档描述的设计与事件契约依旧有效，
> 下文 §10 的「文件清单」路径请以 `packages/agent-core/src/` 为准。原先依赖的 `@nestjs/common`
> `Logger` 已替换为注入式 `CoreLogger`（默认 `NOOP_LOGGER` 静默）。

> AgentHub 多 Agent 协作平台的底层抽象层。把 `@anthropic-ai/claude-agent-sdk` 和
> `@openai/codex-sdk` 两个形态截然不同的 Agent SDK 归一成同一个**会话化事件流**接口，
> 让上层群聊编排层不再关心底层是 Claude 还是 Codex。

---

## 1. 背景与目标

### 1.1 为什么要做 Adapter

AgentHub 的形态类似飞书：用户可以把多个虚拟员工（Agent）拉进一个群聊，让它们协作完成任务。这些虚拟员工底层是封装好的 Claude Code / Codex 实例。

但这两个 SDK 的 API 形态差异很大：

| 维度       | `@anthropic-ai/claude-agent-sdk`                                                | `@openai/codex-sdk`                                                                                     |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 调用入口   | `query({ prompt, options })` 返回 `AsyncIterable<SDKMessage>`                   | `codex.startThread().runStreamed(input)` 返回 `{ events }`                                              |
| 会话模型   | 一次 `query` 一次性消费完；多轮要用 `resume: sessionId`                         | `Thread` 对象长期持有，`runStreamed` 可重复调用                                                         |
| 事件粒度   | `assistant` / `user` / `result` / `system`，content 是 block 数组               | `thread.started` / `turn.started/completed/failed` / `item.started/updated/completed`，item 类型有 7 种 |
| 工具调用   | content block：`tool_use` + `tool_result`（异步配对）                           | item：`command_execution` / `file_change` / `mcp_tool_call` / `web_search`                              |
| 推理输出   | `thinking` block                                                                | `reasoning` item                                                                                        |
| Usage 字段 | `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `total_cost_usd` | `input_tokens` / `output_tokens` / `cached_input_tokens` / `reasoning_output_tokens`                    |
| 权限/沙箱  | `permissionMode` + `allowDangerouslySkipPermissions`                            | `sandboxMode` + `approvalPolicy`                                                                        |
| 配置网关   | `ANTHROPIC_BASE_URL` 环境变量                                                   | `model_providers` 配置树                                                                                |
| 系统提示词 | `options.systemPrompt`                                                          | `CodexOptions.config.instructions`                                                                      |

如果让上层编排逻辑直接对接两套 SDK，会出现大量 `if (vendor === "claude") ... else ...` 的分支代码，且任何 SDK 的 API 升级都会污染上层。Adapter 把差异封装在一层之内，给出一套稳定的对外契约。

### 1.2 设计目标

1. **协议归一**：上层只面对 `AgentAdapter` 接口和 `AgentEvent` 联合类型，不感知底层 SDK。
2. **会话化**：一个 Adapter 实例 ≈ 群聊中的一个虚拟员工。`send()` 可被反复调用以维持多轮上下文。
3. **流式优先**：所有输出都是 `AsyncIterable<AgentEvent>`，便于实时推送到群聊 UI。
4. **错误兜底**：任何异常都被吞掉并转成 `error` + 终止 `done(success=false)`，保证流一定有终态。
5. **零侵入**：不修改用户已有的 `claude_agent.ts` / `codex_agent.ts`，新增目录隔离。

### 1.3 非目标

- **不做多 Agent 编排**：群聊调度、@提及、消息广播是上层（AgentHub Hub 层）的事。
- **不做权限管理 UI**：当前默认 bypass 权限以适配自动化场景，UI 化的权限审批留给后续。
- **不暴露 SDK 全部能力**：MCP 服务器配置、hooks、subagents 等高阶能力先不开放，按需扩展。

---

## 2. 架构总览

### 2.1 分层

```
┌──────────────────────────────────────────────────┐
│       AgentHub 群聊编排层（未实现）              │
│   - 群组、消息分发、@提及、轮询调度              │
└──────────────────┬───────────────────────────────┘
                   │ AgentAdapter 接口
                   │ AgentEvent 流
                   ▼
┌──────────────────────────────────────────────────┐
│       Adapter 层（本目录）                       │
│  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ ClaudeAdapter    │  │ CodexAdapter         │  │
│  │ - 事件翻译       │  │ - 事件翻译           │  │
│  │ - sessionId 续接 │  │ - Thread 复用        │  │
│  └────────┬─────────┘  └──────────┬───────────┘  │
└───────────┼───────────────────────┼──────────────┘
            │                       │
            ▼                       ▼
   @anthropic-ai/             @openai/codex-sdk
   claude-agent-sdk           （子进程 codex CLI）
```

### 2.2 模块组成

```
adapter/
  types.ts     # 共享类型：AgentEvent / AgentAdapter / AgentAdapterConfig 等
  claude.ts    # ClaudeAdapter：包装 query() 异步生成器
  codex.ts     # CodexAdapter：包装 Codex + Thread
  index.ts     # 公开导出 + createAgent 工厂
  test/example.ts  # 简单的使用示例
  test/server.ts   # 演示：用同一段代码驱动两家 Agent 完成同一任务
  test/demo.html   # 演示：用同一段代码驱动两家 Agent 完成同一任务的前端
```

### 2.3 核心抽象

```
        ┌─────────────────────────────────────┐
        │       AgentAdapter（接口）          │
        │  vendor, id, sessionId              │
        │  send(prompt) → AsyncIterable<...>  │
        └────────────┬────────────────────────┘
                     │ 由两个具体类实现
        ┌────────────┴────────────┐
        ▼                         ▼
  ClaudeAdapter             CodexAdapter

每个 Adapter 内部翻译流：

  原生 SDK 事件流  →  translate()  →  AgentEvent 流
```

---

## 3. 核心类型设计

所有类型定义在 `adapter/types.ts`。

### 3.1 `AgentVendor`

```ts
export type AgentVendor = 'claude' | 'codex'
```

简单枚举。任何 `AgentEvent` 都携带它，便于上层调试和差异化展示。

### 3.2 `AgentEvent` —— 统一事件联合

这是整个 Adapter 的核心契约。每种事件都是一个判别联合（discriminated union）成员，便于 TS 在 `switch (ev.type)` 时窄化类型。

```ts
export type AgentEvent =
    | { type: 'session_started'; vendor; sessionId: string }
    | { type: 'turn_started'; vendor }
    | { type: 'progress'; vendor; text: string; itemId? }
    | { type: 'text'; vendor; text: string; itemId? }
    | { type: 'thinking'; vendor; text: string; itemId? }
    | { type: 'tool_use'; vendor; id; name; input; status }
    | { type: 'tool_result'; vendor; toolUseId; output; isError? }
    | { type: 'todo'; vendor; items: AgentTodoItem[] }
    | { type: 'turn_completed'; vendor; finalText?; usage? }
    | { type: 'error'; vendor; message; fatal? }
    | { type: 'done'; vendor; success; finalText?; usage? }
```

设计要点：

- **`session_started`**：会话生命周期内只发一次，携带可用于断点续传的 `sessionId`。
- **`turn_started` / `turn_completed`**：包裹一次 `send()` 调用。Claude SDK 没有显式 turn 概念，由 Adapter 合成。
- **`progress` / `text` / `thinking`**：`progress` 是助手对当前动作的过程播报，展示在运行过程里；`text` 是会被展示给用户的最终回答；`thinking` 是推理过程（应当折叠展示）。两边的 reasoning / thinking block 都映射到 `thinking`。
- **`tool_use` + `tool_result`** 通过 `id` 配对。一次工具调用至少产生一条 `tool_use(started)`，工具完成后再产生 `tool_use(completed|failed)` 以及可选的 `tool_result`。
- **`todo`**：每次 TODO 列表变化都全量推送，上层做 diff。`AgentTodoItem` 是三态 `status: "pending" | "in_progress" | "completed"`，Claude 端直接透传，Codex 端因为 SDK 只暴露 `boolean`，映射为 `completed ? "completed" : "pending"`（拿不到 in_progress 这一态）。
- **`done`** 是流的终结事件，**保证一定出现**（包括异常路径）。`success: false` 时说明本次 turn 整体失败。`finalText` / `usage` 是最终态摘要，便于上层不维持状态也能拿到结果；Claude 的 `finalText` 来自 result，Codex 的 `finalText` 来自本轮最后一条 `agent_message` 候选文本，并在缺失 `text` 流时回退到最近一次 `agent_message`。为对齐两端，Codex 的 `turn_completed` 也会带上同一份 `finalText`（Claude 本就如此）。
- **`error.fatal`**：用于区分"局部错误"（如某个工具失败）和"会话级致命错误"（如鉴权失败、网络断开）。fatal 错误后通常紧跟 `done(success=false)`。
- **调试日志**：两个 Adapter 均通过 `Logger.debug` 打点（`[raw]` SDK 原始事件、`[out]` 翻译后的统一事件类型、`[done]` 本轮汇总：success / finalText 长度 / 文本开头）。默认日志级别下静默；排查事件流问题（如最终文本未送达）时，把 Nest logger 级别开到 `debug` 即可复现完整链路。

### 3.3 `AgentUsage`

```ts
export interface AgentUsage {
    inputTokens?: number
    outputTokens?: number
    cachedInputTokens?: number
    reasoningTokens?: number // codex 独有
    totalCostUSD?: number // claude 独有
}
```

取两家字段的并集，缺失的字段保持 `undefined`。上层做展示时 fallback 即可。

### 3.4 `AgentAdapterConfig` —— 统一配置

```ts
export interface AgentAdapterConfig {
    id?: string
    model: string
    workingDirectory: string
    apiKey: string
    baseUrl?: string
    env?: Record<string, string | undefined>
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}
```

- **`id`**：给 AgentHub 调度用，不传则随机生成（如 `claude-y78fan`）。
- **`workingDirectory`**：Agent 的"工作沙箱"。建议每个 Agent 一个独立目录，避免文件互相覆盖。
- **`baseUrl`**：可选自定义网关。Claude 走 `ANTHROPIC_BASE_URL`，Codex 走自定义 `model_provider` 配置。
- **`reasoningEffort`**：取两家取值集的并集；不存在的值由 Adapter 内部 mapping 到最近的可用值（见 §5.2 / §6.2）。

### 3.5 `AgentAdapter` —— 接口契约

```ts
export interface AgentAdapter {
    readonly vendor: AgentVendor
    readonly id: string
    readonly sessionId: string | null // 首次 send 之后才有值
    send(prompt: string, options?: SendOptions): AsyncIterable<AgentEvent>
}

export interface SendOptions {
    signal?: AbortSignal
    /** 单轮结构化输出 JSON Schema；Claude/Codex 各自映射到 SDK 原生参数。 */
    outputSchema?: Record<string, unknown>
}
```

行为契约（**所有实现都必须满足**）：

1. **会话连续性**：同一个 Adapter 实例上的多次 `send()` 必须共享上下文（多轮对话）。
2. **流的终态保证**：每次 `send()` 返回的流都**必然**以一条 `done` 事件结束。即便底层抛异常也要兜住。
3. **并发互斥**：在前一次 `send()` 的流没消费完之前调用第二次 `send()` 必须抛同步错误。这是为了避免上下文交错。如果上层确实需要并发，应该 spawn 两个 Adapter 实例。
4. **`session_started` 唯一性**：在一个 Adapter 实例的生命周期内只会发一次。
5. **`AbortSignal` 支持**：传入的 signal 触发时，流应当尽快终止并发一条 `done`。
6. **结构化输出**：传入 `outputSchema` 时，Adapter 必须使用底层 SDK 的 schema 输出能力；可用时在 `done.structuredOutput` 返回解析后的对象。

---

## 4. ClaudeAdapter 实现

文件：`adapter/claude.ts`

### 4.1 SDK 形态回顾

```ts
for await (const msg of query({ prompt, options })) {
    // msg 是 SDKMessage 联合类型
}
```

`SDKMessage` 是个庞大的联合（30+ 成员），但 Adapter 只关心：

| `msg.type`  | `msg.subtype`    | 含义                            |
| ----------- | ---------------- | ------------------------------- |
| `system`    | `init`           | 会话初始化，含 sessionId        |
| `assistant` | —                | 模型输出，content 是 block 数组 |
| `user`      | —                | 含工具结果（tool_result block） |
| `result`    | `success` / 错误 | 一次 query 结束的总结           |

其它如 `status` / `hook_*` / `task_*` 暂时忽略。

### 4.2 关键实现细节

#### a) 多轮 = `resume: sessionId`

Claude SDK 一次 `query()` 处理一个 prompt 后流就结束了。要做多轮，必须把 `system/init` 里拿到的 `session_id` 在下次调用时通过 `options.resume` 传回去：

```ts
if (this._sessionId) opts.resume = this._sessionId
```

`_sessionId` 在收到任何带 `session_id` 字段的消息时设置（实际上 `system/init` 就是第一条）。

#### b) Content block 翻译

`assistant.message.content` 是 block 数组，每个 block 自带 `type` 字段：

```ts
for (const block of content) {
  if (b.type === "text")       yield { type: "text", ... };
  else if (b.type === "thinking") yield { type: "thinking", ... };
  else if (b.type === "tool_use") yield { type: "tool_use", status: "started", ... };
}
```

注意 `tool_use` block 在 assistant 消息里只表示"发起"，对应的 `tool_result` 会出现在**下一条 `user` 消息**中（SDK 强制这种结构）。所以 Adapter 翻译时 `tool_use.status` 总是 `"started"`，完成态通过后续的 `tool_result` 事件体现。这与 Codex 的"item 三段式"（started → updated → completed）不完全一致，但语义上等价。

#### c) `result` 消息 → `turn_completed`

```ts
case "result":
  if (msg.subtype === "success") {
    yield {
      type: "turn_completed",
      finalText: msg.result,
      usage: {
        inputTokens: msg.usage?.input_tokens,
        outputTokens: msg.usage?.output_tokens,
        cachedInputTokens: msg.usage?.cache_read_input_tokens,
        totalCostUSD: msg.total_cost_usd,
      },
    };
  } else {
    yield { type: "error", message: `Claude turn ended with subtype=${msg.subtype}` };
    yield { type: "turn_completed" };
  }
```

#### d) 异常兜底

```ts
try {
  yield { type: "turn_started" };
  for await (const msg of query(...)) { /* translate */ }
} catch (err) {
  success = false;
  yield { type: "error", message: err.message, fatal: true };
} finally {
  yield { type: "done", success, finalText, usage };
  this.busy = false;
}
```

这就是为什么实测时 `.env` 401 不会让进程崩溃 —— SDK 内部抛出的 `Error: Claude Code returned an error result: ...` 被这层 `try/catch` 接住了。

#### e) 权限模式

```ts
permissionMode: "bypassPermissions",
allowDangerouslySkipPermissions: true,
```

自动化场景下没有人在终端审批权限。如果未来 AgentHub 要做"审批 UI"，这里改成 `dontAsk` 并接 `canUseTool` 回调即可。

#### f) Effort 映射

Codex 支持 `"minimal"`，Claude 不支持。`mapEffort` 把它降级到 `"low"`：

```ts
function mapEffort(e) {
    if (!e) return undefined
    if (e === 'minimal') return 'low'
    return e
}
```

---

## 5. CodexAdapter 实现

文件：`adapter/codex.ts`

### 5.1 SDK 形态回顾

```ts
const codex = new Codex({ apiKey, baseUrl, config, env });
const thread = codex.startThread({ model, sandboxMode, ... });
const { events } = await thread.runStreamed(prompt, { signal });
for await (const ev of events) { /* ... */ }
```

`thread` 是一个长期对象，`runStreamed` 可以反复调用，每次启动一个新的 turn，但共享 thread 上下文。

`ThreadEvent` 的类型联合比 Claude 简洁：

```
ThreadEvent =
  | { type: "thread.started";   thread_id }
  | { type: "turn.started" }
  | { type: "turn.completed";   usage }
  | { type: "turn.failed";      error }
  | { type: "item.started";     item }
  | { type: "item.updated";     item }
  | { type: "item.completed";   item }
  | { type: "error";            message }
```

`item` 是另一层联合：`agent_message` / `reasoning` / `command_execution` / `file_change` / `mcp_tool_call` / `web_search` / `todo_list` / `error`。

### 5.2 关键实现细节

#### a) Thread 复用 = 多轮

```ts
if (!this.thread) {
  this.thread = this.codex.startThread({ model, workingDirectory, ... });
}
const { events } = await this.thread.runStreamed(prompt, { signal });
```

第一次 `send()` 创建 Thread；后续 `send()` 复用同一个 Thread。SDK 内部维持上下文，Adapter 不需要做特殊处理。

#### b) Item 三段式的去抖

Codex 的同一个 item 会发三次：`item.started` → `item.updated`（可能多次）→ `item.completed`。`agent_message` / `reasoning` 这种**纯文本** item 如果三次都向上抛，会让群聊里出现重复消息。Adapter 的策略：

```ts
case "agent_message":
  if (phase === "item.completed") {
    yield { type: "text", text: item.text };
  }
  return;
case "reasoning":
  if (phase === "item.completed") {
    yield { type: "thinking", text: item.text };
  }
  return;
```

只在 `completed` 阶段发，避免刷屏。代价是丢失了打字机效果 —— 如果上层需要流式打字，将来可以加一个配置开关。

Codex 的 `turn.completed` 原生只有 usage、没有最终文本字段。Adapter 的做法：本轮 `agent_message`（completed 阶段）的 `text` 作为最终回答候选，只保留最后一条作为 `finalText`，并在 `turn_completed` 与 `done` 上**都**带出（对齐 Claude 的 `result.finalText`，避免上层只在 `turn_completed` 分支取文本时拿不到）。如果某条候选后面又出现工具调用或新的候选，它就会被刷成 `progress` 事件，进入运行过程框；最后一条候选不进 `progress`，避免最终回复在过程区重复出现。此外 Adapter 还会跟踪最近一次 `agent_message` 文本（含 `started` / `updated` 阶段）作为兜底：当个别不合规网关只发增量、不发终态 `item.completed`（因而一个 `text` 事件都没有）时，仍能用它补上 `finalText`，让上层优雅降级而不是空白气泡。

#### c) 工具类 item 的状态翻译

`command_execution` / `mcp_tool_call` 自带 `status: "in_progress" | "completed" | "failed"` 字段，所以三段都发：

```ts
const status = toToolStatus(item.status);
yield { type: "tool_use", id: item.id, name: "shell", input: { command }, status };
if (status !== "started") {
  yield {
    type: "tool_result",
    toolUseId: item.id,
    output: item.aggregated_output,
    isError: status === "failed" || (item.exit_code ?? 0) !== 0,
  };
}
```

注意 shell 命令即使 `status === "completed"`，`exit_code` 不为 0 时也判定为 `isError: true` —— 这是常见的"命令跑完了但失败了"的场景，需要让上层感知。

`file_change` 没有 `in_progress` 状态字段，只在 `item.completed` 时给出 `"completed" | "failed"`。Adapter 用 phase 字段补齐：

```ts
const status: ToolCallStatus =
    item.status === 'failed' ? 'failed' : phase === 'item.completed' ? 'completed' : 'started'
```

#### d) 网关配置

用户的 `codex_agent.ts` 走自建网关 `https://ruoli.dev/v1`。Codex SDK 的网关配置不像 Claude 那样有专门的环境变量，要塞进 `config.model_providers`：

```ts
this.codex = new Codex({
    apiKey,
    baseUrl,
    config: baseUrl
        ? {
              model_providers: {
                  test_provider: {
                      name: 'test',
                      base_url: baseUrl,
                      wire_api: 'responses',
                      requires_openai_auth: true
                  }
              },
              model_provider: 'test_provider'
          }
        : undefined,
    env: buildCodexEnv(config)
})
```

只有传了 `baseUrl` 才注入 `model_providers`，否则走默认 OpenAI 端点。

#### e) CODEX_HOME 隔离

Codex CLI 会把会话和配置写到 `CODEX_HOME`（未设置时落到全局 `~/.codex`）。AgentHub 的正式运行路径把
`AgentAdapterConfig.agentHomeDirectory` 作为默认 `CODEX_HOME`，也就是每个聊天的 `sessionHomeDirectory`：

```ts
env.CODEX_HOME ??= config.agentHomeDirectory
```

这样重建 `LiveAgent` 时能按同一个聊天私有目录恢复 Codex 会话，也避免多个聊天共享全局 Codex 状态。注意 Codex CLI 要求
`CODEX_HOME` 目录必须已经存在；`AgentWorkspaceService` 会在创建 Agent/Chat 时预先创建运行目录。

#### f) Effort 映射

Codex 不支持 `"max"`，降级到 `"xhigh"`：

```ts
function mapEffort(e) {
    if (!e) return undefined
    if (e === 'max') return 'xhigh'
    return e
}
```

#### f) 默认 sandbox / approval

```ts
sandboxMode: "danger-full-access",
approvalPolicy: "never",
skipGitRepoCheck: true,
```

与 Claude 端的 `bypassPermissions` 对齐 —— 自动化场景下完全放开。

---

## 6. 事件映射对照表

这是 Adapter 的"翻译词典"，调试时可对照看。

| 统一事件              | Claude 来源                                                     | Codex 来源                                                                                              |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `session_started`     | 首条带 `session_id` 的消息（通常是 `system/init`）              | `thread.started`                                                                                        |
| `turn_started`        | 由 Adapter 在 `send()` 开头合成                                 | `turn.started`                                                                                          |
| `progress`            | （暂不发）                                                      | 非最终 `agent_message` item（仅 completed 阶段）                                                        |
| `text`                | `assistant` 消息中的 `text` block                               | 最后一条 `agent_message` item（仅 completed 阶段）                                                      |
| `thinking`            | `assistant` 消息中的 `thinking` block                           | `reasoning` item（仅 completed 阶段）                                                                   |
| `tool_use(started)`   | `assistant` 中的 `tool_use` block（**`TodoWrite` 除外**）       | `command_execution` / `mcp_tool_call` 的 in_progress 阶段；`file_change` / `web_search` 的 started 阶段 |
| `tool_use(completed)` | （不发，等价于收到对应的 `tool_result`）                        | item 的 completed 阶段                                                                                  |
| `tool_use(failed)`    | （在 `tool_result.isError` 中体现）                             | item.status === "failed"                                                                                |
| `tool_result`         | `user` 消息中的 `tool_result` block（**TodoWrite 的会被吞掉**） | 工具 item 完成/失败时合成发出                                                                           |
| `todo`                | `tool_use(name="TodoWrite")` 拦截后翻译，状态三态保真           | `todo_list` item，每次更新都发（boolean 映射到三态）                                                    |
| `turn_completed`      | `result` 消息（subtype=success）                                | `turn.completed`                                                                                        |
| `error` (非致命)      | `result` 消息（subtype 非 success）                             | `turn.failed.error` / `error` item                                                                      |
| `error` (fatal)       | `try/catch` 兜住的异常                                          | `error` 顶级事件 / `try/catch` 异常                                                                     |
| `done`                | `finally` 块中合成                                              | `finally` 块中合成                                                                                      |

---

## 7. 使用示例

完整示例见 `adapter/example.ts`，下面是最小骨架：

### 7.1 创建并驱动一个 Agent

```ts
import { createAgent } from './adapter'

const agent = createAgent('claude', {
    id: 'bob', // 群聊里的虚拟员工 ID
    model: 'mimo-v2.5-pro',
    workingDirectory: '/tmp/bob-workdir',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    reasoningEffort: 'medium'
})

for await (const ev of agent.send('写一个快速排序，TS 实现')) {
    switch (ev.type) {
        case 'text':
            console.log('说:', ev.text)
            break
        case 'tool_use':
            console.log('用工具:', ev.name, ev.status)
            break
        case 'tool_result':
            console.log('工具结果:', ev.output)
            break
        case 'done':
            console.log('结束 success=', ev.success)
            break
    }
}
```

### 7.2 多轮对话

```ts
for await (const ev of agent.send('第一轮：写函数')) {
    /* ... */
}
for await (const ev of agent.send('第二轮：加单元测试')) {
    /* ... */
}
//  ↑ 第二轮自动续接第一轮的上下文（Claude 用 resume，Codex 复用 Thread）
```

### 7.3 切换 vendor 零改动

```ts
// 把 vendor 改成 "codex"，其它代码不动：
const agent = createAgent('codex', {
    id: 'alice',
    model: 'gpt-5.4-mini',
    workingDirectory: '/tmp/alice-workdir',
    apiKey: process.env.OPENAI_API_KEY!,
    baseUrl: 'https://ruoli.dev/v1',
    reasoningEffort: 'medium'
})
// 后面循环消费 send() 的代码完全一样
```

### 7.4 群聊编排（未来）

```ts
const bob = createAgent("claude", { id: "bob", ... });
const alice = createAgent("codex", { id: "alice", ... });

async function broadcast(prompt: string) {
  await Promise.all([bob, alice].map(async (a) => {
    for await (const ev of a.send(prompt)) {
      hub.publish(a.id, ev);    // 推到群聊频道
    }
  }));
}
```

---

## 8. 已知限制与扩展方向

### 8.1 当前限制

> 自 AgentManager 接入后，以下原限制已落地（见 `../README.md`）：MCP 配置、systemPrompt、skills、
> 工具白名单均已加入 `AgentAdapterConfig`；Claude 端将 systemPrompt 追加到 `claude_code` 预设；
> `resumeWith()` 支持按
> 外部 sessionId 跨进程恢复；`capabilities()` 声明厂商不对称（Codex 支持
> systemPrompt/skills，但不支持 MCP）。AgentManager 会将 Agent Home 下的 vendor 配置
> 同步到会话 workingDirectory；ClaudeAdapter 通过 `CLAUDE_CONFIG_DIR` + `settingSources=['user','project']`
> 加载，Codex 通过工作目录下的 `.codex/skills` 发现 skills。下表为仍存在的限制。

| 限制                                    | 影响                                  | 解决方向                                                                       |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Claude 的 `text` 不流式                 | 大段输出会等整段产生后才发            | 加配置开关，启用时订阅 `SDKPartialAssistantMessage`                            |
| Codex 的 `agent_message` 同上           | 同上                                  | `item.updated` 阶段做增量 diff 后发 `text` 增量                                |
| Codex 的 todo 拿不到 in_progress        | 上层只能看到两态                      | SDK 限制；等 Codex SDK 升级或自行从相邻状态推断                                |
| 权限审批未实现（本期 auto-approve）     | 自动化"全开"，无法对接 UI 审批        | Claude 端接 `canUseTool`（已留 `permissionMode` seam）；Codex SDK 暂无回调 API |
| Claude 的 AskUserQuestion 卡死          | 反问场景下流会挂起                    | 需切到 streaming input 模式 + 双向回调，重构较大                               |
| Codex 的 MCP 不支持                     | Claude 形状的 MCP 配置在 Codex 上无效 | `capabilities()` 已声明；Manager 创建时显式拒绝而非静默丢弃                    |
| 无 cost / rate-limit 上报               | Codex SDK 没有 cost 字段              | 等 SDK 升级；或基于 token 数 + 模型价格表自己算                                |
| 不支持图片输入                          | Codex 的 `local_image` UserInput 未接 | `send()` 改成接受 `string \| UserInput[]`                                      |

### 8.4 模块系统互操作

两个 Agent SDK 均为 **ESM-only**（`package.json` `type: module`，无 `require` 导出）。
后端已整体迁移到 **ESM**（`package.json` `type: module`、tsconfig `module/moduleResolution: NodeNext`），
因此 adapter 直接 `import { query }` / `import { Codex }` 静态加载，无需任何动态 import 桥接
（原先的 `esm.ts` 已删除）。
`CodexAdapter` 仍惰性构造（`ensureCodex()`，首次 `send` 时再 `new Codex`），
这只是为了延迟到真正用到时，与模块系统无关。

### 8.2 扩展点示意

- **加一个 vendor**（如 Gemini / 自研模型）：实现 `AgentAdapter` 接口，在 `createAgent` 工厂里加一个分支即可，上层零改动。
- **加自定义事件类型**：扩 `AgentEvent` 联合，给每家 Adapter 加翻译规则。建议保持向后兼容（新增成员而非修改）。
- **加可观测性**：在 `send()` 的 `for await` 循环里包一层中间件，把所有事件镜像到 OTel / 日志后再 `yield` 给上层。

### 8.3 性能与并发

- **单实例串行**：一个 Adapter 实例的 `send()` 调用必须串行。`busy` flag 守住这一点。
- **多实例并发**：群聊里多个 Agent 并发跑没有问题，每个 Adapter 是独立的 SDK 进程/连接。
- **Codex 子进程**：Codex SDK 实际是 spawn 一个 `codex` CLI 子进程通信，启动成本不算低。如果群里有 10 个 Codex Agent，会同时启 10 个子进程。后续可以做进程池或惰性启动。

---

## 9. 测试与验证

### 9.1 已验证场景

| 场景                        | Vendor | 结果                                                                                                                                      |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 完整任务跑通（写排序+落盘） | Codex  | ✅ 事件流：session → turn_started → 多轮 tool_use/tool_result → file_change → text → turn_completed(usage+finalText) → done(success=true) |
| 鉴权失败                    | Claude | ✅ 事件流：turn_started → session → text(错误内容) → turn_completed(零 usage) → error(fatal) → done(success=false)，**进程不崩溃**        |
| 实例化但不发送              | 两者   | ✅ `sessionId === null`，`vendor` / `id` 字段正确                                                                                         |

### 9.2 运行示例

```bash
pnpm tsx adapter/example.ts codex     # 跑 Codex
pnpm tsx adapter/example.ts claude    # 跑 Claude（确保 ANTHROPIC_API_KEY 有效）
```

输出形如：

```
[main] using codex adapter id=codex-demo
[codex] session=019e5f09-...
[codex] -- turn start --
[codex] text: 我先看一下当前项目结构...
[codex] tool_use(started) shell #item_1 { command: 'ls -la' }
[codex] tool_use(completed) shell #item_1 { ... }
[codex] tool_result #item_1 err=false ...
[codex] tool_use(started) file_change #item_7 { changes: [...] }
[codex] tool_use(completed) file_change #item_7 { ... }
[codex] text: 已放到 test_agent/quickSort.ts
[codex] -- turn end -- { inputTokens: 44225, outputTokens: 998, ... }
[codex] done success=true
```

---

## 10. 文件清单

| 文件                 | 行数 | 职责                      |
| -------------------- | ---- | ------------------------- |
| `adapter/types.ts`   | ~115 | 共享类型定义              |
| `adapter/claude.ts`  | ~205 | ClaudeAdapter 实现        |
| `adapter/codex.ts`   | ~245 | CodexAdapter 实现         |
| `adapter/index.ts`   | ~20  | 导出 + `createAgent` 工厂 |
| `adapter/example.ts` | ~95  | 端到端 demo               |

总代码量 ~680 行，纯 TS，零额外依赖（直接复用项目已装的两个 SDK）。
