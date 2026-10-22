# Conflict Check: Remediation tasks close on a reported commit that never implemented them (#3190)

**Date:** 2026-10-21
**Stories:** `.docs/stories/remediation-tasks-close-on-a-reported-commit-that-.md`
**Result:** 0 blocking, 9 degrading — UNRESOLVED. Spec paused, blocked by jstoup111/ai-conductor#3200.

## Why paused

#3200 ("Done-when closes as verified citing tests that don't assert the check") is in DECIDE on
`spec/done-when-closes-as-verified-citing-tests-that-don` with committed, unmerged amendments to
`adr-2026-08-22-done-when-evidence-at-task-close` (D10–D18: a BUILD-boundary citation judgement
before the completion predicate, bounded per-check refusal, reopen via obligation, retry-once,
spine event) and `adr-2026-09-06-reopened-task-resolution` (D13, source `done-when-citation`).
This spec would claim the same D13, add a second BUILD-boundary judgement with opposite placement
(after the predicate), and could double-reopen a `rem-*` task with a `[test]` check. Operator
decision 2026-10-21: sequence #3190 after #3200; reconcile on resume (likely one shared
BUILD-boundary judgement pass, this source as 09-06 D14).

## Degrading conflicts to resolve on resume

### Story vs story
1. **All-resolved ⇒ BUILD completes invariants** (contradiction). `build-step-completes-with-every-plan-task-still-pe` Story 3 ("…then the step completes, no repair obligation is created, and no stall is raised."), `build-reports-step-completed-status-done-while-lea` S4, `trailer-union-build-completion` Story 2, `tasks-close-with-boilerplate-done-when-evidence-mi` Story 5. Resolution: scope note in the new stories narrowing them to "no completed `rem-*` task holds a non-resolved verdict for its current close"; predicate ordering unchanged; place the malformed-verdict refusal in that ordering.
2. **Pending-task listing in reason and hint** (overlap). `build-step-completes-…` Story 2 TI-2 ("the reason names every pending task by id and title"), `build-reports-…` S5. Resolution: reopen reason = prefix + standard pending listing + rationale; reopen hint is a distinct declared branch.
3. **Untestable criterion-bound `rem-*` task closed `unverified`** (oscillating, bounded). `tasks-close-…` Story 7. Resolution: pass each check's close-record source to the judge; an `unverified` `[test]` close is not by itself grounds for `persists`/`partial`.
4. **Close identity across rebase** (state). `rebase-reopens-completed-repair-tasks-against-stal` Story 3. Resolution: close identity survives rebase translation, or a rebase alone never triggers re-judgement.

### ADR vs story
5. **`adr-2026-08-22-one-owner-per-review-question` D1 map** — "the owners in this map are now the only reviewers of their questions during BUILD." Resolution: amend the map with a row for the remediation-closure question (may only withhold hand-off). Also correct the new ADR's alignment sentence: `prd_audit` at SHIP is the completion authority (trailer-union 2026-08-22 amendment), not `build_review`.
6. **`adr-2026-09-06-reopened-task-resolution` D8** — "No new retry counter or semantic-equivalence mechanism is introduced". Resolution: amend 09-06 with a decision for source `remediation_closure` (bound lives in verdict state; no governing review, as for `plan_amendment`). Number after #3200's D13.
7. **09-06 #2944 stacked amendment** — "An obligation's boundary is `{branch, head}` … taken at host region entry." / "The admission key is `(roundId, findingId, taskIds)`." Resolution: a `remediation_closure` obligation takes `{branch, head}` at admission, keyed by close identity; add a stacked negative path to Story 1.
8. **`adr-2026-10-07-per-child-build-region` D1 / `adr-2026-10-12-routed-whole-feature-repair` D8** — execution child vs cursor child. Resolution: candidates use the execution-child resolver; reword ADR D2 and Story 2.
9. **`adr-2026-08-22-done-when-evidence-at-task-close` D8 / per-child D6** — BUILD "completes on task resolution as before"; the nudge lives inside the predicate. Resolution: new ADR D1 runs after the predicate including the nudge; qualify done-when D8 and per-child D6. Reconcile placement with #3200's D13 (its judgement runs before the predicate).

## ADRs examined
adr-2026-07-05-engine-owned-task-status, adr-2026-07-23-trailer-union-build-step-routing, adr-2026-08-22-done-when-evidence-at-task-close, adr-2026-09-06-reopened-task-resolution, adr-2026-08-25-as-built-remediable-findings-bounded-build-route, adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback, adr-2026-07-13-kickback-build-no-op-escalation, adr-2026-07-20-post-rebase-delta-aware-invalidation, adr-2026-10-12-routed-whole-feature-repair, adr-2026-07-10-intra-step-build-progress-events, adr-2026-07-12-progress-aware-build-halt, adr-2026-07-23-commit-movement-liveness-floor, adr-2026-08-03-uncommitted-work-floor-under-build-completion, adr-2026-07-13-retry-classify-rerun-vs-route, adr-2026-08-05-build-settle-outcome-stamp, adr-2026-07-10-daemon-stall-remediation, adr-2026-07-22-per-task-work-happened-floor, adr-2026-07-22-attempts-counter-on-crash-recovery, adr-2026-07-27-cold-start-within-step-retries, adr-2026-07-17-verify-only-judged-closure, adr-2026-07-26-cross-dispatch-kickback-livelock-bound, adr-2026-08-22-one-owner-per-review-question, adr-2026-10-07-per-child-build-region, adr-2026-10-03-stacked-child-plans-identity-and-state, adr-2026-07-07-audit-trail-event-sink. The remaining ~330 APPROVED ADRs were narrowed out (subjects outside BUILD completion, task status, obligations, stalls, retries, events).
