# Group Chat Orchestrator Continuity Plan

## Steps

1. Add an internal nullable `orchestratorSessionId` field to the group chat
   entity and SQL reference.
2. Extend `OrchestratorPlan` with internal `orchestratorSessionId` and
   `contextUpdates`.
3. Update `LlmOrchestratorPlanner` to resume the existing SDK session before
   sending prompts and return the latest SDK session id after each turn.
4. Update the structured output schema and prompt to allow project meta and
   blackboard decision updates.
5. Update `OrchestratorService` to persist the SDK session id and apply
   `contextUpdates`.
6. Add focused unit tests for session persistence and context update handling.
7. Update server README and run the relevant backend checks.

## Files

- `apps/server/src/multiagents/group/entities/group-chat.entity.ts`
- `apps/server/src/multiagents/group/group-chat.service.ts`
- `apps/server/src/multiagents/group/run/orchestrator-planner.ts`
- `apps/server/src/multiagents/group/run/orchestrator.service.ts`
- `apps/server/src/multiagents/group/__tests__/*`
- `apps/server/sql/group_chat_collaboration.sql`
- `apps/server/README.md`

## Notes

The public shared group chat DTO remains unchanged. This is intentionally an
internal runtime continuity feature.
