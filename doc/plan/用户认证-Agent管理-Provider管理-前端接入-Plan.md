# 前端 - 用户认证 / Agent 管理 / Platform-Provider 管理接入

## Context

后端的「用户登录、Agent 添加、platform-provider 管理」三个模块（NestJS）已完成，接口见 `apps/server/README.md`。当前桌面端（Electron + Vue 3）的渲染层只对接了一个本地 mockApi（`apps/desktop/src/renderer/src/api/`），没有真实网络层、没有登录态、没有视图切换——App.vue 无论 nav 是什么都只渲染聊天界面。

本次目标：把 auth / agents / providers 三个模块接到真实后端，并补齐对应界面：
- 注册 / 登录 / 退出登录界面，右上角（侧边栏）头像弹出菜单（更新昵称 / 更换头像 / 退出登录）。
- 侧边栏第二项「Agent 管理」：左列 Agent 列表，右侧选中后的详情（system prompt / skills / mcp / vendor / model / PlatformProvider 等）+ 新建 / 删除。
- 设置页（左下角设置按钮进入）：左侧设置侧栏含「PlatformProvider」项，选中后右侧再分两栏——左栏 Provider 列表（可添加），右栏选中 Provider 的详情（baseUrl、modelList、测连接、刷新模型、编辑、删除）。

聊天界面保持 mock 不动（后端聊天模块不在本次范围）。

## 已确认的决策

1. **传输层**：渲染进程默认受 CORS 限制、后端未开 CORS → 走主进程 IPC 代理（暴露单一 `api:request` 通道，主进程用 Node fetch 调后端）。无需后端改 CORS，契合 CLAUDE.md 的 IPC 架构。
2. **Agent 详情字段缺口**：后端 AgentView 当前不返回 `systemPrompt` / `skills` / `mcpServers` / `allowedTools`。用户将去后端补这些字段。本次以 `packages/shared` 里的 `AgentView` 作为契约（按 server CLAUDE.md：shared types 即契约），前端按完整字段实现。
3. **Agent 范围**：列表 + 详情 + 创建 + 删除（完整 CRUD）。
4. **聊天**：保持现有 mock。

> ⚠️ **需要后端配合的改动（用户负责）**
>
> 扩展 `apps/server/src/mutiagents/dto/agent-view.dto.ts` 的 `AgentView`，新增（与本计划 `packages/shared/src/agent.ts` 对齐）：
> - `systemPrompt: string | null`
> - `skills: 'all' | string[] | null`
> - `mcpServers: Record<string, unknown> | null`
> - `allowedTools: string[] | null`
> - （可选）`permissionMode` / `reasoningEffort`

---

## 设计

### 1. 共享契约（`packages/shared/src/`）— 与后端 DTO 对齐

新增文件并在 `index.ts` 汇出（保留现有 `chat.ts` 与 `AgentHubApi`，供 mock 聊天继续使用）：

- **`envelope.ts`** — `ApiResponse<T> = { code; message; data: T | null; timestamp }`，`SUCCESS_CODE = 0`。镜像 `apps/server/src/common/dto/api-response.ts`。
- **`user.ts`** — `UserStatus`、`UserView`、`LoginResult`，入参 `RegisterPayload` / `LoginPayload` / `UpdateUserPayload`（`nickname?: string | null`、`avatar?: string | null`）。镜像 user DTO。
- **`provider.ts`** — `ProviderType`（`'openai-chat-completions' | 'openai-responses' | 'anthropic'`）、`PROVIDER_TYPES` 常量、`PROVIDER_TYPE_LABELS`（展示名映射，如 "OpenAI (Chat Completions)"）、`PlatformProviderView`、`ProviderTestResult`、`CreateProviderPayload` / `UpdateProviderPayload`。
- **`agent.ts`** — `AgentVendor`（`'claude' | 'codex'`）、`AgentRuntimeStatus`、`AgentCapabilities`、`AgentView`（含上述待补字段，文件内注释标明依赖后端扩展）、`CreateAgentPayload`。

### 2. 主进程 HTTP 代理（`apps/desktop/src/main/`）

- 新增 `apps/desktop/src/main/api-proxy.ts`：导出 `registerApiProxy()`，注册 `ipcMain.handle('api:request', handler)`。handler 接收 `{ method, path, body?, token? }`，用全局 fetch 请求 `BASE + path`（`BASE = process.env.AGENTHUB_API_BASE ?? 'http://localhost:3000/api'`），带 `Content-Type: application/json` 和 `Authorization: Bearer <token>`（若有），返回 `{ status, ok, body }`（body 为解析后的 JSON 或 null）。网络异常归一为 `{ status: 0, ok: false, body: null, error }`，不抛到 IPC 边界。
- `src/main/index.ts`：在 `app.whenReady()` 内调用一次 `registerApiProxy()`（替换现有 ping 占位）。

### 3. preload 暴露（`apps/desktop/src/preload/`）

- `index.ts`：`const api = { request: (req) => ipcRenderer.invoke('api:request', req) }`。
- `index.d.ts`：把 `Window['api']` 类型从 `unknown` 收紧为 `{ request(req: ApiRequest): Promise<ApiProxyResponse> }`（类型在 preload 内本地声明，避免渲染/Node 跨配置耦合）。

### 4. 渲染层 API 客户端（`apps/desktop/src/renderer/src/api/`）

- **`http.ts`** — 核心：`request<T>(method, path, body?)`，从 auth store 取 token，调 `window.api.request`，校验 `ApiResponse` 信封：`code === 0` 返回 `data`，否则抛 `ApiError(code, message)`；`code === 2001`（UNAUTHORIZED）时清空 auth store（登出）。
- **`auth.ts` / `agents.ts` / `providers.ts`** — 各模块的类型化函数，逐一映射 README 接口：
  - auth：`register`、`login`、`logout`、`getMe`、`updateUser`、`deleteMe`。
  - agents：`listAgents`、`getAgent`、`createAgent`、`deleteAgent`。
  - providers：`listProviders`、`getProvider`、`createProvider`、`updateProvider`、`deleteProvider`、`testProvider`、`refreshModels`。
- **`api/index.ts`**：保留现有 `api = mockApi`（聊天用），并 export 上述真实客户端命名空间（如 `authApi` / `agentApi` / `providerApi`），互不影响。

### 5. 登录态 store（`apps/desktop/src/renderer/src/stores/auth.ts`）

不引入 pinia/vue-router（与现有「手动 nav 切换」「纯 reactive」约定一致，避免过度设计）。用 Vue reactive 单例：持有 `token` / `user: UserView | null`；动作 `login` / `register` / `logout` / `refreshMe` / `updateProfile`；token + user 持久化到 localStorage（key `agenthub.auth`），启动时 rehydrate 并后台 getMe 校验。提供 `userToAvatar(user)` 把 `UserView` 映射成侧边栏头像所需形状（显示名取 `nickname || account`，头像取 `avatar`，initials 从显示名推导）。

### 6. 视图与组件（`apps/desktop/src/renderer/src/`）

- **`App.vue`**：顶层加登录态门禁——未登录渲染全屏 `views/AuthView.vue`；已登录渲染现有外壳，主区按 nav 切换：chat（现状不动）/ agents（`AgentsView`）/ settings（`SettingsView`）。侧边栏 user 改为来自 auth store（经 `userToAvatar`）。接线用户菜单动作。
- **`views/AuthView.vue`** — 登录 / 注册切换（account + password；注册成功后用同账号自动登录或提示登录，按后端「注册不自动登录」语义：注册成功→切到登录态/自动调 login）。沿用 Tailwind 设计 token。
- **`views/AgentsView.vue`** — 两列：左 Agent 列表（名称 + vendor + 运行状态），右详情面板（vendor、model、PlatformProvider 名称、workingDirectory、capabilities、status、systemPrompt、skills、mcp、allowedTools）。顶部「新建 Agent」按钮 → `components/AgentCreateDialog.vue`；详情面板含删除。
- **`components/AgentCreateDialog.vue`** — 新建表单：name、vendor、platformProvider（下拉，取自 `providerApi.list`）、model（依所选 provider 的 modelList 联动）、workingDirectory，以及 systemPrompt / skills / mcp / allowedTools（按 vendor capabilities 动态启用/禁用——codex 支持 systemPrompt/skills，但不支持 mcp，前端按 capabilities 灰显并提示，避免提交后端报 BAD_REQUEST）。
- **`views/SettingsView.vue`** — 左设置侧栏（项：PlatformProvider，预留可扩展）；右内容区在选中 PlatformProvider 时再分两栏：左 `components/ProviderList.vue`（列表 + 添加按钮 → `ProviderEditDialog.vue`），右 `components/ProviderDetail.vue`（platformName、type 展示名、baseUrl、apiKeyMasked、modelList、测连接、刷新模型、编辑、删除）。
- **`components/UserMenu.vue`** — 头像弹出小菜单：更新昵称（弹输入框→`authApi.updateUser`）、更换头像（文件选择→dataURL→`authApi.updateUser({ avatar })`）、退出登录（`authApi.logout`→清 store）。点击外部关闭。
- **`components/GlobalSidebar.vue`** — 头像按钮改为切换 UserMenu（不再直接触发选图）；保留现有导航/设置按钮样式与 token。
- 复用 `components/ContextMenu.vue`（如适配）/ 新增轻量 `components/Modal.vue` 承载对话框，统一弹层样式。

### 设计风格

全部沿用现有 Tailwind 设计 token（primary / surface* / text-* / material-symbols-outlined 图标 / rounded-xl 等，见 `tailwind.config.js` 与现有组件），保持与聊天界面一致的飞书风格，不引入新依赖。

---

## 复用与约定

- 信封 / 错误码：`apps/server/src/common/dto/api-response.ts`、`common/exceptions/error-code.ts`。
- 头像选择逻辑可复用现有 `GlobalSidebar.vue` 的 FileReader → dataURL 模式。
- 现有 `api/index.ts` 的「可替换」设计：mock 聊天与真实后端客户端并存，互不污染。
- 不新增 npm 依赖（不引 axios / pinia / vue-router）。

## 验证

1. **类型**：`pnpm -F @agenthub/shared typecheck && pnpm -F @agenthub/desktop typecheck`；`pnpm lint`；`pnpm format`。
2. **端到端**（需本地后端 + MySQL + Redis 起在 `:3000`，由用户环境提供）：`pnpm dev` 后
   - 注册 → 登录 → 进入主界面（侧边栏头像为当前用户）。
   - 头像菜单：更新昵称 / 更换头像 / 退出登录 各自生效并持久化。
   - Agent 管理：列表加载、选中看详情、新建（含 vendor/provider/model 联动校验）、删除。
   - 设置 → PlatformProvider：列表、添加 Provider、查看详情、测连接、刷新模型、编辑、删除。
   - 刷新应用后仍保持登录态（localStorage rehydrate + getMe 校验）。
3. 后端 AgentView 未补字段前，Agent 详情的 systemPrompt/skills/mcp 会显示为空——属预期，待用户补字段后自动填充（前端已按契约就绪）。

## 备注 / 待办

- 依赖后端扩展 AgentView（见上「需要后端配合的改动」），否则 Agent 详情三字段为空占位。
- SSE 单聊（converse）不在本次范围，故 IPC 代理只覆盖 REST；后续接聊天时需另设流式通道。
- 聊天界面的 mock currentUser 与真实登录用户暂相互独立（聊天保持 mock），不做统一。
