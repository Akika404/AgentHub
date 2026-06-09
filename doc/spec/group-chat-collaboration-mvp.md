# 群聊协作最小闭环（Group Chat Collaboration MVP）

> 本文是群聊功能的第一份落地 Spec，对应 [`doc/context/群聊上下文管理设计方案.md`](../context/群聊上下文管理设计方案.md) P0 的**最小可演示闭环**子集。
> 后端模块位于 `apps/server/src/multiagents/`（与单聊同域，新增 group 子域）；桌面端入口为 `apps/desktop/src/renderer/src/views/`（群聊视图，复用现有 ChatView 体系）。
> 设计前置：本 spec 复用单聊已有机制（`AgentSession` + turn 游离后台任务 + Redis Stream 多端围观），详见 [`agent-single-chat-spec.md`](../agent-single-chat-spec.md)。
>
> ⚠️ **后续增量**：本 spec 标注"留待第二份 spec"的 **DAG 并行调度 / 失败降级（重试 + `blocked` 连锁阻断）/ 冲突结构化上报 / Orchestrator 工具隔离** 已在 [`group-chat-orchestration-hardening.md`](./group-chat-orchestration-hardening.md) 实现。下文涉及"串行执行 / 失败即停 / 上报仅展示"的描述以该加固 spec 为准。

---

## Scope（范围）

### 本 spec 覆盖（最小闭环）

1. **群聊创建与管理**：建群（选成员 Agent + 配置独立 Orchestrator + 共享工作区）、列群、群详情、成员查看。
2. **展示层 presentation_log**：多发言者（user / orchestrator / agent / system）群聊消息历史与发送。
3. **MessageRouter**：纯机械解析 `@`，决定消息去向（不调 LLM）。
4. **Orchestrator（独立内置角色）**：复杂度判断 → 任务拆解写入 `task_graph` → **串行**单任务派发 → 聚合产出并在聊天流汇报。
5. **Blackboard（黑板）**：`project_meta / artifacts / decisions / contracts / task_graph` 状态 + 事件流；MySQL 存储 + 乐观锁（version）。
6. **ContextAssembler**：每次派发前按检索优先级 + 预算装配上下文。
7. **agent_memory**：基础结构（scope/source/status），任务结束轻量去重写入，装配时检索。
8. **再次修改三场景（A/B/C）**：轻量规则判断 + `short_term_buffer`。
9. **子 Agent 执行**：复用 `AgentSession` + turn；每个派发任务在群共享 git 仓库的**独立 worktree/分支**执行，完成合并回主分支并更新黑板产出物版本。
10. **安全最小原则**：Agent 读取的产出物/文件内容视为不可信数据；共享契约仅 owner 可改，非 owner 触碰 → 拒绝并上报 Orchestrator。

### 明确不在本 spec（留待第二份 spec）

> ✅ 标记项已在 [`group-chat-orchestration-hardening.md`](./group-chat-orchestration-hardening.md) 实现。

- ✅ DAG **并行**调度（本 spec 串行执行）。
- ✅ 代码冲突的**检测 / 仲裁**（本 spec 仅建立 worktree 合并机制）——加固 spec 已做合并冲突结构化上报；语义冲突检测仍推迟。
- ✅ **失败降级**的重试 / `blocked` 连锁阻断策略（本 spec 仅"失败即停在该任务"）。
- Contract Watcher / Preflight 主动预检、MemoryManager、`open_issues` / `risks`、`context_trace` 可观测性、正式 ACL / 审批流 / Prompt Injection 系统化防护。

---

## Context

群聊把多个已添加的 Agent 拉进同一会话，用户可以：

- 发布复杂任务，由 **Orchestrator** 自动理解意图、拆解、串行分派给合适的子 Agent，并在聊天流聚合汇报；
- `@某个 Agent` 单独指派或在其完成后要求修改；
- `@多个 Agent`，由 Orchestrator 轻量协调，成员像群聊成员一样依次回复各自产出。

与单聊的本质区别：单聊是「用户 ↔ 一个 Agent」的线性对话；群聊是「用户 + Orchestrator + N 个成员 Agent」围绕**一块黑板**和**一个共享工作区**协作。上下文不再靠堆叠对话历史，而靠黑板（结构化事实）+ ContextAssembler（按需装配）+ agent_memory（跨任务记忆），核心理念见最终方案文档。

群聊不是单聊的并列功能，而是其上层编排：每个成员"干活"仍落到一个 `AgentSession` + 一轮 turn，复用全部后台运行 / 多端围观 / 并发互斥 / abort / 超时 / boot 回收能力。

---

## Model

> 约定：DTO 与 Entity 分离；所有响应走统一 `{ code, message, data, timestamp }` envelope；新建 REST 路由用 `@ApiTags`/`@ApiOperation`/`@ApiEnvelope`。

### 新增实体（MySQL）

| 概念                   | 含义                                                                         | 存储                       |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| **GroupChat**          | 一个群聊：标题、所属用户、Orchestrator 配置、共享工作区、状态                | `group_chat`               |
| **GroupChatMember**    | 群成员：关联 Agent、群内角色、加入时间                                       | `group_chat_member`        |
| **GroupMessage**       | 展示层 presentation_log：多发言者消息（text / task-list / options / system）；成员 text 可通过 payload 关联 `agent_message` 并在视图里返回运行步骤 | `group_message`            |
| **BlackboardArtifact** | 产出物索引                                                                   | `blackboard_artifact`      |
| **BlackboardDecision** | 决策（带 status / supersedes / rationale）                                   | `blackboard_decision`      |
| **BlackboardContract** | 共享契约（带 owner / consumers / approval_required / version）               | `blackboard_contract`      |
| **BlackboardTask**     | 任务图节点（task_graph node：deps / agent / status）                         | `blackboard_task`          |
| **BlackboardEvent**    | 黑板事实变更事件流（append-only）                                            | `blackboard_event`         |
| **AgentMemoryItem**    | 某 Agent 跨任务私有记忆（scope / source / status）                           | `agent_memory_item`        |
| **GroupRun**           | 一次用户消息触发的群运行（含 Orchestrator 决策 + 若干成员 turn），围观载体   | `group_run` + Redis Stream |

> `project_meta`（name / goal / tech_stack / status / workspace_dir）作为字段直接挂在 `group_chat` 上，不单建表。
> 成员"干活"复用现有 `agent_session` / `agent_message` / `agent_message_step`：每个派发任务绑定/复用一个 `scope=group` 的成员内部 `AgentSession`，其 `workingDirectory` 指向该任务的 git worktree，且不进入 `/agent-chats` 单聊列表。`short_term_buffer` 存 Redis（带 TTL），不落 MySQL。

### 关键结构（落到 `packages/shared/src/`，供前后端共享）

```ts
// —— 群聊 ——
interface GroupChatView {
  id: string
  title: string
  status: 'active' | 'archived'
  workspaceDir: string // 共享 git 工作区根；Agent runtime dirs 挂在其下
  orchestrator: OrchestratorConfigView // 独立内置角色配置
  members: GroupMemberView[]
  projectMeta: ProjectMeta
  activeRunId: string | null // 进行中的群运行；空闲为 null（用于打开群时订阅）
  createdAt: string
  updatedAt: string
}

interface OrchestratorConfigView {
  vendor: AgentVendor // 与成员 Agent 解耦，单独配置
  model: string
  providerId: string
  // systemPrompt 由系统内置（编排角色提示词），用户不填
}

interface GroupMemberView {
  agentId: string
  name: string
  avatar: string | null
  color: string
  vendor: AgentVendor
  capabilities: AgentCapabilities
  roleInGroup: string | null // 自由文本能力标签，如 "前端" / "后端"；可空
  capabilitySummary: string | null // Agent 配置上的能力摘要；供 Orchestrator 判断擅长领域
}

interface ProjectMeta {
  name: string
  goal: string | null
  techStack: string[]
  status: 'planning' | 'designing' | 'development' | 'done'
}

// —— 黑板 ——
interface BlackboardView {
  artifacts: BlackboardArtifact[]
  decisions: BlackboardDecision[]
  contracts: BlackboardContract[]
  taskGraph: BlackboardTaskNode[]
}

interface BlackboardArtifact {
  id: string
  type: 'code' | 'document' | 'design' | 'test_report'
  path: string
  ownerAgentId: string
  version: number // 乐观锁基准
  status: 'draft' | 'proposed' | 'approved' | 'deprecated'
  summary: string // 供"注摘要不注全文"
  updatedAt: string
  updatedByAgentId: string
}

interface BlackboardDecision {
  id: string
  content: string
  rationale: string | null
  status: 'proposed' | 'approved' | 'superseded' | 'rejected'
  scope: string | null
  supersedes: string[]
  createdByAgentId: string
  approvedBy: string | null // 'orchestrator' | agentId | userId
  ts: string
}

interface BlackboardContract {
  id: string // e.g. "time_api"
  spec: Record<string, unknown> // endpoint/returns/... 结构化字段
  ownerAgentId: string
  consumers: string[] // agentId[]
  approvalRequired: boolean
  version: number
}

interface BlackboardTaskNode {
  id: string
  name: string
  agentId: string | null // 派给谁；拆解后由 Orchestrator 指定
  deps: string[] // 依赖任务 id
  status: 'pending' | 'ready' | 'doing' | 'done' | 'failed' | 'blocked' // 'blocked' 见加固 spec
  objective: string
}

// —— 记忆 ——
interface AgentMemoryItem {
  id: string
  agentId: string
  content: string
  type: 'convention' | 'project_knowledge' | 'lesson' | 'work_done'
  scope: { project: string; module: string | null }
  source: { type: 'blackboard' | 'self_summary' | 'user'; ref: string | null }
  status: 'active' | 'stale' | 'deprecated'
  createdAt: string
  lastUsedAt: string | null
}

// —— 群聊消息（presentation_log）——
// 复用现有 shared/chat.ts 的 SenderInfo(role: orchestrator)/TaskListMessage/OptionsMessage/TextMessage/SystemMessage。
// 新增 GroupMessageView 把上述 kind 统一为群聊消息，并带 senderAgentId。
// senderRole=agent 的 text 消息可返回 steps?: AgentRunStepView[]，用于刷新后复原运行过程折叠条。
```

> 现有 `packages/shared/src/chat.ts` 已预留 `ChatKind: 'group'`、`SenderInfo.role: 'orchestrator'`、`TaskListMessage`、`OptionsMessage`、`NetworkNode`——这些是前端 mock 阶段铺底，本 spec 将其升级为真实契约（mock 仅作业务意图参考，非后端契约；后端 API 设计优先）。

---

## Backend API

> 前缀 `/api`，需 `Authorization: Bearer <token>`。仅当前用户可访问其群聊。

### 群聊管理

| Method   | Path               | 说明                                                                                                                               |
| -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/group-chats`     | 创建群聊（成员列表 + Orchestrator 配置 + 项目元信息；优先使用用户传入的 `workspaceDir`，未传则后端分配，并校验/初始化为 git 仓库） |
| `GET`    | `/group-chats`     | 当前用户的全部群聊，列表使用                                                                                                       |
| `GET`    | `/group-chats/:id` | 群详情（成员、Orchestrator、projectMeta、activeRunId）                                                                             |
| `PATCH`  | `/group-chats/:id` | 改标题 / projectMeta / 成员（最小实现：加成员、改标题）                                                                            |
| `DELETE` | `/group-chats/:id` | 删除群聊（级联删数据库记录；共享仓库 `ACTIVE=false`，任何情况下都不删除目录）                                                      |

### 群聊会话（presentation_log + 群运行）

| Method     | Path                                  | 说明                                                                                                                         |
| ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET`      | `/group-chats/:id/messages`           | 展示层消息历史（升序，多发言者）                                                                                             |
| `POST`     | `/group-chats/:id/converse`           | 用户发消息，启动一次**群运行**（后台游离），body `{ text, mentions?: string[] }`，返回 `{ runId }`                           |
| `GET @Sse` | `/group-chats/:id/runs/:runId/events` | 订阅群运行事件流：回放 + 追尾，逐条推送 `GroupRunEvent`（Orchestrator 决策、成员 turn 进度、黑板更新、汇报），遇 `done` 结束 |
| `POST`     | `/group-chats/:id/runs/:runId/abort`  | 中止整个群运行（跨实例广播，连带中止其下进行中的成员 turn）                                                                  |

### 黑板（只读 + 调试）

| Method | Path                                 | 说明                                                        |
| ------ | ------------------------------------ | ----------------------------------------------------------- |
| `GET`  | `/group-chats/:id/blackboard`        | 当前黑板状态快照（artifacts/decisions/contracts/taskGraph） |
| `GET`  | `/group-chats/:id/blackboard/events` | 黑板事件流（审计/调试，分页）                               |

> **协作动作不走用户 REST**：`dispatch_agent`（Orchestrator → 成员）、`report_completion`（成员 → Orchestrator）、`blackboard_write`（成员/Orchestrator → 黑板）是**服务端内部协作协议**（以 Agent 工具调用 / 内部服务方法实现），不暴露为用户 HTTP 接口。详见 Runtime Flow。

---

## Runtime Flow

### 组件职责

| 组件                 | 职责                                                                     | 调 LLM                    |
| -------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `MessageRouter`      | 解析 `@mentions`，决定去向；原文写入 `group_message`（presentation_log） | ❌                        |
| `Orchestrator`       | 复杂度判断、拆解写 task_graph、串行派发、聚合汇报                        | ✅（独立 vendor/model）   |
| `BlackboardService`  | 黑板读写（乐观锁 version）、追加 event、级联触发                         | ❌                        |
| `ContextAssembler`   | 按检索优先级 + 预算装配单次派发上下文                                    | ❌                        |
| `AgentMemoryService` | 记忆读写、轻量去重、与黑板对齐丢弃 stale                                 | ❌                        |
| `ContinuityResolver` | 再次修改场景 A/B/C 判定（时间窗口 + 指代词 + 产出物匹配）                | ❌（兜底交 Orchestrator） |
| `GroupRunExecutor`   | 编排一次群运行；把成员任务落成 `AgentSession` + turn 串行执行            | ❌                        |

### 流程一：建群

1. 校验所有成员 Agent 属于当前用户；校验 Orchestrator 的 provider/vendor/model 合法。
2. 规范化共享工作区目录 `workspaceDir`：若用户传入则优先使用该目录，否则后端分配；执行/校验 `git init`（作为产出物真相源），成员 worktree / SDK home 挂在该目录的 `.agenthub/groups/<groupId>/` 下。
3. 落库 `group_chat` + `group_chat_member`；初始化黑板（空 artifacts/decisions/contracts + projectMeta）。
4. 不创建任何成员 SDK 会话（懒加载）。

### 流程二：用户发消息 → 群运行（核心）

```
POST /group-chats/:id/converse { text, mentions }
  1. 生成 runId，SET NX 标记"群有一轮在跑"（跨实例互斥）；已有活跃 run → 返回 GROUP_BUSY，引导用 activeRunId 围观
  2. 原文写入 group_message（presentation_log，sender=user）
  3. MessageRouter 解析 mentions → 决定 routeKind
  4. 不 await 启动游离任务 runGroup(runId)，立即返回 { runId }
```

`MessageRouter` 路由表：

| 输入                  | routeKind       | 行为                                                                                                                   |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@SingleAgent <msg>`  | `direct_single` | 走 ContinuityResolver 判 A/B/C → 直接派发该成员单任务（不强制全量拆解）                                                |
| `@A @B <msg>`         | `multi`         | 交 Orchestrator 轻量协调；需要交付时派任务，需要轻量聊天时走成员真实轻量 turn                                          |
| `@Orchestrator <msg>` | `orchestrate`   | 强制 Orchestrator 介入；任务消息生成计划，非任务消息由 Orchestrator 直接回复；需要成员本人轻量回应时走 `memberTurns`   |
| `<msg>`（无 @）       | `orchestrate`   | 默认交 Orchestrator 判复杂度；任务消息分发，非任务消息由 Orchestrator 直接回复；需要成员本人轻量回应时走 `memberTurns` |

`runGroup` 执行：

```
A) orchestrate / multi:
   1. Orchestrator turn（用其 vendor/model + 内置编排 system_prompt + orchestrator_context）
        orchestrator_context = { projectGoal, activeTaskGraph, recentUserIntents, blackboardSummary, memberStatus }
   2. 产出结构化计划：
        - 简单 → 单个 task 指派给最合适成员
        - 复杂 → 拆成 task_graph（串行：本 spec 即便有 deps 也按拓扑序逐个执行，不并行）
      计划写入 blackboard.task_graph，并以 task-list 消息发到 presentation_log（前端任务面板，只读展示）
   3. 串行遍历就绪任务，逐个 dispatch（见流程三）
   4. 全部完成 → Orchestrator 聚合各成员产出，生成 text 汇报消息发到 presentation_log
   5. 释放 run 活跃指针，发布最终 done

B) direct_single:
   1. ContinuityResolver 判 A/B/C，构造 TaskContext
   2. dispatch 该成员（见流程三）
   3. 成员产出直接发到 presentation_log（sender=该 agent）；done
```

### 流程三：单次派发 dispatch（成员干活）

```
dispatch(groupId, task, mode):
  1. ContextAssembler 组装上下文：
       system_prompt(成员角色)
       + TaskContext(objective/inputs/constraints/output_spec/mode)
       + blackboard_facts(相关 artifacts 摘要 + 相关 contracts，默认注摘要)
       + memory(AgentMemoryService 按 scope 检索，与黑板冲突者丢弃)
       + recent_hot_context(仅情况 A 命中时附 short_term_buffer)
     检索优先级铁律：当前产出物 > 黑板契约/决策 > 任务上下文 > 私有记忆 > 历史会话摘要
     预算超限裁剪序：历史会话摘要 → 低优记忆 → 非目标产出物摘要（保底：system+TaskContext+目标产出物 ref+相关契约）
  2. 准备工作区：为该 task 在群共享 repo 创建 worktree/分支 task/<taskId>
       取/重建该成员的 scope=group AgentSession，workingDirectory = 该 worktree
  3. 运行 turn（复用单聊 turn 机制）：成员是 coding agent，用自带文件工具 read→plan→patch→test
       turn 事件 XADD 到 group run 的 Redis Stream（多端围观），并按现有方式落 agent_message_step（成员私有 L1）
  4. turn 结束后服务端收口：
       - git：对比 worktree diff，识别改动文件 → 更新/新增 blackboard_artifact（version+1, updatedBy/At, status）
       - 合并：worktree 分支合并回主分支（本 spec 串行执行，无并发冲突）
       - 成员结构化报告 report_completion：{ summary, affected{artifacts,contracts,decisions}, decisions?, memory_candidate? }，其中 summary 是面向用户展示的交付摘要，应覆盖产物、关键能力、验证结果和注意事项。
            · 若 affected.contracts 命中非本成员 owner 且 approvalRequired → 拒绝该项写入，记 system 提示并上报 Orchestrator（最小升级）
            · 合法 decisions 写入黑板（带 supersedes 使旧决策 superseded）
            · memory_candidate 经 AgentMemoryService 去重后写入 agent_memory_item
       - 追加 blackboard_event
  5. 更新 task.status=done（失败则 failed，如实汇报并停止后续派发）
```

### 流程四：再次修改场景判定（ContinuityResolver）

```
用户 @Agent 发起修改：
  ├─ 命中短期热窗口？(short_term_buffer 未过期[默认 5min] + 含强指代词[“那个/刚才/你写的”…])
  │     → 情况 A：用 buffer 解析指代(mention_index) → 定位目标产出物 → 重读当前产出物 → 改
  ├─ 针对同一产出物/功能模块？(在 blackboard.artifacts 命中匹配)
  │     → 情况 B：重开干净会话 + 黑板产出物摘要 + 相关记忆 + 重读代码
  └─ 完全不同产出物/新需求？
        → 情况 C：完全重开 + 仅注通用信息(techStack/目录/通用约定)
判不了（模糊/无@）→ 兜底交 Orchestrator(LLM)判定
收尾：dispatch 完成后写 short_term_buffer(TTL)；A 保持热窗口，B/C 一段时间无追问后提炼记忆并失效 buffer
```

### 订阅与围观

- `GET /runs/:runId/events`：复用单聊 turn-stream 模式——`XRANGE` 回放 + `XREAD BLOCK` 追尾，多消费者各自游标，天然多端围观。事件类型：`orchestrator_plan` / `task_status` / `member_turn_event`（透传成员 turn 的 thinking/tool/text）/ `blackboard_update` / `orchestrator_report` / `done`。`task_status` 在终态可携带 `summary`，用于把成员运行气泡从 raw finalText 收口为干净展示文本。
- 断开 SSE 只取消订阅，不中止群运行；`activeRunId` 暴露给前端用于打开群时自动订阅进行中运行。
- 一次群运行一条 Redis Stream（含其下所有成员 turn 事件，按发生序 XADD），设 TTL（默认 1h）。

---

## Validation

### 后端

1. **建群**：`POST /group-chats` 后，`workspaceDir` 存在且为 git 仓库；`GET /group-chats/:id` 返回成员与 Orchestrator 配置一致；黑板初始化为空 + projectMeta。
2. **单 @ 直派**：`@某成员 写一个 X` → 该成员产出 commit 进共享 repo，`blackboard_artifact` 出现对应条目（version=1），presentation_log 出现该成员消息。
3. **Orchestrator 拆解**：无 @ 发布复杂任务 → presentation_log 出现 task-list 消息且 `blackboard.task_graph` 有多个节点；串行执行后每个任务 status=done；最后出现 Orchestrator 汇报消息。
4. **再次修改 A**：完成后 1 分钟内 `@成员 那个X再改改` → 上下文含 short_term_buffer 且发生"重读产出物"；改动使对应 artifact version+1。
5. **再次修改 C**：`@成员 做个全新的 Y` → 上下文不含旧产出物摘要，仅通用信息。
6. **乐观锁**：构造并发写同一 artifact（version 不符）→ 第二次写被拒并要求重读。
7. **契约保护**：成员 report 的 affected.contracts 指向他人 owner 的 `approvalRequired` 契约 → 该写入被拒并上报 Orchestrator（presentation_log 出现 system 提示）。
8. **围观**：发起群运行后多端订阅 `runs/:runId/events`，均能回放 + 实时追尾；断开一端不影响运行与其他订阅。
9. **ContextAssembler 装配**：单元测试断言检索优先级（memory 与黑板契约冲突时丢弃 memory）与预算裁剪顺序。

### 桌面端

10. ChatList「创建群聊」从占位变为可用；建群弹窗可选成员 + 配置 Orchestrator。
11. 群聊视图渲染多发言者气泡 + 任务面板（task-list 只读）+ Orchestrator 汇报卡 + 黑板/产出物侧栏；复用设计系统 ui/ 组件与 Tailwind tokens（不引入裸 hex / 手搓按钮）。
12. 打开存在 `activeRunId` 的群自动订阅并展示进行中进度；切走/关窗不中止群运行。

### 自动化测试范围

- 最小相关测试：ContextAssembler（优先级/裁剪）、MessageRouter（路由表）、ContinuityResolver（A/B/C）、BlackboardService（乐观锁/supersede）单元测试；建群 + 单 @ 直派一条 e2e happy path。
- 不在本轮强制：涉及真实 LLM 的 Orchestrator 拆解端到端（成本高、不稳定），以可注入的假编排结果替代。

---

## Known Limits

- ~~**串行执行**~~ → **已升级 DAG 并行**：见 [`group-chat-orchestration-hardening.md`](./group-chat-orchestration-hardening.md)（并发上限 `GROUP_MAX_PARALLEL_TASKS`，同一 Agent 不并发双开）。
- **冲突**：worktree 合并冲突 / 产出物版本冲突已升级为**结构化上报 + 停下问用户**（加固 spec）；语义冲突检测仍不在范围。
- ~~**失败处理弱**~~ → **已升级**：任务失败重试 1 次，仍失败则其下游标 `blocked`、互不依赖任务继续（加固 spec）；降级到备选 Agent 仍未做。
- **契约升级最小化**：触碰他人 `approvalRequired` 契约仅"拒绝写入 + 结构化上报"，无 Preflight 主动预检、无 Contract Watcher 自动通知 consumers，无 Orchestrator 自动派生配合任务。
- **记忆治理弱**：仅轻量去重写入；无 confidence 排序、无随契约变更自动置 stale 的 MemoryManager。
- **黑板对象裁剪**：本轮不含 `open_issues` / `risks`；artifacts 不含 hash/tags/dependencies。
- **无可观测性**：不产出 `context_trace`（每次注入了哪些黑板 key/memory/artifact）；留待 P1。
- **安全最小**：仅"不可信数据"原则 + 契约 owner 约束；无正式 ACL / 审批流 / Prompt Injection 系统化防护。
- **多实例**：群运行的成员 turn 路由沿用单聊现状（依赖 sdkSessionId 续接，无粘性会话）；boot 回收对群运行的兜底沿用单聊约束。
- **任务面板只读**：前端任务面板本轮仅展示，不支持用户编辑 task_graph 回灌 Orchestrator。
- **快速开发阶段**：不考虑存量数据兼容与迁移。

## 实现说明（与本 spec 的偏差与落地决策）

> 本节在编码完成后补记（spec-kit 阶段 4 回顾），记录实现层面对 spec 的细化与有意偏差。

- **Orchestrator Planner 默认调用大模型**：`OrchestratorPlanner` 接口 + `ORCHESTRATOR_PLANNER` 注入令牌已就位；默认绑定 `LlmOrchestratorPlanner`，使用群聊保存的 vendor/model/provider + 内置 prompt 产 JSON 计划。问候/闲聊/状态询问/澄清讨论等非任务消息可返回 `tasks: []` + `note`，由 Orchestrator 直接回复且不写黑板任务/不派发成员。Orchestrator 不允许代替成员 Agent 发言；当用户需要某个成员本人给出观点或问候、且无需工具/文件产出时，Planner 返回 `memberTurns`，服务端真实调用成员 Agent 做轻量回复；只有需要交付文件、执行命令或写入黑板协作状态时才创建 task。LLM 调用失败、输出 JSON 解析失败或指派给非群成员时，直接按上游错误处理，不静默降级成规则分派。自动化测试可覆盖注入令牌替换为假 Planner，以避免真实 LLM e2e 依赖。
- **成员能力摘要**：Agent 新增 `capabilitySummary` 配置字段，群聊成员视图和 Orchestrator prompt 会携带 `agentId/name/roleInGroup/capabilitySummary`，帮助 Orchestrator 在不读取完整 Agent system prompt 的情况下判断该把任务或轻量回复交给谁。
- **成员 turn 复用方式**：成员 dispatch 未复用单聊 `AgentRuntimeService.startTurn`（其活跃锁/事件流按 session 粒度、且自带独立 turn-stream），而是**复用更底层的适配层**（`createAgent` + `agentToConfig` + `AgentMessageHistoryService.collectStep/saveSteps`）直接驱动成员 turn，事件经 `member_turn_event` 透传到群运行 Stream（`GroupRunStream`，按 `TurnStream` 范式新建、类型为 `GroupRunEvent`、锁粒度为「群」）。成员私有 L1 仍落 `agent_message` / `agent_message_step`。
- **`report_completion` 落地**：成员不直接写库；turn 末尾输出 `report` JSON 块，dispatch 解析后**基于 git diff 代写黑板产出物**，并据 report 处理 decisions / contracts（owner 校验）/ memory_candidate（去重）。无 report 时回退为「以最终文本为摘要」。
- **自动化测试范围**：`BlackboardService`（乐观锁 / decision supersede / contract owner 保护）、`AgentMemoryService`（去重 / scope）、`ContextAssembler`（黑板冲突丢弃 / 预算裁剪 / 情况 A）、`MessageRouter`（路由表全分支）、`ContinuityResolver`（A/B/C + 强指代）共 20 条单测，经 `tsx + node:test` 运行（`pnpm -F @agenthub/server test`）。**建群 + 单 @ 直派的端到端 happy path 依赖在线 MySQL + Redis + 真实 Agent SDK/LLM**，本轮以单元级管线 + 手动验证覆盖，未纳入自动化 CI e2e（与 spec「不强制真实 LLM e2e」一致）。
- **共享工作区 git 操作**：经 `node:child_process` 调用系统 `git`（`init -b main` / `worktree add` / `merge --no-ff` / `diff`），无第三方 git 库依赖。建群写 `ACTIVE=true`；删除群聊只写 `ACTIVE=false`，不删除共享仓库、默认分配目录、worktree/member home 等任何目录。
