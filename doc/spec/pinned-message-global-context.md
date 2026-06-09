# Pin 消息进入会话全局上下文

## Context

当前单 Agent 聊天和群聊都有消息 Pin UI，但 Pin 状态只存在于前端本地缓存，刷新、跨端和后续 Agent 运行都不会感知。该功能将消息 Pin 升级为服务端持久化状态，并把当前会话内的 pinned 消息作为后续运行的固定上下文注入。

范围限定为当前会话内：

- 单聊 pinned 消息只影响同一个 agent chat 的后续 turn。
- 群聊 pinned 消息只影响同一个 group 的后续 Orchestrator 决策、成员任务执行和轻量成员回复。
- 不提供用户级、工作区级或跨会话全局 Pin。

## Model

- `agent_message.pinned`: `tinyint NOT NULL DEFAULT 0`，表示单聊消息是否被 Pin。
- `group_message.pinned`: `tinyint NOT NULL DEFAULT 0`，表示群聊展示层消息是否被 Pin。
- `AgentChatMessageView` 与 `GroupMessageView` 对外返回 `pinned`，供前端刷新/跨端复原 Pin UI。

Pinned 消息上下文为运行时派生内容，不新增独立上下文表。

## Backend API

| Method | Path | 说明 |
|--------|------|------|
| `PATCH` | `/api/agent-chats/:chatId/messages/:messageId` | 修改单聊消息 Pin 状态，body 为 `{ pinned?: boolean }`，返回更新后的消息 |
| `PATCH` | `/api/group-chats/:id/messages/:messageId` | 修改群聊消息 Pin 状态，body 为 `{ pinned?: boolean }`，返回更新后的消息 |

归属校验必须同时匹配当前用户与当前 chat/group。找不到消息或会话时返回 `NOT_FOUND`。归档会话允许 Pin/Unpin，因为它只修改消息标注，不发起新运行。

## Runtime Flow

- 单聊发起 turn 时，服务端读取当前 chat 中 pinned 消息，按创建时间升序渲染为 `# Pinned messages (会话内全局上下文)` 块，置于用户 prompt 前；如果本轮带引用，则顺序为 pinned block、引用块、本轮 prompt。
- 群聊 Orchestrator 决策前读取当前 group 中 pinned 消息，放入 `OrchestratorContext.pinnedMessages`，并在 Orchestrator prompt 的决策信息内渲染。
- 群聊成员任务执行时，`ContextAssembler` 把 pinned 消息渲染为高优先级保底段，位于 TaskContext 后、可裁剪 memory/decisions 前。
- 群聊轻量成员回复同样在成员 prompt 中注入 pinned 消息，保持与任务执行一致。
- Pinned 消息最多注入 20 条，总文本预算约 4000 字符，超出时截断并标注省略数量或截断状态。

## Validation

- 单聊消息 Pin/Unpin 后刷新仍保留状态，消息列表返回 `pinned`。
- 群聊消息 Pin/Unpin 后刷新仍保留状态，消息列表返回 `pinned`。
- 单聊后续 turn 的 SDK prompt 包含 pinned block。
- 群聊 Orchestrator、成员任务和轻量成员回复 prompt 均包含 pinned block。
- 非当前用户、非当前会话消息不能被 Pin/Unpin。

## Known Limits

- 暂不做跨 chat/group 的用户级全局上下文。
- 暂不做项目/工作区级共享 Pin。
- 暂不做独立 Pin 管理页、排序拖拽、Pin 说明编辑或 token 可视化。
- Pinned 上下文使用规则化文本摘要，不调用 LLM 压缩。
