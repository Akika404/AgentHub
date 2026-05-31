AgentManager 后端实现方案

> 本文描述 `mutiagents` 模块（`apps/server/src/mutiagents/`）的设计意图与契约；实现细节随代码演进，字段以实体定义为准。

## Context（为什么做这件事）

AgentHub 是一个“飞书式”的多 Agent 协作平台：用户创建多个虚拟员工（底层是 Claude / Codex 实例），配置好模型与能力后，把它们拉进群聊协作。底层已有统一适配层 `apps/server/src/mutiagents/adapter/`（AgentAdapter 接口 + AgentEvent 流 + createAgent 工厂），它解决了“单个会话的事件归一”；AgentManager 在其上补齐生命周期管理：档案/会话概念、可配置的 Agent、持久化、进程重启恢复、并发保护。

本模块最初在**用户管理模块之前**编写，设计上没有“用户”概念（Agent 全局共享、凭证从环境变量取、创建 Agent 顺手开会话）。本轮重构对齐到完整业务模型，新增四项：

- **用户隔离**：每个用户拥有自己的 AgentList，所有读写按 JWT 用户隔离。
- **凭证来自 Provider**：Agent 不存 `apiKey` / `baseUrl`，改为引用一个 `platformProviderId` + 选定 `model`，运行时从 `platform-provider` 模块取出凭证。
- **Agent 与会话解耦**：创建 Agent 只落配置（进 AgentList），不开会话；本期单聊按 `agentId` 懒加载/复用一条会话。把多个 Agent 拉进同一会话的**群聊**是后续独立模块。
- **接口鉴权**：整模块走无状态 JWT（复用 `user` 模块的 `JwtAuthGuard`）。

对外暴露能力：创建 Agent（可配 workdir / systemPrompt / skills / mcp / tools，引用 Provider 取凭证）、与 Agent 单聊（SSE 流）、暂存/恢复并续聊、清空聊天历史、删除。

已锁定的决策：
- 权限审批：本期 auto-approve（沿用 bypass/never），但留好 seam（可配 permissionMode + 未来 canUseTool 钩子），phase-2 再做交互审批。
- 持久化级别：必须扛进程重启 —— 依赖两个 SDK 自身的磁盘会话，只持久化“句柄”（userId + agentId + vendor + sdkSessionId），恢复 = 用 Agent 配置重建 adapter 并按 id resume。
- 存储：Agent 模块自身全部走 MySQL（TypeORM）；鉴权复用 `user` 模块（其 JWT 黑名单走 Redis）。
- 传输：对话事件流走 SSE（@Sse()）。

SDK 能力已核实（node_modules .d.ts）：Claude 的 query Options 支持 resume / systemPrompt / appendSystemPrompt / mcpServers / allowedTools / skills / canUseTool / permissionMode；Codex 有 resumeThread(id, opts) 但 ThreadOptions 无 systemPrompt/skills（厂商能力不对称），且 Thread/Codex 无 dispose/close API。

---

## 三层模型（核心设计）

| 概念                 | 含义                                                                                          | 存储       |
|--------------------|---------------------------------------------------------------------------------------------|----------|
| Agent（配置）          | 用户拥有的不变配置：userId、name、vendor、platformProviderId、model、workdir、systemPrompt、skills、mcp、tools | MySQL 实体 |
| AgentSession（会话句柄） | userId + agentId + vendor + sdkSessionId（Claude session UUID / Codex thread id）+ status     | MySQL 实体 |
| LiveAgent（活实例）     | 内存中的 AgentAdapter + busy + AbortController + lastUsedAt                                     | 进程内存 Map |

动作在此模型下落地（**Agent 与会话解耦**）：
- 创建 = 只存 Agent（进该用户的 AgentList，**不开会话**）；
- 对话 = 按 agentId 懒加载/复用该用户的单聊 Session → 取/重建 LiveAgent → send()；
- 暂存 = 置 status 并从内存驱逐（磁盘会话仍在）；
- 恢复 = 用 Agent 配置重建并 resumeWith(sdkSessionId)；
- 清空 = 把 sdkSessionId 置空、下次 send() 自动开新会话；
- 删除 = 删 Agent 连同其会话，并驱逐活实例。

---

## 文件布局 apps/server/src/mutiagents/

NestJS 层文件遵循 common/、health/ 的风格（2 空格缩进 + 无分号，注意与 adapter 目录的 4 空格+分号不同）。

```
mutiagents/
  adapter/                      # 既有统一适配层（Claude / Codex → 同一套 AgentEvent）
  agents.module.ts             # forFeature([Agent, AgentSession]) + import UserModule(复用 JwtAuthGuard) + PlatformProviderModule(取凭证)
  agents.controller.ts         # @Controller('agents')，整体 @UseGuards(JwtAuthGuard)；REST + @Sse()
  agent-manager.service.ts     # LiveAgent 注册表 + get-or-rehydrate + 驱逐 + 持久化编排；按 userId 隔离
  live-agent.ts                # 内存 LiveAgent 类型（不持久化）
  entities/
    agent.entity.ts            # @Entity('agent')：用户拥有的 Agent 配置
    agent-session.entity.ts    # @Entity('agent_session')：会话句柄
  dto/
    create-agent.dto.ts        # class-validator
    converse.dto.ts
    agent-view.dto.ts          # 响应形状（不复用实体）
    agent-response.dto.ts      # Swagger 文档类（implements AgentView，与契约同形）
  mappers/
    agent.mapper.ts            # agentToConfig(注入 apiKey+baseUrl)；toAgentView(agent, session?)
```

AgentsModule 加入 app.module.ts 的 imports。autoLoadEntities: true 已开，forFeature 即自动建表（非 prod synchronize:true）。建表 SQL 存档见 `apps/server/sql/agent_manager.sql`，**真实结构以实体定义为准**。

实体字段

- Agent: id(uuid PK) userId(indexed) name vendor platformProviderId(indexed) model workingDirectory systemPrompt(text,null) skills(json,null) mcpServers(json,null) allowedTools(json,null) permissionMode(varchar,null) reasoningEffort(varchar,null) createdAt/updatedAt。**不存 apiKey / baseUrl**（运行时按 platformProviderId 从 platform_provider 取）。
- AgentSession: id(uuid PK) userId(indexed) agentId(indexed，逻辑外键到 agent.id) vendor(冗余，免 join) sdkSessionId(varchar,null) status(active|suspended|cleared) lastTurnAt(null) createdAt/updatedAt。本期单聊：一个 Agent 至多一条会话（不加唯一约束，为群聊阶段一个 Agent 多会话保留前向兼容）。
- JSON 列用 `@Column('json', { nullable: true })`（MySQL JSON 列不能带 default）。

---

## 凭证解析（来自 Provider）

AgentManager 注入 `PlatformProviderService`，运行时调用其内部方法：

```
resolveRuntimeConfig(userId, platformProviderId): { type, baseUrl, apiKey, modelList }
```

该方法复用 `findOwned`（`addSelect('apiKey')` + userId 隔离），返回**含明文 apiKey** 的运行时配置，**仅供后端内部**重建 adapter，绝不经控制器对外暴露（对外仍只回掩码）。`PlatformProviderModule` 为此 `exports: [PlatformProviderService]`。

创建 Agent 时的校验（按顺序）：
1. vendor 能力支持配置（Codex + systemPrompt/skills/mcp 显式报错）；
2. 所引用 Provider 存在且归属本人（否则 NOT_FOUND）；
3. **vendor 与 Provider type 兼容**：`claude`↔`anthropic`，`codex`↔`openai-responses`/`openai-chat-completions`（否则 BAD_REQUEST）；
4. **model 属于该 Provider 的 modelList**（modelList 为空——尚未 refresh——时跳过校验，否则 BAD_REQUEST）。

---

## adapter 层（统一适配层，已实现）

adapter 对上提供与厂商无关的统一接口，AgentManager 仅依赖它：

1. AgentAdapterConfig（全 optional 的能力字段）：systemPrompt? skills?: 'all'|string[] mcpServers?: Record<string, unknown> allowedTools? permissionMode? reasoningEffort? baseUrl? —— 其中 apiKey / baseUrl 由 Manager 从所引用 Provider 注入。
2. AgentAdapter 接口：resumeWith(sdkSessionId)（注入外部会话 id，下次 send 续接）；capabilities()（{ supportsSystemPrompt, supportsSkills, supportsResumeById, supportsMcp }，描述厂商不对称）。
3. claude.ts：透传 systemPrompt / skills / mcpServers / allowedTools / permissionMode；`session_started` 只发一次，但 _sessionId 在每轮结束允许更新为最新值（防 Claude resume 续聊时轮换 session_id）。Manager 在每轮 done 后读 adapter.sessionId 回写 DB —— 无论 SDK 是否轮换 id 都正确。留 canUseTool seam，本期默认 bypass。
4. codex.ts：resumeWith(id) 存 _resumeId；send() 中无 thread 时，有 _resumeId 走 resumeThread 否则 startThread。capabilities() 返回 supportsSystemPrompt:false / supportsSkills:false。
5. busy 不在 adapter 里抛 BusinessException（adapter 保持 Nest 无关）：Manager 在 send() 前同步检查并置位 busy，命中并发则抛 BusinessException(AGENT_BUSY)；adapter 内的裸 throw 仅作兜底。

---

## AgentManager 生命周期

- createAgent(userId, dto)：只落 Agent 配置，不开会话；返回 AgentView（status='none'）。
- getOrCreateSoloSession(userId, agentId)：取 Agent（校验归属）→ 找该用户该 Agent 的会话，无则建一条（active）。converse 用它；suspend/clear 只作用于已有会话（无则 no-op）；restore 用它（无则新建并预热）。
- getOrRehydrate(sessionId)：命中注册表直接返回；否则查 Session → 按 agentId 取 Agent → resolveRuntimeConfig(session.userId, agent.platformProviderId) 注入 baseUrl+apiKey → mapper 转 config → createAgent → 有 sdkSessionId 调 resumeWith → 入表。用 in-flight Promise map（按 sessionId 去重）防并发重建。Provider 已删/不可用 → AGENT_UNAVAILABLE。
- 每轮结束读 adapter.sessionId，与 DB 不一致则回写（覆盖首轮捕获 + 轮换）。只在 turn 结束（done）持久化 sdkSessionId + lastTurnAt，绝不在流中途写，避免崩溃留半截句柄。
- 驱逐：LRU + 上限（AGENT_MAX_LIVE 默认 30；Codex 子进程较重，AGENT_MAX_LIVE_CODEX 默认 8），只驱逐 busy===false 的；加 idle-TTL 清扫（AGENT_IDLE_TTL_MS 默认 15min）。onModuleDestroy 优雅收尾。
- Codex 子进程：SDK 无 dispose API，驱逐只能丢引用靠 GC → 作为已知限制写明，并用“活跃 Codex 实例上限”兜底。

---

## Controller 接口

整个控制器 `@ApiBearerAuth() @UseGuards(JwtAuthGuard)`，每个 handler 注入 `@CurrentUser() user: User` 并传 `user.id`，所有操作按当前登录用户隔离；非本人 Agent 一律 NOT_FOUND（不泄露存在性）。

| Method     | Path（全局前缀 /api）                     | 说明                                                            | 错误码                                                   |
|------------|-------------------------------------|---------------------------------------------------------------|-------------------------------------------------------|
| POST       | /agents                             | CreateAgentDto → 建 Agent（不开会话），返回 AgentView                  | BAD_REQUEST（vendor↔type 不兼容 / model 不在 modelList）；NOT_FOUND（Provider 非本人）；AGENT_UNAVAILABLE（vendor 不支持的配置） |
| GET        | /agents                             | 列出当前用户的 AgentList                                            | —                                                     |
| GET        | /agents/:agentId                    | 详情 AgentView                                                 | NOT_FOUND                                             |
| GET @Sse() | /agents/:agentId/converse?prompt=   | 单聊（懒加载会话），SSE 推 AgentEvent                                  | NOT_FOUND；AGENT_BUSY；AGENT_UNAVAILABLE                |
| POST       | /agents/:agentId/suspend            | 暂存单聊会话（拒绝 mid-turn）                                          | NOT_FOUND；AGENT_BUSY                                  |
| POST       | /agents/:agentId/restore            | 恢复单聊会话，返回 active AgentView                                   | NOT_FOUND                                             |
| POST       | /agents/:agentId/clear              | 清空单聊会话                                                       | NOT_FOUND；AGENT_BUSY                                  |
| DELETE     | /agents/:agentId                    | 删除 Agent（连同其会话）                                             | NOT_FOUND；AGENT_BUSY                                  |

- AgentView：`{ id, name, vendor, platformProviderId, model, workingDirectory, capabilities, status('active'|'suspended'|'cleared'|'none'), hasLiveSession, lastTurnAt, createdAt, updatedAt }`。status='none' 表示尚未开过任何会话。
- 受保护接口需带 `Authorization: Bearer <token>`；Scalar UI 中点右上 Authorize 填入即可。
- 创建时能力校验：Codex + systemPrompt/skills 要显式报错（而非静默丢弃），否则用户以为生效了。

SSE 集成关键点

- @Sse() 需返回 Observable<MessageEvent>：写一个 asyncIterable→Observable 小桥，把每个 AgentEvent 映射成 { data: event }。
- 全局 ResponseInterceptor 会污染 SSE：用 @SkipEnvelope() 装饰器 + ResponseInterceptor 里 Reflector 检测并跳过 SSE 路由。
- 客户端断连必须中止：converse handler 建 AbortController 传给 send({signal})；Observable 的 teardown/unsubscribe 里 abort() 并调用底层 iterator 的 .return()，确保 adapter 的 finally（重置 busy + 发 done）执行。这是最关键的正确性项——否则 busy 卡死、Codex 子进程泄漏。
- **SSE 鉴权**：沿用 `Authorization` 头部鉴权；浏览器原生 EventSource 不便带自定义头，前端需用 fetch-stream 或后续支持 query token。

---

## 错误码（见 `common/exceptions/error-code.ts`）

| 码                       | HTTP | 触发                                          |
|--------------------------|------|---------------------------------------------|
| `2001 UNAUTHORIZED`      | 401  | 缺少/无效/已失效 token                          |
| `3001 BAD_REQUEST`       | 400  | vendor 与 Provider 类型不兼容 / model 不在 modelList |
| `4000 NOT_FOUND`         | 404  | Agent 或所引用 Provider 不存在/非本人              |
| `5001 AGENT_UNAVAILABLE` | 503  | adapter 构造失败 / Provider 已删致凭证不可用 / vendor 不支持的配置 |
| `5002 AGENT_BUSY`        | 409  | 会话进行中再次对话或试图变更                      |

---

## 已知限制 / TODO（写入代码注释与 README）

- **群聊会话**：把多个 Agent 拉进同一会话由后续独立模块实现；agent_session 届时引入房间/会话归属（一个 Agent 多会话），本期单聊为其子集。
- **Agent 配置不可编辑**：本期只提供 create / list / get / delete，无 PATCH（“配置在创建时即确定”）。
- **Provider 删除不级联**：删除被 Agent 引用的 Provider 不校验/级联，运行时凭证解析失败 → AGENT_UNAVAILABLE 明确报错（避免 provider 模块反向依赖 agent 模块）。
- **前端 / `packages/shared` 契约**：本轮仅改后端；Agent 共享类型与前端 mock 需按新契约（id/name/platformProviderId，无 sessionId）另行更新。
- clear() 仅逻辑清空，SDK 磁盘会话文件不删（disk 增长、旧会话技术上仍可 resume）→ phase-2 清理任务。
- 进程重启只能恢复已完成轮次的会话；崩溃时正在跑的 turn 丢失，客户端需重发。
- 权限审批留 seam，本期 auto-approve。
- Codex 子进程无法主动 kill，靠实例上限 + GC。
- 厂商不对称：Codex 不支持 systemPrompt/skills/MCP（见 capabilities()），创建时显式拒绝而非静默丢弃。
- Claude resume 是否轮换 session_id 未在运行时实测——设计已用“每轮回写 adapter.sessionId”做到与该行为无关。

---

## 验证方式

1. pnpm -F @agenthub/server typecheck（adapter + 新模块编译通过）。
2. 起服务 pnpm -F @agenthub/server start（需 MySQL + Redis；synchronize 自动建 agent/agent_session 表）。
3. 注册 → 登录拿 token；建一个 Provider 并 models/refresh（或填 modelList）。
4. POST /api/agents 建一个 claude agent（引用该 Provider、选其中一个 model）→ 拿 agentId。
5. GET /api/agents 看 AgentList（按 userId 隔离）。
6. curl -N -H "Authorization: Bearer <token>" /api/agents/:agentId/converse?prompt=... 看 SSE 事件流（text/tool_use/done）。
7. 多轮：再 converse 一次，确认上下文延续（DB 中 sdkSessionId 已落库）。
8. 重启进程后再 converse 同一 agentId，验证跨进程 resume 续聊（核心验收点）。
9. clear 后 converse，确认开了新会话（不带旧上下文）。
10. 并发对同一 agent 发两次 converse，确认第二次返回 AGENT_BUSY(409) 而非 500。
11. 鉴权：无 Bearer 调 /api/agents 应 401；引用他人 Provider 建 Agent 应 NOT_FOUND；兼容校验：claude + 非 anthropic Provider、或 model 不在 modelList 应 BAD_REQUEST。
