# Conflict Check: Build step completes with every plan task still pending (#2014)

**Date:** 2026-10-02
**ADR corpus:** change_set (`adr-2026-09-06-reopened-task-resolution`), plus `adr-2026-07-23-trailer-union-build-step-routing` for context
**Result:** PASS — zero blocking conflicts remain; one blocking and three degrading conflicts were resolved.

## Conflict: Untruncated daemon line contradicts the bounded single retry log line

**Stories involved:** Story 2 (new) vs Stories 1 and 5 of retry-log-lines-carry-the-completion-check-reason-
**Files:** [.docs/stories/build-step-completes-with-every-plan-task-still-pe.md] vs [.docs/stories/retry-log-lines-carry-the-completion-check-reason-.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The new story required one daemon output line to carry the complete pending list untruncated. The existing story requires every retry to emit exactly one log line whose reason is truncated to a bounded length.

**Resolution Options:**
1. Narrow the new story: the bounded retry line leads with every pending task id before any title text; full ids and titles stay in the `step_retry` event reason, retry hint, stall question and HALT.
2. Amend the existing story with a length carve-out for the BUILD pending list.
3. Emit a second, unbounded log line.

**Recommendation and resolution:** Option 1, applied. It keeps the #521 one-line log bar and still lets an operator see every skipped task id in daemon output.

## Conflict: Dirty-path reason defers to a task-reason format that changes

**Stories involved:** Story 2 (new) vs Story 2 of build-reports-step-completed-status-done-while-lea
**Type:** contradiction
**Severity:** degrading

**Description:** The existing story says its dirty-path reason matches "the existing unresolved-task truncation format" (first three plus a remaining count). The new story removes that truncation from the task reason.

**Resolution:** The existing story is restated to name its own format: the first three paths plus the remaining count. This is a foreign shipped story, so the restatement ships as a companion main-based PR. The dirty-path reason behaviour is unchanged.

## Conflict: Re-seed "never overwrite" versus a plan-change reopen

**Stories involved:** Story 1 (new) vs the seed story of prd-audit-kickback-preserves-task-status
**Type:** state-conflict
**Severity:** degrading

**Description:** The existing seed criterion says a re-seed keeps a completed row ("merge, never overwrite"). A plan-change reopen restages a completed row to pending. Trailer-union and kickback-no-op stories already carry a scope note exempting open repair obligations; this story does not.

**Resolution:** A scope note excluding tasks with an open repair obligation (`adr-2026-09-06-reopened-task-resolution` D4 and D11) is added to the existing story. It ships in the same companion PR.

## Conflict: Stall reason token versus enriched stall text

**Stories involved:** Story 2 (new) vs the stall-unchanged story of trailer-union-build-completion
**Type:** contradiction
**Severity:** degrading

**Description:** The existing story fixes the stall reason string; the new story adds the pending list to the stall question and HALT.

**Resolution:** The new story now requires the unchanged `build stalled: no task progress` reason text alongside the pending list.

## Notes resolved without a conflict entry

- A plan reseal can make `coverage_binding` reopen the same task and charge its own lap before BUILD seeding runs. The new story's no-lap criterion is now scoped to the plan-change reopen, and the ledger check runs with `coverage_binding` disabled.
- D8 named no governing review for a `plan_amendment` obligation. D11 now says it ends when its task resolves and ordinary downstream gates judge the work.
- No #2014 note is added to the July 23 trailer-union ADR. D11 in the reopened-task ADR is the single authority for the new admission source, as D10 is for `coverage_binding`.

## Examined and compatible

trailer-union-build-completion (repair-obligation scope notes); rebase-reopens-completed-repair-tasks-against-stal; remediation-halts-when-the-owning-plan-task-is-alr; unify-build-completion-evidence-derivation-fix-der; build-stall-remediation-skips-no-task-progress; daemon-halts-a-build-that-is-making-forward-progre; kickback-to-build-no-op-when-target-evidence-stamped; plan-growth-allowance-is-spent-on-work-existing-ta; kickback-cap-raise-replays-the-halted-lap-s-remedi; no-diff-task-evidence-stamp; deterministic-evidence-attribution; gate-step-completion-validates-against-code-state-; implementation-only-remediation-falsely-requires-d; post-rebase-build-invalidation-dispatches-a-full-b. No oscillation: a reopen replays idempotently per task and digest with a fixed boundary, so seeding and restage cannot flip-flop.
