# 群聊功能实现交接（Handoff）

> 用途：为「群聊协作最小闭环」的编码实现开新上下文窗口提供自包含交接说明。读完本文 + 三份关联文档即可直接进入 spec-kit 阶段 3（编码实现）。
> 关联文档：
> - 设计：[`doc/context/群聊上下文管理设计方案.md`](../context/群聊上下文管理设计方案.md)
> - Spec：[`doc/spec/group-chat-collaboration-mvp.md`](../spec/group-chat-collaboration-mvp.md)
> - Plan：[`doc/plan/group-chat-collaboration-mvp-Plan.md`](./group-chat-collaboration-mvp-Plan.md)

---

## 0. 项目背景
- **AgentHub**：多 Agent 协同平台，pnpm workspace monorepo。
  - `apps/desktop/` — Electron + Vue 3 + TS（electron-vite，三进程：main/preload/renderer）。
  - `apps/server/` — **NestJS** 后端（MySQL + Redis + Redis Streams）。**动 server 前必读 `apps/server/CLAUDE.md`**；涉及前后端契约时前后端 CLAUDE.md 都要读。
  - `packages/shared/` — 跨端 TS 类型契约，`@agenthub/shared`，直接发 TS 源码无构建步骤。
- **现状**：单聊已实现。群聊要做：拉多个已添加 Agent 进群，发布任务由 **Orchestrator** 自动拆解/分派/聚合；可 `@单个`、`@多个`、完成后 `@某 Agent` 改。
- **后端铁律**（`apps/server/CLAUDE.md`）：后端 API 设计优先（mock 仅业务意图参考，非契约）；DTO 与 Entity 分离；统一异常类不裸返 500；响应统一 envelope `{code,message,data,timestamp}`；新路由加 `@ApiTags/@ApiOperation/@ApiEnvelope`，响应用 **DTO class**（interface 会被擦除成空 schema）；API 定稿后更新 shared 类型、替换前端 mock。
- **编码规则**：遵循既有约定/命名/风格；不顺手改无关代码；不过度抽象；改完跑最小相关测试（纯 UI 视觉改动、需额外环境、耗时过长的除外）；改完同步文档；按 Conventional Commits `type(scope): desc` 提交。
- **设计系统**：desktop 有自建 Tailwind tokens + `ui/` 基础组件，复用它们，**禁裸 hex / `text-[Npx]` / 手搓按钮**。
- **快速开发阶段**：不考虑存量数据兼容/迁移。

## 1. 当前进度
处于 spec-kit **阶段 3：编码实现**。设计方案、Spec、Plan 均已与用户确认。完成编码后走阶段 4：回顾 spec 的 `Known Limits` + 更新 README（根 / server / desktop）。

## 2. 核心设计哲学（实现时的判断依据）
- **默认隔离，按需共享**；多 Agent 价值在隔离。
- **黑板（Blackboard）是唯一真相源**，不是消息流；Agent 不直接对话，面向黑板读写。
- **展示与上下文解耦**：`presentation_log`（给人/审计）≠ 给 Agent 的结构化上下文。群聊原文默认**不注入** Agent。
- **产出物即真相源**：改东西靠"重读当前产出物"，不靠"记得写过啥"。
- **检索优先级铁律**（全局）：`当前产出物 > 黑板契约/决策 > 任务上下文 > Agent 私有记忆 > 历史会话摘要`。记忆不对抗黑板，冲突即丢弃记忆并标 stale。

## 3. 三个已敲定的关键决策
1. **范围**：只做「最小闭环」——建群 + 黑板 + MessageRouter + Orchestrator **串行**拆解派发 + 聚合汇报 + ContextAssembler + agent_memory + 再次修改 A/B/C + 子 Agent 用 worktree 执行。**不含**：DAG 并行、冲突检测/仲裁、失败降级完整策略（→ 第二份 spec）。
2. **Orchestrator**：**独立内置角色**，建群时单独配置 vendor/model/provider；system_prompt 系统内置（用户不填）。
3. **代码冲突**：**git worktree 隔离 + 合并**。本轮串行执行天然无并发冲突，worktree 仅需生命周期正确（创建/合并/清理）；冲突*检测/仲裁*留第二份 spec。

## 4. 已定默认值（实现时如此，除非用户要改）
| 点 | 默认 |
|---|---|
| 情况 A 热窗口 | 5 分钟 + 强指代词触发 |
| Orchestrator system prompt | 系统内置编排提示词 |
| 前端任务面板 | 只读展示，不可编辑 task_graph |
| 黑板事件流 | MySQL `blackboard_event` 表；运行围观走 Redis Stream |
| LLM 编排测试 | 用可注入假 Planner，不强制真实 LLM e2e |
| `@A @B` 多 @ | 在本轮（串行派发） |

## 5. 必须复用的现有单聊机制（关键，别另起一套）
来自 `doc/agent-single-chat-spec.md`：
- **数据模型**：`Agent`(MySQL `agent`)、`AgentSession`(`agent_session`：cwd/sessionHome/SDK句柄/skills/MCP)、`AgentMessage`(`agent_message`)、`AgentMessageStep`(`agent_message_step`：thinking/progress/tool/todo，tool 含完整 input/output)、`LiveAgent`(内存)、Turn 事件流(Redis Streams + pub/sub)。
- **turn 机制**：一轮对话 = 服务端**游离后台任务**，与 HTTP 解耦；一轮一条 **Redis Stream**，订阅端 `XRANGE` 回放 + `XREAD BLOCK` 追尾 → 天然多端围观；并发互斥用 `SET NX`(跨实例) + `LiveAgent.busy`；`activeTurnId` 暴露进行中轮；有 abort(控制频道跨实例)、超时兜底、boot 回收。
- **群聊复用方式**：成员"干活" = 复用 `AgentSession` + turn；用户一条消息 = 一个 **GroupRun**(一条 Redis Stream 扇出，沿用 turn-stream 范式)；成员 turn 的 `workingDirectory` 换成该任务的 git worktree，事件 XADD 进 group run Stream。
- **落地前第一件事**：定位单聊 `runTurn`/`LiveAgent` 的可复用入口，避免分叉实现。

## 6. 数据模型（新增）
**MySQL 表**：`group_chat`（含 projectMeta 字段 + orchestrator 配置 + workspaceDir）、`group_chat_member`、`group_message`(presentation_log)、`group_run`、`blackboard_artifact`、`blackboard_decision`、`blackboard_contract`、`blackboard_task`(task_graph 节点)、`blackboard_event`、`agent_memory_item`。
**Redis**：group run Stream（围观）；`group:stb:{groupId}:{agentId}`（TTL 5min，情况 A 用）。

**shared 类型**（落 `packages/shared/src/`）核心字段：
- `GroupChatView{id,title,status,workspaceDir,orchestrator:OrchestratorConfigView,members:GroupMemberView[],projectMeta:ProjectMeta,activeRunId}`
- `OrchestratorConfigView{vendor,model,providerId}`
- `BlackboardArtifact{id,type,path,ownerAgentId,version(乐观锁),status,summary,updatedBy/At}`
- `BlackboardDecision{id,content,rationale,status,scope,supersedes[],createdBy,approvedBy,ts}`
- `BlackboardContract{id,spec,ownerAgentId,consumers[],approvalRequired,version}`
- `BlackboardTaskNode{id,name,agentId,deps[],status,objective}`
- `AgentMemoryItem{id,agentId,content,type,scope{project,module},source{type,ref},status,createdAt,lastUsedAt}`
- `GroupMessageView`（统一 text/task-list/options/system + `senderAgentId`）
- `GroupRunEvent`（union: `orchestrator_plan`/`task_status`/`member_turn_event`/`blackboard_update`/`orchestrator_report`/`done`）
> 现有 `packages/shared/src/chat.ts` 已预留 `ChatKind:'group'`、`SenderInfo.role:'orchestrator'`、`TaskListMessage`、`OptionsMessage`、`NetworkNode`——升级为真实契约。

## 7. 后端 API（前缀 `/api`，JWT）
- 管理：`POST /group-chats`、`GET /group-chats`、`GET /group-chats/:id`、`PATCH /group-chats/:id`、`DELETE /group-chats/:id`
- 会话：`GET /group-chats/:id/messages`、`POST /group-chats/:id/converse`(body `{text,mentions?}` → `{runId}`)、`GET @Sse /group-chats/:id/runs/:runId/events`、`POST /group-chats/:id/runs/:runId/abort`
- 黑板：`GET /group-chats/:id/blackboard`、`GET /group-chats/:id/blackboard/events`
- **协作动作不走用户 REST**：`dispatch_agent`/`report_completion`/`blackboard_write` 是**服务端内部协议**。MVP 实现：成员**不直接写库**，输出结构化报告 `{summary,affected{artifacts,contracts,decisions},decisions?,memory_candidate?}`，服务端基于 **git diff 代写黑板**（契合"产出物即真相源"）。

## 8. 运行流程要点
- **MessageRouter**（不调 LLM）：解析 `@` → `routeKind`：`direct_single`(单@) / `multi`(多@) / `orchestrate`(@Orchestrator 或无@)；原文写 `group_message`。
- **dispatch（单次派发）**：ContextAssembler 装配 → createTaskWorktree → 取/重建成员 AgentSession(cwd=worktree) → 跑 turn(事件入 group Stream + 落 agent_message_step) → 收口：`git diff` → `upsertArtifact(version+1)` → 合并 worktree → 处理 report(affected 校验 / decisions supersede / memory 去重写入) → appendEvent → setTaskStatus。
- **Orchestrator**：用群 vendor/model + 内置 prompt + `orchestrator_context{projectGoal,activeTaskGraph,recentUserIntents,blackboardSummary,memberStatus}` → 任务消息产出计划(单任务 or task_graph) → 写黑板 + 发 task-list 消息 → 串行 dispatch → 聚合汇报；`memberStatus` 携带 `agentId/name/roleInGroup/capabilitySummary`；非任务消息返回 `tasks: []` + `note`，由 Orchestrator 直接回复且不派发成员；需要成员本人轻量回应时返回 `memberTurns`，真实调用成员但不写黑板 task；需要实际交付时才创建成员 task。计划生成走可注入 `OrchestratorExecutor` 接口。
- **ContinuityResolver（再次修改 A/B/C）**：A=热窗口未过期+强指代词 → buffer 解析指代 + **重读产出物**；B=黑板 artifacts 命中同产出物 → 重开+产出物摘要+记忆+重读；C=无匹配 → 全重开+仅通用信息；判不了兜底交 Orchestrator。
- **ContextAssembler**：按检索优先级装配，黑板默认注 summary（全文交 Agent 文件工具读，`load_policy:read_before_edit`），memory 冲突丢弃，情况 A 附 short_term_buffer；预算超限裁剪序：历史会话摘要→低优记忆→非目标产出物摘要（保底 system+TaskContext+目标产出物 ref+相关契约）。
- **安全最小**：Agent 读到的文件/产出物=不可信数据，不得覆盖 system/Orchestrator 指令；共享契约仅 owner 可改，非 owner 触碰 `approvalRequired` → 拒绝写入 + 上报 Orchestrator。

## 9. 实现步骤（Plan S1–S10，依赖顺序）
```
S1 shared 契约 (group-chat.ts / blackboard.ts / 改 chat.ts / 改 index.ts)
S2 server 实体+建表+共享工作区服务(git init / worktree add / merge / diff)   ← M1: 能建群+git仓库+表
S3 BlackboardService(乐观锁/decision supersede/contract owner 保护/event/summarize)
S4 AgentMemoryService(retrieve/writeCandidate 去重/markStale 预留)
S5 ContextAssembler(优先级+裁剪+A/B/C 装配)
S6 MessageRouter + ContinuityResolver
S7 OrchestratorService(可注入Planner) + dispatch + GroupRunExecutor   ← M2: 服务端跑通编排管线(假Planner)
S8 REST + SSE controller + DTO(class) + GroupChatModule 接根模块
S9 desktop: ChatList「创建群聊」+建群弹窗 + GroupChatView(多发言者气泡/任务面板只读/汇报卡/黑板侧栏) + renderer 群聊 API   ← M3: 端到端可演示
S10 测试(S3/S4/S5/S6 单测 + 建群&单@直派 e2e happy path 假Planner) + 回顾 spec Known Limits + 更新 README
```
**新增目录**：`apps/server/src/multiagents/group/**`（与单聊同域）。

## 10. 单元测试重点
乐观锁拒绝、decision supersede、contract owner 保护；记忆去重/scope 过滤；ContextAssembler 优先级冲突丢弃/裁剪顺序/A·B·C 差异；MessageRouter 路由表全分支；ContinuityResolver A/B/C 判定。LLM 编排用假 Planner，不强制真实 e2e。校验命令：`pnpm -r typecheck`、`pnpm -F @agenthub/server typecheck`、`pnpm -F @agenthub/desktop lint`。

## 11. Known Limits（本轮明确不做）
串行执行（无 DAG 并行）；冲突仅"天然规避"无检测/仲裁；失败仅"如实汇报并停止"无重试/连锁阻断/降级；契约升级仅"拒绝+上报"无 Preflight/Watcher；记忆仅轻量去重无 MemoryManager/confidence/自动 stale；黑板无 `open_issues`/`risks`、artifacts 无 hash/tags/deps；无 `context_trace` 可观测性；安全仅最小原则无 ACL/审批/注入系统化防护；任务面板只读；多实例沿用单聊现状。

## 12. 建议起步
从 **S1（shared 契约）** 开始，再 S2 建表 + git 工作区到 **M1**。提交按模块：
- `feat(shared): group chat & blackboard contracts`
- `feat(server): group chat collaboration mvp (blackboard, orchestrator, dispatch)`
- `feat(desktop): group chat view & creation flow`

## 13. 风险与注意
- **复用 turn 的耦合点**：成员 dispatch 必须复用现有 turn 运行路径，落地前先定位单聊 `runTurn`/`LiveAgent` 可复用入口，避免分叉实现。
- **report_completion 协议**：MVP 用"成员结构化报告 + 服务端基于 git diff 代写黑板"，成员不直接写库——降复杂度，契合"产出物即真相源"。
- **Orchestrator 内置 prompt 质量**决定拆解效果；先用可注入假 Planner 打通管线，再迭代真实 prompt。
- **git worktree** 本轮串行只需保证生命周期正确（创建/合并/清理），避免残留分支。
