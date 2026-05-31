# @agenthub/server

AgentHub 后端服务，基于 **NestJS** 构建。

## 目录结构

```
apps/server/
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── sql/                          # 建表 SQL 存档（参考用，真实结构以实体定义为准）
└── src/
    ├── main.ts                   # 引导入口：全局 ValidationPipe + /api 前缀 + Scalar 文档
    ├── app.module.ts             # 根模块：装配 Config / TypeORM / Redis + 各业务模块
    ├── common/                   # 跨模块基建：统一响应信封、BusinessException、全局过滤器/拦截器、Swagger 装饰器
    ├── redis/
    │   └── redis.module.ts       # @Global Redis 模块，导出 REDIS_CLIENT token
    ├── health/
    │   ├── health.controller.ts  # GET /api/health
    │   └── health.service.ts     # 同时探测 MySQL & Redis
    ├── mutiagents/               # 用户虚拟员工管理（AgentManager）：Agent 配置 + 会话句柄 + vendor adapter（详见下文「多 Agent 管理模块」）
    ├── user/                     # 用户管理 + JWT 认证基座（详见下文「用户管理模块」）
    └── platform-provider/        # 用户自建模型平台（Provider）管理（详见下文「Provider 管理模块」）
```

## 关键依赖（对应 Java 概念）

| 依赖                                                         | 作用                     | Spring 类比                               |
|------------------------------------------------------------|------------------------|-----------------------------------------|
| `@nestjs/core` `@nestjs/common` `@nestjs/platform-express` | NestJS 核心 + Express 适配 | `spring-boot-starter-web`               |
| `@nestjs/config`                                           | `.env` / 配置注入          | `application.yml` + `@Value`            |
| `@nestjs/typeorm` `typeorm` `mysql2`                       | ORM + MySQL 驱动         | `spring-data-jpa` + `mysql-connector-j` |
| `ioredis`                                                  | Redis 客户端              | `Lettuce` / `Jedis`                     |
| `class-validator` `class-transformer`                      | DTO 校验/转换              | `Hibernate Validator`                   |
| `@nestjs/jwt`                                              | JWT 签发/校验              | `jjwt` / `spring-security-jwt`          |
| `bcrypt`                                                   | 密码哈希                   | `BCryptPasswordEncoder`                 |
| `reflect-metadata`                                         | 装饰器元数据                 | 由 Spring AOP 内部处理                       |

## 常用命令

```bash
pnpm -F @agenthub/server dev         # nest start --watch（热重载）
pnpm -F @agenthub/server build       # nest build → dist/
pnpm -F @agenthub/server start:prod  # node dist/main.js
pnpm -F @agenthub/server typecheck
```

## 环境变量

复制 `.env.example` → `.env`（或 `.env.local`），按需填写：

- `MYSQL_*` / `REDIS_*` — 数据库与 Redis 连接。
- `JWT_SECRET` — JWT 签名密钥，**生产环境务必改成强随机值**。
- `JWT_EXPIRES_IN` — token 有效期，如 `7d` / `12h`（`ms` 包格式）。

## 健康检查

启动后访问 `http://localhost:3000/api/health`，会同时 ping MySQL（`SELECT 1`）和 Redis（`PING`）并返回聚合状态。

## 用法示例（注入 Redis）

```ts
import { Inject, Injectable } from '@nestjs/common'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../redis/redis.module'

@Injectable()
export class FooService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}
}
```

## ORM 选择说明

选用 TypeORM 而非 Prisma，因为 `@Entity` / `@Column` / Repository 模式与 JPA 几乎一一对应，迁移成本最低。如果后续想要更强的类型推导和 schema 迁移工具，再切换到 Prisma 也很容易。

## 用户管理模块（`src/user/`）

提供注册、登录、退出登录、注销账号、获取用户信息五项能力，并自带一套可复用的 JWT 认证基座。类比 Spring：相当于 `Spring Security + JWT` 的最小落地。

### 目录结构

```
src/user/
├── user.module.ts          # 装配 User 实体 + JwtModule；导出 JwtAuthGuard 供其他模块复用
├── user.controller.ts      # @Controller('user')，薄控制器
├── user.service.ts         # 注册/登录/退出/注销/获取信息全部业务逻辑
├── entities/user.entity.ts # @Entity('user')
├── dto/                    # register/login 入参、user-view 契约(interface)、user-response 文档类
├── mappers/user.mapper.ts  # 实体 → 视图，剥离 passwordHash
└── auth/
    ├── token.service.ts        # JWT 签发/校验 + Redis 黑名单吊销
    ├── jwt-auth.guard.ts       # 鉴权守卫（类比 Spring 的 OncePerRequestFilter）
    ├── current-user.decorator.ts # @CurrentUser() / @AuthPayload() 参数装饰器
    └── auth.types.ts           # JwtPayload / AuthenticatedRequest
```

### 接口（前缀 `/api`，成功响应统一信封 `{ code, message, data, timestamp }`）

| 方法     | 路径                   | 功能                                 | 鉴权 |
|--------|----------------------|------------------------------------|----|
| POST   | `/api/user/register` | 注册（`account` + `password`），不自动登录   | 否  |
| POST   | `/api/user/login`    | 登录，返回 `{ token, expiresIn, user }` | 否  |
| POST   | `/api/user/logout`   | 退出登录，当前 token 加入黑名单即时失效            | 是  |
| GET    | `/api/user/me`       | 获取当前用户信息                           | 是  |
| DELETE | `/api/user/me`       | 注销账号（逻辑删除），并吊销当前 token             | 是  |

- `account` = 登录名（唯一不可变）；`nickname` = 展示名；`email` / `avatar` 注册后可选补充。
- 受保护接口需带 `Authorization: Bearer <token>`；Scalar UI 中点右上 **Authorize** 填入即可。

### 认证机制

- **无状态 JWT**：登录签发 access token（含 `jti`），放 `Authorization: Bearer` 使用。
- **服务端吊销**：退出登录/注销时把 token 的 `jti` 写入 Redis 黑名单（`auth:blacklist:<jti>`，TTL=token 剩余有效期），`JwtAuthGuard` 每次校验时查黑名单 → 实现无状态 token 的即时失效。**故本模块依赖 Redis 在线**。
- **密码**：仅存 `bcrypt` 哈希；实体侧 `select: false`，默认不随查询返回，登录时显式 select 后比对。

### 数据库

仅一张 `user` 表（登录态/黑名单走 JWT/Redis，不入库）。dev 环境 TypeORM `synchronize` 自动建表；结构存档见 `sql/user_management.sql`，**真实结构以实体定义为准**。

### 错误码（见 `common/exceptions/error-code.ts`）

| 码                          | HTTP | 含义                   |
|----------------------------|------|----------------------|
| `2001 UNAUTHORIZED`        | 401  | 缺少/无效/已失效的 token     |
| `2003 INVALID_CREDENTIALS` | 401  | 账号或密码错误（不区分具体原因，防枚举） |
| `2004 ACCOUNT_DEACTIVATED` | 403  | 账号已注销                |
| `4001 CONFLICT`            | 409  | 账号/邮箱已存在             |

### 已知限制

- 注册不自动登录（如需登录态直接返回，可在 `register` 末尾复用 `login` 逻辑）。
- 账号注销为逻辑删除，`account` / `email` 仍占用唯一索引，不可同名重注册。
- 未做登录失败次数限制 / 验证码 / 密码找回。

## Provider 管理模块（`src/platform-provider/`）

用户自建「模型平台/供应商」的增删改查，外加连接测试与模型拉取。每个 Provider 归属创建它的用户，复用 `user` 模块导出的 `JwtAuthGuard` 做鉴权（类比 Spring 中共享一个 Security filter bean）。与 `mutiagents` 的 `agent`「不存 apiKey」相反——本模块的语义就是用户自带密钥，故必须落库；`mutiagents` 的 Agent 正是引用本模块的 Provider 取运行时凭证（`resolveRuntimeConfig`）。

### 目录结构

```
src/platform-provider/
├── platform-provider.module.ts          # 装配 PlatformProvider 实体；import UserModule 复用 JwtAuthGuard
├── platform-provider.controller.ts      # @Controller('platform-providers')，整体 @UseGuards(JwtAuthGuard)
├── platform-provider.service.ts         # CRUD + 测连接 + 刷新模型；按 userId 数据隔离
├── provider-probe.service.ts            # 出网探测上游（列模型/测连接），原生 fetch + 超时
├── entities/platform-provider.entity.ts # @Entity('platform_provider') + ProviderType 枚举
├── dto/                                  # create/update 入参、view 契约(interface)、response 文档类
└── mappers/platform-provider.mapper.ts  # 实体 → 视图，apiKey 掩码
```

### 接口（前缀 `/api`，成功响应统一信封 `{ code, message, data, timestamp }`，全部需鉴权）

| 方法     | 路径                                           | 功能                                                      |
|--------|----------------------------------------------|---------------------------------------------------------|
| POST   | `/api/platform-providers`                    | 添加 Provider（同一用户下 `platformName` 唯一）                    |
| GET    | `/api/platform-providers`                    | 列出当前用户的全部 Provider                                      |
| GET    | `/api/platform-providers/:id`                | 查询单个详情                                                  |
| PATCH  | `/api/platform-providers/:id`                | 部分修改（`apiKey` 省略则保留原密钥）                                 |
| DELETE | `/api/platform-providers/:id`                | 删除（硬删除）                                                 |
| POST   | `/api/platform-providers/:id/test`           | 测试连接，返回 `{ ok, latencyMs, modelCount?, message? }`      |
| POST   | `/api/platform-providers/:id/models/refresh` | 拉取上游模型并整体覆盖 `modelList`                                 |

- 字段：`platformName` 展示名、`baseUrl` 上游地址、`apiKey` 密钥、`modelList` 模型名数组、`type` 协议类型。
- `type` 取值：`openai-chat-completions` / `openai-responses` / `anthropic`（前端自行映射「OpenAI(Chat Completions)」等展示名）。
- 所有接口需带 `Authorization: Bearer <token>`，且只能操作本人记录；非本人记录一律按 `NOT_FOUND` 处理（不泄露存在性）。

### 密钥与安全

- `apiKey` 必须可逆使用（用于调上游），无法像密码那样哈希；**明文存储**但实体侧 `select: false`，默认不随查询返回。
- 对外视图只回**掩码**（`apiKeyMasked`，如 `sk-****wl7g`），**绝不回明文**；需要密钥的操作（掩码/探测）在 service 内显式 `addSelect` 取出。

### 测试连接 / 拉取模型

- 二者都只读地打上游「列模型」接口（OpenAI 走 `GET {base}/models` + `Bearer`；Anthropic 走 `GET {base}/v1/models` + `x-api-key` & `anthropic-version`），不产生 token 费用。
- 出网请求带 10s 超时；上游不可达 / 非 2xx 归一为 `5000 UPSTREAM_ERROR`（502）。
- `test` 失败**不抛异常**，而是返回 `{ ok:false, message }`，便于前端直接展示；`models/refresh` 上游异常时抛 `UPSTREAM_ERROR`。

### 数据库

仅一张 `platform_provider` 表，`(userId, platformName)` 唯一。dev 环境 TypeORM `synchronize` 自动建表；结构存档见 `sql/platform_provider.sql`，**真实结构以实体定义为准**。

### 错误码（复用 `common/exceptions/error-code.ts`，未新增）

| 码                       | HTTP | 含义                            |
|-------------------------|------|-------------------------------|
| `2001 UNAUTHORIZED`     | 401  | 缺少/无效/已失效的 token              |
| `3000 VALIDATION_FAILED`| 400  | 入参校验失败（如 `baseUrl` 非 http(s)） |
| `4000 NOT_FOUND`        | 404  | Provider 不存在或非本人              |
| `4001 CONFLICT`         | 409  | 同名 Provider 已存在               |
| `5000 UPSTREAM_ERROR`   | 502  | 上游不可达或返回非 2xx                 |

### 已知限制

- `apiKey` 明文存储（按需求选定）；未做静态加密。
- 测连接 / 拉模型只作用于**已保存**的 Provider（按 `:id`），不支持「未保存先测」的草稿校验。
- `models/refresh` 会**整体覆盖** `modelList`（拉取即持久化），非预览。
- `baseUrl` 仅校验 `http(s)://` 前缀，未做更严格的 URL 规范化；`modelList` 上限 200。
- 未写单测（项目当前无测试框架）。

## 多 Agent 管理模块（`src/mutiagents/`）

用户「虚拟员工」（Agent）的创建、管理与单聊对话（SSE 流）。每个 Agent 归属创建它的用户，整模块复用 `user` 模块导出的 `JwtAuthGuard` 鉴权。完整设计见 [`doc/agent-manager-spec.md`](../../doc/agent-manager-spec.md)。

### 目录结构

```
src/mutiagents/
├── agents.module.ts                  # 装配 Agent/AgentSession 实体；import UserModule(复用 JwtAuthGuard) + PlatformProviderModule(取凭证)
├── agents.controller.ts              # @Controller('agents')，整体 @UseGuards(JwtAuthGuard)；REST + SSE
├── agent-manager.service.ts          # 注册表 + 生命周期：创建/对话/暂存/恢复/清空/删除；按 userId 隔离
├── live-agent.ts                     # LiveAgent 接口（内存活实例：adapter + busy + abort + lastUsedAt）
├── entities/
│   ├── agent.entity.ts               # @Entity('agent')：用户拥有的 Agent 配置
│   └── agent-session.entity.ts       # @Entity('agent_session')：会话句柄
├── dto/                              # create-agent 入参、converse 入参、agent-view 契约(interface)、agent-response 文档类
├── mappers/agent.mapper.ts           # Agent → adapter 配置；(agent, session) → 对外视图
└── adapter/                          # 统一 Agent 适配层（Claude / Codex → 同一套 AgentEvent）；详见 adapter/README.md
    ├── types.ts                      # AgentVendor / AgentEvent / AgentAdapter / AgentAdapterConfig / 能力描述
    ├── capabilities.ts               # 各 vendor 能力矩阵
    ├── claude.ts                     # ClaudeAdapter（Claude Agent SDK）
    ├── codex.ts                      # CodexAdapter（OpenAI Codex SDK）
    └── index.ts                      # 对外导出 + createAgent / getCapabilities 工厂
```

### 三层模型

- **Agent**（`agent` 表）：用户拥有的不变配置——`name`、`vendor`（claude/codex）、`platformProviderId` + `model`、工作目录、systemPrompt、skills、mcp、tools 等。**不存 `apiKey` / `baseUrl`**。
- **AgentSession**（`agent_session` 表）：会话句柄——`userId` + `agentId` + `sdkSessionId` + 状态，持久化以扛进程重启。
- **LiveAgent**（进程内存，不入库）：内存中的 adapter 活实例 + 并发锁 + LRU 时间戳。

**Agent 与会话解耦**：创建 Agent 只落配置（进 AgentList），不开会话；本期单聊按 `agentId` 懒加载/复用一条会话。把多个 Agent 拉进同一会话的**群聊**是后续独立模块。

**凭证来自 Provider**：Agent 引用一个 `platformProviderId`，运行时调 `PlatformProviderService.resolveRuntimeConfig` 取 `baseUrl` + 明文 `apiKey` 注入 adapter（仅后端内部）。创建时校验 vendor↔Provider 类型兼容（`claude`↔`anthropic`，`codex`↔`openai-*`）、`model` 属于 Provider 的 `modelList`。

### 接口（前缀 `/api`，成功响应统一信封，全部需鉴权）

| 方法     | 路径                                  | 功能                                       |
|--------|-------------------------------------|------------------------------------------|
| POST   | `/api/agents`                       | 创建 Agent 配置（不开会话），返回 `AgentView`        |
| GET    | `/api/agents`                       | 列出当前用户的 AgentList                        |
| GET    | `/api/agents/:agentId`              | 查询单个 Agent                              |
| DELETE | `/api/agents/:agentId`              | 删除 Agent（连同其会话）                         |
| GET `@Sse` | `/api/agents/:agentId/converse?prompt=...` | 单聊（懒加载会话），SSE 推 `AgentEvent`        |
| POST   | `/api/agents/:agentId/suspend`      | 暂存单聊会话（从内存驱逐，可恢复）                       |
| POST   | `/api/agents/:agentId/restore`      | 恢复单聊会话并预热活实例                            |
| POST   | `/api/agents/:agentId/clear`        | 清空单聊会话（丢弃句柄，下次开新会话）                     |

- 所有操作按 `@CurrentUser()` 隔离，非本人 Agent 一律 `NOT_FOUND`。
- SSE 路由用 `@SkipEnvelope()`；浏览器原生 `EventSource` 不便带 `Authorization` 头，前端需用 fetch-stream 或后续支持 query token。

### 并发与生命周期

- **单会话串行**：进行中的 turn 再次对话 → `AGENT_BUSY`（Manager 同步 check-and-set，非裸 throw）。
- **驱逐**：LRU + 上限（`AGENT_MAX_LIVE` 默认 30；Codex 子进程较重，`AGENT_MAX_LIVE_CODEX` 默认 8），仅驱逐空闲（非 busy）实例；另有 idle-TTL 清扫（`AGENT_IDLE_TTL_MS` 默认 15min）。Codex 子进程无 dispose API，驱逐只能丢引用靠 GC，故设活跃实例上限兜底。
- **句柄回写**：仅在每轮结束（`done`）持久化 `sdkSessionId`，绝不在流中途写；缺失活实例时按 Agent 配置重建 adapter 并 `resumeWith(sdkSessionId)` 续接，故能扛进程重启（仅恢复已完成轮次，崩溃时进行中的 turn 丢失，客户端需重发）。

### 数据库

两张表 `agent` / `agent_session`，均按 `userId` 隔离。dev 环境 TypeORM `synchronize` 自动建表；结构存档见 `sql/agent_manager.sql`，**真实结构以实体定义为准**。

### 错误码（复用 `common/exceptions/error-code.ts`，未新增）

| 码                        | HTTP | 含义                          |
|--------------------------|------|-----------------------------|
| `2001 UNAUTHORIZED`      | 401  | 缺少/无效/已失效的 token            |
| `3001 BAD_REQUEST`       | 400  | vendor↔Provider 类型不兼容等入参错误  |
| `4000 NOT_FOUND`         | 404  | Agent 不存在或非本人               |
| `5001 AGENT_UNAVAILABLE` | 503  | 运行时凭证解析失败（如被引用 Provider 已删） |
| `5002 AGENT_BUSY`        | 409  | 会话已有进行中的 turn               |

### 已知限制

- 群聊会话留给后续模块；本期仅单聊（一个 Agent 至多一条会话）。
- Agent 配置创建后不可编辑（无 PATCH）；`name` 同一用户下不强制唯一。
- 删除被 Agent 引用的 Provider 不级联，运行时凭证解析失败 → `AGENT_UNAVAILABLE`。
- **权限审批**：本期 auto-approve（Claude `bypassPermissions` / Codex `approvalPolicy:"never"`），已留 `config.permissionMode` + `canUseTool` seam，交互审批为 phase-2。
- **厂商不对称**：Codex 不支持 systemPrompt / skills / MCP（见 `capabilities()`），创建时显式拒绝。
- `clear()` 仅逻辑清空：SDK 落盘的旧会话文件不删除（disk 增长、旧会话技术上仍可 resume）→ phase-2 清理任务。
- 前端 / `packages/shared` 的 Agent 契约（`id`/`name`/`platformProviderId`，无 `sessionId`）需另行更新。

## 下一步建议

1. 在 `packages/shared` 里定义后端要暴露的接口契约，让 `apps/server` 直接 `import` 复用类型。
2. 新建第一个业务 Module（如 `chat/`），用 `@Entity` + `Repository` 写一条增删改查跑通链路。
