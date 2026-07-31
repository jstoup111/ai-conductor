# Coherence: Mergeability-first daemon finish

**Date:** 2026-07-30
**Tier:** M
**Plan:** `.docs/plans/at-finish-avoid-automatic-rebasing-when-the-featur.md`

This chat-origin specification has no staged or committed intake-outcome artifact, so the outcome
row class is not required.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Story 1 explicitly cites FR-1 and requires non-mutating assessment before rebase. |
| fr | fr-2 | story-2 | covered | Story 2 explicitly cites FR-2 and preserves a clean-behind feature. |
| fr | fr-3 | story-3 | covered | Story 3 explicitly cites FR-3 and preserves downstream verification. |
| fr | fr-4 | story-4 | covered | Story 4 explicitly cites FR-4 and enters existing conflict recovery. |
| fr | fr-5 | story-5 | covered | Story 5 explicitly cites FR-5 and routes indeterminate results to rebase. |
| fr | fr-6 | story-6 | covered | Story 6 explicitly cites FR-6 and preserves re-kick play-forward. |
| fr | fr-7 | story-7 | covered | Story 7 explicitly cites FR-7 and preserves protected artifacts and evidence. |
| fr | fr-8 | story-8 | covered | Story 8 explicitly cites FR-8 and requires a distinct operator signal. |
| fr | fr-9 | story-9 | covered | Story 9 explicitly cites FR-9 and keeps incomplete rebase state authoritative. |
| story | story-1 | task-1, task-3, task-6, task-11 | covered | Classifier, immutability, guard ordering, and local-target cases cover Story 1. |
| story | story-2 | task-2, task-3, task-8, task-11 | covered | Skip outcome, SHA preservation, finish wiring, and local-target cases cover Story 2. |
| story | story-3 | task-7, task-8 | covered | Verdict preservation and finish integration cover Story 3. |
| story | story-4 | task-4 | covered | Task 4 explicitly routes conflicts through existing recovery. |
| story | story-5 | task-5, task-11 | covered | Indeterminate and local-target failure cases cover Story 5. |
| story | story-6 | task-8, task-9 | covered | Finish opt-in and mandatory re-kick behavior cover Story 6. |
| story | story-7 | task-3, task-7 | covered | Non-mutation and seal/evidence assertions cover Story 7. |
| story | story-8 | task-10 | covered | Task 10 owns the typed event, rendering, and audit classification. |
| story | story-9 | task-6 | covered | Task 6 pins active-rebase precedence and call order. |
| task | task-1 | story-1 | covered | The task's Story line explicitly cites Story 1. |
| task | task-2 | story-2 | covered | The task's Story line explicitly cites Story 2. |
| task | task-3 | story-1 | covered | The task's Story line explicitly cites Story 1. |
| task | task-4 | story-4 | covered | The task's Story line explicitly cites Story 4. |
| task | task-5 | story-5 | covered | The task's Story line explicitly cites Story 5. |
| task | task-6 | story-9 | covered | The task's Story line explicitly cites Story 9. |
| task | task-7 | story-7 | covered | The task's Story line explicitly cites Story 7. |
| task | task-8 | story-3 | covered | The task's Story line explicitly cites Story 3. |
| task | task-9 | story-6 | covered | The task's Story line explicitly cites Story 6. |
| task | task-10 | story-8 | covered | The task's Story line explicitly cites Story 8. |
| task | task-11 | story-5 | covered | The task's Story line explicitly cites Story 5. |

## Verdict

CLEAR — all 9 functional requirements map to accepted stories, all 9 stories map to real plan
tasks, and all 11 plan tasks cite real stories. No ambiguity or waiver is present.
