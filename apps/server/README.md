# @agenthub/server

AgentHub 后端服务，基于 **NestJS** 构建。

## 目录结构

```
apps/server/
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── .env.example
└── src/
    ├── main.ts                    # 引导入口，全局 ValidationPipe + /api 前缀
    ├── app.module.ts              # 根模块：装配 Config / TypeORM / Redis
    ├── redis/
    │   └── redis.module.ts        # @Global Redis 模块，导出 REDIS_CLIENT token
    └── health/
        ├── health.controller.ts   # GET /api/health
        └── health.service.ts      # 同时探测 MySQL & Redis
```

## 关键依赖（对应 Java 概念）

| 依赖 | 作用 | Spring 类比 |
|---|---|---|
| `@nestjs/core` `@nestjs/common` `@nestjs/platform-express` | NestJS 核心 + Express 适配 | `spring-boot-starter-web` |
| `@nestjs/config` | `.env` / 配置注入 | `application.yml` + `@Value` |
| `@nestjs/typeorm` `typeorm` `mysql2` | ORM + MySQL 驱动 | `spring-data-jpa` + `mysql-connector-j` |
| `ioredis` | Redis 客户端 | `Lettuce` / `Jedis` |
| `class-validator` `class-transformer` | DTO 校验/转换 | `Hibernate Validator` |
| `reflect-metadata` | 装饰器元数据 | 由 Spring AOP 内部处理 |

## 常用命令

```bash
pnpm -F @agenthub/server dev         # nest start --watch（热重载）
pnpm -F @agenthub/server build       # nest build → dist/
pnpm -F @agenthub/server start:prod  # node dist/main.js
pnpm -F @agenthub/server typecheck
```

## 环境变量

复制 `.env.example` → `.env`（或 `.env.local`），按需填写 `MYSQL_*` / `REDIS_*`。

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

## 下一步建议

1. 在 `packages/shared` 里定义后端要暴露的接口契约，让 `apps/server` 直接 `import` 复用类型。
2. 新建第一个业务 Module（如 `chat/`），用 `@Entity` + `Repository` 写一条增删改查跑通链路。
