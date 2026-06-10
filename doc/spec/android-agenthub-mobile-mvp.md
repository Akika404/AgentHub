# Android AgentHub Mobile MVP

> Android client module under `apps/android`.

## Context

This feature turns the current Android placeholder app into a real mobile client for AgentHub. It mirrors the desktop app's authenticated backend workflows while adapting interaction patterns for mobile:

- Bottom navigation for chats, group chats, and Agent management.
- Unified chat list and chat conversation screen.
- Swipe-left chat settings/detail page.
- Agent creation, single-Agent chat creation, group chat creation.
- Server-side folder picking through backend filesystem APIs only.

The Android client talks to the existing backend APIs and does not require backend contract changes.

## Model

Android defines Kotlin serializable DTOs matching the shared TypeScript contracts:

- Auth: `LoginPayload`, `RegisterPayload`, `LoginResult`, `UserView`.
- Providers: `PlatformProviderView`.
- Agents: `AgentView`, `CreateAgentPayload`, `CreateAgentChatPayload`, `AgentChatView`, `AgentChatMessageView`, run steps and run events.
- Groups: `GroupChatView`, `CreateGroupChatPayload`, `GroupMessageView`, `GroupRunEvent`, `BlackboardView`, `BlackboardArtifactPreview`.
- Workspace filesystem: `ServerDirectoryRoot`, `ServerDirectoryListing`, `ServerDirectoryEntry`.

The UI derives mobile-specific state from these DTOs, including unified chat list rows, display messages, runtime state, creation form state, and directory picker state.

## Backend API

No new backend APIs are added. Android consumes these existing endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/user/login` | Login and receive JWT token |
| `POST` | `/user/register` | Register account |
| `GET` | `/user/me` | Validate/reload current user |
| `GET` | `/platform-providers` | Load providers for Agent/orchestrator selection |
| `GET` | `/agents` | List Agents |
| `POST` | `/agents` | Create Agent |
| `DELETE` | `/agents/:id` | Delete Agent |
| `GET` | `/agent-chats` | List single-Agent chats |
| `POST` | `/agent-chats` | Create single-Agent chat |
| `PATCH` | `/agent-chats/:id` | Pin/archive single-Agent chat |
| `DELETE` | `/agent-chats/:id` | Delete single-Agent chat |
| `GET` | `/agent-chats/:id/messages` | Load single-Agent chat messages |
| `POST` | `/agent-chats/:id/converse` | Start detached Agent turn |
| `GET` | `/agent-chats/:id/turns/:turnId/events` | Watch Agent turn SSE events |
| `POST` | `/agent-chats/:id/turns/:turnId/abort` | Stop Agent turn |
| `GET` | `/group-chats` | List group chats |
| `POST` | `/group-chats` | Create group chat |
| `PATCH` | `/group-chats/:id` | Pin/archive group chat |
| `DELETE` | `/group-chats/:id` | Delete group chat |
| `GET` | `/group-chats/:id/messages` | Load group chat messages |
| `POST` | `/group-chats/:id/converse` | Start detached group run |
| `GET` | `/group-chats/:id/runs/:runId/events` | Watch group run SSE events |
| `POST` | `/group-chats/:id/runs/:runId/abort` | Stop group run |
| `GET` | `/group-chats/:id/blackboard` | Load group blackboard |
| `GET` | `/group-chats/:id/blackboard/artifacts/:artifactId/preview` | Load artifact preview |
| `GET` | `/workspace-fs/roots` | Load browsable server roots |
| `GET` | `/workspace-fs/directories?path=...` | Browse server directories |

## Runtime Flow

1. On app start, Android loads API base URL, token, and cached user from DataStore.
2. If a token exists, `/user/me` validates it; otherwise the auth screen is shown.
3. Authenticated users see the main bottom-navigation shell.
4. Chat tab loads Agents, single-Agent chats, and group chats, then displays a unified searchable list.
5. Opening a chat loads persisted messages and subscribes to any active turn/run.
6. Sending a message creates an optimistic user bubble, starts the backend turn/run, and subscribes to SSE replay/live events.
7. SSE events update runtime status and in-progress run cards; when the stream finishes, Android reloads authoritative history.
8. Creation forms submit existing backend payloads. Folder fields are populated only through the server directory picker.
9. The chat detail screen uses a two-page horizontal pager: messages on page 1 and settings/detail on page 2.

## Validation

- Build/typecheck: `./gradlew :app:assembleDebug`.
- Unit tests: `./gradlew :app:testDebugUnitTest`.
- Unit coverage targets: envelope parsing, chat sorting/search, creation validation, SSE reducers.
- Manual checks against a running backend:
  - Login/register with editable base URL.
  - Create Agent from existing provider.
  - Create single-Agent chat and send a message with live progress.
  - Create group chat and send a group message with live progress.
  - Swipe to chat/group settings.
  - Pick server folders without typing raw paths.
  - Pin/archive/delete chats.
  - Reopen app and reconnect to active runs.

## Known Limits

- Provider management remains desktop/server-only for this MVP; Android only reads existing providers.
- Message cards are mobile-adapted and compact, not pixel-identical to desktop.
- Artifact preview opens from two surfaces as a read-only fullscreen bottom sheet: the group detail panel's artifact list, and the deploy message card (`kind: deploy`, `static` mode) in the conversation. Text renders as monospace, HTML in a WebView, images decode inline; pdf/audio/video/office/binary/too_large fall back to a file-info card. The deploy card's `service` mode shows the declared run commands (running the dev server stays desktop-only). Inline artifact cards on agent-run bubbles and an editable preview view are not part of this pass.
- The bottom tabs are implemented as lightweight ViewModel state for the MVP. Navigation Compose is available for future nested routes/deep links.
- Android does not expose manual server path typing; this is intentional per product scope.
- Gradle build and test commands were not executed in this implementation turn because the user asked to run Gradle themselves.
