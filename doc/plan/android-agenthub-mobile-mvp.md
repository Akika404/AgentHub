# Android AgentHub Mobile MVP Plan

## Summary

Implement a real API-backed Android client in `apps/android`, using Kotlin + Jetpack Compose. The app will support auth, unified chat list, chat/detail pages, Agent management, Agent/single-chat/group-chat creation, server folder picking, and SSE-backed live runs.

## Implementation Steps

1. Android foundation
   - Keep the generated Android/Kotlin Compose plugin setup and add the Kotlin serialization plugin.
   - Add Navigation Compose, ViewModel Compose, DataStore Preferences, OkHttp SSE, Kotlin serialization, Compose foundation/icons, and coroutine dependencies.
   - Add `INTERNET` permission and cleartext traffic for local backend development.

2. Data layer
   - Add Kotlin DTOs matching `@agenthub/shared`.
   - Implement `ApiClient` with unified envelope parsing, bearer token, unauthorized callback, and JSON encode/decode.
   - Implement `SessionStore` using Preferences DataStore.
   - Implement repositories for auth, providers, agents, single chats, group chats, and workspace filesystem.
   - Implement SSE subscription helpers for Agent turns and group runs.

3. State and reducers
   - Add a single Android app ViewModel for MVP coordination.
   - Derive unified chat rows, selected chat detail, display messages, runtime state, creation form state, and directory picker state.
   - Add pure validators and run-event reducers for focused unit tests.

4. Compose UI
   - Replace placeholder activity with an app root.
   - Build auth screen with login/register tabs and editable API base URL.
   - Build bottom-navigation main shell: Chats, Groups, Agents.
   - Build unified chat list, chat detail with horizontal pager, compact message cards, runtime/send/stop controls, and settings/detail page.
   - Build Agent, single-chat, group-chat creation screens.
   - Build server directory picker dialog/sheet.

5. Verification
   - Add unit tests for envelope parsing, validation, chat sorting, and event reducers.
   - Run `./gradlew :app:assembleDebug` and `./gradlew :app:testDebugUnitTest` after implementation.
   - Update docs if implementation differs from this plan.

## Implementation Notes

- The MVP keeps the three bottom tabs in ViewModel state. Navigation Compose is available as a dependency for future nested routes/deep links, but this pass does not need an additional NavHost layer.
- Gradle build/test execution was intentionally skipped after the user requested to build Gradle themselves.

## Acceptance Criteria

- Android app can independently log in/register against the backend.
- Chat list combines single-Agent and group chats, supports search and long-press actions.
- Chat screen can send single/group messages, watch SSE progress, stop runs, and reconnect active runs.
- Chat settings are reachable by swiping left from the message page.
- Agent/single-chat/group-chat creation submits real backend payloads.
- Folder paths can only be selected through `/workspace-fs` browsing.

## Assumptions

- Backend API remains unchanged.
- Existing providers are configured outside Android before Agent/group creation.
- Bottom nav contains the three main desktop entries only: chat, groups, agents.
