# AgentHub 交付文档

> 版本：v1.0 ·  日期：2026-06-10
> 配套文档：产品需求文档见 [`doc/prd/AgentHub-PRD.md`](./AgentHub-PRD.md)

---

## 1. 交付概览

| 项 | 内容 |
| ---- | ---- |
| 产品 | AgentHub —— 多 Agent 协作平台 |
| 版本 | v1.0 |
| 日期 | 2026-06-10 |
| 仓库 | pnpm workspace monorepo（`apps/desktop`、`apps/server`、`apps/android`、`packages/shared`、`packages/agent-core`）|
| 交付范围 | 桌面端（主交付）+ 服务端 + Android（MVP）+ 共享契约 + Agent 引擎 + 完整 Spec/Plan/Debug 文档体系 |
| 一句话能力 | 以 IM 聊天为核心交互范式，统一接入 Claude Code / Codex，支持单聊多会话并行与群聊多 Agent（Orchestrator + 黑板 + 共享 git 工作区）自动协作，产物可内联预览、二次编辑写回、工作区 Diff 提交，后端 turn 游离运行支持多端实时围观。 |

> 【图 1：AgentHub 总体架构图（桌面/Android/服务端/Agent 引擎/共享契约分层）】

> 【图 2：桌面端主界面截图（统一会话列表 + 单聊运行流 + 右侧检查器）】

---

## 2. 交付内容清单

### 2.1 桌面端 `apps/desktop`（Electron + Vue 3，主交付端）

- **三进程架构**：`main`（IPC + `api-proxy` 转发 REST/SSE/上传绕开 CORS + 本地 runner + `agent-preview://` 协议）、`preload`（contextBridge 暴露 `window.api`）、`renderer`（Vue 3，仅经 `window.api` 访问 Electron）。
- **核心视图**：AuthView（登录/注册）、ChatView（单聊）、GroupChatView（群聊工作台/资料页）、AgentsView（Agent 管理）、SettingsView（Provider 管理）。
- **业务组件**：统一会话列表（置顶/归档/群头像/右键菜单）、消息流（text/agent-run/agent-question/options/task-list/deploy/附件/系统卡片）、输入框（@-mention/文件图片附件/引用）、置顶条、右侧检查器、黑板侧栏、群详情面板、工作区 Diff 面板、产物预览抽屉/全屏编辑层、服务端目录选择器、各创建弹窗。
- **设计系统**：自建 Tailwind token + `components/ui/` Base 组件（BaseButton/Input/Select/Textarea/Skeleton）。
- **本地运行模式**：可选 JWT WebSocket runner 拉起本机 Claude Code/Codex CLI。
- **API 客户端**：auth / agents / group-chats / providers / workspace-fs，含 SSE 流处理与统一信封解包。

> 【图 3：群聊工作台截图（多成员气泡 + 黑板任务/产物面板）】

### 2.2 服务端 `apps/server`（NestJS）

| 模块 | 交付内容 |
| ---- | ---- |
| `common/` | 统一响应信封、BusinessException、全局过滤器/拦截器、Swagger 装饰器 |
| `redis/` | 全局 Redis 模块（事件流/活跃指针锁/JWT 黑名单）|
| `chat-client/` | 无状态统一 LLM 客户端（OpenAI Responses/Completions + Anthropic）|
| `user/` | 注册/登录/登出/注销/资料 + JWT 认证基座（Guard/TokenService/黑名单）|
| `platform-provider/` | Provider CRUD + 测连接 + 拉模型 + 默认 Provider/模型 |
| `user-workspace/` | 用户隔离文件空间（skills/session/agent_home/agent_workspace）|
| `workspace-fs/` | 服务端目录浏览 + 本地 Skill 上传（受 JWT 保护 + realpath 归属校验）|
| `multiagents/` | Agent 配置 CRUD + 单聊 turn runtime（游离后台 + Redis Stream + abort + 工作区 diff + 产物预览/写回 + 再生成 + pin）|
| `multiagents/group/` | 群聊协作：Orchestrator（拆解/DAG 调度/聚合汇报/续编排/最终审查/连续性）、Blackboard（产物/决策/契约/任务图/事件）、ContextAssembler、agent_memory、MessageRouter、continuity-resolver、成员挂起恢复、部署 runner、debug 日志 |

- **API 文档**：Scalar 交互式文档 `/api/reference` + OpenAPI JSON `/api/openapi.json`。
- **数据表**：用户/Provider/Agent（4 表）/群聊（4 表）/黑板（5 表）/记忆（1 表），dev 环境 TypeORM `synchronize` 自动建表，SQL 存档见 `sql/`。

### 2.3 Android `apps/android`（Kotlin + Jetpack Compose，MVP）

- 单 Activity + Compose UI（Material 3），状态集中于 `AppViewModel`；`data/` 层 OkHttp 直连 REST/SSE，`Models.kt` 以 `@Serializable` 镜像 `packages/shared` TS 契约。
- 底部导航（聊天/群聊/Agent 管理）、统一可搜索列表、侧滑设置、Agent/单聊/群聊创建、服务端目录选择、SSE 回放+实时围观、置顶/归档/删除、重开重连活跃 run、DataStore 持久化 baseURL/token/用户。
- 单测 `ReducersTest`（会话排序/运行归约/表单校验）。

> 【图 4：Android 端截图（会话列表 + 运行围观）】

### 2.4 共享契约 `packages/shared`

跨 desktop↔server 的 TypeScript 类型与协议契约：envelope / user / provider / agent / chat / group-chat / blackboard / deployment / workspace-diff / workspace-fs / local-runner。改一处两端同步，运行期消费 `dist/`。

### 2.5 Agent 引擎 `packages/agent-core`

框架无关引擎：统一 `AgentEvent` 流 + `createAgent(vendor)` 工厂（Claude/Codex 适配器）+ capabilities 单一事实源 + WorkspaceGit（工作区 diff/commit）+ artifact-preview（产物预览与 text/html 写回）。被桌面主进程与服务端共同复用。

### 2.6 协作开发记录（课题 AI 协作维度）

- `doc/spec/`：27 份功能设计 spec。
- `doc/plan/`：26 份实现 plan。
- `doc/debug/`：2 份排障记录。
- `doc/context/群聊上下文管理设计方案.md`：多 Agent 上下文工程架构方案（v2.0）。
- `CLAUDE.md` / `.claude/rules/coding_rules.md` / 各模块 README + 后端 `CLAUDE.md`（开发规则）。

---

## 3. 功能完成情况

> 状态图例：✅ 已完成　🟡 部分实现/有已知限制　🔧 已落地但定位为增强　⛔ 未实现（明确推迟）
> PRD ID 对应 [`AgentHub-PRD.md`](./AgentHub-PRD.md) §5。

| 需求域 | PRD ID | 状态 | 说明 | 验收方式 |
| ---- | ---- | ---- | ---- | ---- |
| A 用户与认证 | A-1~A-6 | ✅ | 注册/登录/登出/me/更新资料/注销 + JWT + Redis 黑名单 | 单测 `UserWorkspaceService`/手动登录流 |
| B Provider 管理 | B-1~B-5 | ✅ | CRUD + 测连接 + 拉模型 + 默认 Provider/模型 | 单测 `PlatformProviderService`(5)/手动测连接 |
| C Agent 管理 | C-1~C-6 | ✅ | 配置 CRUD + 能力摘要 + 头像 + 多 vendor + 删除级联 | 单测 `AgentConfigService`/手动创建 |
| C Agent 管理 | C-4(Codex MCP) | 🟡 | Codex system prompt/skills 支持，MCP 暂不支持 | 手动验证 |
| D 单聊 | D-1~D-9 | ✅ | 多会话并行 + 游离 turn + 多端围观 + 步骤 + 再生成 + pin + 清空 | 单测 `AgentChatService`/`AgentMessageHistoryService`/手动单聊 |
| E 群聊·群组管理 | E-1~E-4 | ✅ | 建群/详情/改群/删群 + 共享工作区 git init | 单测 `GroupChatService`/手动建群 |
| E 群聊·协作运行 | E-5~E-14 | ✅ | converse/SSE/abort + Router + Orchestrator + DAG 并行 + 失败降级 + 冲突上报 + worktree 执行 + memberTurns | 单测 task-scheduler/手动群聊 |
| E 群聊·编排智能 | E-15~E-21 | ✅ | 连续性 + contextUpdates + 多阶段续编排 + 最终审查 + 挂起恢复 + 隐藏交接审查 + 提问卡片 | 单测 `LlmOrchestratorPlanner`/`HandoffReviewer`/手动 |
| E 群聊·黑板上下文 | E-22~E-26 | 🟡 | 黑板/ContextAssembler/记忆/群 pin/附件已落地；记忆仅轻量去重，无 open_issues/risks/context_trace | 单测 `GroupMessageService`/`GroupAttachmentService`/手动 |
| F 产物预览与编辑 | F-1~F-4 | 🟡 | ART-1 抽屉 + ART-2 内联卡片 + text/html 写回 + 路径安全；Office/PPT 受限态，单聊内联卡待后端 | 手动预览/编辑 |
| G 工作区 Diff/提交 | G-1~G-3 | ✅ | 累计 diff + 提交推进 checkpoint（单聊+群聊）；运行中拒绝提交 | 单测 `WorkspaceDiffService`(2)/手动 |
| H 部署发布 | H-1~H-4 | 🔧 | 静态/服务部署卡片 + 日志流 + LocalProcessRunner；课题定位 P2 增强，Docker Runner 预留 | 手动部署 |
| I 会话列表治理 | I-1~I-6 | ✅ | 统一列表 + 群头像 + 搜索 + 置顶 + 归档 + 群资料页 | 手动验证 |
| J 文件空间与目录 | J-1~J-4 | ✅ | 用户隔离空间 + 目录浏览 + 本地 Skill 上传 + vendor 配置同步 | 单测 `WorkspaceFsService`(5)/`UserWorkspaceService`(6) |
| K 多端·桌面 | K.1 | ✅ | Electron 三进程全功能 | typecheck/手动 |
| K 多端·Android | K.2 | 🟡 | IM MVP；Provider 只读，内联产物卡/可编辑预览不在本期 | `./gradlew test`/手动 |
| 安全·正式 ACL/审批/注入防护 | §9.5 | ⛔ | 仅最小原则，正式机制推迟 P2 | —— |
| 群聊·语义冲突检测 | §9.5 | ⛔ | 推迟 P2（MVP 用乐观锁 + worktree 隔离 + 上报）| —— |

> 【图 5：功能完成度概览图（按 P0/P1/P2 分色）】

---

## 4. 运行环境与启动方式

### 4.1 依赖版本

| 依赖 | 版本 | 说明 |
| ---- | ---- | ---- |
| Node.js | ≥ 20（开发实测 v25.9）| 服务端/桌面端运行时 |
| pnpm | ≥ 9（开发实测 11.1）| workspace 包管理 |
| MySQL | 8.x | 业务数据持久化 |
| Redis | ≥ 6 | turn/群运行事件流、活跃指针锁、JWT 黑名单（**用户认证强依赖**）|
| TypeScript | 5.9 | 全仓 |
| NestJS | 11 | 后端框架 |
| Vue | 3.5 / Electron 39 / electron-vite 5 | 桌面端 |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` ^0.3.150 | Claude vendor |
| Codex SDK | `@openai/codex-sdk` ^0.133.0 | Codex vendor |
| Android | AGP 9.2.1 / Kotlin 2.4.0 / Compose BOM 2026.05 / SDK 35–36 | 移动端 |

### 4.2 环境变量（`apps/server/.env`，复制 `.env.example` 后填写）

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `SERVER_PORT` | 3000 | 服务端口 |
| `NODE_ENV` | development | dev 环境 TypeORM `synchronize` 自动建表 |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | 127.0.0.1:3306 / agenthub | 数据库连接 |
| `MYSQL_TIMEZONE` | +08:00 | MySQL 会话时区（UTC 可设 `Z`）|
| `REDIS_HOST/PORT/PASSWORD/DB` | 127.0.0.1:6379 / 0 | Redis 连接 |
| `JWT_SECRET` | agent_hub_app | **生产务必改强随机值** |
| `JWT_EXPIRES_IN` | 7d | token 有效期 |
| `AGENTHUB_USER_SPACE_ROOT` | `~/.agenthub/users` | 用户文件空间总根（派生 skills/session/agent_home/agent_workspace）|
| `AGENT_RECLAIM_ON_BOOT` | true | 重启清理残留活跃 turn；**多实例须设 false** |
| `AGENT_TURN_TIMEOUT_MS` | 1800000 | 单轮超时 abort（30 分钟）|
| `GROUP_RECLAIM_ON_BOOT` | true | 重启清理残留群活跃轮；**多实例须设 false** |
| `GROUP_MAX_ORCHESTRATION_STAGES` | 4 | 同一群运行续编排阶段上限 |
| `GROUP_MAX_PARALLEL_TASKS` | 3 | DAG 并行任务上限 |
| `GROUP_DEBUG_LOGS` | true | 群聊运行时 debug 日志（生产可设 false）|
| `GROUP_DEBUG_LOG_MAX_CHARS` | 4000 | 长文本字段截断长度 |
| `API_DOCS_ENABLED` | true | 关闭 Scalar 文档设 false |

> Provider 的上游 baseUrl/apiKey 不在 `.env`，由用户在 Provider 管理界面"自带钥匙"填写。

### 4.3 启动方式

```bash
# 0. 安装依赖（仓库根目录）
pnpm install

# 1. 准备 MySQL & Redis（本机或容器），并配置 apps/server/.env
cp apps/server/.env.example apps/server/.env   # 按需修改

# 2. 启动服务端（会先 build shared + agent-core，再 nest start --watch）
pnpm -F @agenthub/server dev
#   健康检查： http://localhost:3000/api/health
#   API 文档： http://localhost:3000/api/reference

# 3. 启动桌面端（另开终端；会先 build shared + agent-core，再 electron-vite dev）
pnpm dev            # 等价 pnpm -F @agenthub/desktop dev

# 4. 生产打包（按需）
pnpm -F @agenthub/server build && pnpm -F @agenthub/server start:prod
pnpm -F @agenthub/desktop build:mac      # 或 :win / :linux
```

```bash
# Android（独立 Gradle 构建，未纳入 pnpm workspace）
cd apps/android
./gradlew assembleDebug      # 构建 debug APK
./gradlew test               # 单元测试
./gradlew installDebug       # 安装到设备/模拟器
# 模拟器默认连本机后端 http://10.0.2.2:3000/api（Manifest 已开 cleartext）
```

---

## 5. Demo 验收流程

> 前置：MySQL + Redis 在线，服务端 + 桌面端已启动，已准备至少一个可用上游 Provider 的 baseUrl + apiKey。

1. **注册登录**：AuthView 注册账号 → 登录，进入主界面。
   > 【图 6：登录/注册界面】
2. **配置 Provider**：SettingsView → 新增 Provider（选协议类型 / 填 baseUrl + apiKey）→ "测试连接"返回 `ok` → "刷新模型"拉取 modelList → 勾选"设为默认"并选默认模型。
   > 【图 7：Provider 详情 + 测连接成功】
3. **创建 Agent**：AgentsView → 创建 Agent（展示名/头像色/vendor/Provider/model/能力摘要/system prompt，默认 Provider 自动预填）。
4. **单聊验收**：会话列表 `+` → 选该 Agent 开单聊 → 发"用 Claude Code 写一个 React 时区计算器组件" → 观察流式运行步骤（thinking/tool/todo 折叠为"运行过程·n 步"）→ 完成后多轮迭代修改。
   - 可右键消息"再生成"；可 Pin 关键消息作为后续上下文。
   - 关窗再开（或 Android 端打开同一会话）验证**多端围观活跃轮**。
   > 【图 8：单聊运行步骤流 + 产物卡片】
5. **群聊验收**：会话列表新建群 → 拉入多成员 Agent + 配置 Orchestrator → 发"做一个时区计算器" → 观察 Orchestrator 拆解 task_graph、DAG 并行派发、成员依次"发言"、黑板沉淀决策/产物、最终聚合汇报。
   - 验证成员反问挂起 → 用户回答 → 续跑。
   > 【图 9：群聊 Orchestrator 拆解 + 黑板任务图】
6. **产物预览**：成员/单聊回复内联产物卡 → 点击"预览"开右侧抽屉（HTML 沙箱 iframe / 图片 / 文本）→ 点击"编辑"开全屏 → 修改 text/html → 保存写回工作区。
   > 【图 10：产物预览抽屉 + 全屏编辑】
7. **Diff 提交**：输入框上方"工作区变更"面板 → 查看每文件新增/修改/删除与可展开 diff → 点击"提交"推进 checkpoint。
   > 【图 11：工作区 Diff 面板与提交】

---

## 6. 测试与验证结果

> 执行环境：本机 Node v25.9 / pnpm 11.1，仓库根目录，2026-06-10。

| 命令 | 范围 | 结果 |
| ---- | ---- | ---- |
| `pnpm -r typecheck` | shared / agent-core / server / desktop（4 包）| ✅ 全部 **Done，0 类型错误** |
| `pnpm -F @agenthub/server test` | 服务端单元测试（tsx + node:test）| ✅ **tests 50 / pass 50 / fail 0**，duration ≈ 4.1s |

**服务端单测覆盖要点**：

- 用户文件空间隔离与越界防护（`UserWorkspaceService` 6 项：目录派生、运行时路径、跨用户/软链逃逸拒绝）。
- 服务端目录浏览与本地 Skill 上传（`WorkspaceFsService` 5 项：仅列本人 root、路径穿越拒绝）。
- Provider 默认项事务一致性与模型校验（`PlatformProviderService` 5 项）。
- Agent/单聊/群聊工作区分配在用户空间内、checkpoint RPC（`AgentConfigService`/`AgentChatService`/`GroupChatService`）。
- 工作区 diff 汇总与提交推进 checkpoint（`WorkspaceDiffService` 2 项）。
- 消息 Pin 渲染与单/群上下文注入、再生成 prompt 解析（`AgentMessageHistoryService`/`GroupMessageService`）。
- 群附件落工作区/清理/预览鉴权（`GroupAttachmentService` 5 项）。
- Orchestrator 结构化输出优先、隐藏交接审查无状态 ChatClient（`LlmOrchestratorPlanner`/`HandoffReviewer`）。
- 远端 runner 适配与异步队列、非 ASCII 产物路径保留。

**Android**：`./gradlew test`（含 `ReducersTest`：会话排序/运行归约/表单校验）由验收方在本地 Gradle 环境执行（未纳入 pnpm workspace 脚本）。

> 【图 12：typecheck 与单测通过的终端截图】

---

## 7. 已知限制

### 7.1 未实现（明确推迟）

- 群聊**语义冲突检测**与自动仲裁（MVP 用乐观锁 + affected 声明 + git worktree 隔离 + 冲突上报用户）。
- 正式 **ACL / 审批流 / 审计**、**Prompt Injection 系统化防护**（仅落地最小安全原则）。
- **Web 端**（架构为复用预留，当前主交付为桌面端）。
- 消息历史**分页**、消息体**全文搜索**（当前为本地过滤）。
- 黑板 `open_issues` / `risks` 对象、artifacts 的 `hash/tags/dependencies`、`context_trace` 可观测性（P1）。

### 7.2 部分实现

- **Codex MCP** 暂不支持（Claude 全支持；Codex 仅 system prompt + skills）。
- **产物预览**：Office/PPT/PPTX 仅返回受限态信息，不在线渲染；HTML 动态网络/运行态资源路径可能预览失败；二进制/图片/PDF 只读，仅 text/html 可写回。单聊内联产物卡待后端"按 path 预览"支持。
- **工作区 Diff**：累计自 checkpoint，不归因到具体 turn/run；默认提交信息无编辑框；删除/超大文件（>400 行或 80KB）不可展开。
- **群聊记忆**：仅轻量去重写入，无失效/confidence 排序（MemoryManager 列 P1）；Contract 仅被动检测上报（Preflight/Watcher 列 P1）。
- **Android**：Provider 管理只读（创建/编辑桌面/服务端专属）；内联产物卡 + 可编辑预览不在本期；运行态 dev server 桌面专属；消息卡片移动端适配非像素一致。
- **部署发布（H）**：端口由 Agent 声明（无自动分配，冲突即失败）；每群仅一个活跃部署；部署态内存保存，重启丢失；本地子进程隔离弱；dev server 仅 localhost 无鉴权（Docker Runner 预留）。

### 7.3 环境依赖

- **用户认证与事件流强依赖 Redis 在线**（JWT 黑名单 + 活跃指针锁 + turn/群运行 Stream）。
- 业务运行需 **MySQL 在线**；dev 环境靠 TypeORM `synchronize` 自动建表，**无生产迁移脚本**。
- Agent 真实运行需**有效上游 Provider（baseUrl + apiKey）**并产生上游 token 费用。
- **多实例部署**须将 `AGENT_RECLAIM_ON_BOOT` / `GROUP_RECLAIM_ON_BOOT` 设为 `false`，否则重启会误清其它实例活跃轮。
- 远端部署时 Agent Home / 工作目录 / 共享工作区 / skill 来源均为**后端服务器路径**，桌面端经 `/api/workspace-fs/*` 仅能浏览本人空间。

### 7.4 演示限制

- 建群 + 单 @ 直派的端到端 happy path 依赖在线 MySQL/Redis/真实 SDK，**未纳入自动化 e2e**。
- `apiKey` 明文存储（实体 `select:false` + 对外掩码），赛题环境可控，生产需加固静态加密。
- 注销为逻辑删除，account/email 仍占唯一索引，不可同名重注册；无登录失败限制/验证码/密码找回。

---

## 8. 相关文档索引

| 类别 | 路径 | 说明 |
| ---- | ---- | ---- |
| 产品需求 | `doc/prd/AgentHub-PRD.md` | 完整 PRD（功能/优先级/数据模型/API 总览）|
| 课题原始描述 | `README.md` | 课题背景、核心功能、考察要点、交付物 |
| 上下文架构 | `doc/context/群聊上下文管理设计方案.md` | 多 Agent 四层上下文 + 黑板 + 检索优先级（v2.0）|
| 功能 Spec | `doc/spec/`（27 份）| 各功能设计：单聊、群聊编排/硬化/连续性/审查/挂起、产物预览(ART-1/2)、Diff、用户/Provider/Agent、Android MVP 等 |
| 实现 Plan | `doc/plan/`（26 份）| 各功能落地计划 |
| 排障记录 | `doc/debug/`（2 份）| Redis 活跃锁卡死、JWT 跨模块 DI |
| 模块 README | `apps/desktop/README.md` · `apps/server/SERVER_README.md` · `apps/android/README.md` · `packages/shared/README.md` · `packages/agent-core/README.md` | 各端目录结构与模块/接口文档 |
| 后端开发规则 | `apps/server/CLAUDE.md` | API 设计优先级、DTO/Entity 分离、统一异常 |
| 协作规则 | `CLAUDE.md` · `.claude/rules/coding_rules.md` | 仓库总览与人机协作编码规则 |
| API 文档（运行时）| `http://localhost:3000/api/reference`（Scalar UI）· `/api/openapi.json` | 交互式 API 文档 + OpenAPI JSON |
| 适配层文档 | `apps/server/src/multiagents/adapter/README.md` | 统一 Claude/Codex 适配器 + 事件契约 |
| Demo 视频 | `doc/delivery/AgentHub-Demo.mp4`（待补充）| 3 分钟 Demo 视频路径（请放置后更新此处）|

---

> 维护约定：交付内容变化时同步更新本文 §3 功能完成情况与 §6 验证结果；功能形态变化先改 `doc/spec/`，再回写 PRD 与本交付文档；跨端契约变化须同步 `@agenthub/shared` 与两端。
