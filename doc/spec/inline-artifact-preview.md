# Agent 回复内联产物预览卡片

> 模块目录：`apps/server/src/multiagents/group/run/`、`apps/server/src/multiagents/group/`、`apps/desktop/src/renderer/src/components/`、`packages/shared/src/`。

## Context

PRD ART-2：在 Agent 回复气泡内内联展示本回合产出的可预览产物卡片，点击预览在右侧抽屉查看，点击编辑才展开全屏文件窗口。

ART-1（黑板产物预览抽屉）已落地：在群聊黑板侧栏 / 群详情点击产物，从右侧 460px 抽屉读取工作区文件预览。本功能复用 ART-1 的预览接口与渲染逻辑，把入口前移到**每条成员回复气泡内**；消息卡片的预览入口同样承载在侧边栏抽屉，全屏 overlay 只作为编辑入口。

范围：

- **仅群聊**。单聊没有产物模型（黑板/artifact），需要新增"按文件路径预览"的后端能力，留作后续。
- 卡片只对可内联预览类型（html / pdf / image / audio / video / 文本/代码/文档）显示；office / binary / too_large 不入卡。
- **live + 历史复原都带卡**：产物以快照持久化在成员消息上，重开会话后卡片仍在。
- 卡片为**轻量占位**（图标 + 文件名 + 类型/版本），点击才加载预览；气泡内不内嵌 live iframe。

## Model

不新增数据库实体。沿用 ART-1 的 `BlackboardArtifact` 与 `BlackboardArtifactPreview`，新增/扩展以下契约（`packages/shared/src/`）：

- `group-chat.ts` 的 `blackboard_update` 运行事件扩展：
  - `taskId: string | null`、`agentId: string | null`：定位产出该变更的成员气泡。
  - `artifact?: BlackboardArtifact`：`update.kind === 'artifact'` 时携带完整产物快照，免去前端二次拉取。
- `chat.ts` 的 `GroupTextMessageView` 新增 `artifacts?: BlackboardArtifact[]`：本回合产物快照，持久化复原用。
- 渲染层 `chatDisplay.ts` 的 `AgentRunMessage` 新增 `artifacts?: BlackboardArtifact[]`。

产物快照存进 `group_message.payload.artifacts`（与 deploy 卡片的 `payload.artifacts` 同构）。

## Backend

不新增 REST 接口；预览仍走 ART-1 的 `GET /group-chats/:id/blackboard/artifacts/:artifactId/preview`。改动集中在产出与持久化：

- `run/dispatch.service.ts`：成员任务收口写回黑板时，收集本回合 `upsertArtifact` 返回的完整产物快照（`producedArtifacts`）。
  - 发布 `blackboard_update` 事件时带上 `taskId`、`agentId`，并对 artifact 类 update 附带完整 `artifact`。
  - 调 `appendText` 持久化成员发言时，把本回合产物数组一并传入。
- `group-message.service.ts`：`appendText` 新增可选 `artifacts` 参数，非空时写进 `payload.artifacts`。
- `mappers/group-message.mapper.ts`：`text` 分支把 `payload.artifacts` 还原为 `GroupTextMessageView.artifacts`（数组守卫，仿 deploy 分支）。

member-chat（轻量成员闲聊回合）不做产物写回，故不涉及。

## Runtime Flow

### Live（运行中）

1. 群聊 run 中，成员任务完成 → `dispatch` 写回黑板生成 artifact。
2. 后端发 `blackboard_update`（带 `taskId`/`agentId`/完整 `artifact`）。
3. 前端 `ChatView` 在 `onEvent` 的 `blackboard_update` 分支：产物可内联预览时，按 `groupRunMemberKey(groupId, runId, taskId, agentId)` 定位该成员的 `agent-run` 气泡，`appendRunArtifact` 去重追加到气泡 `artifacts[]`。
4. `AgentRunMessage.vue` 在正文下方渲染内联占位卡。

### 历史复原

1. 重开群聊 → `GET /group-chats/:id/messages` 返回 `GroupTextMessageView`（带 `artifacts`）。
2. `utils/groupMessage.ts` 的 `groupMessageToDisplay` 在 agent-run 分支注入 `artifacts`。
3. 卡片照常渲染。

### 预览 / 编辑

1. 点击内联卡主体或 deploy 卡的「预览」→ emit `preview-artifact` → `MessageList` 透传 → `ChatView` 设置 `previewArtifact`。
2. `ArtifactPreviewDrawer.vue` 从右侧打开，调用 `getArtifactPreview` 加载，按 `previewKind` 用 `ArtifactPreviewBody.vue` 渲染（与 ART-1 抽屉共用）。
3. 点击卡片右侧「编辑」→ emit `edit-artifact` → `ChatView` 设置 `overlayArtifact`，打开 `ArtifactPreviewOverlay.vue` 全屏文件窗口。`text` / `html` 以源码 textarea 打开，不走 HTML iframe 预览。
4. HTML 走主进程自定义协议 `agent-preview://` 在 sandbox iframe 渲染。

## Frontend Components

- `components/ArtifactPreviewBody.vue`（新增）：从 `ArtifactPreviewDrawer.vue` 提取的纯展示组件，按 `previewKind` 渲染 text/html/pdf/image/audio/video/受限状态 + `agent-preview://` 协议管理。仅预览抽屉复用。
- `components/ArtifactPreviewOverlay.vue`（新增）：全屏文件窗口，复用 `getArtifactPreview` 拉取内容，但自己渲染编辑态；`text` / `html` 显示源码 textarea，非文本类显示不可编辑状态。
- `components/ArtifactPreviewDrawer.vue`（重构）：改为复用 `ArtifactPreviewBody`，行为不变（ART-1 黑板侧栏入口）。
- `utils/artifactPreview.ts`（新增）：按扩展名判定 `isInlinePreviewable` + 卡片图标 / 文件名 / 类型标签。
- `messages/AgentRunMessage.vue`：正文下方渲染内联占位卡，主体 emit `preview-artifact`，编辑按钮 emit `edit-artifact`。
- `components/MessageList.vue`：透传 `AgentRunMessageView` / `DeployMessageView` 的 `preview-artifact` 与 `edit-artifact`。
- `views/ChatView.vue`：`previewArtifact` ref 驱动 460px 抽屉（黑板侧栏 / 消息预览 / deploy 预览）；`overlayArtifact` ref 驱动全屏编辑窗口；`appendRunArtifact` helper；`blackboard_update` 事件接线；会话切换时清空两个 ref。

## Validation

- `pnpm -F @agenthub/shared typecheck`
- `pnpm -F @agenthub/server typecheck`
- `pnpm -F @agenthub/desktop typecheck`
- 手动：群聊跑一轮产出 html/pdf/图片产物 → 对应成员气泡出现占位卡 → 点击预览打开右侧抽屉；点击编辑打开全屏文件窗口；重开会话卡片仍在；office/binary 不入卡。

## Known Limits

- 仅群聊；单聊待新增"按文件路径预览"后端能力。
- 卡片为占位，不在气泡内内嵌 live iframe（性能/布局）。
- 当前编辑窗口还没有接入保存；真正保存需要新增受黑板 artifact 约束的原始文件读写接口，并定义用户编辑如何更新 artifact 版本/审计。
- `payload.artifacts` 存写入时的快照（含当时 `version`）：预览内容点开时实时读文件（最新），但卡片标题的版本号是产出时刻的快照，后续被改不回填。与 deploy 卡片一致。
- office / pptx 等仍只在预览区显示受限状态（沿用 ART-1 Known Limits）。
