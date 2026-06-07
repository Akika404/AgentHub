# 群聊产出物文件预览

> 模块目录：`apps/server/src/multiagents/group/`、`apps/desktop/src/renderer/src/components/`、`packages/shared/src/`。

## Context

群聊黑板中的产出物目前只展示路径、版本和摘要。用户需要点击产出物后，从右侧弹出一个文件预览侧边栏，直接查看工作区里的真实文件内容：

- `txt`、代码、Markdown、JSON 等文本文件直接显示内容。
- `html` 文件在预览区域内打开渲染预览。
- `pdf`、图片、音频、视频等浏览器可内嵌资源在预览区域打开。
- `ppt` / `pptx` 等 Office 文件打开同一个预览侧边栏，但当前版本先显示受限预览状态与文件信息。
- `.codex`、`.agents`、`.claude` 目录下的产出物不能出现在列表中，也不能通过预览接口读取。

## Model

新增共享类型 `BlackboardArtifactPreview`：

- `artifact`: 对应的黑板产出物。
- `fileName`、`extension`、`mimeType`、`size`: 文件元信息。
- `previewKind`: `text | html | pdf | image | audio | video | office | binary | too_large`。
- `content`: 文本/HTML 内容；非文本为 `null`。
- `dataUrl`: 可内嵌预览的二进制资源 data URL；不可内嵌时为 `null`。
- `message`: 受限状态说明；正常可预览时为 `null`。

不新增数据库实体，预览内容按需从群聊共享工作区读取。

## Backend API

| Method | Path                                                       | 说明                         |
|--------|------------------------------------------------------------|------------------------------|
| `GET`  | `/group-chats/:id/blackboard/artifacts/:artifactId/preview` | 读取当前群聊某个产出物的预览 |

接口规则：

- 先按 `userId + groupChatId` 校验群聊归属。
- 再按 `artifactId + groupChatId` 找黑板产出物。
- 文件路径只来自黑板产出物，不接受前端传任意 path。
- 解析到群聊共享工作区根目录内；绝对路径、路径穿越和隐藏 agent 目录直接拒绝。
- 文件过大时不返回正文，返回 `previewKind: "too_large"`。

## Runtime Flow

1. 用户在群聊黑板侧栏或群详情产出物列表点击某个产出物。
2. 前端打开右侧预览抽屉，并调用预览接口。
3. 后端读取黑板产出物与对应工作区文件，按扩展名和 MIME 类型生成预览响应。
4. 前端按 `previewKind` 渲染：
   - `text`: `<pre>` 直接显示。
   - `html`: sandboxed iframe 通过主进程自定义协议 `agent-preview://` 渲染 HTML，并尽力内联同工作区内的相对 JS/CSS/媒体资源。
   - `pdf`: iframe 渲染 PDF data URL。
   - `image` / `audio` / `video`: 对应原生 media 元素。
   - `office` / `binary` / `too_large`: 显示受限预览状态。
5. 用户关闭抽屉后回到原群聊视图。

## Validation

- `pnpm -F @agenthub/shared typecheck`
- `pnpm -F @agenthub/server typecheck`
- `pnpm -F @agenthub/desktop typecheck:web`
- 手动验证：点击文本、HTML、PDF、PPT/PPTX 类型产出物时均打开预览抽屉；隐藏目录产出物不展示且接口不可读取。

## Known Limits

- 当前不引入 Office 转换服务；PPT/PPTX 只能打开预览侧栏并显示文件元信息，不能内嵌渲染幻灯片。
- HTML 通过 sandboxed `agent-preview://` iframe 预览（自定义协议有自己的响应头，不会继承主应用的严格 CSP，因此内联脚本可正常执行），并会尽力内联同工作区内的相对资源；动态网络请求、复杂路由或运行时生成的资源路径仍可能无法解析。
- 预览接口有大小限制，超大文件只显示受限状态。
