# 聊天列表搜索、归档与跨端置顶 Plan

## Steps

1. 扩展共享契约：为单聊/群聊视图增加 `isPinned`、`archivedAt`，为更新 payload 增加列表状态字段。
2. 扩展后端模型：在 `agent_session` 与 `group_chat` 实体中加入置顶与归档字段，同步 SQL 存档。
3. 扩展后端 API：新增单聊 `PATCH /agent-chats/:chatId`，在群聊 `PATCH /group-chats/:id` 支持 `isPinned` 与 `archived`。
4. 加服务端防线：单聊/群聊已归档时拒绝新 `converse`。
5. 接入桌面端列表：搜索框驱动本地过滤，右键菜单支持置顶/归档，列表状态来自后端返回值。
6. 接入桌面端输入区：已归档聊天禁用输入并显示“已归档”。
7. 同步 README 与最小验证。

## Files

- `packages/shared/src/agent.ts`
- `packages/shared/src/group-chat.ts`
- `apps/server/src/multiagents/entities/agent-session.entity.ts`
- `apps/server/src/multiagents/chats/agent-chat.service.ts`
- `apps/server/src/multiagents/agent-chats.controller.ts`
- `apps/server/src/multiagents/group/entities/group-chat.entity.ts`
- `apps/server/src/multiagents/group/group-chat.service.ts`
- `apps/server/src/multiagents/group/run/group-run.executor.ts`
- `apps/desktop/src/renderer/src/views/ChatView.vue`
- `apps/desktop/src/renderer/src/components/ChatList.vue`
- `apps/desktop/src/renderer/src/components/MessageInput.vue`
- SQL/README 文档

## Notes

- 单聊归档使用 `archivedAt` 独立字段，不复用 `status`，避免和 `cleared/suspended` 运行状态互相覆盖。
- 群聊继续保留现有 `status=archived` 对外语义，并新增 `archivedAt` 作为归档字段。
