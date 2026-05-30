AgentManager 后端实现方案

## Context（为什么做这件事）

AgentHub 是一个“飞书式”的多 Agent 协作平台：用户把多个虚拟员工（底层是 Claude / Codex 实例）拉进群聊协作。底层已有统一适配层 `apps/server/src/mutiagents/adapter/`（AgentAdapter 接口 + AgentEvent 流 + createAgent 工厂），但它只解决了“单个会话的事件归一”，缺少上层的生命周期管理：没有“档案/会话”的概念、不能创建可配置的 Agent、不能持久化、进程重启后无法恢复、并发保护是裸 throw。

本期目标是补齐 AgentManager，对外暴露 4 个能力：创建 Agent（可配 workdir / systemPrompt / skills / mcp / tools）、与 Agent 对话（SSE 流）、暂存/按 id 恢复并续聊、清空聊天历史。

已锁定的决策：
- 权限审批：本期 auto-approve（沿用 bypass/never），但留好 seam（可配 permissionMode + 未来 canUseTool 钩子），phase-2 再做交互审批。
- 持久化级别：必须扛进程重启 —— 依赖两个 SDK 自身的磁盘会话，只持久化“句柄”（vendor + spec + sdkSessionId），恢复 = 用 spec 重建 adapter 并按 id resume。
- 存储：全部 MySQL（TypeORM），本期不引入 Redis。
- 传输：对话事件流走 SSE（@Sse()）。

SDK 能力已核实（node_modules .d.ts）：Claude 的 query Options 支持 resume / systemPrompt / appendSystemPrompt / mcpServers / allowedTools / skills / canUseTool / permissionMode；Codex 有 resumeThread(id, opts) 但 ThreadOptions 无 systemPrompt/skills（厂商能力不对称），且 Thread/Codex 无 dispose/close API。

---

## 三层模型（核心设计）

| 概念                 | 含义                                                                                    | 存储       |
|--------------------|---------------------------------------------------------------------------------------|----------|
| AgentSpec（档案/配方）   | vendor、model、workdir、systemPrompt、skills、mcp、tools 等不变配置                              | MySQL 实体 |
| AgentSession（会话句柄） | AgentHub 侧 id + 关联 spec + sdkSessionId（Claude session UUID / Codex thread id）+ status | MySQL 实体 |
| LiveAgent（活实例）     | 内存中的 AgentAdapter + busy + AbortController + lastUsedAt                               | 进程内存 Map |

4 个动作在此模型下自然落地：
- 创建 = 存 Spec + 开一个 Session；
- 对话 = 按 sessionId 取/重建 LiveAgent → send()；
- 暂存 = 置 status 并从内存驱逐（磁盘会话仍在）；
- 恢复 = 用 Spec 重建并 resumeWith(sdkSessionId)；
- 清空 = 把 sdkSessionId 置空、下次 send() 自动开新会话。

---

## 文件布局 apps/server/src/mutiagents/

NestJS 层文件遵循 common/、health/ 的风格（2 空格缩进 + 无分号，注意与 adapter 目录的 4 空格+分号不同）。

```
mutiagents/
  adapter/                      # 既有，仅做加法式改动（见下）
  agents.module.ts             # TypeOrmModule.forFeature([AgentSpec, AgentSession]) + controller + manager
  agents.controller.ts         # REST + @Sse()，DTO 校验，错误转 BusinessException
  agent-manager.service.ts     # LiveAgent 注册表 + get-or-rehydrate + 驱逐 + 持久化编排
  live-agent.ts                # 内存 LiveAgent 类型（不持久化）
  entities/
    agent-spec.entity.ts       # @Entity('agent_spec')
    agent-session.entity.ts    # @Entity('agent_session')
  dto/
    create-agent.dto.ts        # class-validator
    converse.dto.ts
    agent-view.dto.ts          # 响应形状（不复用实体）
  mappers/
    agent.mapper.ts            # entity→AgentView；CreateAgentDto/Spec→AgentAdapterConfig（注入 apiKey）
```

AgentsModule 加入 app.module.ts 的 imports。autoLoadEntities: true 已开，forFeature 即自动建表（非 prod synchronize:true）。

实体字段

- AgentSpec: id(uuid PK) vendor model workingDirectory systemPrompt(text,null) skills(json,null) mcpServers(json,null) allowedTools(json,null) permissionMode(varchar,null) reasoningEffort(varchar,null) baseUrl(varchar,null) createdAt/updatedAt。不存 apiKey（密钥从 ConfigService/env 在重建时注入；至多存一个 credentialRef）。
- AgentSession: id(uuid PK，客户端对话用的 id) specId(FK) vendor(冗余，免 join) sdkSessionId(varchar,null) status(active|suspended|cleared) lastTurnAt(null) createdAt/updatedAt。
- JSON 列用 `@Column('json', { nullable: true })`（MySQL JSON 列不能带 default）。

---

## adapter 层改动（全部加法、向后兼容）

1. types.ts 扩 AgentAdapterConfig（全 optional）：systemPrompt? skills?: 'all'|string[] mcpServers?: Record<string, unknown> allowedTools?: string[] permissionMode?。
2. AgentAdapter 接口加：resumeWith(sdkSessionId: string): void（注入外部会话 id，下次 send 续接）；capabilities(): AgentCapabilities（{ supportsSystemPrompt, supportsSkills, supportsResumeById, supportsMcp }，描述厂商不对称）。
3. claude.ts：
   - resumeWith(id) → this._sessionId = id。
   - 把写死的 allowedTools / permissionMode 改为读 config，未配置时回退到当前默认值（保持现有行为）。新增透传 systemPrompt / skills / mcpServers。
   - 修 session_id 处理：translate() 现在用 && !this._sessionId 锁死首个 id；改为「session_started 仍只发一次，但 _sessionId 在每轮结束允许更新为最新值」，以防 Claude 在 resume 续聊时轮换 session_id。Manager 在每轮 done 后读取 adapter.sessionId 回写 DB —— 这样无论 SDK 是否轮换 id 都正确。
   - 留 canUseTool seam：本期 permissionMode 默认 bypass、不接钩子。
4. codex.ts：
   - resumeWith(id) → 存 _resumeId；send() 中 !this.thread 时：有 _resumeId 走 codex.resumeThread(_resumeId, opts)，否则 startThread(...)。
   - capabilities() 返回 supportsSystemPrompt:false, supportsSkills:false。
5. busy 不在 adapter 里抛 BusinessException（adapter 保持 Nest 无关）：Manager 在 send() 前同步检查并置位 busy，命中并发则抛 BusinessException(AGENT_BUSY)；adapter 内的裸 throw 仅作兜底。

---

## AgentManager 生命周期

- getOrRehydrate(sessionId)：命中注册表直接返回；否则查 Session+Spec → mapper 转 config（注入 apiKey）→ createAgent → 若有 sdkSessionId 调 resumeWith → 入表。用 in-flight Promise map（按 sessionId 去重） 防并发重建。
- 每轮结束读 adapter.sessionId，与 DB 不一致则回写（覆盖首轮捕获 + 轮换）。只在 turn_completed/done 持久化 sdkSessionId，绝不在流中途写，避免崩溃留半截句柄。
- 驱逐：LRU + 上限（AGENT_MAX_LIVE，Codex 单独设更小上限），只驱逐 busy===false 的；加 idle-TTL 清扫。onModuleDestroy 优雅收尾。
- Codex 子进程：SDK 无 dispose API，驱逐只能丢引用靠 GC → 作为已知限制写明，并用“活跃 Codex 实例上限”兜底。

---

## Controller 接口

先在 error-code.ts 加 AGENT_BUSY = 5002 → ERROR_CODE_HTTP_STATUS 映射 CONFLICT(409)，并在 all-exceptions.filter.ts 的 mapHttpStatusToCode 补一条（CONFLICT 已映射到 CONFLICT，需区分则另行处理；最简单直接用 BusinessException(AGENT_BUSY) 走 BusinessException 分支即可，filter 无需改）。

| Method     | Path（全局前缀 /api）                     | 说明                                                                             | 错误码                                                               |
|------------|-------------------------------------|--------------------------------------------------------------------------------|-------------------------------------------------------------------|
| POST       | /agents                             | CreateAgentDto → 建 Spec+Session，返回 { sessionId, specId, vendor, capabilities } | VALIDATION_FAILED；AGENT_UNAVAILABLE（vendor 不支持 / Codex+skills 被拒） |
| GET        | /agents                             | 列表                                                                             | —                                                                 |
| GET        | /agents/:sessionId                  | 详情 AgentView                                                                   | NOT_FOUND                                                         |
| GET @Sse() | /agents/:sessionId/converse?prompt= | SSE 推 AgentEvent                                                               | NOT_FOUND；AGENT_BUSY；AGENT_UNAVAILABLE                            |
| POST       | /agents/:sessionId/suspend          | 暂存（拒绝 mid-turn）                                                                | NOT_FOUND；AGENT_BUSY                                              |
| POST       | /agents/:sessionId/restore          | 恢复，返回 active AgentView                                                         | NOT_FOUND                                                         |
| POST       | /agents/:sessionId/clear            | 清空历史                                                                           | NOT_FOUND；AGENT_BUSY                                              |
| DELETE     | /agents/:sessionId                  | 删除                                                                             | NOT_FOUND                                                         |

创建时能力校验：Codex + systemPrompt/skills 要显式报错（而非静默丢弃），否则用户以为生效了。

SSE 集成关键点

- @Sse() 需返回 Observable<MessageEvent>：写一个 asyncIterable→Observable 小桥，把每个 AgentEvent 映射成 { data: event }。
- 全局 ResponseInterceptor（main.ts:25）会污染 SSE：它对每个 emission 套 buildSuccess，MessageEvent 不匹配 isApiResponse → 会被错误包封。需新增 @SkipEnvelope() 装饰器 + 在 ResponseInterceptor 里用 Reflector 检测并跳过 SSE 路由。
- 客户端断连必须中止：converse handler 建 AbortController 传给 send({signal})；Observable 的 teardown/unsubscribe 里 abort() 并调用底层 iterator 的 .return()，确保 adapter 的 finally（重置 busy + 发 done）执行。这是最关键的正确性项——否则 busy 卡死、Codex 子进程泄漏。

---

## 已知限制 / TODO（写入代码注释与 README）

- clear() 仅逻辑清空，SDK 磁盘会话文件不删（disk 增长、旧会话技术上仍可 resume）→ phase-2 清理任务。
- 进程重启只能恢复已完成轮次的会话；崩溃时正在跑的 turn 丢失，客户端需重发。
- 权限审批留 seam，本期 auto-approve。
- Codex 子进程无法主动 kill，靠实例上限 + GC。
- Claude resume 是否轮换 session_id 未在运行时实测——设计已用“每轮回写 adapter.sessionId”做到与该行为无关。

---

## 验证方式

1. pnpm -F @agenthub/server typecheck（adapter 改动 + 新模块编译通过）。
2. 起服务 pnpm -F @agenthub/server start（需 MySQL；synchronize 自动建 agent_spec/agent_session 表）。
3. POST /api/agents 建一个 claude agent → 拿 sessionId。
4. curl -N /api/agents/:id/converse?prompt=... 看 SSE 事件流（text/tool_use/done）。
5. 多轮：再 converse 一次，确认上下文延续（DB 中 sdkSessionId 已落库）。
6. 重启进程后再 converse 同一 sessionId，验证跨进程 resume 续聊（核心验收点；若 Claude/Codex resume 不如预期，回退为“sticky：暂不驱逐有活会话的实例”）。
7. clear 后 converse，确认开了新会话（不带旧上下文）。
8. 并发对同一 agent 发两次 converse，确认第二次返回 AGENT_BUSY(409) 而非 500。
