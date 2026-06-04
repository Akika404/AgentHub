# 单聊 Agent 任务：后台运行 + 多端实时围观

## Context（为什么做这件事）

当前"和 Agent 单聊"里，一轮对话（turn）被绑死在前端发起的那一条 SSE 连接上：

- 后端 `agent-chats.controller.ts` 里 `req.on('close', () => abort.abort())`，客户端一断开就中止整轮。
- 前端 `ChatView.vue` 在「切换聊天 / 组件卸载 / 关窗」三种情况都会主动 `cancelCurrentStream()`。

结果：切走任务被掐、关窗任务被掐、第二台设备完全看不到正在跑的 turn（事件只推给发起请求的那一条连接，且有 busy 锁）。历史消息已持久化（DB 按 userId 存），但正在进行的进度无法跨端、无法后台续看。

目标：
1. **后台运行**——turn 与任何单条连接解耦，连接断开只是「不再接收」，turn 继续在服务端跑到结束。
2. **多端实时围观**——同一个 turn 可被 N 个连接同时订阅，晚到的连接能回放本轮已发生的事件再追尾实时事件。
3. 用户可通过显式「停止」按钮主动中止跑飞的 turn。

## 已确认的架构决策

- 广播/回放底层用 **Redis Streams**（一轮一条 stream），不引入 MQ；不用「裸 pub/sub + 单独 buffer」。
  - 理由：`XADD`/`XREAD BLOCK` 一个原语就同时给到「回放历史 + 实时追尾 + 多消费者各自游标 + MAXLEN/TTL 裁剪」，正好匹配「围观」语义；MQ 对单服务、单轮、低频事件属过度设计。
- 按可横向扩展形态一步到位实现（现在就上 Redis），多实例下观看端连到非执行实例也能读同一条 stream。
- 加**显式「停止」**端点 + 前端按钮；跨实例中止走 Redis pub/sub 控制频道。

> ▎ **契约变更须知**（遵循 `apps/server/CLAUDE.md`「后端先行 + 显式披露 + 改前端适配」）：
> ▎ 现状是 `GET :chatId/converse`（prompt 在 query）一个端点既「启动」又「流式返回」。新设计拆分为「`POST` 启动（返回 turnId）」+「`GET` 订阅（SSE 回放+追尾）」——启动是写操作、订阅是读操作，符合 REST，且是支持多端订阅的前提。这是前端可见变更，采用 **Option A：改前端适配后端**，下文前端章节已列出对应改动。

## 服务端改动（apps/server）

### 新增：服务端拥有的 Turn 概念

turn 不再属于某条 HTTP 请求，而是 AgentManager 启动的一个游离后台任务。

**Redis 键**（新建 `turn-stream.service.ts` 封装，Redis 逻辑就地隔离）：
- `agent:turn:{turnId}:events` — Stream，每条 AgentEvent 一次 `XADD`（带 MAXLEN ~ N 上限）；turn 结束追加终止事件并 `EXPIRE`（如 1h）。
- `agent:session:{sessionId}:activeturn` — 指向当前活跃 turnId，启动设置、结束清除，供「打开窗口发现有任务在跑」用。
- `agent:turn:{turnId}:control` — pub/sub 频道，承载跨实例 abort 信号。

### agent-manager.service.ts 重构

注入 `REDIS_CLIENT`（来自全局 RedisModule）。把 `converseChat` 拆成：

- **`startTurn(userId, chatId, prompt) → { turnId }`**：沿用 `loadChat`/`getOrRehydrate`/busy 检查（保留一聊一轮的 busy 锁）、`saveMessage(user)`；生成 turnId、写 activeturn 指针；不 await 地启动 `runTurn()`；立即返回 turnId。
  - 若该 chat 已有活跃 turn → 返回现有 turnId（幂等加入，让多端收敛到同一轮），不报 busy。
- **`runTurn()`**（游离任务）：迭代 `live.adapter.send(prompt, { signal: turnAbort.signal })`，每条事件 `XADD` 到 stream 并复用现有 `collectStep`；结束时 `XADD` 终止事件、复用现有 finally 落库逻辑（message + steps）、`persistHandle`、清 busy、清 activeturn 指针、`EXPIRE` stream。turnAbort 由 turn 持有（存入 `LiveAgent.abort` 与新的 `activeTurns: Map<sessionId, {turnId, abort}>`），并订阅 control 频道响应跨实例 abort。
- **`subscribeTurn(turnId) → AsyncIterable<AgentEvent>`**：基于 `XREAD BLOCK` 从 id 0 起——先回放 backlog、再追尾实时，遇终止事件结束。每个订阅者独立游标，天然支持多端。
- **`abortTurn(userId, chatId, turnId)`**：本实例直接命中 `activeTurns` 调 abort；并 `PUBLISH` 到 control 频道覆盖多实例。
- **`getActiveTurn(chatId)`**：读 activeturn 指针，供 view 暴露。

### agent-chats.controller.ts 路由调整

- **`POST :chatId/converse`**（prompt 移入 body）→ `startTurn`，返回 `{ turnId }`（走统一 envelope）。
- **`GET :chatId/turns/:turnId/events`**（`@Sse` + `@SkipEnvelope`）→ `subscribeTurn`；`req.on('close')` 只结束本订阅，绝不 abort turn。
- **`POST :chatId/turns/:turnId/abort`** → `abortTurn`。
- **`GET :chatId`**（AgentChatView）补充 `activeTurnId`。

### DTO / 其他

- 新 `StartTurnResultDto { turnId }`；`AgentChatViewDto` 增 `activeTurnId`；`ConverseDto` 的 `prompt` 由 query 改 body。
- 新 `turn-stream.service.ts`（Redis Streams 封装：publish / subscribe / abort / active 指针）。`mutiagents.module.ts` 注册之。
- 用 `@ApiTags`/`@ApiOperation`/`@ApiEnvelope` 注解新路由（响应需 DTO class）。
- 启动时清理：服务重启后游离任务已死，需在 boot 时清理残留 activeturn 指针 / 把卡在 running 的 turn 标记为中断（见 follow-up）。

## 共享契约改动（packages/shared/src）

- `AgentChatView` 增 `activeTurnId: string | null`。
- 新增 `StartTurnResult { turnId: string }`。
- `converse` 入参 `prompt` 改走 POST body。
- `AgentEvent` 维持不变。

## 桌面端改动（apps/desktop）

- **`src/main/api-proxy.ts`**：`streamStart` 已是 GET SSE，改指向 `/agent-chats/:id/turns/:turnId/events`；取消订阅只断本地 reader（服务端不再因 close 而中止，天然满足后台续跑）。
- **`src/renderer/src/api/agents.ts`**：`converse` 改为「POST `/agent-chats/:id/converse`(body prompt) → 得 turnId → `streamStart` 订阅 URL」；新增 `subscribeTurn(chatId, turnId)`、`abortTurn(chatId, turnId)`。
- **`src/renderer/src/views/ChatView.vue`**：
  - `send()`：POST converse 取 turnId → 订阅。
  - `selectChat()`：把 `cancelCurrentStream()` 换成 `detachStream()`——只取消订阅、保留服务端 turn。
  - `onUnmounted()`：detach，不 abort。
  - 打开/切入聊天：`listMessages` 后若 `chat.activeTurnId` 存在 → 订阅该 turn（回放+追尾）实现围观；用回放事件复用现有 runtime/collect 逻辑重建「进行中」的 agent 运行消息。
  - 新增「停止」按钮：turn 运行中显示，点击调 `abortTurn(chatId, turnId)`。

## 验证（端到端）

- **后台续跑**：发一个会触发工具、耗时较长的 prompt → 切到别的聊天再切回 → 进度仍在推进并可见；关掉窗口重开 → 仍能续看。
- **多端围观**：同一用户在第二个客户端（第二个 Electron 窗口/同账号第二处登录）打开同一聊天 → 实时看到同一 turn 的进度。
- **停止**：点「停止」→ turn 中止，已产出的部分正常落库。
- **Redis 校验**：turn 运行中 `XLEN agent:turn:{id}:events` 增长，结束后键带 TTL；activeturn 指针结束后清除。
- `pnpm typecheck`（全工作区）、`pnpm -F @agenthub/server typecheck`、`pnpm lint`。

## 已知限制 / Follow-up

- 多实例 abort 依赖 control pub/sub；执行实例需为每个运行中 turn 订阅该频道。
- 服务重启 mid-turn：游离任务随进程消失；需 boot 清理残留 activeturn 指针并把 running turn 标记为中断（前端订阅时回退到 DB 历史）。
- stream TTL 取值（建议 1h）：晚于 TTL 才打开的设备回退读 DB 历史（此时 turn 多半已结束）。
- 幂等启动：选择「返回现有 turnId」而非 409，使多端收敛到同一轮。
- busy 锁保留（一个 chat 同时仅一轮）；跨不同 chat 的并行任务本就已支持，本次不改。





# 实现完成

多端实时围观 + 后台运行已落地，turn 从「绑死在前端 SSE 连接」改成了「服务端游离后台任务」。

### 改动清单

#### 共享契约 (packages/shared/src/agent.ts)
- `AgentChatView` 加 `activeTurnId: string | null`；新增 `StartTurnResult { turnId }`。

#### 服务端 (apps/server)
- 新增 `turn-stream.service.ts`——Redis Streams 封装：`publish`(XADD)、`subscribe`(从 0 回放 backlog + XREAD BLOCK 追尾)、活跃指针(SET NX EX 兼作跨实例并发锁)、`requestAbort`(pub/sub 控制频道)。
- `agent-manager.service.ts`——`converseChat` 拆成：`startTurn`(保留 busy 锁、幂等返回既存 turnId)、游离 `runTurn`(复用原 collectStep/落库逻辑，XADD 每条事件)、`subscribeTurn`(带归属校验)、`abortTurn`、活跃 turn 填充进 view。
- `agent-chats.controller.ts`——`POST converse`(返回 turnId) + `GET turns/:turnId/events`(SSE，断连不再 abort turn) + `POST turns/:turnId/abort`。
- 新 DTO、module 注册 TurnStream。

#### 桌面端 (apps/desktop)
- `agents.ts`——converse 改 POST→订阅两步；新增 `subscribeTurn`/`abortTurn`。
- `ChatView.vue`——`cancelCurrentStream`→`detachStream`(只断本端、不停 turn)；切换/卸载只 detach；打开聊天若 `activeTurnId` 存在则 `watchTurn` 围观；handler 抽成工厂供「发起」与「围观」复用。
- `MessageInput.vue`——加「停止」按钮。

### 关于你的疑问：不用 MQ，用 Redis Streams

确认了选型理由——`XADD`/`XREAD BLOCK` 单原语就覆盖「回放+追尾+多消费者各自游标+TTL裁剪」，正好是围观语义；MQ 对单服务单轮低频事件是过度设计。已按可横向扩展形态一步到位（活跃指针 + 控制频道都跨实例）。

### 验证状态

- ✅ `pnpm typecheck`(三个包全过)、`pnpm -F @agenthub/server typecheck`、`pnpm lint` 全绿。
- ⏳ 端到端手测未跑——需要起后端 + Redis，本环境没有。请你本地验：①切走再切回进度续看 ②第二个客户端实时围观 ③停止按钮 ④XLEN/TTL。

### 两个已知 follow-up(计划里也写了)

1. 服务重启 mid-turn:游离任务随进程消失。活跃指针有 2h 安全 TTL 兜底(不会永久锁死),但更干净的做法是 boot 时清理残留指针 + 把卡住的 turn 标记中断。建议补,要的话我接着做。
2. 多实例 abort 依赖控制频道,执行实例靠 `runningTurns` map 命中——已实现,但仅在 turn 落到本实例时生效(设计如此)。