# 用户文件工作区隔离 Plan

## Steps

1. 新增 `UserWorkspaceService` 与 `UserWorkspaceModule`，负责读取 `AGENTHUB_USER_SPACE_ROOT`、创建用户四类目录、返回 roots、校验路径归属。
2. 更新 `workspace-fs`：
   - controller 使用 `@CurrentUser()` 传入当前用户。
   - service 改为基于 `UserWorkspaceService` 返回和校验用户 roots。
3. 更新 Agent/单聊路径链路：
   - Agent 创建/更新对 `workingDirectory`、`agentHomeDirectory`、`skillSourceDirectories` 做对应 root 校验。
   - Agent 创建未传 home 时分配到 `agent_home/<agentId>`。
   - 单聊创建先生成 `sessionId`，未传 workspace 时分配到 `agent_workspace/chat-<sessionId>`，session home 固定为 `session/<sessionId>`。
4. 更新群聊路径链路：
   - 创建群聊前校验或分配 `workspaceDir` 到当前用户 `agent_workspace`。
   - `GroupWorkspaceService` 保持 git/worktree 生命周期职责，不再决定默认跨用户根。
5. 更新共享类型、Swagger DTO、README 与测试。

## Files

- `apps/server/src/user-workspace/*`
- `apps/server/src/workspace-fs/*`
- `apps/server/src/multiagents/agents/agent-config.service.ts`
- `apps/server/src/multiagents/chats/agent-chat.service.ts`
- `apps/server/src/multiagents/group/group-chat.service.ts`
- `packages/shared/src/workspace-fs.ts`
- `apps/server/README.md`

## Verification

- 扩展 `workspace-fs.service.spec.ts` 覆盖用户 root 隔离和跨用户拒绝。
- 新增 `user-workspace.service.spec.ts` 覆盖路径校验、自动分配目录、skill/root 限制。
- 运行 `pnpm -F @agenthub/server test` 和 `pnpm -F @agenthub/server typecheck`。
