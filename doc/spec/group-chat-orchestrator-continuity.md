# Group Chat Orchestrator Continuity

> Defines the runtime behavior for the built-in Orchestrator under
> `apps/server/src/multiagents/group/run`.

## Context

The Orchestrator must behave like a continuous participant in a group chat. A
short user reply such as "网页版吧" should be interpreted against the previous
Orchestrator clarification turn instead of being treated as an isolated new
request.

The underlying Claude Code and Codex adapters already support session
continuity through SDK session ids. The group runtime should preserve and
resume the Orchestrator SDK session for each group chat, while still writing
important project facts into server-owned state so the rest of the system can
inspect them.

## Model

- `group_chat.orchestratorSessionId`: nullable internal SDK session id for the
  built-in Orchestrator. It is not exposed in the public group chat DTO.
- `projectMeta`: keeps the latest project name, goal, tech stack, and status.
- `blackboard_decision`: stores confirmed user choices and requirements that
  are useful to members and audits.

## Backend API

No public API shape changes.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/group-chats/:id/converse` | Resumes the group's Orchestrator SDK session while planning. |
| `GET` | `/api/group-chats/:id` | Response shape is unchanged; `orchestratorSessionId` remains internal. |

## Runtime Flow

1. A group run starts from a user message.
2. `LlmOrchestratorPlanner` creates an adapter from the group's Orchestrator
   config.
3. If `group_chat.orchestratorSessionId` exists, the adapter resumes that SDK
   conversation before sending the current planning prompt.
4. The adapter returns a structured plan and the latest SDK session id.
5. The server persists the latest Orchestrator SDK session id on the group.
6. The plan may include `contextUpdates`:
   - `projectGoal`, `projectName`, `projectTechStack`, `projectStatus` update
     `projectMeta`.
   - `decisions` are written as approved blackboard decisions created by the
     Orchestrator and approved by the current user.
7. The usual task/member-turn/no-op flow continues.

## Validation

- Unit tests verify that the Planner resumes with an existing
  `orchestratorSessionId`.
- Unit tests verify that the Orchestrator service persists a new SDK session id.
- Unit tests verify that project goal and confirmed decisions from
  `contextUpdates` are persisted.
- Server typecheck should pass.

## Known Limits

- The Orchestrator may eventually hit provider context limits because this
  version intentionally relies on full SDK conversation continuity.
- Project fact extraction is model-driven. The server validates and deduplicates
  simple fields/decisions but does not yet run a second verifier model.
- Superseding older blackboard decisions from Orchestrator context updates is
  not automatic yet; exact duplicate decisions are skipped.
