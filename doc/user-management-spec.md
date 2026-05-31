# 用户管理模块（后端）实现方案

## Context

`apps/server` 本次新增"用户管理"模块，提供注册、登录、退出登录(sign-out)、注销账号(逻辑删除)、获取用户信息五项能力，并从零搭建一套可复用的 JWT 认证基座。

设计依据已与用户确认的三项决策：
1. **凭证机制 = 纯 JWT 无状态**（access token 放 `Authorization: Bearer`）。
2. **退出登录 = 加 sign-out 接口 + 服务端 token 失效**：无状态 JWT 要服务端失效，须引入按 `jti` 的黑名单存储 → **启用项目内现已停用的 Redis 模块**。
3. **逻辑删除 = `status` 枚举列**（`active` / `deactivated`），与现有 `AgentSession.status` 约定一致，不用 `deletedAt`。

模块结构完全对照现有 `mutiagents`（Controller → Service → Repository/Entity + Mapper + 三类 DTO 分离），并遵循 `apps/server/CLAUDE.md`：DTO 与 Entity 分离、错误统一经 `BusinessException` 抛出、响应用 `@ApiEnvelope` 出文档。**注意 ESM：所有相对 import 带 `.js` 后缀。**

## 功能与接口设计（前缀 `/api`）

| 方法 | 路径 | 功能 | 鉴权 |
|---|---|---|---|
| POST | `/api/user/register` | 注册（account + password） | 否 |
| POST | `/api/user/login` | 登录，返回 token + 用户视图 | 否 |
| POST | `/api/user/logout` | 退出登录，当前 token 加黑名单 | 是 |
| GET | `/api/user/me` | 获取当前用户信息 | 是 |
| DELETE | `/api/user/me` | 注销账号（status→deactivated，并使当前 token 失效） | 是 |

- `account` = 登录名（唯一、不可变）；`nickname` = 展示名；`email`/`avatar` 注册后可选补充。注册入参仅 `account` + `password`。
- 注册**不自动登录**，返回用户视图；登录单独换取 token。

## 新增文件结构（`apps/server/src/user/`）

```
user/
  user.module.ts          # TypeOrmModule.forFeature([User]) + JwtModule.registerAsync；声明 controller/service/guard/token，导出 JwtAuthGuard 供未来其他模块复用
  user.controller.ts      # @ApiTags('user') @Controller('user')；薄控制器，委派 service
  user.service.ts         # register / login / logout / deactivate / getMe 全部业务逻辑 + DB 访问
  entities/
    user.entity.ts        # @Entity('user')
  dto/
    register.dto.ts       # class-validator 入参
    login.dto.ts          # class-validator 入参
    user-view.dto.ts      # interface：UserView / LoginResult（对外契约，唯一真源）
    user-response.dto.ts  # Swagger class，implements 上面 interface（仅出文档）
  mappers/
    user.mapper.ts        # toUserView(user)：剥离 passwordHash，Date→ISO
  auth/
    token.service.ts        # 签发/校验 JWT、jti 生成、黑名单读写（注入 REDIS_CLIENT + JwtService）
    jwt-auth.guard.ts       # CanActivate：解析 Bearer→校验→查黑名单→载入 user→校验 status，挂到 req.user
    current-user.decorator.ts  # @CurrentUser() 取 req.user
    auth.types.ts          # JwtPayload { sub, jti, iat, exp }
```

## 实体 `user.entity.ts`

沿用现有约定（UUID 主键、camelCase 列、`@CreateDateColumn`/`@UpdateDateColumn`、varchar 状态列）：

- `id` `@PrimaryGeneratedColumn('uuid')`
- `account` `@Column varchar(64)` + `@Index({ unique: true })`
- `passwordHash` `@Column({ type: 'varchar', length: 100, select: false })` — **`select: false` 防御性默认不加载**（类比 Spring 的 `@JsonIgnore` + 显式查询）；登录时用 `addSelect`/`select` 显式取。
- `nickname` `@Column varchar(64) nullable`
- `email` `@Column varchar(255) nullable` + `@Index({ unique: true })`（MySQL 唯一索引允许多个 NULL）
- `avatar` `@Column varchar(1024) nullable`（URL 或 data URL）
- `status` `@Column({ type: 'varchar', length: 16, default: 'active' })`，类型 `UserStatus = 'active' | 'deactivated'`
- `createdAt` / `updatedAt`

`synchronize`（非 prod）会自动建表，无需迁移。

## 库表设计（`user` 表）

实体即真源；下方 DDL 为等价结构，定稿后落到 `apps/server/sql/user_management.sql`（存档/参考用，与 `agent_manager.sql` 同约定：utf8mb4、InnoDB、camelCase 列名、`datetime(6)` 微秒时间戳）。本次只新增 **一张表**（登录态/黑名单等不落库，走 Redis 或无状态 token）。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `varchar(36)` | PK | UUID，应用生成 |
| `account` | `varchar(64)` | NOT NULL, UNIQUE | 登录名，唯一、不可变 |
| `passwordHash` | `varchar(100)` | NOT NULL | bcrypt 哈希；实体侧 `select:false` 默认不查出 |
| `nickname` | `varchar(64)` | NULL | 展示名 |
| `email` | `varchar(255)` | NULL, UNIQUE | 可空且唯一（MySQL 唯一索引允许多个 NULL） |
| `avatar` | `varchar(1024)` | NULL | 头像 URL 或 data URL |
| `status` | `varchar(16)` | NOT NULL, DEFAULT `'active'` | `active` / `deactivated`（逻辑删除） |
| `createdAt` | `datetime(6)` | NOT NULL, DEFAULT `CURRENT_TIMESTAMP(6)` | 创建时间 |
| `updatedAt` | `datetime(6)` | NOT NULL, DEFAULT `CURRENT_TIMESTAMP(6)` ON UPDATE | 更新时间 |

```sql
CREATE TABLE `user` (
  `id`           varchar(36)   NOT NULL COMMENT '主键，UUID',
  `account`      varchar(64)   NOT NULL COMMENT '登录名，唯一不可变',
  `passwordHash` varchar(100)  NOT NULL COMMENT 'bcrypt 哈希，绝不存明文',
  `nickname`     varchar(64)   DEFAULT NULL COMMENT '展示名',
  `email`        varchar(255)  DEFAULT NULL COMMENT '邮箱，可空且唯一',
  `avatar`       varchar(1024) DEFAULT NULL COMMENT '头像 URL / data URL',
  `status`       varchar(16)   NOT NULL DEFAULT 'active' COMMENT 'active / deactivated',
  `createdAt`    datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt`    datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_user_account` (`account`),
  UNIQUE KEY `UQ_user_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

## 业务逻辑要点（`user.service.ts`）

- **register**：先 `findOne({ where: { account } })` 预检唯一（命中→`BusinessException.conflict('账号已存在')`，DB 唯一索引作兜底）；`bcrypt.hash(password, 10)`；`repo.create/save`，`status:'active'`；返回 `toUserView`。
- **login**：按 `account` 查（**显式 select passwordHash**）。用户不存在 / 已注销 / `bcrypt.compare` 失败 → 统一抛 `INVALID_CREDENTIALS`（**不泄露是哪一项错**）。成功 → `tokenService.sign(userId)` 得到含 `jti` 的 token → 返回 `LoginResult { token, expiresIn, user: UserView }`。
- **logout**：从守卫注入的 payload 取 `jti` + `exp`，写 Redis 黑名单键 `auth:blacklist:<jti>`，TTL = `exp - now`。返回 `{ success: true }`。
- **deactivate（注销账号）**：`repo.update({ id }, { status: 'deactivated' })`，并把当前 token 加黑名单（即时下线）。返回 `{ deactivated: true }`。
- **getMe**：直接由守卫已载入的 user 经 mapper 返回。

## 认证基座

- **TokenService**：`JwtService.signAsync({ sub: userId }, { jwtid: <crypto.randomUUID()> })`；`verifyAsync` 解析；`isBlacklisted(jti)` / `blacklist(jti, ttl)` 走 `REDIS_CLIENT`。
- **JwtAuthGuard**（`@Injectable()` implements `CanActivate`）：取 `Authorization: Bearer`；缺失/校验失败 → `BusinessException.unauthorized()`；`jti` 命中黑名单 → `unauthorized()`；按 `sub` 载入用户，缺失或 `status!=='active'` → `unauthorized()`/`ACCOUNT_DEACTIVATED`；将 `{ user, payload }` 挂到 `req`。
- 受保护路由用 `@UseGuards(JwtAuthGuard)`。

## 复用与改动的现有文件

- `apps/server/src/common/exceptions/error-code.ts`：新增 `INVALID_CREDENTIALS = 2003`（401）、`ACCOUNT_DEACTIVATED = 2004`（403），并在 `ERROR_CODE_HTTP_STATUS` 加映射。注册/邮箱冲突复用 `CONFLICT(4001)`，token 缺失/失效复用 `UNAUTHORIZED(2001)`。
- `apps/server/src/common/exceptions/business.exception.ts`：补静态工厂 `invalidCredentials()`、`accountDeactivated()`（与现有 `notFound`/`conflict` 风格一致）。
- `apps/server/src/app.module.ts`：取消 `RedisModule` 注释（启用），`imports` 加入 `UserModule`。
- `apps/server/src/redis/redis.module.ts`：复用现成 `REDIS_CLIENT` provider，无需改动。
- 复用现成基建：全局 `ValidationPipe`、`ResponseInterceptor`（信封）、`AllExceptionsFilter`、`@ApiEnvelope`、`@ApiTags/@ApiOperation`。

## 依赖与配置

- 新增依赖：`bcrypt` + `@types/bcrypt`（哈希）、`@nestjs/jwt`（签发/校验）。
- `.env` 新增：`JWT_SECRET`、`JWT_EXPIRES_IN`（如 `7d`）。Redis 已有 `REDIS_*` 变量。

## 文档与一致性

- 实体定稿后补 `apps/server/sql/user_management.sql`（仅存档/参考，与 `agent_manager.sql` 同约定）。
- 可选 follow-up（本次后端范围外）：`packages/shared` 已有 `CurrentUser` UI 契约，待前后端联调时再对齐；本次不动前端。

## 验证

项目无测试设施（无 jest/vitest），按 `coding_rules` 不强制建测试栈。验证方式：

1. `pnpm -F @agenthub/server typecheck` — 类型必须通过。
2. 启动依赖：本地 MySQL（`agent_hub` 库）+ Redis；`pnpm -F @agenthub/server dev`（dev 下 `synchronize` 自动建 `user` 表）。
3. 经 Scalar UI（`/api/reference`）或 curl 端到端走查：
   - 注册 → 登录拿 token → 带 token 调 `GET /api/user/me` 成功；不带 token → 2001。
   - `POST /api/user/logout` 后，旧 token 再调 `/api/user/me` → 2001（黑名单生效）。
   - `DELETE /api/user/me` 后，该账号再登录 → `INVALID_CREDENTIALS`（已注销）。
   - 重复注册同 `account` → `CONFLICT`。

## 待确认/已知限制

- 注册不自动登录（如需自动登录返回 token，可在 register 末尾复用 login 逻辑）。
- 账号注销为逻辑删除，`account`/`email` 仍占用唯一索引（不可同名重注册）——如需释放需另行约定。
- 未做登录失败次数限制 / 验证码 / 密码找回，超出本次范围。
