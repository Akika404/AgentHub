# AgentHub · 多 Agent 协作平台

> 以 **IM 聊天**为核心交互范式的多 Agent 协作平台。像用飞书/微信一样，新建对话、发送消息，与 Claude Code、Codex、OpenCode 等不同 AI Agent 协作；支持多会话并行、群聊协作（Orchestrator 自动拆解分派），并把代码 Diff、网页预览、文件附件等产物内联到聊天流中实时预览与编辑。

---

## ✨ 核心能力

| 模块 | 说明 |
| --- | --- |
| **IM 聊天式交互** | 左侧统一会话列表（单聊 + 群聊），支持新建/置顶/归档/搜索；消息支持文本、代码块、图片、文件、网页/Diff/部署卡片；聊天历史自动作为上下文持续传递 |
| **单聊模式** | 1v1 与单个 Agent 对话，适合明确任务（如「用 Claude Code 写一个 React 组件」），流式回复 + 工作区 git diff/commit |
| **群聊协作** | 一个对话内 @ 多个 Agent，由主 Agent（Orchestrator）理解意图、拆解任务、分派给子 Agent，并聚合产出在聊天流中汇报。子 Agent 在隔离 worktree 中执行 |
| **多 Agent 接入** | 统一适配器层抹平 API 差异，至少接入 Claude Code + Codex；支持用户自建 Agent（System Prompt + 工具集），每个 Agent 是一个独立「联系人」 |
| **产物预览与编辑** | 回复中内联产物卡片（网页 iframe、文档渲染等），点击展开预览或编辑；text/html 产物可写回工作区文件 |

---

### [ => 详见已实现的功能清单](./功能清单.md)

## 🧱 技术栈

| 端 / 包 | 技术 |
| --- | --- |
| **desktop**（当前主交付端） | Electron 39 + Vue 3 + TypeScript，electron-vite 构建，Tailwind 自建 token 设计系统；三进程模型（main / preload / renderer） |
| **server** | NestJS 11 + TypeORM + MySQL + Redis（ioredis）+ JWT；Scalar API 文档；统一响应信封 + 全局异常 |
| **android**（轻量端） | Kotlin + Jetpack Compose（Material 3），单 Activity + `AppViewModel`，OkHttp 直连 REST/SSE |
| **packages/shared** | 跨 desktop ↔ server 的共享 TypeScript 类型与协议契约 |
| **packages/agent-core** | 框架无关 Agent 引擎：将 Claude Agent SDK / OpenAI Codex SDK 归一为统一 `AgentEvent` 流，含工作区 git diff/commit、产物预览与写回 |

---

## 📂 仓库结构

pnpm workspace 单仓多包（monorepo）。各部分完整目录树见对应 README：

```
AgentHub/
├── apps/
│   ├── desktop/   Electron + Vue 3 桌面端（主交付端）   → apps/desktop/README.md
│   ├── server/    NestJS 后端服务                       → apps/server/SERVER_README.md
│   └── android/   原生 Android 客户端（Kotlin/Compose）  → apps/android/README.md
├── packages/
│   ├── shared/      共享类型与协议契约                   → packages/shared/README.md
│   └── agent-core/  框架无关 Agent 引擎                  → packages/agent-core/README.md
├── doc/           产品设计 / spec / plan 文档
├── pnpm-workspace.yaml
└── package.json   根 workspace 脚本
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 20（开发使用 25.x）
- **pnpm** ≥ 9（开发使用 11.x）
- **MySQL** 8.x（后端数据库，默认库名 `agenthub`）
- **Redis** 6+（后端缓存 / 活跃 turn 指针）
- 桌面端本地运行模式需要本机已安装相应 Agent CLI（Claude Code / Codex）

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动后端（NestJS）

```bash
cd apps/server
cp .env.example .env          # 按需填写 MySQL（运行apps/server/sql 中的 DDL 建表） / Redis / JWT 配置

pnpm -F @agenthub/server dev   # nest start --watch，默认监听 :3000，API 前缀 /api
```

启动后可访问 Scalar API 文档（`http://localhost:3000/api`）。

### 3. 启动桌面端（Electron + Vue）

```bash
pnpm dev          # = pnpm -F @agenthub/desktop dev
```

### 4. （可选）Android 客户端

用 Android Studio 打开 `apps/android/`，模拟器默认通过 `http://10.0.2.2:3000/api` 连接本机后端。

---

## 🛠️ 常用命令

根脚本默认代理到桌面端，server/android 通过各自 filter 运行：

```bash
pnpm dev          # 启动桌面端开发 (alias: -F @agenthub/desktop dev)
pnpm build        # 构建桌面端
pnpm typecheck    # 对所有 workspace 包做类型检查 (pnpm -r)
pnpm lint         # 桌面端 ESLint
pnpm format       # 全仓 Prettier
```

按包执行：

```bash
pnpm -F @agenthub/desktop start       # 预览生产构建
pnpm -F @agenthub/desktop build:mac   # 打包 macOS（也支持 :win / :linux）
pnpm -F @agenthub/server  dev         # nest start --watch
pnpm -F @agenthub/server  test        # 后端单测
pnpm -F @agenthub/shared  build       # 类型包 → dist/
pnpm -F @agenthub/agent-core build    # Agent 引擎 → dist/
```

> `shared` 与 `agent-core` 是运行期依赖产物（`dist/`），desktop / server 的 `dev`/`build` 脚本已自动先行构建二者，一般无需手动编译。

---

## 📖 文档索引

| 文档 | 内容 |
| --- | --- |
| [`apps/desktop/README.md`](apps/desktop/README.md) | 桌面端三进程模型、IPC、目录结构 |
| [`apps/server/SERVER_README.md`](apps/server/SERVER_README.md) | 后端模块 / 接口总览 |
| [`apps/server/CLAUDE.md`](apps/server/CLAUDE.md) | 后端开发规则（改 server 前必读） |
| [`apps/android/README.md`](apps/android/README.md) | Android 端架构与目录 |
| [`packages/shared/README.md`](packages/shared/README.md) | 共享契约说明 |
| [`packages/agent-core/README.md`](packages/agent-core/README.md) | Agent 引擎说明 |
| [`doc/`](doc/) | 产品设计、spec、plan |

