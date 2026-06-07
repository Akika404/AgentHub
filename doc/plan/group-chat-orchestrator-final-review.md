# Group Chat Orchestrator Final Review Plan

## Steps

1. Add spec/plan docs for LLM-backed final review.
2. Introduce an injectable `OrchestratorFinalReviewer` interface and default LLM
   implementation.
3. Reuse the group Orchestrator vendor/model/provider config for final review,
   with tools disabled and workspace isolated.
4. Collect blackboard summary plus safe artifact previews from the shared
   workspace.
5. Update `OrchestratorService.report` to support review-aware final reporting.
6. Update `GroupRunExecutor` so incomplete final review triggers another
   planning stage instead of ending the run.
7. Add focused tests with fake reviewer/planner/dispatch services.
8. Update server README and run backend tests/typecheck.

## Files

- `apps/server/src/multiagents/group/run/orchestrator-final-reviewer.ts`
- `apps/server/src/multiagents/group/run/orchestrator.service.ts`
- `apps/server/src/multiagents/group/run/group-run.executor.ts`
- `apps/server/src/multiagents/group/run/group-run.executor.spec.ts`
- `apps/server/src/multiagents/group/group-chat.module.ts`
- `apps/server/README.md`

## Notes

- The deterministic template remains as a fallback for waiting-input states,
  failed/blocked outcomes, and reviewer failures.
- No public REST or shared type contract changes are planned.
