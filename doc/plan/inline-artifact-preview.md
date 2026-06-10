# Agent 回复内联产物预览卡片实现计划

对应 PRD ART-2。spec 见 `doc/spec/inline-artifact-preview.md`。

## 1. 共享类型 `packages/shared/`

- `group-chat.ts`：`blackboard_update` 事件补 `taskId` / `agentId` / `artifact?`。
- `chat.ts`：`GroupTextMessageView` 加 `artifacts?: BlackboardArtifact[]`。
- `types/chatDisplay.ts`（desktop 渲染层）：`AgentRunMessage` 加 `artifacts?: BlackboardArtifact[]`。

## 2. 后端 `apps/server/`

- `run/dispatch.service.ts`：
  - 收口写回时用 `producedArtifacts` Map 收集 `upsertArtifact` 返回的完整产物。
  - 发 `blackboard_update` 带 `taskId`/`agentId`，artifact 类附完整 `artifact`。
  - `appendText` 传入本回合产物数组。
- `group-message.service.ts`：`appendText` 加可选 `artifacts` 参数，存进 `payload.artifacts`。
- `mappers/group-message.mapper.ts`：`text` 分支还原 `artifacts`。

## 3. 前端 `apps/desktop/`

- 新增 `utils/artifactPreview.ts`：`isInlinePreviewable` + 图标/文件名/类型标签。
- 抽出 `components/ArtifactPreviewBody.vue`（previewKind 渲染 + `agent-preview://` 协议）。
- `components/ArtifactPreviewDrawer.vue` 重构为复用 body。
- 新增 `components/ArtifactPreviewOverlay.vue`（全屏文件窗口，text/html 用源码 textarea，不复用 HTML 预览 body）。
- `messages/AgentRunMessage.vue`：渲染内联占位卡 + emit `preview-artifact` / `edit-artifact`。
- `components/MessageList.vue`：透传预览和编辑事件。
- `utils/groupMessage.ts`：复原时注入 `artifacts`。
- `views/ChatView.vue`：`previewArtifact` 抽屉预览 + `overlayArtifact` 全屏编辑 + `appendRunArtifact` helper + `blackboard_update` 接线 + 会话切换清空。

## 4. 文档与验证

- 更新 `doc/message-card-spec.md`（agent-run 内联产物段）。
- 更新 `README.md` ART-2 状态。
- 执行 shared / server / desktop typecheck。
