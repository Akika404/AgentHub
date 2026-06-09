# 会话工作区变更面板实现计划

## 目标

在单 Agent 聊天和群聊输入框上方展示当前会话工作区相对 AgentHub checkpoint 的累计 git 变更，并支持用户点击提交/确认。点击后后端推进 checkpoint，后续变更重新累计。

## 涉及文件

- `packages/shared/src/workspace-diff.ts`
- `packages/shared/src/index.ts`
- `apps/server/src/multiagents/workspace/workspace-diff.service.ts`
- `apps/server/src/multiagents/dto/workspace-diff-response.dto.ts`
- `apps/server/src/multiagents/dto/workspace-commit.dto.ts`
- `apps/server/src/multiagents/agents.module.ts`
- `apps/server/src/multiagents/agent-manager.service.ts`
- `apps/server/src/multiagents/chats/agent-chat.service.ts`
- `apps/server/src/multiagents/agent-chats.controller.ts`
- `apps/server/src/multiagents/group/group-chat.module.ts`
- `apps/server/src/multiagents/group/group-chat.manager.ts`
- `apps/server/src/multiagents/group/group-chat.controller.ts`
- `apps/desktop/src/renderer/src/api/agents.ts`
- `apps/desktop/src/renderer/src/api/group-chats.ts`
- `apps/desktop/src/renderer/src/components/WorkspaceDiffPanel.vue`
- `apps/desktop/src/renderer/src/components/MessageInput.vue`
- `apps/desktop/src/renderer/src/views/ChatView.vue`

## 实现步骤

1. 新增 shared 类型
   - 定义 `WorkspaceDiffFileStatus`、`WorkspaceDiffFile`、`WorkspaceDiffSummary`、`WorkspaceCommitPayload`、`WorkspaceCommitResult`。
   - 从 shared index 导出。

2. 新增后端 Git 服务
   - `WorkspaceDiffService` 负责初始化/校验 git 仓库、维护 `refs/agenthub/workspace-diff/<scope>/<ownerId>` checkpoint、解析 `status --porcelain -z` / `diff --name-status`、生成 numstat 与单文件 diff。
   - 忽略 `.agenthub/`、`.codex/`、`.claude/`、`.agents/`、`ACTIVE`。
   - 对删除文件和超长 diff 禁止展开。
   - 提交时执行 `git add -A`、确认 staged diff 非空、按需 `git commit`，随后推进 checkpoint 并返回提交后 diff。

3. 接入单 Agent API
   - `AgentChatService` 复用现有 `loadChat` 做用户归属校验，新建聊天后初始化 checkpoint。
   - 新增 `getWorkspaceDiff` 与 `commitWorkspace`；提交前通过 runtime/activeTurn 检查会话空闲。
   - `AgentManager` 与 `AgentChatsController` 暴露 GET/POST 接口。

4. 接入群聊 API
   - `GroupChatService` 创建共享工作区后初始化 checkpoint；`GroupChatManager` load group 后调用 `workspace.repoDir(...)` 定位共享工作区。
   - 提交前检查 `GroupRunStream.getActiveRun(groupId)`，运行中拒绝提交。
   - `GroupChatController` 暴露 GET/POST 接口。

5. 前端 API
   - 在 `agentChatApi`/`groupChatApi` 添加 `getWorkspaceDiff` 和 `commitWorkspace`。

6. 前端 UI
   - 新增 `WorkspaceDiffPanel.vue` 展示文件条、状态颜色、增删行数、展开 diff、刷新与提交按钮。
   - `MessageInput` 接收 diff、loading/error/committing 状态并渲染面板。
   - `ChatView` 按 session key 缓存 diff；选择会话、turn/run 完成、提交成功后刷新。

7. 验证
   - 跑 `pnpm -F @agenthub/server typecheck`。
   - 跑 `pnpm -F @agenthub/desktop typecheck`。
   - 如有现有测试受影响，补跑最小相关测试。

## 风险与处理

- 未跟踪文件 diff 需要避免把运行态目录展示出来，后端统一过滤。
- 提交真实修改工作区，必须在运行中禁用/拒绝。
- 大 diff 不传给前端，避免输入区卡顿。
