# 跨模块复用 JwtAuthGuard 时启动报 DI 解析失败

## 现象

后端启动直接挂在 NestJS 依赖注入阶段（还没连 MySQL 就报错）：

```
ERROR [ExceptionHandler] UnknownDependenciesException: Nest can't resolve dependencies
of the JwtAuthGuard (?, UserRepository). Please make sure that the argument TokenService
at index [0] is available in the PlatformProviderModule module.
```

- 报错点是 `PlatformProviderModule`（`AgentsModule` 同理，只是模块初始化顺序先撞上前者）。
- `UserModule` 自己的 `UserController` 用同一个 `@UseGuards(JwtAuthGuard)` 却没事。

## 原因

`JwtAuthGuard` 自身有两个注入依赖：`TokenService` 和 `User` 仓储。

```ts
constructor(
    private readonly tokenService: TokenService,
    @InjectRepository(User) private readonly userRepo: Repository<User>
) {}
```

`UserModule` 当时只 `exports: [JwtAuthGuard]`，**没导出这两个依赖**。

当别的模块导入 `UserModule` 并用 `@UseGuards(JwtAuthGuard)` 时，Nest 会在**消费方模块的注入上下文**里实例化这个 guard，于是要在那里解析 `TokenService` —— 但它没被导出，解析失败。`UserModule` 内部用它没问题，是因为 `TokenService`、`User` 仓储在本模块就是直接可见的 provider。

## 修复

`apps/server/src/user/user.module.ts` —— 把 guard 需要的依赖一并导出（导出 `TypeOrmModule` 即可把 `forFeature([User])` 注册的仓储再导出）：

```ts
exports: [JwtAuthGuard, TokenService, TypeOrmModule]
```

改完后三个业务模块全部初始化成功、路由全部 mapped、`Nest application successfully started`。

## 以后如何避免

- **导出一个 provider 给别的模块用时，记得连它的依赖一起对外可见。** guard / interceptor / pipe 这类带注入依赖、又会被 `@UseGuards` 等在其它模块引用的 provider 尤其容易踩 —— 它们是在消费方上下文里实例化的，光导出 guard 本身不够。
- 经验法则：看 guard 构造函数注入了什么，那些就都得能在「会用到这个 guard 的模块」里解析到（要么由本模块导出，要么消费方自己已具备）。
- 新增一个「整体挂 guard」的 Controller 后，**起一次服务确认能启动**，别只靠 typecheck —— 这类 DI 装配错误编译期发现不了，只在运行时（`nest start`）暴露。
