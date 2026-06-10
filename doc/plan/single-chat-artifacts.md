# 单聊产物预览 / 内联卡片 / 预览卡片

## 目标

把当前仅群聊拥有的三项能力下沉到单聊（agent chat），桌面端优先打通：

1. **产物预览**（地基）：在预览抽屉里打开单聊工作区的某个文件（text/html/image/pdf...）。
2. **内联产物卡片**：在 agent-run 气泡下方挂出"本轮产出/改动文件"的可点卡片。
3. **预览卡片**：一轮结束后，若产出可呈现交付物，插入一张独立卡片（单聊先做 static 预览，不做 service 部署）。

产物来源（已确认）：**diff 推导**，与群聊一致 —— 不改 agent 行为/prompt，不引入完整黑板。

## 现状关键事实（已核实）

- 群聊"产物"不是 agent 显式声明，而是每轮 run 结束对 worktree 做 `diffArtifacts` → `upsertArtifact` 写黑板 → 广播 `blackboard_update`（`dispatch.service.ts:360-400`）。
- 单聊已具备：`diff.checkpoint / diff.summarize / diff.commit`，**server 与 local 模式都已打通**（local 走反向通道 RPC，`agent-chat.service.ts:94/245/269`）；turn 事件流 + steps 持久化（`agent-runtime.service.ts:294-301`）。
- 预览渲染 UI（`ArtifactPreviewDrawer/Overlay/Body`、`previewKind` 判定、`isInlinePreviewable`）平台通用，目前被 `groupId` 写死。
- 预览取数服务 `GroupArtifactPreviewService` 是服务器专属 + 黑板耦合（按 `artifactId` → 黑板查 `path` → 读文件）。

## 两个需要你拍板的设计决策（已给推荐）

### 决策 A：单聊 workspace-diff 是"累计自 checkpoint"，不是"每轮"

`diff.summarize` 返回的是相对基线的**累计**改动。若直接拿它当本轮产物，每轮都会重复浮现历史所有改动文件。

- **推荐**：turn 开始时抓一次 diff 快照、turn 结束再抓一次，**本轮产物 = 两次之间内容有变化的文件**（精确反映"这轮干了什么"，对齐群聊 per-turn 语义）。预览卡片则用结束时的累计快照表示"当前可交付物"。
- 备选：只用累计快照，内联卡片 = 当前所有改动文件（实现更简单，但语义偏"工作区当前状态"而非"本轮产出"）。

### 决策 B：单聊预览卡片只做 static，不做 service 部署

部署模块（`DeploymentView.groupChatId`、runner）与群聊强耦合。单聊没有 Orchestrator 终审来产出 manifest。

- **推荐**：单聊预览卡片只做 **static** —— 一轮结束后若产物里能推断入口（如 `index.html`），插一张"预览"卡，点开走产物预览抽屉。service（起 dev server + iframe）本期不做。
- 备选：本期连预览卡片都不做，只交付"产物预览 + 内联卡片"，预览卡片后续单独排期。

## 数据模型（packages/shared）

复用 `BlackboardArtifact` / `BlackboardArtifactPreview` 作为传输与渲染类型（最大化 UI 复用），单聊侧填充：`ownerAgentId = agentId`、`status = 'draft'`、`version` 用文件改动次数或恒 1。

- `agent.ts`：给 `AgentChatMessageView` 增加 `artifacts?: BlackboardArtifact[]`（与群聊 `GroupTextMessageView.artifacts` 对称，注释说明为单聊本轮产物快照）。
- `agent.ts`：`AgentEvent` 增加一个单聊轮内事件 `{ type: 'artifact'; artifact: BlackboardArtifact }`（对齐群聊 `blackboard_update` 的 artifact 快照），供实时挂内联卡片。
- `agent.ts` 或新文件：单聊预览卡片事件/视图（若采纳决策 B 的 static 卡）：复用 `DeployManifest`（mode 固定 `static`）。
- `blackboard.ts`：`BlackboardArtifactPreview` 已够用，不动。

## 服务端（apps/server）—— 先读 `apps/server/CLAUDE.md`（已读）

1. **抽取纯预览逻辑到 `@agenthub/agent-core`**（框架无关，server + 桌面 local runner 共用）：把 `GroupArtifactPreviewService` 里"文件 → BlackboardArtifactPreview"的纯逻辑（previewKind 判定、HTML 资源内联、大小限制、路径安全）抽成一个不依赖黑板/NestJS 的函数 `buildArtifactPreview(repoDir, relPath)`。群聊预览服务改为调用它（行为不变）。
2. **单聊产物推导**（`agent-runtime.service.ts` turn finalize，约 `:294` saveMessage 之后）：
   - turn 开始抓基线快照、结束抓快照，按决策 A 算本轮产物文件集。
   - server 模式用 `workspaceDiff.summarize`；local 模式用反向通道 `diff.summarize` RPC（均已存在）。
   - 把产物快照随 agent 消息持久化（新增 `agent_message_artifacts` 表或在消息上加 JSON 列；倾向独立表，与 steps 一致）。
   - 实时在 turn 流上 `publish` `{ type: 'artifact', artifact }` 事件。
   - 若采纳决策 B：结束后推断 static manifest，publish 预览卡事件并持久化。
3. **单聊预览端点**：`GET /agent-chats/:chatId/artifacts/preview?path=<workspace-relative>`（单聊无黑板，按 **path** 而非 artifactId 取数）。
   - server 模式：`buildArtifactPreview(chat.workingDirectory, path)`。
   - local 模式：新增 RPC 方法 `artifact.preview`（`local-runner.ts` 的 `LocalRunnerRpcMap`），桌面端在本机仓库上跑 `buildArtifactPreview` 返回。
   - 路径安全：复用抽取出的 path 校验（必须相对、不含 `..`、在 workdir 内、排除 `.claude/.codex/.agents`）。
4. `agent-message-history.service.ts`：`listChatMessages` 带出 `artifacts`；`saveMessage`/新方法落库产物快照。

## 桌面端（apps/desktop）

### 渲染端（renderer）

1. **预览抽屉去 groupId 化**：`ArtifactPreviewDrawer.vue` / `ArtifactPreviewOverlay.vue` 当前写死 `groupChatApi.getArtifactPreview(groupId, artifactId)`。改为接受一个取数函数或 `source` 判别（`group` 用 artifactId、`agent` 用 path），其余渲染不变。
2. **api/agents.ts**：新增 `getArtifactPreview(chatId, path)` 调单聊预览端点。
3. **types/chatDisplay.ts**：`AgentRunMessage.artifacts` 注释从"group chats only"放开；`DeployMessage` 复用（单聊 static 卡）。
4. **ChatView.vue**：
   - `agentRunFromView`（`:535`）/`messageFromView`：把 `view.artifacts` 透传到 `AgentRunMessage.artifacts`（目前单聊不带）。
   - 单聊 turn 事件处理：新增对 `{ type: 'artifact' }` 事件的处理，调用已存在的 `appendRunArtifact`（`:866`）挂内联卡 —— 该函数本就通用，群聊已在用。
   - `openArtifactPreview`/`openArtifactEditor`（`:876/881`）already 通用，确认单聊路径下 `previewArtifact`/`overlayArtifact` 绑定到的抽屉走单聊取数。
   - 若采纳决策 B：单聊消息流插入 static `DeployMessage` 的处理（参考群聊 `:631-647`）。
5. **AgentRunMessage.vue / DeployMessage.vue**：无需结构改动（已按 `artifacts` 渲染），仅确认单聊上下文下"预览/编辑"按钮 emit 正确。

### local runner（desktop 主进程侧）

6. 实现 `artifact.preview` RPC handler：在本机仓库跑 `buildArtifactPreview`（复用 `@agenthub/agent-core`），返回 `BlackboardArtifactPreview`。

## 不在本期范围

- Android 端（后续单独排期；Android 连群聊内联卡片都还没做）。
- 单聊 service 部署（起 dev server + iframe）。
- agent 显式标记交付物机制。

## 验证

- `pnpm -F @agenthub/shared typecheck`、`pnpm -F @agenthub/server typecheck`、`pnpm typecheck`（全量）。
- server 预览服务/抽取逻辑：补/改 `group-artifact-preview` 相关单测（已存在 spec 模式），新增单聊产物推导的最小单测。
- 桌面端：`pnpm -F @agenthub/desktop lint`；手动验证 server 模式与 local 模式各跑一轮、内联卡片出现、预览抽屉打开 text/html/image。

## 落地顺序

1. shared 类型 + agent-core 预览逻辑抽取（群聊行为回归不变）。
2. server：单聊预览端点（server 模式）→ 渲染端预览抽屉去 groupId → 打通"产物预览"地基。
3. server：turn finalize 产物推导 + 持久化 + `artifact` 事件 → 渲染端内联卡片。
4. local 模式 RPC（`artifact.preview`）+ 桌面 handler。
5. （决策 B 若采纳）static 预览卡片。

## 实现纪要（与计划的偏差）

- **没有新增实时 `artifact` 事件**（计划第 3 步原拟在 turn 流上 publish）。原因：单聊一轮 =
  一次 finalize，产物只能在 turn 结束(diff 收口)时算出，没有"运行中"可推送的时刻；而单聊
  本就在 `done` 后走 `reloadAfterTurn → loadMessages` 用 DB 权威历史覆盖本地态,持久化在消息
  上的 artifacts/manifest 自然随之渲染。因此跳过事件，既避免改动 `AgentEvent`(server 的
  agent-core 版与 renderer 的 shared 版是两份手工同步的定义)与 turn-stream 类型,也无任何
  UX 损失(卡片出现时机不变)。
- 产物落库：`agent_message` 新增 `artifacts` / `deployManifest` 两个 nullable json 列
  (`synchronize: true` 在非 prod 自动建列);经 `saveMessage(..., extra)` 写入。
- 预览取数:群聊按 `artifact.id`(黑板)、单聊按 `artifact.path`(工作目录相对路径)。预览抽屉/
  overlay 改为同时接受 `groupId?` / `chatId?`,据此选 `groupChatApi` / `agentChatApi`。
- 本轮产物签名用 `status:additions:deletions`(廉价、够用);diff 快照失败(如 local runner
  未连)时静默回退空结果,不阻断 turn 收尾。

## 已知限制 / 后续

- 单聊"编辑文件"overlay 已补充 text/html 保存写回端点；图片/PDF/Office/二进制与过大文件仍只读。
- 产物签名极端情况下(本轮改动后增删行数与上轮快照恰好相同)可能漏判,MVP 可接受。
- Android、单聊 service 部署、agent 显式标记交付物仍未做(见下)。
