# AGENTS.md

This file provides guidance to Vibe Coding Tools (Claude Code、OpenCode、Trae...) when working with code in this repository.

## Repository layout

pnpm workspace monorepo. **每个部分的完整目录树请到对应目录的 README 查看**，本文件只保留顶层概览：

```
apps/
  android/   — Native Android app (Kotlin + Jetpack Compose)        → apps/android/README.md
  desktop/   — Electron + Vue 3 renderer (current main deliverable) → apps/desktop/README.md
  server/    — NestJS backend service                               → apps/server/SERVER_README.md
packages/
  shared/    — Shared TypeScript types & protocol contracts (desktop ↔ server) → packages/shared/README.md
  agent-core/— Framework-agnostic agent engine (Claude/Codex adapters + workspace git/artifact) → packages/agent-core/README.md
```

Root-level configs: `pnpm-workspace.yaml`, `package.json` (workspace scripts), `.prettierrc.yaml`, `.npmrc`.

## Commands

Root scripts delegate to the desktop app (server/android run via their own filters):

```bash
pnpm dev          # alias: pnpm -F @agenthub/desktop dev
pnpm build        # alias: pnpm -F @agenthub/desktop build
pnpm typecheck    # run typecheck across every workspace package (pnpm -r)
pnpm lint         # alias: pnpm -F @agenthub/desktop lint
pnpm format       # Prettier across the whole repo
```

Per-package commands use `pnpm -F <pkg> <script>`:

```bash
pnpm -F @agenthub/desktop start       # preview production build
pnpm -F @agenthub/desktop build:mac   # package for macOS (also :win / :linux)
pnpm -F @agenthub/server  dev         # nest start --watch
pnpm -F @agenthub/shared  build       # types package → dist/
pnpm -F @agenthub/agent-core build    # agent engine → dist/
```

## Architecture summaries

完整目录树见各目录 README；这里只给一句话定位：

- **Desktop** (`apps/desktop/`) — 三进程 Electron：`src/main/`（主进程 + IPC + 本地 runner）、`src/preload/`（`contextBridge` 暴露 `window.api`）、`src/renderer/`（Vue 3，仅通过 `window.api` 访问 Electron）。详见 `apps/desktop/README.md`。
- **Server** (`apps/server/`) — NestJS：`user` / `platform-provider` / `multiagents`（单聊 turn runtime）/ `multiagents/group`（群聊协作 + Orchestrator）/ `workspace-fs` 等模块。详见 `apps/server/SERVER_README.md`。
- **Android** (`apps/android/`) — 原生 Kotlin + Jetpack Compose（Material 3），单 Activity + `AppViewModel`。详见 `apps/android/README.md`。
- **shared** (`packages/shared/`) — 跨 desktop ↔ server 的类型与协议契约（`@agenthub/shared`）。改 API 形状时改 `src/`，两端同步。详见 `packages/shared/README.md`。
- **agent-core** (`packages/agent-core/`) — 框架无关的 Agent 引擎（Claude/Codex 适配器 + 工作区 git/产物预览），被 desktop 主进程与 server 复用。详见 `packages/agent-core/README.md`。

## Coding Rules

Before taking any action, if there is no rules-related content in your context, you **MUST** read the shared project rules under:
- .agents/rules

## Submodule Rules

- Before modifying any code under `apps/server`, you **must** first read `apps/server/AGENTS.md` (backend dev rules). 目录结构与模块/接口文档在 `apps/server/SERVER_README.md`。
- For any change involving the frontend-backend contract, **both files must be read**.
