# 消息重新生成

> 单聊消息右键菜单中的重新生成能力。桌面端入口位于
> `apps/desktop/src/renderer/src/components/MessageList.vue` 与
> `apps/desktop/src/renderer/src/views/ChatView.vue`；后端接口位于
> `apps/server/src/multiagents/agent-chats.controller.ts`。

## Context

当前消息右键菜单支持 Pin、复制、回复。用户需要在单 Agent 聊天中对已有消息触发“重新生成”，让 Agent 基于该消息关联的用户输入重新产出一条新的回复。

功能范围：

- 仅支持单 Agent 聊天。
- 右键用户消息时，使用该用户消息原文作为重新生成 prompt。
- 右键 Agent 回复时，服务端向前查找最近一条用户消息，并使用该用户消息原文作为重新生成 prompt。
- 重新生成启动新的后台 turn，沿用现有 SSE 订阅、运行中状态、工作区 diff 与历史刷新流程。
- 重新生成不会重复落库一条用户消息；新结果以新的 Agent 回复消息追加到历史末尾。

## Model

不新增数据库表或字段。

复用现有模型：

- `AgentMessage`：按 `sessionId` 查询当前聊天历史，解析被点击消息对应的用户 prompt。
- `AgentSession`：沿用当前聊天的 Agent、工作目录、SDK 会话句柄与 active turn 锁。
- `StartTurnResult`：复用 `{ turnId: string }` 作为重新生成接口返回值。

## Backend API

| Method | Path                                                  | 说明                                                                 |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `POST` | `/agent-chats/:chatId/messages/:messageId/regenerate` | 基于当前消息解析最近用户 prompt，启动一轮重新生成，返回 `{ turnId }` |

归属校验：

- `chatId` 必须属于当前用户且为单聊 `scope=user`。
- `messageId` 必须属于该聊天。
- 归档聊天拒绝重新生成。
- 当前聊天已有 active turn 时返回 `AGENT_BUSY`。

## Runtime Flow

1. 桌面端在单聊消息右键菜单中显示“重新生成”。
2. 用户点击菜单项后，前端调用 `POST /agent-chats/:chatId/messages/:messageId/regenerate`。
3. 服务端读取当前聊天历史：
   - 如果目标消息是用户消息，直接使用该消息文本与 `replyTo`。
   - 如果目标消息不是用户消息，则向前查找最近一条用户消息。
4. 服务端获取 active turn 锁并重建/复用当前 `LiveAgent`。
5. 服务端构建 SDK prompt：pinned 上下文、原用户消息引用上下文、原用户消息正文；不额外保存用户消息。
6. 服务端后台运行 turn 并通过现有 turn stream 发布事件。
7. 桌面端订阅该 turn，显示一条新的 Agent 运行消息；结束后刷新后端权威历史。

## Validation

- 单聊用户消息右键菜单出现“重新生成”，点击后启动新 turn。
- 单聊 Agent 回复右键菜单出现“重新生成”，点击后基于前一条用户消息启动新 turn。
- 运行中或归档聊天中该菜单项禁用。
- 重新生成不会在历史中追加重复用户消息。
- 群聊消息不显示重新生成入口。
- 类型检查通过，服务端相关单元测试通过。

## Known Limits

- 暂不支持群聊重新生成；群聊涉及 Orchestrator、成员任务、附件和黑板状态，后续需要单独定义语义。
- 重新生成不会截断或删除旧回复，也不会回滚工作区文件；新回复追加到当前会话末尾。
- SDK 运行会话仍沿用当前 chat 的底层会话句柄，因此模型侧上下文不是“时间旅行到历史消息当时状态”。
