AgentManager 后端实现方案

> 本文描述 `apps/server/src/mutiagents/` 的当前设计。字段与接口以实体和 shared 契约为准。

## Context

AgentHub 的 Agent 是用户创建的虚拟员工配置，底层由 Claude / Codex adapter 驱动。Agent 本身不再等同于聊天；用户可以基于同一个 Agent 创建多个独立的单 Agent 聊天会话。群聊仍是后续独立模块。

核心决策：

- Agent 只保存可复用配置：展示名、头像/颜色标识、vendor、Provider、model、默认目录、system prompt、skills/MCP/tools 等。
- AgentSession 是一个具体单聊会话：title、workingDirectory、sessionHomeDirectory、sdkSessionId、有效 skills/MCP、status。
- AgentMessage 按 `sessionId` 隔离 UI 消息历史。
- LiveAgent 按 `session.id` 存在内存中，同一个 Agent 的不同聊天可以并行运行，只有同一 chat 会互斥。

## Model

| 概念         | 存储            | 说明                                       |
| ------------ | --------------- | ------------------------------------------ |
| Agent        | `agent`         | 用户拥有的 Agent 配置，不存 apiKey/baseUrl |
| AgentSession | `agent_session` | 单 Agent 聊天会话和底层 SDK 句柄           |
| AgentMessage | `agent_message` | 主聊天区可见文本历史，按 sessionId 隔离    |
| LiveAgent    | memory          | adapter + busy + abort + LRU 时间戳        |

凭证仍来自 `PlatformProviderService.resolveRuntimeConfig(userId, platformProviderId)`，仅后端内部使用。

## Backend API

所有接口前缀为 `/api`，成功响应走统一信封，全部需 JWT。

| Method     | Path                                    | 说明                               |
| ---------- | --------------------------------------- | ---------------------------------- |
| `POST`     | `/agents`                               | 创建 Agent 配置，不开聊天          |
| `GET`      | `/agents`                               | 当前用户 AgentList                 |
| `GET`      | `/agents/:agentId`                      | Agent 详情                         |
| `DELETE`   | `/agents/:agentId`                      | 删除 Agent，并删除其所有聊天和消息 |
| `POST`     | `/agent-chats`                          | 创建单 Agent 聊天                  |
| `GET`      | `/agent-chats`                          | 当前用户的聊天列表                 |
| `GET`      | `/agent-chats/:chatId`                  | 聊天详情                           |
| `GET`      | `/agent-chats/:chatId/messages`         | 聊天消息历史                       |
| `GET @Sse` | `/agent-chats/:chatId/converse?prompt=` | 聊天 SSE 对话流                    |
| `POST`     | `/agent-chats/:chatId/clear`            | 清空聊天句柄和消息                 |
| `DELETE`   | `/agent-chats/:chatId`                  | 删除聊天                           |

## Runtime Flow

创建聊天：

- 校验 Agent 归属和 vendor 能力。
- `workingDirectory` 必填并规范化。
- 创建 `sessionHomeDirectory = <agentHomeDirectory>/.agenthub/chats/<chatId>`。
- Claude 会复制 Agent 私有 skills 到会话 home，再导入本聊天的 skill 文件夹。
- 有效 skills = Agent 原 skills + 导入 skill 名称；有效 MCP = Agent MCP 与聊天 MCP 浅合并。
- 保存 AgentSession，不启动 SDK。

对话：

- 按 `chatId` 加载 AgentSession，再加载 Agent。
- Adapter config 中，模型/Provider/systemPrompt/tools/permission/reasoning 来自 Agent；cwd/home/skills/MCP 来自 AgentSession。
- `registry` 和 busy 锁使用 `session.id`。
- 用户消息和 Agent/system 回复都写入 `agent_message.sessionId`。
- turn 结束后回写 `sdkSessionId/status/lastTurnAt`。

删除：

- 删除单个 chat：拒绝 busy，驱逐 LiveAgent，删除该 session 的消息和 session。
- 删除 Agent：拒绝其任一 session busy，驱逐全部 LiveAgent，删除所有消息、sessions、Agent。

## Validation

- `pnpm -F @agenthub/server typecheck`
- 创建同一 Agent 的两个聊天，分别发送消息，确认 `sdkSessionId`、messages、busy 状态互不影响。
- Claude 聊天验证 skills/MCP 合并；Codex 聊天传 skills/MCP 应被拒绝。
- 删除 Agent 前若任一聊天 busy，应返回 `AGENT_BUSY`。

## Known Limits

- 群聊未实现。
- 聊天消息历史暂不分页。
- clear 不删除 SDK 已落盘的旧会话文件。
- Codex SDK 无显式 dispose API，仍依赖实例上限和 GC。
