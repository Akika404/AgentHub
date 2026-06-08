---
name: debug-me
description: 用于调试 AgentHub 项目中的 bug、运行失败、类型/构建/测试错误、Electron/Vue 桌面问题、NestJS 后端问题、IPC/API/streaming 问题、shared contract 不一致、登录/鉴权/请求失败、状态/UI 异常。Use when the user asks to debug, investigate, reproduce, diagnose, fix a bug, explain an error log, or make a failing command pass in this repository.
---

# Debug Me

Use this skill to debug AgentHub with a narrow, evidence-first workflow.

## First Moves

1. Read `.agents/rules/coding_rules.md` before making changes if the rules are not already in context.
2. Run `git status --short` and preserve unrelated user changes.
3. Capture the symptom: failing command, stack trace, UI behavior, expected behavior, and the smallest known reproduction.
4. Use `rg` to trace code paths before editing. Prefer reading the implementation over guessing from filenames.
5. Do not use `spec-kit` for ordinary bugfixes unless debugging reveals a genuinely new feature request.

## Project Map

- Desktop app: `apps/desktop`, Electron + Vue 3 + TypeScript.
- Renderer UI: `apps/desktop/src/renderer/src`.
- Renderer API clients: `apps/desktop/src/renderer/src/api`.
- Electron main/preload IPC: `apps/desktop/src/main`, `apps/desktop/src/preload`.
- Backend: `apps/server`, NestJS. Before modifying it, read `apps/server/AGENTS.md`.
- Shared contracts: `packages/shared/src`. When API shapes change, update shared types first or alongside both consumers.

## Request Path

For frontend/backend bugs, trace the full path:

1. Renderer API helper: `apps/desktop/src/renderer/src/api/http.ts`
2. Preload bridge: `apps/desktop/src/preload/index.ts` and `index.d.ts`
3. Main-process proxy: `apps/desktop/src/main/api-proxy.ts`
4. Backend route/controller/service/mapper/DTO/entity under `apps/server/src`
5. Shared envelope and domain types in `packages/shared/src`

Important details:

- Renderer requests use `window.api.request` instead of direct `fetch`.
- The main proxy targets `AGENTHUB_API_BASE` or `http://localhost:3000/api`.
- Normal backend responses should use the shared envelope shape (`code`, `message`, `data`).
- `status: 0` from the proxy means transport failure before a backend HTTP response.
- Unauthorized business codes clear frontend session state.
- Streaming uses `window.api.streamStart` -> `api:stream:start`; the backend must return `text/event-stream` for SSE.

## Debugging Patterns

### Desktop UI or State Bug

Trace from the visible component to composables/stores/API calls. Check props, emitted events, computed state, async loading/error state, and whether mocked data is still being used after a backend API exists.

### IPC or Electron Bug

Check that the renderer calls only `window.api`/`window.electron`, preload exposes the method, `index.d.ts` matches the exposed API, and main registers the matching `ipcMain.handle/on` channel exactly once.

### Backend Bug

Read `apps/server/AGENTS.md` first. Keep DTOs separate from entities. Throw unified business exceptions instead of returning bare 500s. Compare controllers, services, mappers, SQL/entity fields, and shared types.

### Contract Mismatch

For frontend-backend contract changes, read both the root rules and `apps/server/AGENTS.md`. Do not silently bend backend REST/domain design to frontend mocks. If frontend and backend disagree, list the field/shape/semantic differences, recommend either frontend adaptation or a backend adapter, and wait for user confirmation when the design choice is material.

### Typecheck or Build Failure

Start from the first real TypeScript error, not the cascade. Inspect imports, exported shared types, Vue template type errors, preload global declarations, and package boundaries.

## Commands

Use the smallest command that proves or disproves the hypothesis:

```bash
pnpm -F @agenthub/desktop typecheck
pnpm -F @agenthub/desktop lint
pnpm -F @agenthub/desktop build
pnpm -F @agenthub/server typecheck
pnpm -F @agenthub/server test
pnpm -F @agenthub/shared typecheck
pnpm typecheck
pnpm lint
```

For local reproduction:

```bash
pnpm -F @agenthub/server dev
pnpm -F @agenthub/desktop dev
```

Use environment overrides only when the bug depends on them, especially `AGENTHUB_API_BASE`.

## Fix Rules

- Prefer the smallest code change that addresses the confirmed cause.
- Keep temporary logging out of the final diff unless the user asked for persistent diagnostics.
- Update `apps/desktop/src/preload/index.d.ts` whenever the preload API surface changes.
- Update `packages/shared/src` whenever data crossing desktop/server changes.
- Update relevant docs only when behavior or setup changes.
- After edits, run the minimal relevant validation and report any command that could not be run.

## Final Report

End with:

- Root cause in one or two sentences.
- Files changed.
- Validation commands and results.
- Remaining risks, skipped checks, or follow-up work.
