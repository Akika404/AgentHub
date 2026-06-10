# Message Image Cards Plan

## Scope

在现有群聊附件链路上新增图片发送体验和消息气泡图片卡片展示。实现范围包括 shared 类型、NestJS 群聊附件预览 API、桌面端输入预览、消息气泡附件卡片。

## Steps

1. Shared contract
   - 在 `packages/shared/src/chat.ts` 增加 `GroupAttachmentPreview` 类型。
   - 复用 `ArtifactFilePreview` 与 `BlackboardArtifactPreviewKind`，避免重复定义预览 payload。

2. Backend API
   - 在 `GroupAttachmentService` 增加 `preview(userId, group, attachmentId)`。
   - 通过附件表按 `id/userId/groupChatId` 查找附件，要求 `workspacePath` 非空。
   - 使用 `GroupWorkspaceService.repoDir` 和 `buildArtifactPreview` 构建预览。
   - 在 `GroupChatManager` 增加 `previewAttachment` 门面。
   - 在 `GroupChatController` 增加 `GET /group-chats/:id/attachments/:attachmentId/preview`。
   - 在 DTO 中补充 Swagger response 类型。
   - 在 `group-attachment.service.spec.ts` 增加成功预览与未消费拒绝测试。

3. Desktop API
   - 在 `apps/desktop/src/renderer/src/api/group-chats.ts` 增加 `getAttachmentPreview`。

4. Message input UI
   - 在 `MessageInput.vue` 中为图片文件创建/释放 Object URL。
   - 新增图片选择按钮，文件选择器接受 `image/*` 时只唤起图片选择。
   - 输入区将图片显示为缩略卡片，普通文件继续显示为 chip。

5. Message bubble UI
   - 更新 `AttachmentList.vue`：识别图片附件，展示图片卡片。
   - 对本地乐观附件使用 `previewUrl`，对历史附件通过 `getAttachmentPreview` 获取 data URL。
   - 加载失败或非图片附件降级为现有文件卡片样式。

6. Chat view glue
   - 扩展本地乐观附件对象，给图片附件附加 `previewUrl`。
   - 在发送失败、消息移除或组件卸载时释放 Object URL，避免泄漏。

7. Documentation and validation
   - 回顾 spec 的 Known Limits。
   - 更新 `apps/desktop/README.md` 的组件说明。
   - 运行 shared/server/desktop typecheck，以及相关 server attachment 单测。
