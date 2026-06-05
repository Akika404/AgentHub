# Plan/Todo 卡片实现方案

## Context（为什么做这件事）

用户希望聊天消息流支持「Plan 卡片 和 Todo 卡片」。

这是两种不同的卡片，用户确认「两者都要、两处都显示」：

- **A. Todo/任务清单式**（旧 demo.html 里 renderTodo 渲染的 📋 Plan 置顶卡片）：Agent 维护任务清单，逐项 pending → in_progress → completed 实时演进。
- **B. Plan 模式 / ExitPlanMode**：Agent 在 plan 模式产出一份计划正文 → 审批 → 再执行。

**关键现状结论：**

- **A** 的服务端契约已全部就绪（demo 已端到端验证）：AgentEvent 有 `{type:'todo', items}`；claude.ts 已拦截 TodoWrite/TaskCreate/TaskUpdate 并发全量快照；collectStep 有 case 'todo'；AgentMessageStep.todos 列、mapper、AgentRunStepView.todos 全有。缺口仅在前端——todo 现在只进右侧 RightInspector，没进消息流、历史不复原（runStepFromView 对 todo 返回 null）。
- **B** 完全缺失：AgentEvent/AgentMessageStepType 无 plan 分支；ExitPlanMode 目前只会被当普通 tool 透传；plan 模式审批回路（SDK canUseTool）从未接入（claude.ts 注释标为 phase-2）。

因此分阶段实施：**Phase 1**（Todo 卡片，纯前端，低风险） → **Phase 2a**（Plan 正文卡片，只读展示） → **Phase 2b**（Plan 审批回路，需新增反向通道，最重，建议独立排期）。

> **契约镜像约束**（来自 `apps/server/CLAUDE.md` 与 shared 注释）：`packages/shared/src/agent.ts` 与 `apps/server/src/mutiagents/adapter/types.ts` 是手工镜像的两份定义，凡改 AgentEvent/step 类型必须同步两处。

---

## Phase 1 — Todo/任务清单卡片（推荐先做；服务端零改动）

把已经流到前端的 todo 事件，渲染成 agent-run 消息气泡内的一张「计划清单」子卡片，随快照实时刷新，并支持历史复原。复用现有 agent-run 消息 + 步骤持久化机制，不动 shared 契约、不动服务端。

### 改动点

1. **`apps/desktop/src/renderer/src/types/chatDisplay.ts`**
   - `AgentRunStep.type` 联合增加 `'todo'`。
   - 增加可选字段 `todos?: AgentTodoItem[]`（从 `@agenthub/shared` 引入 `AgentTodoItem`）。

2. **`apps/desktop/src/renderer/src/views/ChatView.vue`**
   - 新增 `upsertTodoStep(chatId, todos)` helper：在 `steps[]` 中查找 `type==='todo'` 的步骤——存在则替换其 `todos`，不存在则追加一条 `status:'completed'`、`type:'todo'` 的步骤（用 completed 而非 active，避免干扰 `startRunStep`/`completeActiveRunStep` 的「活动步骤」推进逻辑）。todo 是全量快照、单例，不可每次 append。
   - `syncAgentRunMessage`（约 631 行的 switch）增加 `case 'todo': upsertTodoStep(chat.id, event.items); return`。
   - `runStepFromView`（约 380 行，目前 `// todo 步骤不在运行条里复原 直接 return null`）改为：`view.type === 'todo'` 时返回 `{ id, type:'todo', label, status:'completed', todos: view.todos ?? [] }`，实现历史复原。

3. **`apps/desktop/src/renderer/src/components/messages/AgentRunMessage.vue`**
   - 增加 computed `planStep = steps.find(s => s.type === 'todo')`。
   - 渲染一个始终可见的「📋 计划」清单块（不随「运行过程」折叠面板隐藏），三态样式：
     - `pending` → `radio_button_unchecked`（muted）
     - `in_progress` → 高亮色 + 进行中标记
     - `completed` → `check_circle`（success）+ 文字删除线
   - 现有 `v-for="step in message.steps"` 的步骤循环中跳过 `type==='todo'`（`v-if="step.type !== 'todo'"`），避免重复渲染。
   - 样式复用设计系统 token（参考 `RightInspector.vue:135-156` 与 `messages/TaskListMessage.vue`），不要引入裸 hex / `text-[Npx]`。

4. **`apps/desktop/src/renderer/src/components/RightInspector.vue`**（可选增强，满足「两处都显示」+ 3 态）
   - 现有任务面板（`:135-156`）只有 completed/未完成两态。补 `in_progress` 高亮样式，与卡片视觉一致。`runtime.todos` 已由 `handleRuntimeEvent` 的 case `'todo'`（:857）维护，无需改数据流。

### Phase 1 验证

- `pnpm typecheck`（覆盖 desktop + shared）。
- `pnpm dev` 启动桌面端，对 claude vendor 发一个会产生多步任务的指令（触发 TaskCreate/TaskUpdate），确认：消息流卡片出现清单并随执行逐项点亮；右侧任务面板同步；刷新/重进会话后历史卡片能复原清单（验证 `runStepFromView`）。

---

## Phase 2a — Plan 正文卡片（ExitPlanMode 只读展示）

让 plan 模式下 Agent 通过 ExitPlanMode 产出的计划正文，作为结构化「计划」卡片展示（先不接审批，纯展示）。

### 改动点（服务端 + shared + 前端）

1. **契约（两处镜像同步）**：`packages/shared/src/agent.ts` 与 `apps/server/src/mutiagents/adapter/types.ts`
   - `AgentEvent` 增加 `{ type: 'plan'; vendor: AgentVendor; plan: string }`。
   - `AgentMessageStepType` 增加 `'plan'`（`agent.ts` + `entities/agent-message-step.entity.ts` + `dto/agent-message-view.dto.ts` 三处镜像）。

2. **适配器 `apps/server/src/mutiagents/adapter/claude.ts`**
   - 在 `translate()` 的 `tool_use` 分支（约 281–355 行），`TASK_TOOLS` 判断之后、默认透传之前，增加 `if (name === 'ExitPlanMode')`：从 `b.input.plan` 提取正文 → `yield { type:'plan', vendor, plan }`，并 `this.suppressedToolUseIds.add(id)`（沿用现有机制吞掉其 `tool_result`）。

3. **落库 `apps/server/src/mutiagents/agent-manager.service.ts`**
   - `StepDraft`（约 48 行）已有 text；`collectStep`（约 594 行）增加 `case 'plan': drafts.push({ type:'plan', text: ev.plan })`。计划正文复用 `text` 列，无需新增实体列。`saveSteps` 已透传 `text`。

4. **mapper/dto**：`mappers/agent-message.mapper.ts` 已透传 `text/type`，无需改（仅类型联合扩了 `'plan'`）。

5. **前端**
   - `chatDisplay.ts`：`AgentRunStep.type` 增加 `'plan'`（plan 正文存 `text`）。
   - `ChatView.vue`：`syncAgentRunMessage` 增加 case `'plan'`（upsert 一条 `type:'plan'` 步骤，正文存 `text`）；`runStepFromView` 增加 `view.type === 'plan'` 复原分支。
   - `AgentRunMessage.vue`：渲染「计划」卡片块展示 plan 正文（markdown，若项目已有 markdown 渲染器则复用；否则 `whitespace-pre-wrap`）。

### Phase 2a 验证

- `pnpm -F @agenthub/server typecheck` + `pnpm -F @agenthub/shared typecheck` + `desktop typecheck`。
- 将某 agent 的 permissionMode 设为 plan，发指令触发 ExitPlanMode，确认服务端发出 plan 事件、落库为 plan step、前端渲染计划卡片、历史可复原。

---

## Phase 2b — Plan 审批回路（较重，建议独立排期 / 单独确认）

支持「展示计划 → 用户批准/拒绝 → Agent 继续执行」。这需要打通一条客户端 → 服务端的反向控制通道（当前 turn 事件流是单向 SSE 服务端→客户端）：

- `claude.ts` 接入 SDK 的 `canUseTool` 回调与 `set_permission_mode`，在 ExitPlanMode 处阻塞等待审批决定。
- 新增审批提交 API（controller）+ 服务端等待/唤醒机制（可基于现有 Redis 通道扩展）。
- 前端计划卡片增加「批准 / 拒绝」按钮并回传决定。

此部分改动跨架构（双向通道）、工作量最大，不在本轮一并实现；待 Phase 1 / 2a 落地后单独出设计方案再确认。

---

## 实施顺序与提交

按 Phase 1 → 2a 推进，每个 Phase 独立成可提交单元（遵循 Conventional Commits，scope 用受影响模块）：

- **Phase 1**：`feat(desktop): render agent todo plan checklist card in message flow`
- **Phase 2a**：`feat(desktop,server,shared): surface ExitPlanMode plan as plan card`