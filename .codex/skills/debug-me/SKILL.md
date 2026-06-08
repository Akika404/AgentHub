---
name: debug-me
description: Debug AgentHub bugs, runtime failures, type/build/test errors, Electron/Vue desktop issues, NestJS backend issues, IPC/API/streaming problems, shared contract mismatches, authentication failures, request failures, state management issues, and UI anomalies. Use when the user asks to debug, investigate, reproduce, diagnose, fix a bug, explain an error log, identify a root cause, compare minimal vs recommended fixes, or make a failing command pass in this repository. Prefer evidence-based root cause analysis over symptom-level patching.
---

# Debug Me

Use this skill to debug AgentHub with a narrow, evidence-first workflow.

## First Moves

1. Read `.agents/rules/coding_rules.md` before making changes if the rules are not already in context.
2. Pay special attention to the `# Auto Testing` section in `coding_rules.md`. Test execution and validation must follow project rules rather than assumptions made by this skill.
3. Run `git status --short` and preserve unrelated user changes.
4. Capture the symptom: failing command, stack trace, UI behavior, expected behavior, and the smallest known reproduction.
5. Use `rg` to trace code paths before editing. Prefer reading the implementation over guessing from filenames.
6. Do not use `spec-kit` for ordinary bugfixes unless debugging reveals a genuinely new feature request.

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

For frontend-backend contract changes, read both the root rules and `apps/server/AGENTS.md`.

Do not silently bend backend REST/domain design to frontend mocks.

If frontend and backend disagree:

1. List the field differences.
2. List the shape differences.
3. List the semantic differences.
4. Recommend either:
  - frontend adaptation, or
  - a backend adapter layer.

If the design decision is material, wait for user confirmation before implementation.

### Typecheck or Build Failure

Start from the first real TypeScript error, not the cascade. Inspect imports, exported shared types, Vue template type errors, preload global declarations, and package boundaries.

## Root Cause Analysis

Before implementing a fix:

1. Identify the immediate failure point.
2. Identify the underlying cause.
3. Determine whether the issue originates from:
  - implementation,
  - API contract,
  - IPC boundary,
  - shared types,
  - state flow,
  - data modeling,
  - architecture,
  - or project conventions.

Do not stop analysis at the first working patch if evidence suggests a deeper root cause.

When multiple fixes are possible:

### Minimal Fix

The smallest change that resolves the immediate symptom.

### Recommended Fix

The change that most appropriately resolves the underlying cause and prevents similar issues from recurring.

Always evaluate both when they differ significantly.

If the Recommended Fix requires:

- broad refactoring,
- public API changes,
- contract redesign,
- database/schema changes,
- cross-package changes,
- architectural restructuring,

stop and present both approaches to the user before proceeding.

Include:

- root cause analysis,
- Minimal Fix,
- Recommended Fix,
- tradeoffs,
- expected impact.

Wait for user confirmation before implementing large-scope changes.

## Commands

Use the smallest command that proves or disproves the current hypothesis.

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

- Prefer the fix that best addresses the confirmed root cause, not necessarily the smallest code change.
- Distinguish clearly between:
  - Minimal Fix
  - Recommended Fix
- Investigate whether the root cause is:
  - an implementation mistake,
  - a contract mismatch,
  - a state-management issue,
  - a missing invariant,
  - a design flaw,
  - or an architectural problem.
- Do not stop at the first patch that appears to work if evidence indicates a deeper issue.
- Keep temporary logging out of the final diff unless the user explicitly requests persistent diagnostics.
- Update `apps/desktop/src/preload/index.d.ts` whenever the preload API surface changes.
- Update `packages/shared/src` whenever data crossing desktop/server changes.
- Update relevant documentation only when behavior, contracts, architecture, or setup changes.

## Validation

After edits:

- Follow the `# Auto Testing` section in `.agents/rules/coding_rules.md`.
- Execute the validations required by project rules.
- Do not automatically run tests that project rules prohibit or require user confirmation for.
- Run only the validations necessary to verify the affected area and satisfy project requirements.
- Report:
  - validations executed,
  - validations skipped,
  - reasons for skipped validations,
  - any commands that could not be executed.

## Final Report

End with:

### Root Cause

One or two sentences describing the actual root cause.

### Fix Strategy

State whether the implemented solution was:

- Minimal Fix
- Recommended Fix

If both were evaluated, explain why the chosen approach was selected.

### Files Changed

List all modified files.

### Validation

List validation commands and results.

### Remaining Risks / Follow-up Work

Include:

- skipped checks,
- known limitations,
- future cleanup opportunities,
- architectural improvements not implemented.
