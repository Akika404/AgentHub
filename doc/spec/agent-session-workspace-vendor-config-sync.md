# Agent 会话工作区 Vendor 配置同步

> 模块范围：`apps/server/src/mutiagents`、`packages/shared/src/agent.ts`、桌面端 Agent/Chat 创建表单。

## Context

AgentHub 需要统一 Claude Agent SDK 与 Codex SDK 的 skills / MCP 等 vendor 配置发现方式。

设计上将目录分为两类：

- Agent Home：Agent 的持久配置源目录，保存 vendor 模板配置，例如 `.claude`、`.codex`。
- Session Working Directory：每次单 Agent 聊天实际运行的工作目录，SDK 的 `cwd` 指向这里，vendor 配置在创建聊天时从 Agent Home 合并进这里。

新建聊天时，用户可以指定工作目录；若不指定，后端在 Agent Home 下创建递增任务目录：

```text
<agentHomeDirectory>/Task1
<agentHomeDirectory>/Task2
<agentHomeDirectory>/Task3
```

工作目录不能与 Agent Home 相同，避免运行时文件、用户代码和 Agent 模板配置互相污染。

## Model

沿用现有模型：

- `Agent.agentHomeDirectory`：Agent 持久配置源目录。
- `Agent.workingDirectory`：Agent 默认工作目录，兼容既有数据和视图展示。
- `AgentSession.workingDirectory`：本聊天实际工作目录。
- `AgentSession.sessionHomeDirectory`：本聊天私有 SDK home，用于 SDK 状态隔离；不再作为 skills 复制目标。
- `Agent.skills` / `AgentSession.skills`：有效 skills 名称集合，仍用于传给支持显式 skills 参数的 SDK。
- `Agent.mcpServers` / `AgentSession.mcpServers`：有效 MCP 配置，仍用于传给支持显式 MCP 参数的 SDK。

能力声明调整：

- Claude：继续支持 `systemPrompt`、`skills`、`mcpServers`。
- Codex：支持 `systemPrompt`、`skills`。skills 通过 `<workingDirectory>/.codex/skills` 被 Codex SDK 发现。
- Codex MCP：本期不声明支持，因为当前统一接口是 Claude 形状，尚未实现 Codex MCP 配置形态翻译。

## Backend API

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/agents` | 创建 Agent 配置。`agentHomeDirectory` 不传时默认等于 `workingDirectory`，并按 vendor 初始化 Agent Home 下的配置目录。 |
| `PATCH` | `/agents/:agentId` | 更新 Agent 配置。可导入 skills 到 Agent Home 的 vendor skills 目录。 |
| `POST` | `/agent-chats` | 创建单 Agent 聊天。`workingDirectory` 由必填调整为可选；为空时后端分配 `<agentHomeDirectory>/TaskN`。 |

`CreateAgentChatDto.workingDirectory` 调整为可选字段：

- 传入非空路径：使用该路径，但必须不等于 Agent Home。
- 不传或空字符串：后端自动创建递增 `TaskN` 工作目录。

## Runtime Flow

### 创建 Agent

1. 校验 vendor、Provider、model、skills / MCP 能力。
2. 规范化 `workingDirectory`。
3. 规范化 `agentHomeDirectory`；不传时兼容现有行为，默认使用 `workingDirectory`。
4. 创建必要目录：
   - Agent Home 根目录。
   - Agent 默认 Working Directory。
   - 当前 vendor 的 Agent Home 配置目录，例如 `.claude/skills` 或 `.codex/skills`。
5. 将用户上传 / 指定的 skill source 导入当前 vendor 的 Agent Home skills 目录。
6. 保存 Agent 配置。

### 创建聊天

1. 加载 Agent。
2. 若请求指定 `workingDirectory`，规范化后校验它不等于 `agent.agentHomeDirectory`。
3. 若请求未指定 `workingDirectory`，扫描 Agent Home 下的 `TaskN`，选择第一个不存在的序号并创建。
4. 创建会话私有 `sessionHomeDirectory`，用于 SDK 状态隔离。
5. 将 Agent Home 下当前 vendor 配置目录合并进 Working Directory：
   - Claude：`<agentHomeDirectory>/.claude` -> `<workingDirectory>/.claude`
   - Codex：`<agentHomeDirectory>/.codex` -> `<workingDirectory>/.codex`
6. 合并策略采用“工作目录优先”：
   - 若目标同名目录或文件已存在，保留目标版本。
   - 对 skills，若 `<workingDirectory>/<vendorDir>/skills/<skillName>` 已存在，则跳过 Agent Home 中同名 skill。
   - 不做文件级覆盖，避免把两个 skill 版本混合。
7. 将本聊天额外导入的 skills 复制到 Working Directory 的当前 vendor skills 目录；若同名 skill 已存在，则报错，要求用户改名或删除目标后重试。
8. 计算并保存 `AgentSession.skills`、`AgentSession.mcpServers`。

### 运行 Agent

1. `agentToConfig()` 继续把 `session.workingDirectory` 作为 SDK `cwd`。
2. `agentToConfig()` 继续把 `session.sessionHomeDirectory` 作为 SDK 私有 home。
3. Claude adapter 使用 `CLAUDE_CONFIG_DIR=<sessionHomeDirectory>/.claude`，同时 `cwd` 下也存在同步后的 `.claude`，支持项目级发现。
4. Codex adapter 使用 `CODEX_HOME=<sessionHomeDirectory>`，同时 `workingDirectory` 下存在同步后的 `.codex/skills`，支持 Codex SDK 从当前工作目录发现 skills。

## Validation

- 服务端 typecheck 通过。
- 共享类型与服务端 DTO 保持一致，`CreateAgentChatPayload.workingDirectory` 改为可选。
- 创建 Codex Agent 时允许传入 `skillSourceDirectories` 和 `skills`。
- 创建聊天且不传 `workingDirectory` 时，会自动创建 `Task1`；若已存在则创建 `Task2`。
- 创建聊天时指定 `workingDirectory === agentHomeDirectory` 会返回 bad request。
- 当工作目录已有同名 skill 时，Agent Home 同名 skill 不覆盖工作目录版本。
- 桌面端创建聊天表单允许工作目录留空，并提示将使用默认 Task 目录。

## Known Limits

- Codex MCP 本期仍不支持；需要后续明确 Codex SDK MCP 配置格式后再做转换。
- Agent 创建时 `agentHomeDirectory` 不传仍默认等于 `workingDirectory`，这是为了兼容现有 API 与前端表单；新建聊天时会禁止工作目录等于 Agent Home。
- Vendor 配置同步只在创建聊天时执行；已有聊天不会自动追踪 Agent Home 后续变化。
- 合并策略只做目标优先的目录级复制，不做深层三方合并。
