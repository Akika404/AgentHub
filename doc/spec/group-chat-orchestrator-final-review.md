# Group Chat Orchestrator Final Review

> Adds LLM-backed final review and reporting to
> `apps/server/src/multiagents/group/run`.

## Context

The current group-chat Orchestrator final report is a deterministic template over
member task statuses. It can say that every task is `done`, but it cannot inspect
what members actually produced or compare those outputs with the user's original
request.

For multi-agent collaboration, the Orchestrator should behave like a real lead:
after members finish, it should review the blackboard artifacts and task
outcomes, decide whether the original user request has been satisfied, and only
then produce the final user-facing summary.

## Model

- `OrchestratorFinalReview`: internal result from the final review model.
  - `complete`: whether the original request is satisfied.
  - `summary`: final user-facing summary.
  - `completedItems`: concise list of delivered work.
  - `gaps`: missing or inadequate items.
  - `followUpInstruction`: continuation prompt when `complete === false`.
- `OrchestratorReviewArtifact`: internal preview of blackboard artifacts.
  - Reads artifact metadata from the blackboard.
  - Includes text/html previews when safely readable.
  - Includes size/type/message only for binary, large, or unsupported files.

No public shared API shape changes are required.

## Backend API

No public API changes.

| Method | Path                            | Description                                                                                             |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/group-chats/:id/converse` | Final report now runs an Orchestrator LLM review before completing a fully successful orchestrated run. |

## Runtime Flow

1. A group run starts and the Orchestrator creates tasks as before.
2. Member Agents complete tasks and write artifacts/reports to the blackboard.
3. Before final success reporting, the runtime builds a review context:
   - original user request;
   - all task outcomes;
   - blackboard summary;
   - artifact metadata and safe text/html previews;
   - project meta.
4. The Orchestrator LLM receives that review context and returns structured
   JSON.
5. If the review says `complete: true`, the final Orchestrator message is the
   LLM-generated summary.
6. If the review says `complete: false`, the current run performs another
   Orchestrator planning stage using `followUpInstruction` and the reported
   gaps. The final message is not emitted yet.
7. If final review fails due to upstream errors or invalid output, the runtime
   falls back to the deterministic report so the group run can still finish.

## Validation

- Unit tests verify that final review is invoked after successful member tasks.
- Unit tests verify that incomplete review results trigger a follow-up planning
  stage instead of a premature final report.
- Unit tests verify that noop/direct discussion still does not invoke final
  review.
- Server tests and typecheck pass.

## Known Limits

- Artifact review is text-oriented. Binary/image/PDF outputs are represented by
  metadata unless a future multimodal reviewer is added.
- Very large text/html artifacts are truncated before being sent to the model.
- The review is advisory and model-driven; it improves completion checks but is
  not a formal verifier.
