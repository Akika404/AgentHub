# AgentManager 后端实现方案

> 本文描述 `apps/server/src/multiagents/` 的当前设计。字段与接口以实体和 shared 契约为准。

## Context

AgentHub 的 Agent 是用户创建的虚拟员工配置，底层由 Claude / Codex adapter 驱动。Agent 本身不再等同于聊天；用户可以基于同一个 Agent 创建多个独立的单 Agent 聊天会话。群聊会复用 AgentSession 作为成员内部运行会话，但不进入单聊列表。

核心决策：

- Agent 只保存可复用配置：展示名、头像/颜色标识、能力摘要、vendor、Provider、model、默认目录、system prompt、skills/MCP/tools 等。
- AgentSession 是一个具体 Agent 运行会话：`scope=user` 为用户显式创建的单聊，`scope=group` 为群聊成员内部运行会话；包含 title、workingDirectory、sessionHomeDirectory、sdkSessionId、有效 skills/MCP、status。
- AgentMessage 按 `sessionId` 隔离 UI 消息历史。
- AgentMessageStep 按 `messageId` 一对多承载 agent 消息的有序运行步骤（thinking/progress/tool/todo）。
- LiveAgent 按 `session.id` 存在内存中，同一个 Agent 的不同聊天可以并行运行，只有同一 chat 会互斥。
- 一轮对话（turn）是与 HTTP 请求解耦的游离后台任务：事件经一轮一条的 Redis Stream 广播，支持后台运行与多端实时围观（回放+追尾）。

## Model

| 概念             | 存储                 | 说明                                                                  |
| ---------------- | -------------------- | --------------------------------------------------------------------- |
| Agent            | `agent`              | 用户拥有的 Agent 配置，不存 apiKey/baseUrl                            |
| AgentSession     | `agent_session`      | Agent 运行会话和底层 SDK 句柄；单聊 API 只暴露 `scope=user`           |
| AgentMessage     | `agent_message`      | 主聊天区可见文本历史，按 sessionId 隔离                               |
| AgentMessageStep | `agent_message_step` | agent 消息的运行步骤，tool 含完整 input/output                        |
| LiveAgent        | memory               | adapter + busy + abort + LRU 时间戳                                   |
| Turn 事件流      | Redis                | 一轮一条 Stream 广播 AgentEvent；会话活跃指针 + 跨实例 abort 控制频道 |

凭证仍来自 `PlatformProviderService.resolveRuntimeConfig(userId, platformProviderId)`，仅后端内部使用。
`capabilitySummary` 是给用户和群聊 Orchestrator 看的简短能力描述，用于判断 Agent 擅长什么；它不会作为 system prompt 注入 adapter。

## Code Layout

`AgentManager` 现在只作为 controller-facing facade，保持控制器注入入口稳定；实际职责按服务拆分：

- `agents/agent-config.service.ts`：Agent 配置 CRUD、Provider/model/vendor 兼容校验、更新后驱逐相关 live session。
- `agents/agent-policy.service.ts`：纯业务规则与归一化，例如 vendor 能力、颜色/标题、skills/MCP 合并。
- `chats/agent-chat.service.ts`：AgentSession lifecycle、消息历史查询、start/subscribe/abort turn 的归属入口。
- `runtime/agent-runtime.service.ts`：LiveAgent registry、rehydrate、后台 turn 执行、timeout、abort、active turn 状态。
- `runtime/turn-stream.service.ts`：Redis Stream 事件广播/回放、session active 指针、turn 归属索引、跨实例 abort 控制频道。
- `messages/agent-message-history.service.ts`：UI 消息和运行步骤的读取、落库、清理，以及 AgentEvent -> StepDraft 合并。
- `workspace/agent-workspace.service.ts`：工作目录、Agent Home、vendor 配置同步、skill 导入。
- `adapter/`：Claude/Codex SDK 到统一 `AgentEvent` 的转换。

## Backend API

所有接口前缀为 `/api`，成功响应走统一信封，全部需 JWT。

| Method     | Path                                        | 说明                                                        |
| ---------- | ------------------------------------------- | ----------------------------------------------------------- |
| `POST`     | `/agents`                                   | 创建 Agent 配置，不开聊天                                   |
| `GET`      | `/agents`                                   | 当前用户 AgentList                                          |
| `GET`      | `/agents/:agentId`                          | Agent 详情                                                  |
| `DELETE`   | `/agents/:agentId`                          | 删除 Agent，并删除其所有聊天和消息                          |
| `POST`     | `/agent-chats`                              | 创建单 Agent 聊天                                           |
| `GET`      | `/agent-chats`                              | 当前用户的聊天列表                                          |
| `GET`      | `/agent-chats/:chatId`                      | 聊天详情                                                    |
| `GET`      | `/agent-chats/:chatId/messages`             | 聊天消息历史                                                |
| `POST`     | `/agent-chats/:chatId/converse`             | 启动一轮对话（后台游离），body 传 prompt，返回 `{ turnId }` |
| `GET @Sse` | `/agent-chats/:chatId/turns/:turnId/events` | 订阅该轮事件流（回放+追尾），遇 `done` 结束                 |
| `POST`     | `/agent-chats/:chatId/turns/:turnId/abort`  | 中止该轮（跨实例广播）                                      |
| `POST`     | `/agent-chats/:chatId/clear`                | 清空聊天句柄和消息                                          |
| `DELETE`   | `/agent-chats/:chatId`                      | 删除聊天                                                    |

## Runtime Flow

创建聊天：

- 校验 Agent 归属和 vendor 能力。
- `workingDirectory` 必填并规范化。
- 创建 `sessionHomeDirectory = <agentHomeDirectory>/.agenthub/chats/<chatId>`。
- Claude 会复制 Agent 私有 skills 到会话 home，再导入本聊天的 skill 文件夹。
- 有效 skills = Agent 原 skills + 导入 skill 名称；有效 MCP = Agent MCP 与聊天 MCP 浅合并。
- 保存 AgentSession，不启动 SDK。

对话（turn 后台游离运行）：

- 按 `chatId` 加载 AgentSession，再加载 Agent。
- Adapter config 中，模型/Provider/systemPrompt/tools/permission/reasoning 来自 Agent；cwd/home/skills/MCP 来自 AgentSession。
- `startTurn` 生成 `turnId`，用会话活跃指针 `SET NX EX`（跨实例锁，配合 `LiveAgent.busy` 同实例兜底）保证一聊一轮；已有活跃轮则幂等返回既存 turnId。`registry`/busy 锁仍使用 `session.id`。
- 用户消息和 Agent/system 回复都写入 `agent_message.sessionId`。
- 不 await 启动 `runTurn`，请求即返回 turnId；`runTurn` 把每条 AgentEvent `XADD` 到 turn 的 Redis Stream，并按 `seq` 累积运行步骤（tool_use 建行、tool_result 按 toolUseId 回填）。
- 订阅 `turns/:turnId/events` 从 Stream 回放 backlog + BLOCK 追尾，多端各自独立游标；断开订阅不影响 turn。
- turn 结束（或被 abort/异常）后补发终止 `done`、回写 `sdkSessionId/status/lastTurnAt`、存完 agent 回复后批量写入 `agent_message_step`、释放活跃指针并给事件流设 TTL。

删除：

- 删除单个 chat：拒绝 busy，驱逐 LiveAgent，删除该 session 的运行步骤、消息和 session。
- 删除 Agent：拒绝其任一 session busy，驱逐全部 LiveAgent，删除所有运行步骤、消息、sessions、Agent。
- 启动回收：进程重启后游离任务已死，单实例下 boot 时清理残留活跃指针并给残留轮补 `done`（`AGENT_RECLAIM_ON_BOOT`，默认开；多实例须关，靠活跃指针安全 TTL 兜底）。

## Validation

- `pnpm -F @agenthub/server typecheck`
- 创建同一 Agent 的两个聊天，分别发送消息，确认 `sdkSessionId`、messages、busy 状态互不影响。
- Claude 聊天验证 skills/MCP 合并；Codex 聊天验证 skills 同步到 `.codex/skills`，Codex MCP 仍应被拒绝。
- 删除 Agent 前若任一聊天 busy，应返回 `AGENT_BUSY`。
- 发起一轮长任务后切走再切回 / 关窗重开，进度应续看；第二个客户端打开同一聊天应实时围观同一 turn；点「停止」turn 应中止且已产出部分落库。
- turn 运行中 `XLEN agent:turn:{turnId}:events` 增长，结束后键带 TTL，会话活跃指针清除。

## Known Limits

- 群聊未实现。
- 聊天消息历史暂不分页。
- 运行步骤已持久化（tool 含完整 input/output），但 tool 入参/返回暂无展开 UI；todo 不重建为面板；空轮次（无回复消息）的步骤不落库。
- clear 不删除 SDK 已落盘的旧会话文件。
- Codex SDK 无显式 dispose API，仍依赖实例上限和 GC。
- 多实例：跨实例 abort 已支持；boot 回收默认仅单实例安全（多实例设 `AGENT_RECLAIM_ON_BOOT=false`，靠活跃指针安全 TTL 兜底）；turn 执行实例未做粘性会话，连续轮靠 `sdkSessionId` 续接。
- turn 事件流在 Redis 仅保留 TTL（默认 1h），晚于 TTL 打开的端回退读 DB 历史。
