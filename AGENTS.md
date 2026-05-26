# AGENTS.md

This file provides guidance to Vibe Coding Tools (Claude Code、OpenCode、Trae...) when working with code in this repository.

## Repository layout

pnpm workspace monorepo:

```
apps/
  desktop/   — Electron + Vue 3 renderer (the current main deliverable)
  server/    — Backend service (placeholder; framework not chosen yet)
packages/
  shared/    — Shared TypeScript types & protocol contracts (consumed by desktop & server)
```

Root-level configs: `pnpm-workspace.yaml`, `package.json` (workspace scripts), `.prettierrc.yaml`, `.npmrc`.

## Commands

Root scripts delegate to the desktop app for now (the only runnable app):

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
pnpm -F @agenthub/shared  typecheck   # types-only package
pnpm -F @agenthub/server  typecheck
```

## Desktop architecture (`apps/desktop/`)

Standard three-process Electron app using Vue 3 + TypeScript, built with electron-vite.

- `src/main/` — Electron main process. Creates `BrowserWindow`, registers `ipcMain` handlers.
- `src/preload/` — Context bridge. Exposes APIs to the renderer via `contextBridge`. Add new renderer-accessible APIs here.
- `src/renderer/` — Vue 3 frontend. Treated as a normal Vite/Vue app; accesses Electron APIs only through `window.electron` / `window.api` (injected by preload).

IPC pattern: renderer calls `window.api.<method>` → preload exposes it via `contextBridge` → main handles it with `ipcMain.handle/on`. Keep IPC surface minimal and typed via `src/preload/index.d.ts`.

Output goes to `apps/desktop/out/` (main/preload compiled) and `apps/desktop/out/renderer/` (Vue bundle).

## Shared types (`packages/shared/`)

All data types crossing the desktop ↔ server boundary (chat summaries, messages, message-card kinds, network nodes, the `AgentHubApi` interface) live here and are imported as `@agenthub/shared`. The package ships TypeScript source directly — no build step.

When changing an API shape, edit it in `packages/shared/src/` so both ends pick up the change.

## Coding Rules

Please follow the shared project rules under:
- .agents/rules

## Submodule Rules

- Before modifying any code under `apps/server`, you **must** first read `apps/server/CLAUDE.md`.
- Before modifying any code under `apps/desktop`, you **must** first read `apps/desktop/CLAUDE.md`.
- For any change involving the frontend-backend contract, **both files must be read**.
