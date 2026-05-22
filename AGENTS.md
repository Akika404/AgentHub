# AGENTS.md

This file provides guidance to Vibe Coding Tools (Claude Code、OpenCode、Trae...) when working with code in this repository.

## Commands

```bash
pnpm dev          # start dev server with HMR
pnpm build        # typecheck + build for production
pnpm start        # preview production build
pnpm lint         # ESLint
pnpm format       # Prettier
pnpm typecheck    # run both tsc (main/preload) and vue-tsc (renderer)
pnpm build:mac    # package for macOS
pnpm build:win    # package for Windows
pnpm build:linux  # package for Linux
```

## Architecture

Standard three-process Electron app using Vue 3 + TypeScript, built with electron-vite.

- `src/main/` — Electron main process. Creates `BrowserWindow`, registers `ipcMain` handlers.
- `src/preload/` — Context bridge. Exposes APIs to the renderer via `contextBridge`. Add new renderer-accessible APIs here.
- `src/renderer/` — Vue 3 frontend. Treated as a normal Vite/Vue app; accesses Electron APIs only through `window.electron` / `window.api` (injected by preload).

IPC pattern: renderer calls `window.api.<method>` → preload exposes it via `contextBridge` → main handles it with `ipcMain.handle/on`. Keep IPC surface minimal and typed via `src/preload/index.d.ts`.

Output goes to `out/` (main/preload compiled) and `out/renderer/` (Vue bundle).
