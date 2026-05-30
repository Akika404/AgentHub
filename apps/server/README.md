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
    ├── mutiagents/               # 多 Agent 管理（AgentManager）：spec + 会话句柄 + vendor adapter
    └── user/                     # 用户管理 + JWT 认证基座（详见下文「用户管理模块」）
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

## 下一步建议

1. 在 `packages/shared` 里定义后端要暴露的接口契约，让 `apps/server` 直接 `import` 复用类型。
2. 新建第一个业务 Module（如 `chat/`），用 `@Entity` + `Repository` 写一条增删改查跑通链路。
