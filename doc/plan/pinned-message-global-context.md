# Pin 消息进入会话全局上下文实现计划

## Summary

把消息 Pin 状态落库并回传到前端；后续单聊 turn、群聊 Orchestrator 决策、成员任务执行和轻量成员回复都注入当前会话内 pinned 消息摘要。

## Backend Changes

- 在 `AgentMessage` 和 `GroupMessage` 实体增加 `pinned` 字段，并同步更新 SQL 参考脚本。
- 更新单聊/群聊消息 mapper、DTO 和 shared 类型，让消息 view 携带 `pinned`。
- 新增消息更新 DTO `{ pinned?: boolean }`。
- 单聊新增 `PATCH /agent-chats/:chatId/messages/:messageId`，在 `AgentChatService` 内校验 chat 归属后委托消息历史服务更新。
- 群聊新增 `PATCH /group-chats/:id/messages/:messageId`，在 `GroupChatManager` 内校验 group 归属后委托群消息服务更新。

## Runtime Context Changes

- 新增服务端 pinned 消息摘要渲染逻辑，统一限制最多 20 条、约 4000 字符。
- 单聊 `AgentRuntimeService.startTurn` 在构建 SDK prompt 时注入 pinned block，再拼引用块和本轮 prompt。
- 群聊 `OrchestratorContext` 增加 pinned message 文本，prompt 决策信息中渲染。
- 群聊 `ContextAssembler` 读取并渲染 group pinned messages，作为保底上下文段。
- 群聊 `MemberChatService` 在轻量回复 prompt 前注入 group pinned messages。

## Frontend Changes

- `agentChatApi` 和 `groupChatApi` 增加消息更新方法。
- 单聊消息映射和群聊消息映射保留服务端 `pinned`。
- `ChatView.vue` 的 Pin/Unpin 从本地布尔翻转改为调用对应 PATCH API，成功后更新本地缓存。

## Tests

- 增加服务端 focused specs 覆盖消息 Pin 持久化、归属校验、单聊 pinned prompt、群聊上下文 prompt。
- 跑 `pnpm -F @agenthub/server typecheck`、`pnpm -F @agenthub/desktop typecheck` 和相关 server specs。
