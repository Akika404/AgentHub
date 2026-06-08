# Server Directory Picker - Plan

## Goal

Implement `doc/spec/server-directory-picker.md` so directory selection in the desktop app browses server-side folders through authenticated backend APIs.

## Files

- `packages/shared/src/workspace-fs.ts`
  - Add server directory browser contract types.
- `packages/shared/src/index.ts`
  - Export the new contracts.
- `apps/server/src/workspace-fs/workspace-fs.service.ts`
  - Resolve configured roots.
  - Normalize and authorize requested paths.
  - List readable child directories.
- `apps/server/src/workspace-fs/workspace-fs.controller.ts`
  - Add `GET /workspace-fs/roots`.
  - Add `GET /workspace-fs/directories`.
- `apps/server/src/workspace-fs/workspace-fs.module.ts`
  - Wire controller/service and auth dependencies.
- `apps/server/src/app.module.ts`
  - Import the new module.
- `apps/desktop/src/renderer/src/api/workspace-fs.ts`
  - Add typed client functions.
- `apps/desktop/src/renderer/src/api/index.ts`
  - Export the new API client.
- `apps/desktop/src/renderer/src/components/ServerDirectoryPicker.vue`
  - Shared modal picker for single or multiple server directories.
- `apps/desktop/src/renderer/src/components/AgentCreateDialog.vue`
  - Replace Electron local directory selection with server picker for Agent Home and skill folders.
- `apps/desktop/src/renderer/src/components/AgentChatCreateDialog.vue`
  - Add server picker for optional chat working directory and skill folders.
- `apps/desktop/src/renderer/src/components/GroupChatCreateDialog.vue`
  - Replace Electron local directory selection with server picker for group workspace.
- `apps/server/README.md`
  - Document server directory roots and remote deployment path semantics.

## Steps

1. Add shared types and exports.
2. Implement the NestJS module:
   - Parse `AGENTHUB_WORKSPACE_ROOTS` using `path.delimiter`.
   - Default to service user home and configured/default `GROUP_WORKSPACE_ROOT`.
   - Resolve `~`.
   - Filter roots to readable directories, creating missing roots where possible.
   - Reject browse requests outside roots with `BusinessException.forbidden`.
3. Add desktop API client methods.
4. Build the reusable server directory picker:
   - Modal with roots, breadcrumb, child directory list, path field, refresh/up actions.
   - Single-select and multi-select modes.
   - Preserve manual path editing.
5. Wire dialogs:
   - Agent Home: single picker.
   - Agent skill folders: multi picker.
   - Single-chat working directory: single picker.
   - Single-chat skill folders: multi picker.
   - Group workspace: single picker.
6. Update documentation.
7. Validate with focused typechecks.

## Risks

- Large directories can be slow to list. The first implementation lists one level only and returns directories only.
- Permission errors vary by OS. The service should return readable roots only and mark unreadable child directories instead of crashing.
- Existing local Electron IPC methods remain for other future uses, but workspace-related UI should use the server picker.
