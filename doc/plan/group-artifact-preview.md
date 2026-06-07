# 群聊产出物文件预览实现计划

## 1. 共享类型

- 在 `packages/shared/src/blackboard.ts` 增加 `BlackboardArtifactPreviewKind` 与 `BlackboardArtifactPreview`。

## 2. 后端接口

- 新增 `GroupArtifactPreviewService`：
  - 通过 artifact id 查询黑板产出物。
  - 校验路径位于群聊工作区内。
  - 拒绝 `.codex`、`.agents`、`.claude` 目录。
  - 按扩展名生成文本内容、data URL 或受限预览响应。
- 在 `BlackboardService` 增加按 id 读取 artifact 的方法。
- 在 `GroupChatManager` 增加 `getArtifactPreview`。
- 在 `GroupChatController` 增加 `GET /group-chats/:id/blackboard/artifacts/:artifactId/preview`。
- 在 `blackboard-response.dto.ts` 增加 Swagger DTO。
- 在 `GroupChatModule` 注册新 service。

## 3. 前端 API 与组件

- 在 `apps/desktop/src/renderer/src/api/group-chats.ts` 增加 `getArtifactPreview`。
- 新增 `ArtifactPreviewDrawer.vue`：
  - 接收 `groupId` 与 artifact。
  - 自行加载预览接口。
  - 按 `previewKind` 渲染文本、HTML、PDF、媒体或受限状态。
- 修改 `BlackboardSidebar.vue` 与 `GroupDetailPanel.vue`：
  - 产出物条目改为可点击按钮。
  - emit `open-artifact`。
- 修改 `ChatView.vue` 与 `GroupChatView.vue`：
  - 保存当前预览选择。
  - 传入 `ArtifactPreviewDrawer`。
  - 切换会话/群聊时关闭旧预览。

## 4. 文档与验证

- 更新 `apps/server/README.md` 的群聊 API 表。
- 回顾 spec 的 Known Limits。
- 执行 shared/server/desktop typecheck。
