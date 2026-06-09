# 群聊编排加固：DAG 并行 · 失败降级 · 冲突上报 · 工具隔离

> 本文是群聊功能的**第二份落地 Spec**，承接 [`group-chat-collaboration-mvp.md`](./group-chat-collaboration-mvp.md) 中明确"留待第二份 spec"的部分，并对齐 [`doc/context/群聊上下文管理设计方案.md`](../context/群聊上下文管理设计方案.md) 的 P0 目标（§7.1 DAG 并行、§7.2 失败降级、§7.3 代码冲突处理、§9 安全最小原则）。
> 后端改动集中在 `apps/server/src/multiagents/group/run/`；契约改动在 `packages/shared/src/`；前端在 `apps/desktop/src/renderer/`。

---

## Context（为什么做）

MVP 闭环跑通后，复盘发现 4 处与设计文档 P0 目标背离或存在风险：

1. **Orchestrator 工具未隔离**：编排角色配了真实仓库 cwd + `bypassPermissions` + 全套文件工具，仅靠提示词约束"不写代码"，模型一旦不遵守即可直写共享仓库。
2. **失败降级粗暴**：首个任务失败即 `break` 掉所有后续（含互不依赖任务），无重试；`blocked` 语义缺失。
3. **DAG 并行未实现**：`deps` 被持久化却从不参与调度，纯串行；per-task worktree 成本照付、并行收益为零。
4. **协调"上报"无回路**：契约冲突 / worktree 合并冲突的"上报 Orchestrator"只是一句展示文本，无任何后续；合并冲突还被直接吞掉。

本 spec 修复以上 4 项。**协调策略采用"结构化上报 + 停下问用户"**（不做自动再编排，避免无界循环与不确定性），与设计文档 §6.5"派生配合任务"的完整形态相比是其有界子集，差异见 Known Limits。

---

## Scope（范围）

### 覆盖

1. **Orchestrator 工具隔离**：编排 turn 禁用全部工具、`plan` 权限模式、cwd 指向 worktree 外的 home scratch。
2. **DAG 并行调度**：按 `deps` 计算就绪集并发派发，并发上限可配，同一 Agent 不并发双开。
3. **失败降级**：单任务失败重试 1 次；仍失败标 `failed` 并把其**传递下游**标 `blocked`（互不依赖任务继续）；新增 `blocked` 任务状态。
4. **冲突结构化上报**：worktree 合并冲突、产出物版本冲突（乐观锁）、受保护契约写入 → 作为 `escalation` 计入任务结果，汇报中单列"⚠️ 需你决策"并停止相关派发。
5. **产出物乐观锁接通**：派发前快照产出物版本，writeback 带 `based_on_version`，版本不符转上报而非静默覆盖。

### 仍不在本 spec（继续推迟）

- **自动再编排**：上报后由 Orchestrator LLM 自动派生配合任务（设计 §6.5 完整形态）；本轮停下问用户。
- 语义冲突检测、Contract Watcher / Preflight、MemoryManager、`context_trace`、正式 ACL / 审批流。
- Orchestrator 汇报默认调用最终审查 LLM 做综合确认；模板拼接仅作为审查器失败时的兜底。

---

## Model（契约改动）

### `packages/shared/src/blackboard.ts`

```ts
// 新增 'blocked'：上游失败导致下游从未派发
type BlackboardTaskStatus = 'pending' | 'ready' | 'doing' | 'done' | 'failed' | 'blocked'
```

- `GroupRunEvent` 的 `task_status` 事件可携带 `status: 'blocked'`，并在终态用可选 `summary` 收口成员运行气泡正文（`packages/shared/src/group-chat.ts`）。
- `TaskItem`（`chat.ts`，task-list 气泡用）现在同步 `failed` / `blocked`，避免群运行结束刷新后任务卡片退回为待办态。

### 服务端内部类型（不跨端）

- `DispatchResult` 新增可选 `escalation?: { kind: 'contract' | 'merge'; detail: string }`，表示该派发遇冲突需用户裁决。
- `TaskOutcome` 新增 `status: 'done' | 'failed' | 'blocked'` 与可选 `escalation`，供汇报区分。

### 配置

| 环境变量 | 默认 | 含义 |
| --- | --- | --- |
| `GROUP_MAX_PARALLEL_TASKS` | `3` | 单次群运行内并发派发的成员任务数上限（`< 1` 或非法值回落 3） |

---

## Runtime Flow（调度与降级）

### Orchestrator turn（工具隔离）

`LlmOrchestratorPlanner.runOrchestrator`（`orchestrator-executor.ts`）：`permissionMode: 'plan'`、`allowedTools: []`、`workingDirectory` = 编排专属 home 目录。Orchestrator 只产 JSON 计划，物理上无法读写共享仓库。

### 初始任务状态（`orchestrator.service.ts`）

`plan()` 写 `task_graph` 时：`status = deps.length === 0 ? 'ready' : 'pending'`（替换原先一律 `ready`），让调度器据此起步。

### DAG 调度器（`group-run.executor.ts` + `task-scheduler.ts`）

纯调度逻辑抽到 `task-scheduler.ts`（无副作用、可单测）：

- `computeReady(nodes, statusById)`：自身 `pending/ready` 且全部 `deps` 已 `done` 的节点。
- `markDownstreamBlocked(nodes, failedId, statusById)`：把 `failedId` 的传递闭包下游中仍活动的节点标 `blocked`，返回新阻塞 id（互不依赖任务不受影响）。

`scheduleTaskGraph` 主循环：

```
while (!aborted):
  for node in computeReady(...):            # 取至 GROUP_MAX_PARALLEL_TASKS
     if inFlight 已满: break
     if node.agentId 正忙: continue          # 同一 Agent 不并发双开（共享 AgentSession.workingDirectory）
     占位 doing → 并发 runOne(node)
  if inFlight 为空: break
  await Promise.race(inFlight)               # 任一完成即补位、解锁下游
await allSettled(inFlight)
→ orchestrator.report(outcomes)
```

`runOne`：`setStatus(doing)` → `dispatchWithRetry` → 成功 `done`；失败 `failNode`（标 `failed` + `markDownstreamBlocked` 落库/推流，下游 outcome 记 `blocked`/"上游任务失败，未执行"）。

`dispatchWithRetry`：首次失败且**非冲突、非中止**时重试 1 次；冲突（`escalation`）不重试（确定性失败，重试无益）。

### 收口与上报（`dispatch.service.ts`）

派发前 `getState` 快照 `path -> version`。turn 结束 writeback：

- 每个改动文件 `upsertArtifact(..., basedOnVersion)`；抛 `BLACKBOARD_CONFLICT` → 记 `escalation{kind:'merge'}` + `blackboard_event(op:'rejected')`，不静默 bump。
- `mergeTaskWorktree` 抛错（合并冲突）**不再吞**：记 `escalation{kind:'merge'}` + `blackboard_event`。
- 受保护契约非 owner 写入：除原有 system 提示 + event 外，回传 `escalation{kind:'contract'}`。

`escalation` 存在 → `DispatchResult.success=false`；executor 计该任务 `failed` + 阻塞下游。`orchestrator.report` 汇报区分 ✅完成 / ❌失败 / ⏸️阻塞，并在有冲突时追加：

```
⚠️ 需你决策（已停止相关派发，请裁决后重新发起）：
- <任务名>：<冲突明细>
```

---

## Validation

- `pnpm -r typecheck` 全绿（shared / server / desktop；`blocked` 已补齐前端两处 exhaustive Record + OpenAPI 枚举）。
- 新增 `apps/server/src/multiagents/group/__tests__/task-scheduler.spec.ts`（`node:test`）覆盖：就绪计算、依赖未满足不就绪、终态不再挑选、下游传递阻塞、独立任务不连坐、菱形依赖共享下游只阻塞一次。
- 既有群聊单测全绿（44/44），含 `orchestrator.service` / `orchestrator-planner` / `blackboard.service`。
- 运行单文件：`cd apps/server && node --import tsx --test src/multiagents/group/__tests__/task-scheduler.spec.ts`。
- 端到端真实群聊需 provider 凭证 + Redis（重环境），按 `coding_rules` 未纳入自动执行；以纯调度单测 + 类型检查覆盖核心逻辑。

---

## Known Limits（本轮仍存）

- **协调仅"上报 + 停下问用户"**：不自动派生配合任务、不自动通知 consumers；用户裁决后需重新发起。
- **`direct_single` 路径**：单 @ 直派的冲突只走 dispatch 内的 system 提示，不经 `orchestrator.report` 的"需你决策"块（仅 orchestrate / multi 路径汇报）。
- **汇报审查**：`orchestrator.report` 默认调用最终审查 LLM 做综合确认，失败时才退回模板拼接。
- **task-list 气泡显示终态**：`TaskItem` 已扩展 `failed` / `blocked`，服务端会在任务状态变化时同步更新展示层 payload。
- **乐观锁基线**：版本快照取自派发入口；真正并发同文件编辑主要由 git worktree 合并冲突兜住，乐观锁为二级防线。
- **并发上限为全局值**：`GROUP_MAX_PARALLEL_TASKS` 不区分 vendor/provider 限流；高并发下仍可能触发上游 provider 限流。

## 涉及文件

- `apps/server/src/multiagents/group/run/orchestrator-executor.ts`（工具隔离 + 提示词 deps 语义）
- `apps/server/src/multiagents/group/run/orchestrator.service.ts`（初始状态 + 汇报区分）
- `apps/server/src/multiagents/group/run/dispatch.service.ts`（escalation + 乐观锁接通 + 合并冲突不吞）
- `apps/server/src/multiagents/group/run/group-run.executor.ts`（DAG 调度 + 失败降级）
- `apps/server/src/multiagents/group/run/task-scheduler.ts`（新增，纯调度逻辑）
- `apps/server/src/multiagents/group/__tests__/task-scheduler.spec.ts`（新增）
- `apps/server/src/multiagents/group/dto/blackboard-response.dto.ts`（OpenAPI 枚举）
- `packages/shared/src/blackboard.ts`（`blocked` 状态）
- `apps/desktop/src/renderer/src/components/GroupDetailPanel.vue`、`views/ChatView.vue`（`blocked` 渲染 + 事件处理）
