# Coherence Check: stale claimed-ledger recovery

**Date:** 2026-08-01
**Tier:** M
**Track:** Product
**Plan stem:** `engineer-unclaim-requeue-verb-stale-claimed-ledger`
**Result:** COVERED WITH TWO GOVERNANCE-TASK GAPS

No outcome rows are required: the committed intake marker records only the source reference and
owner; it contains no Desired-outcome bullets to map.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Story 1 explicitly requires abandoned claimed ideas to return to the queue. |
| fr | fr-2 | story-1 | covered | Story 1 explicitly covers automatic recovery during the next queue pull. |
| fr | fr-3 | story-1 | covered | Story 1's negative path cites FR-3 and protects claims within the configured window. |
| fr | fr-4 | story-2, story-3, story-6 | covered | Stories 2, 3, and 6 explicitly cite capture-time preservation and queue ordering. |
| fr | fr-5 | story-3 | covered | Story 3 explicitly covers one-command recovery of a referenced claim. |
| fr | fr-6 | story-4, story-8 | covered | Stories 4 and 8 cover manual refusal and automatic terminal-entry safety. |
| fr | fr-7 | story-5 | covered | Story 5 explicitly requires a non-error not-found result. |
| fr | fr-8 | story-6 | covered | Story 6 explicitly covers bulk recovery with an optional age bound. |
| fr | fr-9 | story-7 | covered | Story 7 covers closed-issue dropping and the unreadable-state negative path. |
| fr | fr-10 | story-1, story-8 | covered | Story 1's negative path and Story 8 bound automatic recovery to safe claim states. |
| fr | fr-11 | story-2, story-6 | covered | Stories 2 and 6 explicitly require the re-entry count while preserving ordering. |
| fr | fr-12 | story-1 | covered | Story 1 explicitly requires an operator-visible recovery announcement. |
| story | story-1 | task-1, task-3, task-4, task-5, task-6 | covered | Tasks implement the transition, window, predicate, automatic reap, announcement, and safety boundary. |
| story | story-2 | task-1, task-7 | covered | Tasks preserve capture time, increment attempts, and prove same-pull FIFO eligibility. |
| story | story-3 | task-1, task-8, task-14 | covered | Tasks implement and register the single-idea recovery verb. |
| story | story-4 | task-2, task-9 | covered | Tasks guard the ledger transition and surface the CLI refusal. |
| story | story-5 | task-10 | covered | Task 10 owns the unknown-reference non-error path. |
| story | story-6 | task-4, task-11, task-14 | covered | Tasks share the age predicate, implement bulk recovery, and register the verb. |
| story | story-7 | task-12, task-13 | covered | Tasks cover confirmed-closed dropping and fail-safe behavior when liveness is unreadable. |
| story | story-8 | task-6 | covered | Task 6 explicitly proves the automatic reap never touches non-claimed entries. |
| task | task-1 | story-1, story-2, story-3 | covered | The task's Story line explicitly cites Stories 1, 2, and 3. |
| task | task-2 | story-4 | covered | The task's Story line explicitly cites Story 4. |
| task | task-3 | story-1 | covered | The task's Story line explicitly cites Story 1. |
| task | task-4 | story-1, story-6 | covered | The task's Story line explicitly cites Stories 1 and 6. |
| task | task-5 | story-1 | covered | The task's Story line explicitly cites Story 1. |
| task | task-6 | story-1, story-8 | covered | The task's Story line explicitly cites Stories 1 and 8. |
| task | task-7 | story-2 | covered | The task's Story line explicitly cites Story 2. |
| task | task-8 | story-3 | covered | The task's Story line explicitly cites Story 3. |
| task | task-9 | story-4 | covered | The task's Story line explicitly cites Story 4. |
| task | task-10 | story-5 | covered | The task's Story line explicitly cites Story 5. |
| task | task-11 | story-6 | covered | The task's Story line explicitly cites Story 6. |
| task | task-12 | story-7 | covered | The task's Story line explicitly cites Story 7. |
| task | task-13 | story-7 | covered | The task's Story line explicitly cites Story 7's negative path. |
| task | task-14 | story-3, story-6 | covered | The task's Story line explicitly cites Stories 3 and 6. |
| task | task-15 | — | gap | `task-15`: its Story line names the repository's documentation-upkeep rule, not a real story id, and its type is not infrastructure/refactor. |
| task | task-16 | — | gap | `task-16`: its Story line names the repository's release gates, not a real story id, and its type is not infrastructure/refactor. |

## Verdict

All 12 functional requirements map to accepted stories, and all eight stories map to real plan
tasks. Tasks 15 and 16 are repository-governance obligations rather than product-story work; their
two explicit gaps are waived separately instead of being reported as fabricated story coverage.
