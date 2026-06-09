# 群聊部署卡片：总结后预览 / 运行交付物

> 模块目录：`apps/server/src/multiagents/group/`、`apps/desktop/src/renderer/src/`、`packages/shared/src/`。

## Context

群聊任务跑完、Orchestrator 给出最终总结后，如果本轮产生了可呈现的交付物，再多走一步：在群聊里出现一张**部署卡片**，按交付物形态分两种：

- **静态产物**（`index.html`、文本报告等）：卡片上点「预览」直接复用现有产物抽屉（`ArtifactPreviewDrawer`）在侧边栏打开。
- **需起服务的网页项目**（Vite / React / Vue 工程等）：卡片展示 Orchestrator 声明的启动命令，用户点「运行并预览」确认后，服务端起一个 dev server 进程，侧边栏抽屉（`DeploymentDrawer`）用 iframe 指向 `localhost:<port>` 实时显示页面，并流式展示日志。

设计决策（与用户确认）：

- 启动命令来源：**Agent 显式声明** —— 由 `orchestrator-final-reviewer` 的结构化输出新增 `deploy` 字段给出 `command` / `port` / `installCommand`，比"自动探测"可靠。无 final review 时降级为探测产物里的 `index.html` → 静态卡。
- 缺依赖：**自动 install** —— 项目缺 `node_modules` 时先跑声明的 `installCommand`（会执行依赖的 postinstall 脚本，已知风险）。
- 安全底线：**人工确认 + 可终止** —— 服务端绝不自动 spawn；卡片只展示命令，用户点「运行」才触发；运行中抽屉常驻「停止」按钮（杀进程树），切群/关闭自动清理。
- 运行后端抽象为 `DeploymentRunner` 接口，本期实现本机 `child_process.spawn`（`LocalProcessRunner`），**Docker 隔离留作后续实现**（多用户场景的真隔离）。

## Model

新增共享类型（`packages/shared/src/deployment.ts`）：

- `DeployManifest`：`mode: 'static' | 'service'`、`entryPath?`、`command?`、`installCommand?`、`port?`、`note?`。
- `DeploymentStatus`：`installing | starting | running | stopped | failed`。
- `DeploymentRunnerKind`：`local | docker`（`docker` 预留）。
- `DeploymentView`：一次部署的运行态（`id`、`status`、`port`、`url`、`error`、`startedAt`…）。
- `DeploymentEvent`：`DeploymentLogEvent`（`stream: stdout|stderr|system` + `line`）与 `DeploymentStatusEvent`（状态迁移）。
- `StartDeploymentPayload`：`{ manifest }`。

扩展：

- `GroupRunEvent` 新增 `deploy_card`（携带 `manifest` + `artifacts`，供前端实时插卡）。
- `GroupMessageView` 新增 `GroupDeployMessageView`（`kind: 'deploy'`，payload `{ manifest, artifacts }`）。
- `OrchestratorFinalReviewResult` 新增 `deploy: DeployManifest | null`。

持久化：`group_message.kind` 增加 `'deploy'`，结构化负载放 `payload`。部署运行态为内存态（进程绑定），不落库 —— 重启即失效，符合"开发预览"语义。

## Backend API

| Method     | Path                                              | 说明                                        |
| ---------- | ------------------------------------------------- | ------------------------------------------- |
| `POST`     | `/group-chats/:id/deployments`                    | 用 deploy 卡片的 manifest 启动 service 部署 |
| `DELETE`   | `/group-chats/:id/deployments/:deploymentId`      | 停止部署（杀进程树，幂等）                  |
| `GET(SSE)` | `/group-chats/:id/deployments/:deploymentId/logs` | 订阅部署日志 + 状态流（回放 + 追尾）        |

接口规则：

- 均按 `userId + groupChatId` 校验群聊归属。
- 仅 `mode === 'service'` 可启动；一个群同时只允许一个活跃部署，启动新部署会先停止旧的。
- dev server 的 cwd 固定为群共享工作区 repo 目录（`GroupWorkspaceService.repoDir`），命令不接受前端任意输入，只来自卡片 manifest。
- 日志通道与群运行事件流分离（日志量、生命周期不同）。

## Runtime Flow

1. 群运行收尾：`OrchestratorService.report()` 发完总结（`orchestrator_report`）后，调用 `emitDeployCard()`：
   - review 给出 `deploy` → 用其 manifest；否则降级探测 `index.html` 静态卡；都没有则不出卡。
   - 落一条 `deploy` 群消息 + 广播 `deploy_card` 事件；随后 executor 照常发 `done`。
2. 前端 `buildGroupRunHandlers` 收到 `deploy_card` → 实时插入部署卡片（`DeployMessage.vue`）。
3. **静态卡**：点「预览」→ 复用 `previewArtifact` → `ArtifactPreviewDrawer`。
4. **service 卡**：点「运行并预览」→ `POST /deployments` →
   - 服务端 `DeploymentService.start()` 先创建内存态 `DeploymentView` 并立即返回；runner 在后台继续执行。`LocalProcessRunner` 启动前检查 `127.0.0.1:<port>` 是否可用，缺依赖先 install，再 spawn 启动命令；HTTP 轮询 `127.0.0.1:<port>` 探活，应答后置 `running`。
   - 前端拿到 `DeploymentView` 打开 `DeploymentDrawer`，订阅 `…/logs` SSE：状态徽章 + 日志 tab 会实时显示 install/start 输出；`running` 后预览 tab 用 iframe 加载 `localhost:<port>`。
5. 用户点「停止」或关闭抽屉 → `DELETE /deployments/:id` → 杀进程树。

## Security

- 运行的是 Agent 生成的代码：本期靠**人工确认 + 进程级隔离 + 可终止**兜底，无沙箱。
- dev server 仅监听 localhost、无鉴权，仅本机可访问；卡片与本文均注明。
- 渲染层 CSP `frame-src` 放开 `http://localhost:* http://127.0.0.1:*` 以允许 iframe 加载 dev server。
- 真隔离待 `DockerRunner` 落地（接口已预留，上层不变）。

## 已知限制 / 后续

- 端口由 Agent 声明，启动前发现冲突则失败（不做自动分配）。
- 一个群同时仅一个活跃部署。
- 本机 spawn 隔离弱；多用户 / 不可信代码场景需实现 `DockerRunner`。
- 部署运行态为内存态，服务端重启后丢失。
