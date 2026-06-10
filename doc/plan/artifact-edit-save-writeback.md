# 产物编辑保存写回实现计划

## 1. 共享契约与核心文件工具

- 在 `packages/shared/src/blackboard.ts` 为 `BlackboardArtifactPreview` / `ArtifactFilePreview` 增加 `editableContent`。
- 新增 `ArtifactContentUpdatePayload`。
- 在 `packages/agent-core/src/workspace/artifact-preview.ts`：
  - 让预览构建器为 text/html 返回原始 `editableContent`。
  - 新增 `writeArtifactEditableContent(repoDir, relPath, content)`。
  - 复用现有路径边界与隐藏目录校验。
  - 只允许 text/html 写回，并限制写回内容大小。

## 2. 后端 API

- 单聊：
  - `AgentChatService.saveArtifactContent`：归属校验、active turn 检查、本地模式 RPC 或 server 文件写回。
  - `AgentManager.saveArtifactContent` 门面。
  - `AgentChatsController` 新增 `PUT :chatId/artifacts/content?path=...`。
- 群聊：
  - `GroupArtifactPreviewService.saveContent`：按 artifact id 定位、写回 repo 文件、刷新黑板 artifact。
  - `GroupChatManager.saveArtifactContent`：归属校验、active run 检查。
  - `GroupChatController` 新增 `PUT :id/blackboard/artifacts/:artifactId/content`。
- DTO：
  - 增加保存请求 DTO 与预览响应 `editableContent` Swagger 字段。

## 3. 本地 runner

- 在 `LocalRunnerRpcMap` 新增 `artifact.write`。
- `apps/desktop/src/main/local-runner.ts` 处理该 RPC，调用 `writeArtifactEditableContent`。

## 4. 桌面端 UI

- 在 `agentChatApi` / `groupChatApi` 增加保存方法。
- `ArtifactPreviewOverlay.vue`：
  - 使用 `editableContent` 初始化 textarea。
  - 增加保存按钮、保存中状态、脏状态、成功/失败提示。
  - 保存成功后用返回预览刷新编辑器和标题元信息。
  - 非 text/html 或缺少 `editableContent` 时保持只读提示。

## 5. 验证与文档回顾

- 跑 shared/agent-core/server/desktop focused typecheck。
- 回顾 spec 与 README。若 README 对产物编辑仍只描述“预览”，同步补充保存说明。
