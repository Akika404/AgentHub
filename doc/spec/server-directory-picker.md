# Server Directory Picker

> Module scope: server-side workspace filesystem browsing, shared contracts, and desktop create/edit dialogs that select Agent workspaces, chat workspaces, group workspaces, and skill folders.

## Context

AgentHub can run with the desktop client connected to a backend deployed on a server. In that mode Claude Code / Codex run inside the backend process environment, so paths used for Agent Home, single-chat working directories, group shared workspaces, and skill imports must be server-side paths.

Before this feature, desktop directory buttons used Electron's local `showOpenDialog`, which only saw the desktop user's machine. The backend already treats incoming paths as server paths, but users could only reliably use remote paths by typing them manually.

This feature adds an authenticated server directory browser and replaces local directory dialogs in AgentHub workspace/skill forms with a shared server directory picker.

## Model

New shared contracts:

- `ServerDirectoryRoot`: a configured root that the current user may browse.
- `ServerDirectoryEntry`: one directory child under a listed path.
- `ServerDirectoryListing`: normalized current path, parent path, root metadata, and directory children.

Server-side root policy:

- Browsing is limited to configured roots.
- Roots are configured through `AGENTHUB_WORKSPACE_ROOTS`, a path-list separated by the OS delimiter (`:` on Linux/macOS, `;` on Windows).
- If no explicit roots are configured, the server exposes safe development defaults: the service user's home directory and `GROUP_WORKSPACE_ROOT` / `~/.agenthub/groups`.
- Every requested path is normalized and must resolve inside one configured root.
- The API lists directories only; files are not returned.

## Backend API

| Method | Path                                             | Description                                                                                     |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET`  | `/workspace-fs/roots`                            | List server directory roots available to the authenticated user.                                |
| `GET`  | `/workspace-fs/directories?path=<absolute path>` | List child directories for a server path. If `path` is omitted, list the first configured root. |

Both endpoints require `JwtAuthGuard` and return the normal AgentHub response envelope.

## Runtime Flow

### Loading roots

1. Desktop opens the server directory picker.
2. Renderer calls `GET /workspace-fs/roots` through the existing main-process HTTP proxy.
3. Server resolves configured roots, removes duplicates, creates missing root directories when possible, and returns roots that are readable directories.
4. Frontend picks the current value's matching root if possible; otherwise it opens the first root.

### Browsing directories

1. Frontend calls `GET /workspace-fs/directories?path=...`.
2. Server normalizes the path.
3. Server rejects paths outside configured roots.
4. Server reads child entries and returns readable directories sorted by name, with hidden directories included because `.codex`, `.claude`, and `.agenthub` are meaningful in AgentHub.
5. Frontend updates the picker list and lets the user select the current path.

### Submitting paths

1. The picker writes the selected server path into the existing form field.
2. Existing Agent / chat / group create APIs keep receiving `workingDirectory`, `workspaceDir`, and `skillSourceDirectories`.
3. Backend runtime directory creation, git init, and skill import continue to happen on the server.

## Validation

- Shared package typecheck passes.
- Server package typecheck passes.
- Desktop package typecheck passes.
- Directory browse API rejects paths outside configured roots.
- Agent create dialog selects Agent Home and skill folders from server paths.
- Single-chat create dialog can select an optional server working directory and server skill folders.
- Group chat create dialog selects the shared workspace directory from server paths.

## Known Limits

- The browser lists existing directories only. Users can still type a new child path manually; the existing backend create flow will create it when the relevant Agent/chat/group is saved.
- There is no file upload/sync path for importing skills from the desktop machine; skill source directories must already exist on the server.
- The directory picker is not a general file manager: it does not rename, delete, upload, or recursively search.
- Root visibility is process-wide configuration, not per-user ACL. Multi-tenant deployments should run separate backend instances or add per-user root policy before sharing a server among untrusted users.
