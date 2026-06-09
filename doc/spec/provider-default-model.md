# Provider 默认模型

> 为 `platform-provider` 模块增加“用户默认 Provider + 默认模型”能力。目录涉及 `apps/server/src/platform-provider/`、`packages/shared/src/provider.ts`，以及桌面端 Provider/Agent/Group 创建表单。

## Context

`ChatClient` 本身不保存任何凭证；调用方必须传入 `providerType`、`apiKey`、`baseUrl` 和 `model`。目前这些值来自明确选择的 Provider 引用，例如群聊 handoff review 通过 `PlatformProviderService.resolveRuntimeConfig(userId, group.orchestratorProviderId)` 读取群聊配置里的 Provider。

当前 Provider 管理只有“存储供应商配置”的能力，没有用户级默认 Provider/模型。结果是创建 Agent 或群聊 Orchestrator 时，前端只能让用户每次手动选择 Provider 和模型。新增默认值后，用户可以在新增或编辑 Provider 时把某个 Provider 设置为默认，并指定默认模型；后续创建 Agent / 群聊时用该默认值预填。

## Model

在 `platform_provider` 表新增字段：

- `isDefault`：boolean，默认 `false`。表示该 Provider 是否为当前用户默认 Provider。
- `defaultModel`：nullable varchar(128)。该 Provider 被设为默认时使用的默认模型名。

约束语义：

- 每个 `userId` 最多只有一个 `isDefault=true` 的 Provider。
- 该唯一性由服务层事务保证：设置某条 Provider 为默认时，先将同用户其他 Provider 的 `isDefault=false, defaultModel=null`。
- 不新增独立默认配置表，避免把 Provider 凭证与默认模型拆散；默认模型随 Provider 生命周期一起维护。
- 删除默认 Provider 后，该用户不再有默认 Provider；服务端不自动挑选替代项。
- 若 `modelList` 非空，`defaultModel` 必须存在于 `modelList`。
- 若 `modelList` 为空，允许 `defaultModel` 为任意非空字符串，保持与现有 Agent/Group 模型校验规则一致。

实体与对外视图：

- `PlatformProvider` 增加 `isDefault` / `defaultModel` 字段。
- `PlatformProviderView` 返回 `isDefault` / `defaultModel`，不返回任何 apiKey 明文。
- `ProviderRuntimeConfig` 不强制携带默认信息；默认解析新增独立服务方法。

## Backend API

不新增必需 REST 路由，复用现有 Provider CRUD：

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/platform-providers` | 创建 Provider；可传 `isDefault` 与 `defaultModel` |
| `PATCH` | `/api/platform-providers/:id` | 更新 Provider；可设置或取消默认 |
| `GET` | `/api/platform-providers` | 列表返回 `isDefault` / `defaultModel`，默认 Provider 可排在前面 |
| `GET` | `/api/platform-providers/:id` | 详情返回 `isDefault` / `defaultModel` |

DTO 变化：

- `CreatePlatformProviderDto`
  - `isDefault?: boolean`
  - `defaultModel?: string | null`
- `UpdatePlatformProviderDto`
  - `isDefault?: boolean`
  - `defaultModel?: string | null`

服务方法补充：

- `PlatformProviderService.resolveDefaultRuntimeConfig(userId)`：返回当前用户默认 Provider 的运行时配置与默认模型；无默认时抛 `NOT_FOUND`。

## Runtime Flow

创建 Provider：

1. 校验 `platformName` 唯一。
2. 解析 `modelList`。
3. 如果 `isDefault=true`：
   - 校验 `defaultModel` 非空。
   - 若 `modelList` 非空，校验 `defaultModel` 在 `modelList` 中。
   - 在事务内清除同用户其他默认 Provider。
   - 保存当前 Provider 为默认。
4. 如果 `isDefault` 未传或为 `false`：
   - `defaultModel` 忽略或保存为 `null`。

更新 Provider：

1. 取当前用户拥有的 Provider。
2. 计算更新后的有效 `modelList`、`isDefault`、`defaultModel`。
3. 如果设置为默认，按创建逻辑校验并清除同用户其他默认 Provider。
4. 如果取消默认，将当前 Provider 的 `isDefault=false, defaultModel=null`。
5. 如果当前 Provider 已是默认且更新 `modelList`，必须保证 `defaultModel` 仍合法，否则拒绝更新。

桌面端：

1. Provider 新增/编辑弹窗增加“设为默认 Provider”开关。
2. 开启后显示默认模型输入/选择：
   - `modelList` 有值时优先用下拉选择。
   - `modelList` 为空时允许文本输入模型名。
3. Provider 列表/详情标记默认 Provider 和默认模型。
4. 创建 Agent 时，若当前 vendor 兼容默认 Provider，则预填 `platformProviderId` 与 `model`。
5. 创建群聊时，Orchestrator 的 vendor/provider/model 也按默认 Provider 预填；若默认 Provider 与默认 vendor 不兼容，则根据默认 Provider 自动切换 vendor。

## Validation

- 后端单测：
  - 创建默认 Provider 会清除同用户旧默认。
  - `modelList` 非空时，`defaultModel` 不在列表内会失败。
  - 更新默认 Provider 的 `modelList` 导致默认模型失效会失败。
  - 删除默认 Provider 后列表中无默认项。
  - `resolveDefaultRuntimeConfig` 返回明文运行时配置和默认模型，且按 `userId` 隔离。
- 前端类型检查：
  - `PlatformProviderView` / create / update payload 与 shared contract 对齐。
- 最小命令：
  - `pnpm -F @agenthub/server typecheck`
  - `pnpm -F @agenthub/server test`
  - `pnpm -F @agenthub/desktop typecheck`

## Known Limits

- 快速开发阶段不考虑存量生产迁移脚本；dev 环境继续依赖 TypeORM `synchronize`，同时更新 `apps/server/sql/platform_provider.sql` 作为结构存档。
- 默认 Provider 是用户级唯一，不按 `claude` / `codex` 分别维护多个默认项。需要分 vendor 默认时可后续扩展为 `defaultScope` 或独立默认配置表。
- 默认值只做创建表单预填，不会自动改写已有 Agent、已有群聊或正在运行的任务。
- 如果 Provider 的模型列表为空，服务端允许默认模型为任意非空字符串；实际上游是否支持仍由运行时调用决定。
