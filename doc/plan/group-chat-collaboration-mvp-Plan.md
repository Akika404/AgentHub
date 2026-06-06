# 群聊协作最小闭环 — 实现 Plan

> 对应 Spec：[`doc/spec/group-chat-collaboration-mvp.md`](../spec/group-chat-collaboration-mvp.md)
> 设计依据：[`doc/context/群聊上下文管理设计方案.md`](../context/群聊上下文管理设计方案.md)（P0 最小闭环子集）
> 原则：复用单聊已有机制（`AgentSession` + turn + Redis Stream 围观），不重造；DTO/Entity 分离、统一 envelope、OpenAPI 注解；快速开发阶段不考虑存量数据迁移。

---

## 0. 总览与依赖顺序

实现按「**契约 → 数据层 → 黑板/记忆 → 上下文装配 → 编排执行 → HTTP/SSE → 前端**」推进。关键依赖：

```
S1 shared 类型契约
      │
S2 server: 实体 + 迁移(建表) + git 工作区服务
      │
      ├─ S3 BlackboardService (依赖 S2)
      ├─ S4 AgentMemoryService (依赖 S2)
      │
S5 ContextAssembler (依赖 S3,S4)
      │
S6 MessageRouter + ContinuityResolver (依赖 S3)
      │
S7 GroupRunExecutor + Orchestrator + dispatch (依赖 S5,S6, 复用单聊 turn)
      │
S8 GroupChat REST + Group Run SSE (依赖 S7)
      │
S9 desktop: 建群 + 群聊视图 + 黑板侧栏 (依赖 S1,S8)
      │
S10 测试 + 文档回顾
```

里程碑校验点：
- **M1（S2 完成）**：能建群、`git init` 工作区、库表就绪。
- **M2（S7 完成）**：服务端可跑通"用户消息 → Orchestrator(可注入假计划) → 串行 dispatch → 黑板更新 → 汇报"。
- **M3（S9 完成）**：桌面端端到端可演示单 @ 直派与拆解派发。

---

## 1. Step S1 — Shared 类型契约（`packages/shared/src/`）

**目标**：定义前后端共享的群聊 + 黑板 + 记忆契约。后端 API 设计优先，mock 仅参考。

涉及文件：
- 新增 `packages/shared/src/group-chat.ts`：`GroupChatView`、`OrchestratorConfigView`、`GroupMemberView`、`ProjectMeta`、`CreateGroupChatPayload`、`ConverseGroupPayload`、`GroupRunEvent`（discriminated union: `orchestrator_plan`/`task_status`/`member_turn_event`/`blackboard_update`/`orchestrator_report`/`done`）。
- 新增 `packages/shared/src/blackboard.ts`：`BlackboardView`、`BlackboardArtifact`、`BlackboardDecision`、`BlackboardContract`、`BlackboardTaskNode`、`AgentMemoryItem`。
- 编辑 `packages/shared/src/chat.ts`：复用 `SenderInfo(role:'orchestrator')`/`TaskListMessage`/`OptionsMessage`；新增 `GroupMessageView`（带 `senderAgentId`，统一 text/task-list/options/system kind）。
- 编辑 `packages/shared/src/index.ts`：导出新模块。

校验：`pnpm -F @agenthub/shared typecheck`。

---

## 2. Step S2 — Server 实体 + 建表 + 共享工作区（`apps/server/src/multiagents/group/`）

> 动 `apps/server` 前置：已读 `apps/server/CLAUDE.md`（NestJS、DTO/Entity 分离、统一异常类、OpenAPI envelope）。新增 `group` 子目录与单聊 `multiagents` 同域。

**S2.1 实体（Entity，与 DTO 分离）**
- `group/entities/group-chat.entity.ts`：`group_chat`（id, userId, title, status, workspaceDir, orchestratorVendor/Model/ProviderId, projectMeta 字段, createdAt, updatedAt）。
- `group/entities/group-chat-member.entity.ts`：`group_chat_member`（id, groupChatId, agentId, roleInGroup, joinedAt）。
- `group/entities/group-message.entity.ts`：`group_message`（id, groupChatId, kind, senderRole, senderAgentId, text, payload json, createdAt）。
- `group/entities/group-run.entity.ts`：`group_run`（id, groupChatId, status, routeKind, createdAt, endedAt）。
- `blackboard/entities/`：`blackboard-artifact`、`blackboard-decision`、`blackboard-contract`、`blackboard-task`、`blackboard-event`。
- `memory/entities/agent-memory-item.entity.ts`。

**S2.2 建表迁移**：按现有项目迁移方式新增表（沿用单聊建表风格；快速开发阶段，无存量迁移负担）。

**S2.3 共享工作区服务** `group/group-workspace.service.ts`：
- `createWorkspace(groupId)`：建目录 + `git init`（+ 初始空 commit）。
- `createTaskWorktree(groupId, taskId)`：`git worktree add` 分支 `task/<taskId>`。
- `mergeTaskWorktree(groupId, taskId)`：合并回主分支（串行执行，无冲突）+ 移除 worktree。
- `diffArtifacts(groupId, taskId)`：返回改动文件清单（喂给黑板更新）。
- 复用单聊工作目录规范化逻辑（参考 `AgentSession` 创建流程）。

校验（M1）：`pnpm -F @agenthub/server typecheck`；起服务建群 → 目录 + git 仓库存在 + 表可写。

---

## 3. Step S3 — BlackboardService（`group/blackboard/blackboard.service.ts`）

- `getState(groupId)` → `BlackboardView`。
- `upsertArtifact(groupId, patch, basedOnVersion)`：**乐观锁**，version 不符抛统一异常 `BLACKBOARD_CONFLICT`，要求重读。
- `writeDecision(groupId, decision)`：写入并把 `supersedes` 指向的旧决策置 `superseded`。
- `writeContract` / `getContract`：写入校验 owner + approvalRequired（非 owner 改 → 抛 `CONTRACT_APPROVAL_REQUIRED`）。
- `upsertTaskGraph` / `setTaskStatus`。
- `appendEvent(groupId, event)`：每次状态变更 append `blackboard_event`。
- `summarize(groupId)`：产出 `blackboardSummary`（给 Orchestrator 上下文 + ContextAssembler 摘要）。

单元测试：乐观锁拒绝、decision supersede、contract owner 保护。

---

## 4. Step S4 — AgentMemoryService（`memory/agent-memory.service.ts`）

- `retrieve(agentId, scope)`：按 project/module 过滤 active 记忆。
- `writeCandidate(agentId, candidate)`：轻量去重（同 scope + 近似 content 跳过）后写入。
- `markStaleByContract(...)`：预留接口（本轮可空实现，P1 接 MemoryManager）。
- 与黑板对齐：检索结果交由 ContextAssembler 做冲突丢弃（记忆不对抗黑板）。

单元测试：去重、scope 过滤。

---

## 5. Step S5 — ContextAssembler（`group/context/context-assembler.service.ts`）

- 输入 `ContextAssemblerInput`（agentId, task, mode, targetArtifacts, budget）。
- 装配顺序与**检索优先级铁律**：当前产出物 > 黑板契约/决策 > 任务上下文 > 私有记忆 > 历史会话摘要。
- 步骤：
  1. system_prompt（成员角色）+ TaskContext。
  2. 黑板相关 facts：默认注 `summary`，全文留给 Agent 用文件工具读（注入 `artifact_refs` + `load_policy: read_before_edit`）。
  3. memory 检索 → 与黑板契约/决策冲突者丢弃并标 stale。
  4. 情况 A 命中 → 附 `short_term_buffer`。
  5. 预算超限裁剪序：历史会话摘要 → 低优记忆 → 非目标产出物摘要（保底 system+TaskContext+目标产出物 ref+相关契约）。
- 输出 `ContextAssemblerOutput`（拼成成员 turn 的 prompt/system）。

单元测试：优先级冲突丢弃、预算裁剪顺序、情况 A/B/C 装配差异。

---

## 6. Step S6 — MessageRouter + ContinuityResolver（`group/routing/`）

**MessageRouter** `message-router.service.ts`（纯机械、不调 LLM）：
- 解析 `@mentions`（成员名/Orchestrator），输出 `routeKind`：`direct_single` / `multi` / `orchestrate`。
- 原文写入 `group_message`（presentation_log）。

**ContinuityResolver** `continuity-resolver.service.ts`：
- 读 Redis `group:stb:{groupId}:{agentId}`（TTL，默认 5min）。// stb = short_term_buffer
- 判定 A（热窗口 + 强指代词表）/ B（黑板 artifacts 命中同产出物）/ C（无匹配）。
- 判不了 → 标记 `needsOrchestratorJudgement`，兜底交 Orchestrator。
- 收尾写 `short_term_buffer`（recent_intents/outputs/artifacts/mention_index）。

单元测试：路由表全分支、A/B/C 判定、指代词命中。

---

## 7. Step S7 — GroupRunExecutor + Orchestrator + dispatch（核心，`group/run/`）

> 复用单聊 turn 机制：成员 turn 直接调用现有 `LiveAgent`/turn 运行路径（参考 `agent-single-chat-spec` 的 runTurn），仅把 `workingDirectory` 换成 worktree、把事件 XADD 到 group run 的 Redis Stream。

**S7.1 OrchestratorService** `orchestrator.service.ts`：
- 用群配置的 vendor/model/provider + **内置编排 system_prompt** 跑一轮 LLM，输入 `orchestrator_context`（projectGoal/activeTaskGraph/recentUserIntents/blackboardSummary/memberStatus）。
- 产出结构化计划（单任务 or task_graph），写入黑板 + 发 task-list 消息到 presentation_log。
- 末尾聚合各成员产出生成汇报 text 消息。
- **可注入性**：计划生成走一个 `OrchestratorPlanner` 接口，测试用假实现注入（避免真实 LLM e2e）。

**S7.2 dispatch** `dispatch.service.ts`：
- 串单次派发：ContextAssembler 装配 → createTaskWorktree → 取/重建成员 AgentSession（cwd=worktree）→ 跑 turn（事件入 group run Stream + 落 agent_message_step）。
- turn 收口：`diffArtifacts` → BlackboardService.upsertArtifact(version+1) → mergeTaskWorktree → 处理成员 `report_completion`（affected 校验 / decisions / memory_candidate）→ appendEvent → setTaskStatus(done/failed)。
- 成员"协作工具"（内部协议，非 REST）：`report_completion`（结构化产出）。MVP 实现方式——约定成员 turn 末尾输出结构化报告（或注入一个轻量工具），由 dispatch 解析；`blackboard_write` 由服务端基于 git diff + report 代写，成员不直接写库。

**S7.3 GroupRunExecutor** `group-run.executor.ts`：
- `runGroup(runId)`：按 routeKind 编排（direct_single 走 ContinuityResolver 直派；orchestrate/multi 走 Orchestrator）。
- 串行遍历就绪任务逐个 dispatch；失败即如实汇报并停止后续（最小降级）。
- 管理 run 活跃指针（SET NX 跨实例互斥）、Redis Stream、最终 `done`、TTL；复用单聊 abort/超时/boot 回收范式。

集成测试（M2，假 Planner）：用户消息 → 计划 → 串行 dispatch → 黑板 artifact version 递增 → 汇报消息落库。

---

## 8. Step S8 — REST + SSE（`group/group-chat.controller.ts` + DTO）

- DTO（与 Entity 分离）：`CreateGroupChatDto`、`UpdateGroupChatDto`、`ConverseGroupDto`，响应 DTO **class**（非 interface，保证 OpenAPI schema）。
- 端点（全部 `@ApiTags('group-chats')` + `@ApiOperation` + `@ApiEnvelope`）：
  - `POST /group-chats`、`GET /group-chats`、`GET /group-chats/:id`、`PATCH /group-chats/:id`、`DELETE /group-chats/:id`
  - `GET /group-chats/:id/messages`、`POST /group-chats/:id/converse`（返回 `{ runId }`）
  - `GET @Sse /group-chats/:id/runs/:runId/events`、`POST /group-chats/:id/runs/:runId/abort`
  - `GET /group-chats/:id/blackboard`、`GET /group-chats/:id/blackboard/events`
- 鉴权：复用 JWT guard，校验群属当前用户；run/turn 归属校验沿用单聊范式。
- `GroupChatModule` 注册以上 service/controller，接入根模块。

校验：`/api/reference` 出现群聊端点；envelope 正确。

---

## 9. Step S9 — Desktop（`apps/desktop/src/renderer/src/`）

> 复用设计系统 ui/ 组件 + Tailwind tokens，禁裸 hex / `text-[Npx]` / 手搓按钮。

- **建群入口**：`ChatList` 的 `+` 菜单「创建群聊」从禁用占位变可用。
- **建群弹窗**：选成员 Agent（多选）+ 配置 Orchestrator（vendor/model/provider）+ projectMeta + 工作区目录。提交 `POST /group-chats`。
- **群聊视图** `views/GroupChatView.vue`（或扩展 ChatView）：
  - 多发言者气泡（user/orchestrator/agent/system），复用现有 message-card 体系（`messageFromView` 扩展群消息 kind）。
  - 任务面板（task-list 消息，只读）。
  - Orchestrator 汇报卡。
  - 右侧黑板/产出物侧栏（artifacts/decisions/contracts 摘要）。
- **运行与围观**：`POST converse` 拿 `runId` → 订阅 `runs/:runId/events`；复用单聊后台订阅/detach/重连范式；`activeRunId` 驱动打开群时自动订阅。
- **API client**：renderer 侧新增群聊 API 方法（沿用现有 HTTP+SSE 封装）。

校验：端到端单 @ 直派、无 @ 拆解派发可视。

---

## 10. Step S10 — 测试与文档回顾（spec-kit 阶段 4）

- **最小相关测试**：S3/S4/S5/S6 单元测试 + 建群、单 @ 直派一条 e2e happy path（假 Planner）。`pnpm -r typecheck`、`pnpm -F @agenthub/desktop lint`。
- **回顾 Spec**：核对功能遗漏/受限项，若有变化更新 spec 的 `Known Limits` 并告知用户。
- **更新 README**：根 `README.md`、`apps/server/README.md`、`apps/desktop/README.md`（如存在）补群聊功能描述。
- **提交建议**：按 Conventional Commits 分模块提交，例如：
  - `feat(shared): group chat & blackboard contracts`
  - `feat(server): group chat collaboration mvp (blackboard, orchestrator, dispatch)`
  - `feat(desktop): group chat view & creation flow`

---

## 涉及文件清单（速查）

| 层 | 新增/编辑 |
| --- | --- |
| shared | +`group-chat.ts` +`blackboard.ts` ~`chat.ts` ~`index.ts` |
| server | +`multiagents/group/**`（entities/dto/controller/services：workspace、blackboard、memory、context-assembler、message-router、continuity-resolver、orchestrator、dispatch、group-run executor、module）+ 建表迁移 |
| desktop | +`views/GroupChatView.vue` ~`ChatList`/创建弹窗 ~`message-card`/`messageFromView` + renderer 群聊 API |
| docs | ~spec Known Limits ~README |

---

## 风险与注意

- **复用 turn 的耦合点**：成员 dispatch 必须复用现有 turn 运行路径而非另起一套；落地前先定位单聊 `runTurn`/`LiveAgent` 的可复用入口，避免分叉实现。
- **report_completion 协议**：MVP 用"成员结构化报告 + 服务端基于 git diff 代写黑板"，不让成员直接写库——降低协议复杂度，也契合"产出物即真相源"。
- **Orchestrator 内置 prompt 质量**直接决定拆解效果；先用可注入假 Planner 打通管线，再迭代真实 prompt。
- **git worktree** 在并发下才有冲突价值；本轮串行，仅需保证 worktree 生命周期（创建/合并/清理）正确，避免残留分支。
