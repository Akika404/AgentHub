# Message Image Cards

> 群聊消息气泡中的图片附件发送与图片卡片展示功能，覆盖桌面端输入区、消息气泡、群聊附件预览 API。

## Context

群聊已经支持通过 `MessageInput` 上传附件，并在发送时通过 `attachmentIds` 让后端把文件复制到共享工作区。当前消息气泡只把所有附件显示为普通文件行，无法在输入前预览图片，也无法在历史消息中以内联图片卡片形式查看图片。

本功能在现有群聊附件链路上补齐图片体验：

- 输入区选择或拖拽图片后展示缩略卡片，并继续支持普通文件 chip。
- 用户发送图片附件后，消息气泡展示图片卡片；非图片仍展示文件卡片。
- 已发送并被后端消费到工作区的图片附件可通过附件预览 API 加载 data URL，历史消息重载后仍能展示图片。
- 点击图片卡片可在新标签打开图片 data URL；加载失败时降级为普通文件卡片信息。

## Model

复用现有 `GroupAttachmentView`：

- `id`：附件 id。
- `groupChatId`：所属群聊 id。
- `originalName`：上传文件名。
- `mimeType`：MIME 类型，用于识别图片附件。
- `size`：文件大小。
- `workspacePath`：发送并消费后生成的工作区相对路径；预览 API 要求其存在。
- `createdAt`：创建时间。

新增 `GroupAttachmentPreview`：

- `attachment`：对应的 `GroupAttachmentView`。
- `fileName`、`extension`、`mimeType`、`size`：文件预览元信息。
- `previewKind`：复用 `BlackboardArtifactPreviewKind`，图片为 `image`。
- `content`：文本类预览内容，本功能不在 UI 中展示。
- `dataUrl`：图片/PDF/音视频等可预览文件的 data URL；图片卡片使用该字段渲染缩略图。
- `message`：无法预览时的说明。

前端本地发送中的图片附件会临时创建 `Object URL`，只用于乐观显示；服务端返回历史消息后以后端预览为准。

## Backend API

| Method | Path                                                 | 说明                                                   |
| ------ | ---------------------------------------------------- | ------------------------------------------------------ |
| `POST` | `/group-chats/:id/attachments`                       | 既有接口，上传附件文件。                               |
| `POST` | `/group-chats/:id/converse`                          | 既有接口，通过 `attachmentIds` 发送附件并启动群运行。  |
| `GET`  | `/group-chats/:id/attachments/:attachmentId/preview` | 新增接口，读取已消费到工作区的附件并返回预览 payload。 |

`GET /group-chats/:id/attachments/:attachmentId/preview` 行为：

- 校验当前用户拥有该群聊。
- 校验附件属于该群聊和当前用户。
- 未消费到工作区的附件返回 bad request。
- 工作区文件不存在返回 not found。
- 路径安全与文件预览类型复用 `@agenthub/agent-core` 的 `buildArtifactPreview`。

## Runtime Flow

1. 用户在群聊输入区点击附件按钮、图片按钮或拖拽文件。
2. `MessageInput` 校验最多 5 个附件、单文件不超过 25MB。
3. 图片文件在输入区以缩略卡片展示，普通文件保持紧凑 chip。
4. 发送时前端先追加本地乐观消息；图片附件带本地 Object URL 用于立即显示。
5. 前端逐个调用附件上传接口，再把返回的附件 id 传给群聊 `converse`。
6. 后端把附件复制到共享工作区 `attachments/<runId>/...`，并把附件快照写入用户消息 payload。
7. 消息气泡中的附件列表按 MIME/扩展名识别图片，图片以卡片显示。
8. 对没有本地预览但已有 `workspacePath` 的图片附件，前端调用附件预览 API 获取 data URL 后渲染。
9. 对未加载完成、加载失败或非图片附件，前端显示普通文件信息卡片。

## Validation

- 选择 PNG/JPEG/WebP/GIF/SVG 后，输入区出现图片缩略卡片，点击移除后不再发送。
- 拖拽图片到输入区与点击选择文件路径行为一致。
- 发送图片附件后，本地消息立即展示图片卡片。
- 历史消息重新加载后，图片附件通过预览 API 展示图片卡片。
- 普通文件附件仍展示文件卡片，不受图片逻辑影响。
- 后端附件预览接口拒绝未消费、越权或不存在的附件。
- 运行 `pnpm -F @agenthub/shared typecheck`、`pnpm -F @agenthub/server typecheck`、`pnpm -F @agenthub/desktop typecheck`。

## Known Limits

- 当前仅支持群聊图片附件；单聊没有附件上传协议，本功能不扩展单聊消息发送接口。
- 图片卡片使用 data URL/object URL 渲染，不新增独立下载接口。
- 输入区本地预览只在当前渲染进程内有效；发送成功后的历史预览依赖后端附件预览 API。
- 大于预览构建器限制的图片会降级展示为普通文件信息。
