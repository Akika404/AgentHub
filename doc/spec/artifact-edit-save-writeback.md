# 产物编辑保存写回

> 为桌面端产物编辑浮层补齐保存能力。涉及 `packages/agent-core` 的文件写回工具、`packages/shared` 的产物预览契约、`apps/server` 的单聊/群聊写回 API，以及 `apps/desktop` 的编辑浮层。

## Context

当前产物卡片可以打开预览抽屉，也可以进入全屏编辑浮层；编辑浮层对文本类产物展示 textarea，但修改只存在于前端状态，关闭后不会写回工作区文件。

本功能为现有产物编辑补充“保存到工作区文件”能力：

- 支持单聊产物：按聊天工作目录相对路径写回。
- 支持群聊黑板产物：按 artifact id 定位黑板产物，再写回群工作区文件。
- 仅支持可编辑文本类产物：`text` 与 `html`。
- HTML 预览仍使用内联资源后的内容，编辑保存使用原始 HTML 文件内容，避免把预览内联内容写回源文件。
- 保存成功后返回最新产物预览，用于刷新 size/content/metadata。
- 单聊 turn 或群聊 run 正在运行时拒绝保存，避免用户写回与 Agent 写文件并发冲突。

## Model

复用 `BlackboardArtifactPreview`，新增字段：

- `editableContent: string | null`：编辑器使用的原始可写内容。`text` 与 `html` 产物有值；不可编辑类型为 `null`。

新增共享 payload：

- `ArtifactContentUpdatePayload`
  - `content: string`
  - `baseVersion?: number`

`baseVersion` 主要用于群聊黑板产物的轻量版本保护；单聊产物没有真实黑板版本，可忽略。

## Backend API

| Method | Path | 说明 |
|--------|------|------|
| `PUT` | `/agent-chats/:chatId/artifacts/content?path=<workspace-relative-path>` | 保存单聊工作区产物文件内容 |
| `PUT` | `/group-chats/:id/blackboard/artifacts/:artifactId/content` | 保存群聊黑板产物对应工作区文件内容 |

两个接口请求体均为 `ArtifactContentUpdatePayload`，响应均为 `BlackboardArtifactPreview`。

## Runtime Flow

1. 用户从产物卡片点击“编辑文件”，打开 `ArtifactPreviewOverlay`。
2. 前端加载产物预览，并使用 `preview.editableContent` 填充编辑器。
3. 用户修改后点击保存。
4. 前端按来源调用单聊或群聊保存 API。
5. 后端校验用户归属、运行状态、路径边界、文件类型和内容大小。
6. 写回工作区文件。
7. 群聊产物写回后更新黑板 artifact 元数据并追加黑板事件。
8. 后端重新构建并返回最新预览，前端清除脏状态并展示保存结果。

## Validation

- `pnpm -F @agenthub/shared typecheck`
- `pnpm -F @agenthub/agent-core typecheck`
- `pnpm -F @agenthub/server typecheck`
- `pnpm -F @agenthub/desktop typecheck`

## Known Limits

- 仅支持 UTF-8 文本与 HTML 源文件写回；图片、PDF、Office、二进制和过大文件仍只读。
- 群聊 `baseVersion` 只做保存前版本检查；没有引入细粒度文件锁。运行中的群 run 会被拒绝保存来规避最常见冲突。
- 单聊产物没有持久化 artifact 版本，保存接口按 path 写回并返回合成 artifact 元信息。
- 黑板 artifact 当前只有 agent actor 字段；人工保存会更新版本和事件，但 `updatedByAgentId` 暂沿用原产物的 agent 标识。
