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
    ├── multiagents/              # 用户虚拟员工管理：Agent 配置 + 聊天会话 + 后台 turn runtime（详见下文「多 Agent 管理模块」）
    ├── user-workspace/           # 按用户隔离的服务器文件空间：skills/session/agent_home/agent_workspace
    ├── workspace-fs/             # 服务端目录浏览：为桌面端选择当前用户自己的 Agent/群聊工作区与 skill 目录
    ├── user/                     # 用户管理 + JWT 认证基座（详见下文「用户管理模块」）
    └── platform-provider/        # 用户自建模型平台（Provider）管理（详见下文「Provider 管理模块」）
```

## 关键依赖（对应 Java 概念）

| 依赖                                                       | 作用                       | Spring 类比                             |
| ---------------------------------------------------------- | -------------------------- | --------------------------------------- |
| `@nestjs/core` `@nestjs/common` `@nestjs/platform-express` | NestJS 核心 + Express 适配 | `spring-boot-starter-web`               |
| `@nestjs/config`                                           | `.env` / 配置注入          | `application.yml` + `@Value`            |
| `@nestjs/typeorm` `typeorm` `mysql2`                       | ORM + MySQL 驱动           | `spring-data-jpa` + `mysql-connector-j` |
| `ioredis`                                                  | Redis 客户端               | `Lettuce` / `Jedis`                     |
| `class-validator` `class-transformer`                      | DTO 校验/转换              | `Hibernate Validator`                   |
| `@nestjs/jwt`                                              | JWT 签发/校验              | `jjwt` / `spring-security-jwt`          |
| `bcrypt`                                                   | 密码哈希                   | `BCryptPasswordEncoder`                 |
| `reflect-metadata`                                         | 装饰器元数据               | 由 Spring AOP 内部处理                  |

## 常用命令

```bash
pnpm -F @agenthub/server dev         # nest start --watch（热重载）
pnpm -F @agenthub/server build       # nest build → dist/
pnpm -F @agenthub/server start:prod  # node dist/main.js
pnpm -F @agenthub/server typecheck
```

## 环境变量

复制 `.env.example` → `.env`（或 `.env.local`），按需填写：

- `MYSQL_*` / `REDIS_*` — 数据库与 Redis 连接；`MYSQL_TIMEZONE` 默认 `+08:00`（东八区），如果 MySQL 会话时间为 UTC 可设为 `Z`。
- `JWT_SECRET` — JWT 签名密钥，**生产环境务必改成强随机值**。
- `JWT_EXPIRES_IN` — token 有效期，如 `7d` / `12h`（`ms` 包格式）。
- `AGENTHUB_USER_SPACE_ROOT` — 多用户文件空间总根，默认 `~/.agenthub/users`。后端会为每个用户创建 `<root>/<userId>/skills`、`session`、`agent_home`、`agent_workspace`，所有 Agent Home、单聊/群聊工作区、session home、skill 来源目录都必须落在当前用户自己的空间内。
- `AGENTHUB_WORKSPACE_ROOTS` — 旧版全局目录浏览配置；当前普通用户目录浏览不再使用它，保留仅作兼容说明。
- `GROUP_WORKSPACE_ROOT` — 旧版群聊默认工作区根；当前新建群聊未传 `workspaceDir` 时会分配到当前用户 `agent_workspace/group-<groupId>`，普通用户链路不再使用全局默认根。

> 远端部署时，Agent Home、单聊工作目录、群聊共享工作区、`skillSourceDirectories` 都是**后端服务器路径**。桌面端目录选择器通过 `/api/workspace-fs/*` 只能浏览当前登录用户自己的 `skills` / `agent_home` / `agent_workspace`；若要导入 skill，skill 文件夹必须已经存在于当前用户的 `skills` 目录下。

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

选用 TypeORM 而非 Prisma，因为 `@Entity` / `@Column` / Repository 模式与 JPA 几乎一一对应，迁移成本最低。如果后续想要更强的类型推导和
schema 迁移工具，再切换到 Prisma 也很容易。

## 用户管理模块（`src/user/`）

提供注册、登录、退出登录、注销账号、获取用户信息、更新用户资料六项能力，并自带一套可复用的 JWT 认证基座。类比 Spring：相当于
`Spring Security + JWT` 的最小落地。

### 目录结构

```
src/user/
├── user.module.ts          # 装配 User 实体 + JwtModule；导出 JwtAuthGuard 供其他模块复用
├── user.controller.ts      # @Controller('user')，薄控制器
├── user.service.ts         # 注册/登录/退出/注销/获取信息/更新资料全部业务逻辑
├── entities/user.entity.ts # @Entity('user')
├── dto/                    # register/login/update-user 入参、user-view 契约(interface)、user-response 文档类
├── mappers/user.mapper.ts  # 实体 → 视图，剥离 passwordHash
└── auth/
    ├── token.service.ts        # JWT 签发/校验 + Redis 黑名单吊销
    ├── jwt-auth.guard.ts       # 鉴权守卫（类比 Spring 的 OncePerRequestFilter）
    ├── current-user.decorator.ts # @CurrentUser() / @AuthPayload() 参数装饰器
    └── auth.types.ts           # JwtPayload / AuthenticatedRequest
```

### 接口（前缀 `/api`，成功响应统一信封 `{ code, message, data, timestamp }`）

| 方法   | 路径                 | 功能                                               | 鉴权 |
| ------ | -------------------- | -------------------------------------------------- | ---- |
| POST   | `/api/user/register` | 注册（`account` + `password`），不自动登录         | 否   |
| POST   | `/api/user/login`    | 登录，返回 `{ token, expiresIn, user }`            | 否   |
| POST   | `/api/user/logout`   | 退出登录，当前 token 加入黑名单即时失效            | 是   |
| GET    | `/api/user/me`       | 获取当前用户信息                                   | 是   |
| POST   | `/api/user/update`   | 更新当前用户资料（部分更新 `nickname` / `avatar`） | 是   |
| DELETE | `/api/user/me`       | 注销账号（逻辑删除），并吊销当前 token             | 是   |

- `account` = 登录名（唯一不可变）；`nickname` = 展示名；`email` / `avatar` 注册后可选补充。
- `POST /api/user/update` 为部分更新：字段省略保留原值、显式传 `null` 清空；当前仅开放 `nickname` / `avatar`（头像支持 URL 或 <= 256 KiB 的压缩 data URL；`account` 不可变、`email` 暂未开放、`password` 应走独立的校验旧密码接口）。
- 受保护接口需带 `Authorization: Bearer <token>`；Scalar UI 中点右上 **Authorize** 填入即可。

### 认证机制

- **无状态 JWT**：登录签发 access token（含 `jti`），放 `Authorization: Bearer` 使用。
- **服务端吊销**：退出登录/注销时把 token 的 `jti` 写入 Redis 黑名单（`auth:blacklist:<jti>`，TTL=token 剩余有效期），
  `JwtAuthGuard` 每次校验时查黑名单 → 实现无状态 token 的即时失效。**故本模块依赖 Redis 在线**。
- **密码**：仅存 `bcrypt` 哈希；实体侧 `select: false`，默认不随查询返回，登录时显式 select 后比对。

### 数据库

仅一张 `user` 表（登录态/黑名单走 JWT/Redis，不入库）。dev 环境 TypeORM `synchronize` 自动建表；结构存档见
`sql/user_management.sql`，**真实结构以实体定义为准**。

### 错误码（见 `common/exceptions/error-code.ts`）

| 码                         | HTTP | 含义                                     |
| -------------------------- | ---- | ---------------------------------------- |
| `2001 UNAUTHORIZED`        | 401  | 缺少/无效/已失效的 token                 |
| `2003 INVALID_CREDENTIALS` | 401  | 账号或密码错误（不区分具体原因，防枚举） |
| `2004 ACCOUNT_DEACTIVATED` | 403  | 账号已注销                               |
| `4001 CONFLICT`            | 409  | 账号/邮箱已存在                          |

### 已知限制

- 注册不自动登录（如需登录态直接返回，可在 `register` 末尾复用 `login` 逻辑）。
- 账号注销为逻辑删除，`account` / `email` 仍占用唯一索引，不可同名重注册。
- 未做登录失败次数限制 / 验证码 / 密码找回。

## Provider 管理模块（`src/platform-provider/`）

用户自建「模型平台/供应商」的增删改查，外加连接测试与模型拉取。每个 Provider 归属创建它的用户，复用 `user` 模块导出的
`JwtAuthGuard` 做鉴权（类比 Spring 中共享一个 Security filter bean）。与 `multiagents` 的 `agent`「不存
apiKey」相反——本模块的语义就是用户自带密钥，故必须落库；`multiagents` 的 Agent 正是引用本模块的 Provider 取运行时凭证（
`resolveRuntimeConfig`）。

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

| 方法   | 路径                                         | 功能                                                      |
| ------ | -------------------------------------------- | --------------------------------------------------------- |
| POST   | `/api/platform-providers`                    | 添加 Provider（同一用户下 `platformName` 唯一）           |
| GET    | `/api/platform-providers`                    | 列出当前用户的全部 Provider                               |
| GET    | `/api/platform-providers/:id`                | 查询单个详情                                              |
| PATCH  | `/api/platform-providers/:id`                | 部分修改（`apiKey` 省略则保留原密钥）                     |
| DELETE | `/api/platform-providers/:id`                | 删除（硬删除）                                            |
| POST   | `/api/platform-providers/:id/test`           | 测试连接，返回 `{ ok, latencyMs, modelCount?, message? }` |
| POST   | `/api/platform-providers/:id/models/refresh` | 拉取上游模型并整体覆盖 `modelList`                        |

- 字段：`platformName` 展示名、`baseUrl` 上游地址、`apiKey` 密钥、`modelList` 模型名数组、`type` 协议类型。
- `type` 取值：`openai-chat-completions` / `openai-responses` / `anthropic`（前端自行映射「OpenAI(Chat Completions)」等展示名）。
- 所有接口需带 `Authorization: Bearer <token>`，且只能操作本人记录；非本人记录一律按 `NOT_FOUND` 处理（不泄露存在性）。

### 密钥与安全

- `apiKey` 必须可逆使用（用于调上游），无法像密码那样哈希；**明文存储**但实体侧 `select: false`，默认不随查询返回。
- 对外视图只回**掩码**（`apiKeyMasked`，如 `sk-****wl7g`），**绝不回明文**；需要密钥的操作（掩码/探测）在 service 内显式
  `addSelect` 取出。

### 测试连接 / 拉取模型

- 二者都只读地打上游「列模型」接口（OpenAI 走 `GET {base}/models` + `Bearer`；Anthropic 走 `GET {base}/v1/models` +
  `x-api-key` & `anthropic-version`），不产生 token 费用。
- 出网请求带 10s 超时；上游不可达 / 非 2xx 归一为 `5000 UPSTREAM_ERROR`（502）。
- `test` 失败**不抛异常**，而是返回 `{ ok:false, message }`，便于前端直接展示；`models/refresh` 上游异常时抛
  `UPSTREAM_ERROR`。

### 数据库

仅一张 `platform_provider` 表，`(userId, platformName)` 唯一。dev 环境 TypeORM `synchronize` 自动建表；结构存档见
`sql/platform_provider.sql`，**真实结构以实体定义为准**。

### 错误码（复用 `common/exceptions/error-code.ts`，未新增）

| 码                       | HTTP | 含义                                    |
| ------------------------ | ---- | --------------------------------------- |
| `2001 UNAUTHORIZED`      | 401  | 缺少/无效/已失效的 token                |
| `3000 VALIDATION_FAILED` | 400  | 入参校验失败（如 `baseUrl` 非 http(s)） |
| `4000 NOT_FOUND`         | 404  | Provider 不存在或非本人                 |
| `4001 CONFLICT`          | 409  | 同名 Provider 已存在                    |
| `5000 UPSTREAM_ERROR`    | 502  | 上游不可达或返回非 2xx                  |

### 已知限制

- `apiKey` 明文存储（按需求选定）；未做静态加密。
- 测连接 / 拉模型只作用于**已保存**的 Provider（按 `:id`），不支持「未保存先测」的草稿校验。
- `models/refresh` 会**整体覆盖** `modelList`（拉取即持久化），非预览。
- `baseUrl` 仅校验 `http(s)://` 前缀，未做更严格的 URL 规范化；`modelList` 上限 200。
- 未写单测（项目当前无测试框架）。

## 多 Agent 管理模块（`src/multiagents/`）

用户「虚拟员工」（Agent）的创建、管理与单 Agent 聊天会话。每个 Agent 归属创建它的用户；同一个 Agent 可以创建多个互不影响的
`AgentSession`。完整设计见 [`doc/agent-manager-spec.md`](../../doc/agent-manager-spec.md)。

### 目录结构

```
src/multiagents/
├── agents.module.ts                  # 装配实体和 controllers
├── agents.controller.ts              # /agents：Agent 配置管理
├── agent-chats.controller.ts         # /agent-chats：单 Agent 聊天会话
├── agent-manager.service.ts          # controller-facing facade，保持对外注入入口稳定
├── live-agent.ts                     # 内存活实例：adapter + busy + abort + lastUsedAt
├── agents/
│   ├── agent-config.service.ts       # Agent 配置 CRUD；Provider/model/vendor 能力校验
│   └── agent-policy.service.ts       # 纯业务规则：能力、颜色/标题、skills/MCP 合并
├── chats/
│   └── agent-chat.service.ts         # AgentSession lifecycle、消息查询、turn 入口委托
├── runtime/
│   ├── agent-runtime.service.ts      # LiveAgent registry、后台 turn、abort、活跃状态
│   └── turn-stream.service.ts        # Redis Stream 广播/回放 + 活跃指针 + 跨实例 abort
├── messages/
│   └── agent-message-history.service.ts # UI 消息与运行步骤的读取/落库/清理
├── workspace/
│   └── agent-workspace.service.ts    # 工作目录、vendor 配置同步、skill 导入
├── entities/
│   ├── agent.entity.ts               # Agent 配置
│   ├── agent-session.entity.ts       # 单 Agent 聊天会话
│   ├── agent-message.entity.ts       # 按 sessionId 隔离的 UI 消息历史
│   └── agent-message-step.entity.ts  # agent 消息的有序运行步骤（thinking/progress/tool/todo）
└── adapter/                          # Claude / Codex -> AgentEvent
    ├── types.ts                      # AgentVendor / AgentEvent / AgentAdapter / AgentAdapterConfig / 能力描述
    ├── capabilities.ts               # 各 vendor 能力矩阵
    ├── claude.ts                     # ClaudeAdapter（Claude Agent SDK）
    ├── codex.ts                      # CodexAdapter（OpenAI Codex SDK）
    └── index.ts                      # 对外导出 + createAgent / getCapabilities 工厂

```

### 模型

- **Agent**（`agent` 表）：可复用配置，包含展示名、头像/颜色标识、vendor、Provider、model、Agent Home、system prompt、skills/MCP/tools 等；不存
  `apiKey/baseUrl`。
- **AgentSession**（`agent_session` 表）：Agent 运行会话；`scope=user` 表示用户显式创建的单聊，`scope=group`
  表示群聊成员内部运行会话。它包含可选 title、会话 cwd、会话私有 home、有效 skills/MCP、SDK 句柄和状态；创建时会把
  Agent Home 下的 vendor 配置同步到会话 cwd。`/agent-chats` 只暴露 `scope=user` 的单聊。`isPinned` 保存跨端置顶状态，
  `archivedAt` 非空时聊天只读，服务端拒绝新的 `converse`。
- **AgentMessage**（`agent_message` 表）：主聊天区可见文本，按 `sessionId` 隔离。
- **AgentMessageStep**（`agent_message_step` 表）：一条 agent 消息产出过程中的有序运行步骤（thinking/progress/tool/todo），以 `messageId` 关联、`seq` 排序；tool 步骤合并 tool_use+tool_result 并存完整 input/output。
- **LiveAgent**（内存）：按 `session.id` 持有 adapter 和 busy 锁。
- **Turn 事件流**（Redis）：一轮对话一条 Redis Stream，承载该轮 `AgentEvent` 的广播与回放；另含会话活跃指针（`SET NX` 跨实例并发锁）与跨实例 abort 控制频道。turn 是与 HTTP 请求解耦的游离后台任务，支撑后台运行与多端实时围观；同一聊天已有活跃 turn 时，新 prompt 会返回 busy，应通过 `activeTurnId` 订阅既存 turn。

### 接口（前缀 `/api`，成功响应统一信封，全部需鉴权）

| 方法       | 路径                                            | 功能                                                                                   |
| ---------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| POST       | `/api/agents`                                   | 创建 Agent 配置，不开聊天                                                              |
| GET        | `/api/agents`                                   | 列出当前用户 AgentList                                                                 |
| GET        | `/api/agents/:agentId`                          | 查询单个 Agent                                                                         |
| PATCH      | `/api/agents/:agentId`                          | 修改 Agent 配置                                                                        |
| DELETE     | `/api/agents/:agentId`                          | 删除 Agent，并删除其全部聊天和消息                                                     |
| POST       | `/api/agent-chats`                              | 创建单 Agent 聊天                                                                      |
| GET        | `/api/agent-chats`                              | 列出当前用户单 Agent 聊天                                                              |
| GET        | `/api/agent-chats/:chatId`                      | 查询聊天详情                                                                           |
| PATCH      | `/api/agent-chats/:chatId`                      | 修改聊天列表状态（`isPinned` / `archived`）                                            |
| GET        | `/api/agent-chats/:chatId/messages`             | 查询聊天消息历史                                                                       |
| POST       | `/api/agent-chats/:chatId/converse`             | 启动一轮对话（后台游离），body 传 prompt，返回 `{ turnId }`；已有活跃 turn 时返回 busy |
| GET `@Sse` | `/api/agent-chats/:chatId/turns/:turnId/events` | 订阅该轮事件流（回放+追尾），遇 `done` 结束                                            |
| POST       | `/api/agent-chats/:chatId/turns/:turnId/abort`  | 中止该轮（跨实例广播）                                                                 |
| POST       | `/api/agent-chats/:chatId/clear`                | 清空聊天句柄和 UI 消息历史                                                             |
| DELETE     | `/api/agent-chats/:chatId`                      | 删除聊天                                                                               |

Agent 可保存头像 data URL/URL、颜色标识与 `capabilitySummary` 能力摘要；未设置头像时，前端用颜色和名称前两个字生成默认头像。能力摘要用于群聊 Orchestrator 判断成员擅长什么，不作为成员运行时 system prompt 注入。创建 Agent 时，`workingDirectory` 必须位于当前用户 `agent_workspace`，`agentHomeDirectory` 必须位于当前用户 `agent_home`；未传 Agent Home 时后端分配到 `agent_home/<agentId>`。创建聊天时 `workingDirectory` 可选；留空时后端分配到当前用户 `agent_workspace/chat-<sessionId>`，会话私有 home 固定在 `session/<sessionId>`。system prompt 不在聊天上设置，运行时继承 Agent。聊天创建时会把 Agent Home 下的 vendor 配置同步到会话 cwd，并把本聊天指定的 skill 文件夹导入到会话工作目录的 vendor skills 目录；skill 来源必须位于当前用户 `skills`。MCP 与 Agent 原配置浅合并。同一 Agent 的不同聊天使用不同 `session.id` busy 锁，因此互不阻塞。

## 服务端目录浏览模块（`src/workspace-fs/`）

桌面端连接远端后端时，不能使用 Electron 本机目录弹窗选择 Agent 工作区。`workspace-fs` 模块提供受 JWT 保护的服务器目录浏览 API，只返回当前登录用户文件空间内的一级子目录，用于选择 Agent Home、单聊工作目录、群聊共享工作区与 skill source folders。

### 接口（前缀 `/api`，成功响应统一信封，全部需鉴权）

| 方法 | 路径                                                 | 功能                                                           |
| ---- | ---------------------------------------------------- | -------------------------------------------------------------- |
| GET  | `/api/workspace-fs/roots`                            | 列出当前用户允许浏览的服务器目录根                             |
| GET  | `/api/workspace-fs/directories?path=<absolute path>` | 列出某个服务器目录下的一级子目录；`path` 省略时返回第一个 root |

安全边界：

- 可浏览根目录由 `AGENTHUB_USER_SPACE_ROOT` 派生，当前用户只能看到自己的 `skills`、`agent_home`、`agent_workspace`。
- 后端会对请求路径和 root 做 `realpath()` 后再校验归属，避免 `..` 与符号链接越界。
- API 只浏览目录，不提供上传、删除、重命名。新目录仍可在前端手动输入路径，但创建 Agent/聊天/群聊时会再次校验必须位于当前用户对应目录内。

一轮对话（turn）启动后即在服务端游离运行，与发起请求解耦：发起端切走/关窗/断连只取消订阅，turn 继续跑到结束；任意端可订阅 `turns/:turnId/events` 回放+实时追尾同一轮，实现多端围观；`AgentChatView.activeTurnId` 暴露当前活跃轮，桌面端会在聊天列表加载/刷新后订阅所有活跃轮，并在列表显示运行标志。相关环境变量：`AGENT_RECLAIM_ON_BOOT`（默认开，进程重启清理残留活跃指针；多实例部署应设 `false`）和 `AGENT_TURN_TIMEOUT_MS`（默认 30 分钟，超时会 abort 当前 turn 并向订阅端发送 `error` + `done`，释放活跃指针）。

### 数据库与限制

四张表 `agent` / `agent_session` / `agent_message` / `agent_message_step`，均按 `userId`（步骤表按 `sessionId`）隔离。dev 环境 TypeORM `synchronize` 自动建表；结构存档见
`sql/agent_manager.sql`，**真实结构以实体定义为准**。

已知限制：聊天消息历史暂不分页；运行步骤已持久化但 tool 的 input/output 暂无展开 UI；clear 不删除 SDK 已落盘的旧会话文件；Codex 无显式 dispose API，仍依赖实例上限和 GC。（群聊协作见下文「群聊协作模块」。）

## 群聊协作模块（`src/multiagents/group/`）

把多个已有 Agent 拉进同一会话，围绕一块**黑板（Blackboard）**和一个**共享 git 工作区**协作，由独立内置的 **Orchestrator** 自动拆解/串行分派/聚合汇报。与单聊同域，复用单聊适配层 + 消息历史 + Provider 凭证解析。完整设计见 [`doc/context/群聊上下文管理设计方案.md`](../../doc/context/群聊上下文管理设计方案.md)，Spec 见 [`doc/spec/group-chat-collaboration-mvp.md`](../../doc/spec/group-chat-collaboration-mvp.md)。

### 目录结构

```
src/multiagents/group/
├── group-chat.module.ts            # 装配本域全部实体/服务/控制器，接入根模块
├── group-chat.controller.ts        # /group-chats：管理 + 会话(converse/SSE/abort) + 黑板只读
├── group-chat.manager.ts           # 对外门面（控制器只依赖它）
├── group-chat.service.ts           # 建群/管理 + 共享工作区编排 + 装载助手
├── group-message.service.ts        # 展示层 presentation_log 读写
├── group-workspace.service.ts      # 共享 git 仓库：init / worktree add / merge / diff / ACTIVE 标记
├── entities/                       # group_chat / group_chat_member / group_message / group_run
├── blackboard/
│   ├── blackboard.service.ts       # 乐观锁 / decision supersede / contract owner 保护 / event / summarize
│   └── entities/                   # blackboard_artifact / _decision / _contract / _task / _event
├── memory/
│   ├── agent-memory.service.ts     # 跨任务私有记忆：retrieve(scope) / writeCandidate(去重) / markStale
│   └── entities/agent-memory-item.entity.ts
├── context/
│   └── context-assembler.service.ts # 按检索优先级 + 预算装配单次派发上下文（A/B/C）
├── debug/
│   └── group-debug-logger.service.ts # 群聊运行时结构化 debug 日志（脱敏 + 长文本截断）
├── routing/
│   ├── message-router.service.ts   # 纯机械解析 @ → routeKind（不调 LLM）
│   └── continuity-resolver.service.ts # 再次修改场景 A/B/C 判定（热 buffer + 强指代 + 产出物匹配）
├── run/
│   ├── group-run-stream.service.ts # 群运行事件流（Redis Stream，沿用 turn-stream 范式）
│   ├── orchestrator-planner.ts     # OrchestratorPlanner 接口 + LLM 默认实现（测试可注入假 Planner）
│   ├── orchestrator.service.ts     # 出计划 → 写 task_graph + 发 task-list → 聚合汇报
│   ├── dispatch.service.ts         # 单次派发：装配→worktree→跑 turn→git diff 代写黑板→处理报告
│   └── group-run.executor.ts       # converse 入口 + 串行编排一次群运行 + abort
├── dto/                            # create/update/converse 入参 + 各 view 的 OpenAPI 文档类
└── mappers/                        # 实体 → 视图（group-chat / group-message / blackboard / memory）
```

### 接口（前缀 `/api`，统一信封，全部需鉴权）

| 方法       | 路径                                                            | 功能                                                                                               |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| POST       | `/api/group-chats`                                              | 建群（成员 + Orchestrator 配置 + projectMeta；可传 `workspaceDir`，未传则后端分配；后端 git init） |
| GET        | `/api/group-chats`                                              | 列出当前用户群聊                                                                                   |
| GET        | `/api/group-chats/:id`                                          | 群详情（成员/Orchestrator/projectMeta/activeRunId）                                                |
| PATCH      | `/api/group-chats/:id`                                          | 改标题 / projectMeta / 加成员 / 修改列表状态（`isPinned` / `archived`）                            |
| DELETE     | `/api/group-chats/:id`                                          | 删群（级联删数据库记录；工作区 `ACTIVE=false`，不删除目录）                                        |
| GET        | `/api/group-chats/:id/messages`                                 | 展示层消息历史（升序，多发言者）                                                                   |
| POST       | `/api/group-chats/:id/converse`                                 | 发消息启动群运行（后台游离），body `{text,mentions?}` → `{runId}`                                  |
| GET `@Sse` | `/api/group-chats/:id/runs/:runId/events`                       | 订阅群运行事件流（回放+追尾 `GroupRunEvent`，遇 done 结束）                                        |
| POST       | `/api/group-chats/:id/runs/:runId/abort`                        | 中止整个群运行（跨实例广播）                                                                       |
| GET        | `/api/group-chats/:id/blackboard`                               | 黑板状态快照                                                                                       |
| GET        | `/api/group-chats/:id/blackboard/artifacts/:artifactId/preview` | 读取黑板产出物对应工作区文件的预览内容                                                             |
| GET        | `/api/group-chats/:id/blackboard/events`                        | 黑板事件流（审计/调试，分页）                                                                      |

> 协作动作（`dispatch_agent` / `report_completion` / `blackboard_write`）是**服务端内部协议**，不暴露为用户 REST：成员输出结构化 `report`，服务端基于 git diff 代写黑板。

### 运行与并发

- 一次群运行 = 一条 Redis Stream（`GroupRunStream`，按单聊 `TurnStream` 范式），成员 turn 事件经 `member_turn_event` 透传，天然多端围观；活跃指针 `SET NX` 做「群」级跨实例互斥（已有活跃轮 → 返回冲突，引导用 `activeRunId` 围观）。
- 群聊主体保存 `isPinned` 与 `archivedAt`：置顶状态跨端一致；`archivedAt` 非空或 `status=archived` 时群聊只读，服务端拒绝新的 `converse`。
- 成员干活复用单聊适配层（`createAgent` + `agentToConfig`）和 `scope=group` 的成员内部 `AgentSession`，`workingDirectory` 指向该任务的 git worktree；私有 L1 落 `agent_message` / `agent_message_step`，但不会进入 `/agent-chats` 单聊列表。轻量成员聊天（例如打招呼、给一句观点）走 `memberTurns`，真实调用成员 Agent，但不创建黑板 task、不建 worktree、不做 report/diff。
- 成员 task 成功返回后，会先经过 Orchestrator 的隐藏交接判断（不写展示消息、不推 `orchestrator_report`）：若成员实际是在用普通文本向用户澄清/提问，即使没有按 `report.awaiting_user_input` 格式声明，也会把该 task 标为 `waiting_input`，下游 task 不启动，群运行静默等待用户回复。
- 多阶段任务会在每阶段 task graph 全部完成后做有限续编排：服务端把阶段结果交回 Orchestrator 判断原始需求是否已真正交付；若前一阶段只是 PRD/方案/调研，会继续派发实现/验证等下游任务，避免前置规划完成后提前收尾。
- 最终汇报默认先调用 Orchestrator 最终审查器，读取黑板摘要与可安全预览的文本/HTML 产物，对照原始需求和任务状态确认完成、失败、阻塞或等待输入；只有审查器调用失败时才退回模板拼接。全成功但审查发现缺口时，会继续派发后续任务，直到审查通过或达到续编排上限。
- 共享工作区：创建群聊时可传 `workspaceDir`，但必须位于当前用户 `agent_workspace`；未传时分配到当前用户 `agent_workspace/group-<groupId>`。成员 task worktree、成员 SDK home、Orchestrator SDK home 都挂在共享仓库下的 `.agenthub/groups/<groupId>/`，因此 `.codex` / `.claude` 等运行态会出现在群聊项目工作区目录树内。建群写 `ACTIVE=true`，删除群聊只把共享仓库根的 `ACTIVE` 改成 `false`，任何情况下都不删除目录。
- 环境变量：`AGENTHUB_USER_SPACE_ROOT`（用户文件空间总根）、`GROUP_RECLAIM_ON_BOOT`（默认开，重启清理残留活跃轮；多实例应设 `false`）、`GROUP_MAX_ORCHESTRATION_STAGES`（默认 `4`，限制同一群运行内的续编排阶段数）、`GROUP_DEBUG_LOGS`（默认开，输出群聊运行时 debug 日志；生产可设 `false`）、`GROUP_DEBUG_LOG_MAX_CHARS`（默认 `4000`，控制单个长文本字段截断长度）。
- Debug 日志：`GroupDebugLogger` 会输出结构化 JSON，覆盖用户输入、路由结果、Orchestrator prompt/输出/任务分配、黑板快照、ContextAssembler trace、每个成员 Agent 收到的 prompt、memory 检索/保留/丢弃、turn 事件、report、git diff、黑板更新与 hot buffer。日志会递归脱敏 `apiKey` / `token` / `secret` / `password` 等字段。

### Orchestrator Planner

`OrchestratorPlanner` 可注入（`ORCHESTRATOR_PLANNER` 令牌）。默认使用 `LlmOrchestratorPlanner`，按群聊保存的 vendor/model/provider + 内置 prompt 产 JSON 计划；Orchestrator 自身会把 Claude Code/Codex SDK 会话 id 持久化到内部字段 `group_chat.orchestratorSessionId`，后续群运行用 `resumeWith()` 恢复同一编排会话，因此可接住「上一轮追问、下一轮短答」这类连续对话。问候/闲聊/状态询问/澄清讨论等非任务消息可返回 `tasks: []` + `note`，由 Orchestrator 直接回复且不写黑板任务/不派发成员。续编排检查中的 `tasks: []` 只表示后续工作已结束，不会额外发 Orchestrator 文本，最终由最终审查器验收并统一收尾。Orchestrator 不允许代替成员 Agent 发言；当用户需要某个成员本人给出观点或问候、且无需工具/文件产出时，Planner 返回 `memberTurns`，服务端真实调用成员 Agent 做轻量回复；只有需要交付文件、执行命令或写入黑板协作状态时才创建 task。Planner 还可返回 `contextUpdates`，服务端会把已确认的项目目标/技术栈/阶段写回 `projectMeta`，把明确的用户选择写成已批准黑板决策。LLM 调用失败或输出非法时如实返回上游错误，不静默降级成规则分派。测试场景可覆盖该 token 注入假 Planner / 假最终审查器 / 假交接审查器。

### 数据库与测试

- 10 张表（`group_chat` / `group_chat_member` / `group_message` / `group_run` / `blackboard_artifact` / `blackboard_decision` / `blackboard_contract` / `blackboard_task` / `blackboard_event` / `agent_memory_item`），dev 环境 TypeORM `synchronize` 自动建表，按 `userId` / `groupChatId` 隔离。
- 单元测试：`pnpm -F @agenthub/server test`（`tsx + node:test`），覆盖群聊编排的多阶段续编排、最终审查缺口继续派发，以及上游成员普通文本提问时挂起下游的路径；其它模块测试可继续按相同模式补充。

### 已知限制（本轮 MVP）

串行执行（无 DAG 并行）；冲突仅「天然规避」无检测/仲裁；失败仅「如实汇报并停止」无重试/降级；契约升级仅「拒绝+上报」；记忆仅轻量去重；黑板无 `open_issues`/`risks`、artifacts 无 hash/tags/deps；无 `context_trace`；安全仅最小原则；任务面板只读；建群+单@直派的端到端 happy path 依赖在线 MySQL/Redis/真实 SDK，未纳入自动化 e2e。详见 spec 的 `Known Limits` 与「实现说明」。

## 下一步建议

1. 在 `packages/shared` 里定义后端要暴露的接口契约，让 `apps/server` 直接 `import` 复用类型。
2. 新建第一个业务 Module（如 `chat/`），用 `@Entity` + `Repository` 写一条增删改查跑通链路。
