# AgentHub 产品需求文档（PRD）

> 版本：v1.0 ·  日期：2026-06-10
> 适用范围：AgentHub 多 Agent 协作平台（桌面端 / 服务端 / Android / 共享契约 / Agent 引擎）
> 文档定位：基于课题 README、各端 README、`doc/context/群聊上下文管理设计方案.md` 及 `doc/spec/` 全量 spec 与现有代码，沉淀的**完整产品需求文档**。本文是「做什么 / 为什么 / 优先级」的单一事实源；「怎么做」的工程细节以各模块 spec 与实体定义为准。

---

## 0. 文档导航

| 章节 | 内容 |
| ---- | ---- |
| 1 | 产品概述：背景、愿景、价值主张 |
| 2 | 目标与非目标 |
| 3 | 目标用户与典型场景 |
| 4 | 产品功能地图与优先级总览 |
| 5 | 详细功能需求（11 个功能域） |
| 6 | 核心端到端流程 |
| 7 | 技术架构概览 |
| 8 | 数据模型与 API 总览 |
| 9 | 群聊上下文管理（核心设计摘要） |
| 10 | 非功能需求 |
| 11 | 优先级路线图（P0/P1/P2） |
| 12 | 已知限制与风险 |
| 13 | 交付物与验收标准 |

---

## 1. 产品概述

### 1.1 背景

AI Coding Agent（Claude Code、Codex、OpenCode 等）已能通过对话式交互产出网页、代码、文档、Workflow 等产物。但当前体验割裂：每个工具各自为政、API 各异、缺少统一的"多 Agent 协同"范式，用户难以像调度一个团队那样让多个 Agent 围绕同一目标分工协作。

AgentHub 以 **IM 聊天**作为核心交互范式，把"与 AI 协作"重塑为"像用飞书/微信一样与一群 AI 同事对话"。用户新建对话、发送消息，即可与不同 Agent 单聊；在群聊中 @ 多个 Agent，由主 Agent（Orchestrator）自动协调分工，多个 Agent 像群聊成员一样依次交付各自产出。

### 1.2 产品愿景

> 让"指挥一支 AI 团队"像发一条微信消息一样自然。

把异构的 AI Agent 平台统一到一个 IM 式工作台中，用对话驱动从需求 → 拆解 → 多 Agent 协作 → 产物预览 → 二次编辑 → 部署发布的完整闭环。

### 1.3 核心价值主张

1. **统一入口**：通过统一适配器层屏蔽 Claude Code / Codex 等平台 API 差异，一个界面对话所有 Agent。
2. **IM 式心智**：会话列表、单聊/群聊、@、消息卡片、置顶、归档、搜索——零学习成本复用 IM 心智。
3. **多 Agent 自动协作**：Orchestrator 自动拆解任务、按 DAG 调度、聚合汇报，处理失败降级与冲突上报。
4. **产物即对话**：代码 Diff、网页预览、文件附件内联在聊天流中，可预览、可二次编辑写回、可一键部署。
5. **工程化上下文治理**：以结构化黑板为唯一真相源，默认隔离、按需共享，解决多 Agent "上下文爆炸/串味"问题。
6. **多端**：桌面端（主交付）+ Android 移动端，后端游离运行支持多端实时围观同一轮对话。

---

## 2. 目标与非目标

### 2.1 产品目标

- **G1**：提供流畅的 IM 单聊体验——用户可与任意已接入/自建 Agent 1v1 对话，多会话并行，上下文连续，支持多轮迭代修改。
- **G2**：提供群聊多 Agent 协作——一个对话内多个 Agent 在 Orchestrator 协调下围绕共享工作区协同交付。
- **G3**：至少接入 2 个主流 Agent 平台（Claude Code + Codex），并支持用户对话式自建 Agent。
- **G4**：Agent 产出支持内联预览、代码二次编辑写回、工作区变更追踪与提交。
- **G5**：沉淀一套可复用的「人机协作开发规范」（Spec、Skill、Rules），这是课题 AI 协作能力维度（权重 30%）的核心。
- **G6**：桌面端为主力端达到可演示 Demo 标准；Android 端提供轻量 IM MVP 体验。

### 2.2 非目标（本阶段不做 / 明确推迟）

- ❌ 不做完整的企业级权限/ACL/审批流（仅保留最小安全原则，详见 §9.5）。
- ❌ 不做语义级代码冲突检测与自动仲裁（MVP 用乐观锁 + git worktree 隔离 + 冲突上报）。
- ❌ 不做生产级容器化/云部署平台（部署仅本地子进程探测式运行，Docker Runner 预留接口）。
- ❌ 不做 Web 端（课题列为主力端，但当前主交付为桌面端；架构为复用预留）。
- ❌ 不做 PPT/Office 在线渲染（仅返回受限态信息）。
- ❌ 不做消息历史分页、消息体全文搜索（当前为本地过滤）。

---

## 3. 目标用户与典型场景

### 3.1 目标用户

| 用户 | 描述 | 关注点 |
| ---- | ---- | ---- |
| 开发者 / 技术人员 | 用 AI Agent 写代码、做网页、生成文档 | 产出质量、可编辑、工作区可控 |
| 产品/设计/运营 | 通过对话让 AI 团队完成端到端任务 | 协作是否跑通、产物能否预览/部署 |
| AI 协作探索者 | 研究多 Agent 编排与上下文工程 | 编排策略、黑板/记忆机制、可观测性 |

### 3.2 典型使用场景

1. **单任务单聊**：「用 Claude Code 写一个 React 时区计算器组件」——选 Claude Code Agent 新建单聊，多轮迭代直到满意，预览网页、编辑代码、提交工作区变更。
2. **多会话并行**：同时开 3 个单聊，分别让不同 Agent 处理不同任务，像 IM 多窗口切换。
3. **群聊协作交付**：建群拉入 ProductAgent / FrontendAgent / TestAgent，发「做一个时区计算器」——Orchestrator 自动拆解为设计→开发→测试，串/并行派发，成员各自在 git worktree 干活，黑板沉淀决策/契约/产物，最终聚合汇报并给出部署卡片。
4. **再次迭代修改**：群聊里 @FrontendAgent「那个切换按钮换个样式」——系统识别强延续（情况 A），解析指代、重读当前产出物后修改。
5. **澄清挂起**：成员 Agent（如 PM）反问用户「要 Web 版还是桌面版？」——任务图挂起等待，用户回答后从同一会话续跑。
6. **跨端围观**：桌面端发起一轮长任务后关窗，手机 Android 端打开同一会话实时围观运行进度。

---

## 4. 产品功能地图与优先级总览

### 4.1 功能域总览

```
AgentHub
├── A. 用户与认证        注册/登录/登出/注销/资料  (JWT + Redis 黑名单)
├── B. Provider 管理     用户自建模型平台/密钥/默认模型/测连接/拉模型
├── C. Agent 管理        虚拟员工配置 CRUD + 能力/头像/skills/MCP
├── D. 单聊（1v1）       多会话并行 + 后台游离 turn + 多端围观 + 再生成 + pin
├── E. 群聊协作          Orchestrator + 黑板 + 共享工作区 + DAG 调度 + 上下文装配
├── F. 产物预览与编辑    内联卡片 + 抽屉/全屏预览 + text/html 写回
├── G. 工作区 Diff/提交  会话工作区累计变更 + checkpoint 提交
├── H. 部署发布          静态预览卡片 + 本地服务运行 + 日志流  (P2)
├── I. 会话列表治理      统一单/群列表 + 搜索 + 置顶 + 归档（跨端持久）
├── J. 文件空间与目录    用户隔离文件空间 + 服务端目录浏览 + 本地 Skill 上传
└── K. 多端             桌面端（主交付） + Android（MVP）
```

### 4.2 优先级总览

| 优先级 | 含义 | 覆盖范围 |
| ------ | ---- | -------- |
| **P0** | 课题 MVP，必须跑通 | A 用户、B Provider、C Agent、D 单聊、E 群聊最小闭环 + 编排硬化、F 产物预览(ART-1/2)、G 工作区 Diff、I 列表治理、J 文件空间 |
| **P1** | 强烈建议补 | 群聊 Orchestrator 连续性/最终审查/挂起恢复、记忆治理、可观测性(context_trace)、Contract Watcher |
| **P2** | 后续演进 | H 部署发布、语义冲突检测、正式 ACL/审批、Prompt Injection 系统防护、Web 端 |

> 说明：群聊的部署卡片（H）已有实现 spec（`group-chat-deploy-card.md`）并落地，但课题层面定位为 P2 增强；本文保留其需求描述并标注实现状态。

---

## 5. 详细功能需求

> 约定：所有后端接口前缀 `/api`，成功响应统一信封 `{ code, message, data, timestamp }`，除登录/注册外均需 `Authorization: Bearer <token>`。

### A. 用户与认证（P0）

**目标**：提供账号体系与无状态 JWT 鉴权基座，所有业务数据按 `userId` 隔离。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| A-1 | 注册 | `account + password`，不自动登录；账号唯一不可变 |
| A-2 | 登录 | 返回 `{ token, expiresIn, user }` |
| A-3 | 登出 | 当前 token 的 `jti` 写入 Redis 黑名单即时失效 |
| A-4 | 获取当前用户 | `GET /user/me` |
| A-5 | 更新资料 | 部分更新 `nickname` / `avatar`（头像支持 URL 或 ≤256KiB data URL）|
| A-6 | 注销账号 | 逻辑删除并吊销当前 token |

**机制**：无状态 JWT（含 `jti`）+ 服务端黑名单实现即时失效（依赖 Redis 在线）；密码仅存 bcrypt 哈希，实体 `select:false`。
**已知限制**：注销为逻辑删除，account/email 仍占唯一索引；无登录失败次数限制/验证码/密码找回；资料更新仅开放 nickname/avatar。

### B. Provider 管理（P0）

**目标**：用户自带模型平台与密钥（"自带钥匙"），作为 Agent/群聊运行时凭证来源。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| B-1 | Provider CRUD | 同一用户下 `platformName` 唯一；归属创建者 |
| B-2 | 协议类型 | `openai-chat-completions` / `openai-responses` / `anthropic` |
| B-3 | 测试连接 | 只读打上游列模型接口，返回 `{ ok, latencyMs, modelCount?, message? }`，失败不抛异常 |
| B-4 | 刷新模型 | 拉取上游模型整体覆盖 `modelList` |
| B-5 | 默认 Provider + 默认模型 | 用户级唯一默认项，预填 Agent/群聊创建表单 |

**安全**：`apiKey` 明文存储（需可逆调上游）但 `select:false`，对外仅回掩码 `apiKeyMasked`，绝不回明文。
**已知限制**：apiKey 未做静态加密；测连/拉模型仅作用于已保存 Provider；`models/refresh` 整体覆盖非预览；默认项用户级唯一（不按 vendor 分别维护）。

### C. Agent 管理（"虚拟员工"）（P0）

**目标**：把 Agent 抽象为可复用的"虚拟员工"配置，与具体聊天会话解耦，一个 Agent 可派生多个互不影响的会话。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| C-1 | Agent 配置 CRUD | 展示名、头像/颜色、vendor、Provider、model、Agent Home、system prompt、skills/MCP/tools |
| C-2 | 能力摘要 `capabilitySummary` | 创建时必填，供群聊 Orchestrator 判断成员擅长什么（不作为成员运行时 prompt 注入）|
| C-3 | 头像 | 支持 data URL/URL；未设置时前端用颜色+名称前两字生成默认头像 |
| C-4 | 多 vendor 支持 | Claude Code（含 system prompt + skills + MCP）、Codex（system prompt 经 `base_instructions`，skills 经 `.codex/skills`，MCP 暂不支持）|
| C-5 | 自建 Agent | 对话式/表单式创建，设定 system prompt + 工具集，作为联系人显示 |
| C-6 | 删除 | 级联删除其全部聊天与消息 |

**约束**：Agent 不存 `apiKey/baseUrl`（引用 Provider 取运行时凭证）；`workingDirectory` 必须位于当前用户 `agent_workspace`，`agentHomeDirectory` 必须位于 `agent_home`。

### D. 单聊（1v1）（P0）

**目标**：用户与单个 Agent 在多个独立会话中对话，会话内上下文连续，支持多轮迭代。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| D-1 | 创建/列出/删除单聊 | 选已有 Agent，可选标题/工作目录/skill 文件夹/MCP JSON |
| D-2 | 发起一轮对话 | `POST converse` 返回 `{ turnId }`；已有活跃 turn 时返回 busy，引导用 `activeTurnId` 订阅 |
| D-3 | 后台游离 turn | 一轮对话与 HTTP 请求解耦，发起端切走/关窗/断连不影响 turn 跑完 |
| D-4 | 多端实时围观 | 任意端订阅 `GET turns/:turnId/events`（Redis Stream 回放+追尾），遇 `done` 结束 |
| D-5 | 中止 | `POST turns/:turnId/abort` 跨实例广播 |
| D-6 | 运行步骤展示 | thinking / progress / tool / todo 步骤聚合为可折叠"运行过程·n 步" |
| D-7 | 消息再生成 | 从用户消息或 agent 回复重新生成（追加新回复，不删旧、不截断历史、不回滚工作区）|
| D-8 | 消息 Pin | Pin 后作为本会话后续 turn 固定上下文（会话内全局上下文，≤20 条/~4000 字预算）|
| D-9 | 清空 | 清空句柄与 UI 消息历史 |

**机制**：每个会话独立 SDK 句柄 + 工作目录 + busy 锁，同一 Agent 不同会话互不阻塞；turn 事件流默认 TTL ~1h 后退回 DB；`AGENT_TURN_TIMEOUT_MS` 默认 30 分钟超时 abort。
**已知限制**：消息历史不分页；tool input/output 已持久化但无展开 UI；clear 不删 SDK 落盘文件。

### E. 群聊协作（多 Agent）（P0 核心）

**目标**：把多个已有 Agent 拉进同一会话，围绕一块**黑板**和一个**共享 git 工作区**协作，由内置 **Orchestrator** 自动拆解/调度/聚合汇报。这是课题"多 Agent 调度"评分核心。

#### E.1 群组管理

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| E-1 | 建群 | 选成员 Agent + 配置独立 Orchestrator + projectMeta；可传 `workspaceDir`（须位于用户 agent_workspace），未传则分配 `agent_workspace/group-<groupId>` 并 git init |
| E-2 | 群详情/列表 | 成员、Orchestrator、projectMeta、activeRunId |
| E-3 | 改群 | 标题 / projectMeta / 加成员 / 列表状态（置顶/归档）|
| E-4 | 删群 | 级联删 DB 记录；工作区仅置 `ACTIVE=false`，不删目录 |

#### E.2 协作运行

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| E-5 | 发消息启动群运行 | `POST converse { text, mentions?, attachmentIds? }` → `{ runId }`（后台游离）|
| E-6 | 群运行事件流 | `GET runs/:runId/events`（Redis Stream，成员 turn 事件经 `member_turn_event` 透传，多端围观）|
| E-7 | 中止整个群运行 | 跨实例广播 |
| E-8 | MessageRouter | 纯机械解析 @ → routeKind，不调 LLM；原文进 presentation_log |
| E-9 | Orchestrator 拆解/调度 | 复杂度判断 → 写 task_graph → DAG 派发 → 聚合汇报；非任务消息（问候/闲聊/澄清）直接回复不派发 |
| E-10 | DAG 并行调度 | 按 `deps` 就绪集并行派发，`GROUP_MAX_PARALLEL_TASKS` 默认 3，同一 Agent 不重复派发 |
| E-11 | 失败降级 | 成员单轮失败重试 1 次 → 仍败标 `failed`，下游 `blocked`，独立任务继续；如实汇报请用户决策 |
| E-12 | 冲突上报 | 乐观锁(`based_on_version`) + 影响范围声明 + git worktree 隔离合并；合并/契约/版本冲突 → "⚠️ 需你决策"并停止 |
| E-13 | 成员干活 | 复用单聊适配层 + `scope=group` 内部 AgentSession，workingDirectory 指向任务 git worktree；不进入单聊列表 |
| E-14 | 轻量成员发言 | `memberTurns`：真实调用成员 Agent 做问候/给观点等轻量回复，不建 task/worktree/report/diff |

#### E.3 编排智能（P1 增强，已落地）

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| E-15 | Orchestrator 连续性 | 持久化 `orchestratorSessionId`，`resumeWith()` 续同一编排会话，接住"上一轮追问、下一轮短答" |
| E-16 | contextUpdates 回写 | 已确认项目目标/技术栈/阶段写回 projectMeta，明确用户选择写成已批准黑板决策 |
| E-17 | 多阶段续编排 | 每阶段 task graph 完成后判断原始需求是否真正交付；前置仅 PRD/方案则继续派发实现/验证，`GROUP_MAX_ORCHESTRATION_STAGES` 默认 4 |
| E-18 | 最终审查 | LLM 最终审查器对照原始需求确认完成/失败/阻塞/等待输入；发现缺口继续派发；失败才退回模板拼接 |
| E-19 | 成员任务挂起/恢复 | 成员 `report.awaiting_user_input` 或普通文本提问 → task 标 `waiting_input`、run 标 `waiting`，下游不启动，群运行静默等待；用户回复后强制情况 A 续跑 |
| E-20 | 隐藏交接审查 | 任务交接下游前用无状态 ChatClient 做隐藏审查闸，不污染 orchestratorSessionId |
| E-21 | 交互式提问卡片 | `agent-question` 卡片镜像 AskUserQuestion（options/multiSelect/allowText）|

#### E.4 黑板与上下文（详见 §9）

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| E-22 | 黑板状态/事件 | `GET blackboard`（state 快照）+ `GET blackboard/events`（审计分页）；只存结构化字段，禁存原始过程 |
| E-23 | ContextAssembler | 每次派发前按检索优先级 + 预算装配上下文（情况 A/B/C）|
| E-24 | agent_memory | 跨任务私有记忆：retrieve(scope) / writeCandidate(去重) / markStale；记忆不对抗黑板 |
| E-25 | 群消息 Pin | 当前群固定上下文，注入 Orchestrator/成员 task/轻量聊天；不跨群共享 |
| E-26 | 群附件 | 上传落入工作区可见目录，`converse.attachmentIds` 消费；图片内联卡片 |

> 协作动作（`dispatch_agent` / `report_completion` / `blackboard_write`）是**服务端内部协议**，不暴露为用户 REST：成员输出结构化 report，服务端基于 git diff 代写黑板。

**已知限制（MVP）**：冲突仅上报无自动仲裁；语义冲突检测推迟 P2；记忆仅轻量去重；黑板暂无 open_issues/risks，artifacts 无 hash/tags/deps；任务面板只读；安全仅最小原则。

### F. 产物预览与编辑（P0）

**目标**：Agent 产出不止文字，内联展示并可预览/编辑/写回。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| F-1 (ART-1) | 黑板产物预览抽屉 | 右侧抽屉读真实工作区文件；previewKind = text/html/pdf/image/audio/video/office/binary/too_large；HTML 经沙箱 `agent-preview://` iframe 内联相对资源 |
| F-2 (ART-2) | 内联产物卡片 | 成员回复气泡内可预览产物占位卡（图标+文件名+类型/版本），点击预览开抽屉、编辑开全屏；live(`blackboard_update`) + 历史(`group_message.payload.artifacts`) |
| F-3 | 产物编辑写回 | text/html 全屏编辑可保存写回工作区文件；`PUT artifacts/content`；运行中拒绝写回；群聊用 `baseVersion` 粗粒度版本校验 |
| F-4 | 路径安全 | 仅黑板派生路径，拒绝穿越/绝对路径/隐藏 agent 目录（.codex/.claude/.agenthub）|

**已知限制**：Office/PPT 仅受限态信息；HTML 动态网络/运行态资源路径可能预览失败；过大文件转受限态；二进制/图片/PDF 只读；内联卡片版本为产出时快照不回填；单聊内联产物卡需后续"按 path 预览"后端支持。

### G. 工作区 Diff 与提交（P0）

**目标**：在聊天输入框上方展示当前会话工作区相对 AgentHub checkpoint 的累计文件变更，支持一键提交推进 checkpoint。覆盖单聊 + 群聊。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| G-1 | 查询累计 diff | `GET workspace-diff`：每文件新增(绿)/修改(蓝 +N -M)/删除(红)，可展开 diff |
| G-2 | 提交变更 | `POST workspace-commit` 提交可见未提交变更并推进 checkpoint；运行中拒绝提交 |
| G-3 | checkpoint ref | `refs/agenthub/workspace-diff/<scope>/<ownerId>`；`git init -b main` 自动引导 |

**已知限制**：累计自 checkpoint（不归因到具体 turn/run）；默认提交信息（无编辑框）；二进制仅摘要；删除/超大(>400 行或 80KB)不可展开；群聊展示共享工作区合并结果，非成员 worktree 中间态。

### H. 部署发布（P2，已落地）

**目标**：Orchestrator 最终汇报后若存在可展示产物，发出**部署卡片**。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| H-1 | 静态部署卡片 | 经产物抽屉预览 |
| H-2 | 服务部署卡片 | 跑本地 dev server，iframe `localhost:<port>` + 流式日志 |
| H-3 | 部署生命周期 | `POST/DELETE deployments` + SSE `logs`；手动确认拉起、自动装缺失依赖、kill 进程树停止 |
| H-4 | Runner 抽象 | `LocalProcessRunner`（当前），`DockerRunner` 预留 |

**已知限制**：端口由 Agent 声明（无自动分配，冲突即失败）；每群仅一个活跃部署；本地子进程隔离弱；部署态内存保存重启丢失；dev server 仅 localhost 无鉴权。

### I. 会话列表治理（P0）

**目标**：统一单聊/群聊列表，提供搜索、置顶、归档（跨端持久）。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| I-1 | 统一列表 | 单聊 `agent:<chatId>` + 群聊 `group:<groupId>` 合并；群聊显示"群聊"标签 |
| I-2 | 群头像 | 成员头像/颜色/首字微信式拼接（前端实时合成不持久化）|
| I-3 | 搜索 | 本地过滤：标题/预览/类型/Agent 名+模型/群成员/projectMeta |
| I-4 | 置顶 | `isPinned` 入库跨端一致，置顶优先 + 更新时间倒序 |
| I-5 | 归档 | `archivedAt` 非空只读，服务端拒绝新 converse/run（不删除、不中止在跑任务）|
| I-6 | 群聊资料页 | 独立群聊页改为资料浏览：左列群列表，右侧成员/目标/工作区/Orchestrator/黑板摘要，无输入区 |

### J. 文件空间与目录浏览（P0）

**目标**：按用户隔离的服务器文件空间，远端部署时桌面端通过受 JWT 保护的 API 浏览/选择服务器目录。

| 需求 ID | 需求 | 说明 |
| ------- | ---- | ---- |
| J-1 | 用户文件空间 | `AGENTHUB_USER_SPACE_ROOT/<userId>/{skills,session,agent_home,agent_workspace}`，所有 Agent/聊天/群聊目录必须落在本人空间内 |
| J-2 | 目录浏览 | `GET workspace-fs/roots` + `directories?path=`，realpath 归属校验防 `..`/软链越界 |
| J-3 | 本地 Skill 上传 | `POST workspace-fs/skills/import-local`：桌面端读本地 skill 文件夹清单上传到用户 `skills` 根，返回路径作 `skillSourceDirectories` |
| J-4 | Vendor 配置同步 | 聊天创建时把 Agent Home 下 .claude/.codex 配置同步到会话 cwd，导入指定 skill 到 vendor skills 目录 |

**已知限制**：目录浏览只读不增删；本地上传不接收绝对路径，拒绝穿越/超限；roots 为进程级配置非多租户 ACL。

### K. 多端（P0 桌面 / Android MVP）

#### K.1 桌面端（Electron + Vue 3，主交付）

三进程：`main`（IPC + api-proxy 转发 REST/SSE/上传绕开 CORS + 本地 runner + preview 协议）、`preload`（contextBridge 暴露 `window.api`）、`renderer`（Vue 3，仅经 `window.api` 访问 Electron）。
核心视图：AuthView / ChatView（单聊）/ GroupChatView（群工作台）/ AgentsView / SettingsView（Provider）。
设计系统：自建 Tailwind token + `components/ui/` Base 组件，复用不手搓。
**本地运行模式**：可选 JWT WebSocket runner 拉起本机 Claude Code/Codex CLI（`local-runner` + 反向通道网关 `RemoteAgentAdapter`）。

#### K.2 Android（Kotlin + Jetpack Compose，MVP）

镜像桌面端鉴权后工作流，**不改后端契约**。底部导航（聊天/群聊/Agent 管理）；统一可搜索列表；侧滑设置（双页 pager）；Agent/单聊/群聊创建；仅服务端目录选择；SSE 回放+实时围观；置顶/归档/删除；重开重连活跃 run；DataStore 存 baseURL/token/缓存用户。
**已知限制**：Provider 管理仅桌面/服务端（Android 只读）；产物预览只读全屏 bottom sheet（运行态 dev server 桌面专属）；内联产物卡+可编辑预览不在本期。

---

## 6. 核心端到端流程

### 6.1 单聊一轮对话

```
用户输入 prompt
  → POST /agent-chats/:id/converse  → { turnId }（已有活跃轮则 busy + activeTurnId）
  → 服务端创建游离 turn：拼 pinned 上下文 + 引用块 + prompt → 调 Agent 适配器
  → 事件经 Redis Stream 广播：thinking / tool / progress / todo / text / done
  → 任意端 GET turns/:turnId/events 回放+追尾渲染运行卡
  → 结束：消息与运行步骤落库；工作区 diff 面板可查看/提交
```

### 6.2 群聊协作一轮运行

```
用户消息 → MessageRouter(解析 @, 原文进 presentation_log)
  → Orchestrator(resume 编排会话, 复杂度判断)
       非任务消息 → 直接回复 / memberTurns 轻量发言
       任务消息   → 拆解写 blackboard.task_graph
  → TaskScheduler 按 DAG 就绪集并行派发（≤GROUP_MAX_PARALLEL_TASKS）
  → 每任务：ContextAssembler 组装上下文 → 建 git worktree → 成员 turn 干活
           → 成员输出结构化 report → 服务端按 git diff 代写黑板 → 合并回共享仓库
  → 失败重试 1 次 / 冲突上报 / 挂起等待用户输入
  → 阶段完成 → 续编排判断（最多 N 阶段）→ 最终 LLM 审查
  → 聚合汇报（成员依次"发言"）+ 可选部署卡片
```

### 6.3 再次修改判定（情况 A/B/C）

```
用户 @Agent 改一下 XXX
  ├─ 命中短期热窗口(<5min + 强指代 + 同产出物) → 情况 A：buffer 解析指代 → 重读产出物 → 改
  ├─ 同产出物/功能、隔了一段时间          → 情况 B：重开干净会话 + 黑板摘要 + 记忆 + 重读代码
  └─ 完全新产出物/新需求                  → 情况 C：完全重开 + 仅注通用信息
  统一收尾：read→plan→patch→test→summarize → 黑板 version+1 → memory_candidate → report
```

---

## 7. 技术架构概览

### 7.1 仓库结构（pnpm workspace monorepo）

```
apps/
  desktop/   Electron + Vue 3 渲染层（主交付）
  server/    NestJS 后端服务
  android/   原生 Kotlin + Jetpack Compose
packages/
  shared/      跨 desktop↔server 的 TypeScript 类型与协议契约（@agenthub/shared）
  agent-core/  框架无关 Agent 引擎（Claude/Codex 适配器 + 工作区 git/产物预览）
```

### 7.2 关键技术决策

| 决策 | 选型 | 理由 |
| ---- | ---- | ---- |
| 后端框架 | NestJS | 模块/DI/装饰器与 Spring 心智一致 |
| ORM | TypeORM + MySQL | `@Entity`/Repository 与 JPA 近一一对应 |
| 缓存/流 | Redis（ioredis）| turn/群运行事件流、活跃指针锁、JWT 黑名单 |
| Agent 引擎 | agent-core | 把 Claude Agent SDK / Codex SDK 归一为统一 `AgentEvent` 流，desktop 与 server 共用 |
| 适配层 | 统一 AgentAdapter + capabilities 单一事实源 | 屏蔽 vendor 差异，新增 vendor 仅加适配器 |
| 事件流 | Redis Stream（turn / group-run）| 后台游离 + 多端围观 + 跨实例 abort |
| 工作区隔离 | 共享 git 仓库 + per-task worktree | 并行任务隔离，完成合并，冲突上报 |
| 桌面通信 | main 进程 api-proxy 转发 | 绕开渲染层 CORS，统一解信封/401 |

### 7.3 统一适配器与事件流

- **AgentAdapter**：`createAgent(vendor)` 工厂，Claude/Codex 各自适配器把原生流归一为 `AgentEvent`。
- **LiveAgent**（内存）：按 `session.id` 持有 adapter + busy 锁 + abort + lastUsedAt。
- **Turn / GroupRun 事件流**：一轮一条 Redis Stream，承载 AgentEvent/GroupRunEvent 广播与回放；活跃指针 `SET NX` 跨实例互斥；abort 走控制频道；boot 回收清理残留活跃指针。
- **统一 LLM 客户端**（chat-client）：无状态轻量客户端，供 Orchestrator 隐藏判断等不复用成员会话的场景，避免污染编排会话。

---

## 8. 数据模型与 API 总览

### 8.1 主要数据表（dev 环境 TypeORM synchronize，真实结构以实体为准）

| 模块 | 表 | 说明 |
| ---- | ---- | ---- |
| 用户 | `user` | 账号/资料/状态（登录态走 JWT/Redis 不入库）|
| Provider | `platform_provider` | `(userId, platformName)` 唯一 + isDefault/defaultModel |
| Agent | `agent` / `agent_session` / `agent_message` / `agent_message_step` | 配置 / 运行会话(scope=user\|group) / UI 消息 / 有序运行步骤 |
| 群聊 | `group_chat` / `group_chat_member` / `group_message` / `group_run` | 群 + 成员 + presentation_log + 运行 |
| 黑板 | `blackboard_artifact` / `_decision` / `_contract` / `_task` / `_event` | 产物/决策/契约/任务图/事件 |
| 记忆 | `agent_memory_item` | Agent 私有跨任务记忆（scope/source/status）|

### 8.2 API 模块总览

| 模块 | 前缀 | 代表性接口 |
| ---- | ---- | ---- |
| 用户 | `/api/user` | register / login / logout / me / update / DELETE me |
| Provider | `/api/platform-providers` | CRUD + `:id/test` + `:id/models/refresh` |
| Agent | `/api/agents` | CRUD |
| 单聊 | `/api/agent-chats` | CRUD + messages + converse + turns/:turnId/events(SSE)/abort + workspace-diff/commit + artifacts preview/content + messages/:id(pin)/regenerate + clear |
| 群聊 | `/api/group-chats` | CRUD + messages + converse + runs/:runId/events(SSE)/abort + blackboard(+events+artifacts preview/content) + attachments + workspace-diff/commit + deployments |
| 目录/文件 | `/api/workspace-fs` | roots + directories + skills/import-local |
| 健康 | `/api/health` | ping MySQL |
| 文档 | `/api/reference`（Scalar UI）/ `/api/openapi.json` | 交互式 API 文档，可 `API_DOCS_ENABLED=false` 关闭 |

> 文档约定：新增路由用 `@ApiTags`/`@ApiOperation` + `@ApiEnvelope(model)` 反映统一信封；响应体需 DTO **class**（interface 运行时被擦除）。

---

## 9. 群聊上下文管理（核心设计摘要）

> 完整方案见 `doc/context/群聊上下文管理设计方案.md`（v2.0）。这是平台多 Agent 协作的架构内核，对应课题"AI 协作能力"维度。

### 9.1 一句话哲学

> 默认隔离、按需共享；用结构化黑板做唯一真相源而非消息流；Agent 在私有上下文干脏活、只交提炼结论；会话每次重开、靠外部记忆不失忆；改东西以"重读当前产出物"为准，强延续才保留短期热上下文；改动触碰共享契约自动升级为协作。

### 9.2 四层上下文模型 + 横切记忆

| 层 | 存什么 | 生命周期 | 可见性 |
| ---- | ---- | ---- | ---- |
| L4 展示层 presentation_log | 群聊气泡原文 | 长期 | 用户；Agent 按需检索（默认不注入）|
| L3 黑板 state/events | 产物/决策/契约/任务图 + 变更事件 | 长期 | 所有 Agent 可读（结构化带版本）|
| L2 任务上下文 TaskContext | 目标/输入/约束/输出规格 | 单次任务，用完即焚 | 仅被派发 Agent |
| L1 私有工作上下文 | 推理/草稿/工具原始返回 | 任务期间，结束即弃 | 仅自己 |
| 横切：agent_memory | 经验/约定/踩过的坑 | 长期跟随 Agent | 仅该 Agent |

### 9.3 检索优先级（固化，冲突时高优先级胜）

```
当前产出物 > 黑板契约/决策 > 本次任务上下文 > Agent 私有记忆 > 历史会话摘要
```

### 9.4 三大组件

- **MessageRouter**：纯机械路由（解析 @、决定去向、原文进 presentation_log），不调 LLM。
- **Orchestrator**：智能决策（复杂度判断/拆解/调度/协调/汇总），调 LLM；拿"项目控制面板"而非全量历史，防上下文黑洞。
- **ContextAssembler**：每次唤起 Agent 前按预算与优先级组装最终上下文，默认注摘要而非全文，预算超限按"历史摘要→低优记忆→非目标产出物摘要"顺序裁剪，保底永远保留 system_prompt + TaskContext + 目标产出物 ref + 相关契约。

### 9.5 冲突与安全（MVP）

- **冲突三件套**：乐观锁(`based_on_version`) + 影响范围声明(`affected`) + 共享工作区 git worktree 隔离合并；合并冲突上报 Orchestrator/用户。语义冲突检测推迟 P2。
- **失败降级**：子 Agent 单轮失败/超时重试 1 次 → 标 `failed` 并汇报请用户决策；依赖失败下游挂 `blocked` 不连锁假成功。
- **安全最小原则**：产出物/文件内容视为不可信数据不得覆盖系统指令；契约 owner 才能改，非 owner 改触发升级；高危动作（删文件/改契约/部署/产生费用）原则上需确认。正式 ACL/审批/注入防护推迟 P2。

---

## 10. 非功能需求

| 维度 | 要求 |
| ---- | ---- |
| 多端实时性 | turn/群运行后台游离，多端订阅同一 Redis Stream 回放+追尾；活跃轮跨端可围观 |
| 并发与互斥 | 同一聊天/群已有活跃轮时新 prompt 返回 busy，引导订阅既存轮；活跃指针 `SET NX` 跨实例 |
| 容错 | turn 超时 abort（默认 30min）；boot 回收残留活跃指针（多实例须关）；失败重试 1 次 + 如实汇报 |
| 数据隔离 | 全部业务数据按 `userId` 隔离；文件落用户专属空间；非本人记录按 NOT_FOUND 处理不泄露存在性 |
| 安全 | JWT 无状态 + Redis 黑名单即时失效；密码 bcrypt；apiKey 明文存储但 select:false + 对外掩码；目录 realpath 归属校验 |
| 错误处理 | 统一信封 + BusinessException + 全局过滤器；禁止裸 500 |
| 可观测性 | GroupDebugLogger 结构化 JSON 全链路日志（脱敏 apiKey/token/secret + 长文截断）；context_trace 列 P1 |
| 可维护性 | DTO 与 Entity 分离；跨端契约集中在 `@agenthub/shared` 改一处两端同步 |
| 文档 | Scalar 交互式 API 文档；各模块 README/spec 与实现保持一致 |

---

## 11. 优先级路线图

### P0 — 课题 MVP（必须跑通）

1. 用户认证 + Provider 管理 + Agent 管理（含默认 Provider/模型预填）。
2. 单聊：多会话并行 + 后台游离 turn + 多端围观 + 运行步骤 + 再生成 + 消息 pin。
3. 群聊最小闭环：建群 + 黑板 + MessageRouter + Orchestrator 拆解/派发 + 聚合汇报 + ContextAssembler + agent_memory + 再次修改 A/B/C + 成员 worktree 执行。
4. 群聊编排硬化：Orchestrator 工具隔离 + DAG 并行 + 失败降级 + 冲突上报。
5. 产物预览 ART-1（黑板产物抽屉）+ ART-2（内联产物卡片）+ text/html 写回。
6. 工作区 Diff/提交（单聊 + 群聊）。
7. 统一会话列表 + 搜索/置顶/归档 + 用户文件空间隔离 + 服务端目录浏览 + 本地 Skill 上传。
8. 桌面端全功能 + Android MVP。

### P1 — 强烈建议补

- Orchestrator 连续性 / contextUpdates 回写 / 多阶段续编排 / 最终 LLM 审查 / 成员任务挂起恢复 + 交互式提问卡片。
- MemoryManager（失效/confidence/对齐黑板）；Contract Watcher + Preflight 主动预检。
- 黑板 open_issues / risks 对象；artifacts 的 hash/tags/dependencies。
- context_trace 可观测性（调试收益高，建议尽早）。

### P2 — 后续演进

- 部署发布（已落地，定位增强）：静态/服务部署卡片 + Docker Runner。
- 语义冲突检测；正式 ACL + 审批流 + 审计；Prompt Injection 系统化防护。
- Web 端主力端。

---

## 12. 已知限制与风险

| 类别 | 限制/风险 | 影响 | 缓解 |
| ---- | ---- | ---- | ---- |
| 群聊编排 | MVP 冲突仅上报无自动仲裁；语义冲突未检测 | 复杂并行可能需人工裁决 | git worktree 隔离 + 乐观锁 + 上报用户 |
| 上下文 | 记忆仅轻量去重；无 context_trace | 调试与记忆质量受限 | schema 预留字段，P1 补 |
| 消息 | 历史不分页；无消息体全文搜索；tool input/output 无展开 UI | 长会话/检索体验受限 | 后续迭代 |
| 产物 | Office/PPT 不渲染；HTML 动态资源可能预览失败 | 部分产物受限态 | 仅 text/html 可写回 |
| 部署 | 本地子进程隔离弱、端口 Agent 声明、状态内存保存 | 重启丢失/冲突失败 | Docker Runner 预留 |
| 多实例 | boot 回收默认开（清残留活跃指针）| 多实例误清 | 多实例部署须 `*_RECLAIM_ON_BOOT=false` |
| 安全 | apiKey 明文存储；无正式 ACL/审批/注入防护 | 赛题环境可控，生产需加固 | select:false + 掩码 + 最小原则，P2 补 |
| 依赖 | 用户认证/事件流强依赖 Redis 在线；上游 SDK 真实调用 | 离线不可用 | 健康检查 + 超时兜底 |

---

## 13. 交付物与验收标准

### 13.1 课题交付物

产品设计文档（本 PRD）+ 技术文档（各 README/spec）+ 可运行 Demo + AI 协作开发记录（doc/spec、doc/plan、doc/debug、CLAUDE.md/rules）+ 3 分钟 Demo 视频。

### 13.2 考察维度对齐

| 维度 | 权重 | 本系统对应 |
| ---- | ---- | ---- |
| AI 协作能力 | 30% | 完整 Spec/Plan/Debug 文档体系 + CLAUDE.md/coding_rules + 群聊上下文设计方案；spec-kit 流程 |
| 功能完整度 | 25% | 单聊多会话 + 群聊 Orchestrator DAG 调度跑通 + 后台游离/多端围观 |
| 生成效果质量 | 20% | IM 聊天 UI（设计系统 + 消息卡片）+ 产物内联预览/编辑 |
| 代码理解度 | 15% | 统一适配层 + 事件流 + 黑板/上下文架构可解释 |
| 创新与产品感 | 10% | 四层上下文模型、再次修改 A/B/C、成员挂起恢复、跨端围观、部署卡片 |

### 13.3 关键验收清单（P0 happy path）

- [x] 注册→登录→创建 Provider→设默认→创建 Agent→开单聊→发消息→看到流式运行步骤→预览/编辑产物→提交工作区变更。
- [x] 建群（多成员）→发复杂需求→Orchestrator 拆解→DAG 并行派发成员→黑板沉淀产物/决策→聚合汇报。
- [x] 群聊成员反问→任务挂起→用户回答→续跑。
- [x] 单聊发起长任务→关窗→另一端（或 Android）围观同一轮。
- [x] 会话列表统一显示单/群、搜索、置顶、归档生效。

---

> 维护约定：本 PRD 为需求事实源。功能形态变化时，先更新对应 `doc/spec/`，再回写本文相关条目与 §11 优先级；跨端契约变化须同步 `@agenthub/shared` 与两端。
