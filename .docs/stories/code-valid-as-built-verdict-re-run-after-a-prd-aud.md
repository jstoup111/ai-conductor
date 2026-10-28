**Status:** Accepted

# Stories: Code-valid as-built verdict re-run after a prd_audit refusal halt

Source-Ref: jstoup111/ai-conductor#3363. Track: technical (no PRD). Tier: S.

Scope boundary (from `.docs/track/code-valid-as-built-verdict-re-run-after-a-prd-aud.md`): only the
auto-mode SHIP validation group (`manual_test`, `prd_audit`, `architecture_review_as_built`) with
artifact verification on. A member is "satisfied at the join" when its dispatch returned a passing
outcome, its post-dispatch verdict handshake recorded no failure, its objective gate verdict computed
by the join is satisfied, and, for `manual_test`, its results carry no FAIL rows. A "judgement halt"
is a join exit that halts the loop because of a member's verdict: the `prd_audit` decision-projection,
plan-gap, over-scope, and refusal-rework halts; the `architecture_review_as_built` kickback no-op
escalation, remediation-planner, and terminal-verdict halts; the gap-member kickback no-op escalation
halt; the two gap remediation-planner halts (with and without a merged `manual_test` work order); the
`manual_test` FAIL kickback halts the join reaches through the shared manual-test kickback handler,
whether every sibling is satisfied or the merged work order falls back to that handler (no-op
escalation, routed-admission refusal or exhaustion, self-heal exhaustion, and the durable-shipment
stop); and the generic group halt. The no-verdict and mechanical-fault exits already retain satisfied
siblings and are unchanged. A member whose dispatch fails or whose verdict handshake keeps failing exhausts its
retries and ends the round at the no-verdict exit, so at a judgement halt an unsatisfied sibling is one
whose gate verdict is unsatisfied or, for `manual_test`, whose results carry FAIL rows.

Today a judgement halt records only the halting member, so a sibling that passed in the same round
keeps its earlier `pending` or `stale` status and is dispatched again when the halt is cleared (observed
on `shipped-features-decide-artifacts-accumulate-in-do`, 2026-10-22). Separately, the group fan-out
dispatches every non-`done` member without the stale-preservation probe that the serial walk runs, so
a sibling restaged `stale` by a kickback is re-judged even when its stored verdict is still valid.

## Story 1: A judgement halt keeps the siblings the join found satisfied

**Requirement:** #3363 desired outcome 1

As a daemon operator, I want a validation-group halt on one member's judgement to keep its siblings' passing results, so that clearing the halt re-runs only the member I made a decision about.

### Acceptance Criteria

#### Happy Path
- Given the group dispatched `prd_audit` and `architecture_review_as_built`, `architecture_review_as_built` is satisfied at the join, and `prd_audit` routes to an over-scope halt, when the halt is written, then `architecture_review_as_built` and its validation-group member key are both recorded `done` in the same state commit that records `prd_audit` `refused`, whether `architecture_review_as_built` entered the round `pending` or `stale`.
- Given a sibling satisfied at the join, for each other judgement halt (the `prd_audit` decision-projection, plan-gap, and refusal-rework halts, the `architecture_review_as_built` kickback no-op escalation, remediation-planner, and terminal-verdict halts, the gap-member kickback no-op escalation halt, both gap remediation-planner halts, the `manual_test` FAIL kickback halts, and the generic group halt), when that halt is written, then the satisfied sibling and its validation-group member key are both recorded `done`.
- Given the over-scope halt above has been cleared and HEAD has not moved, when the conductor resumes, then `prd_audit` is dispatched, `architecture_review_as_built` is not dispatched, no `step_started` event names `architecture_review_as_built`, and every `parallel_started` event of that run lists `prd_audit` as its only branch.

#### Negative Paths
- Given a judgement halt, when the state commit is written, then the halting member is not recorded `done` and keeps the status that exit already assigns it (`refused` where the exit records a refusal).
- Given a sibling whose gate verdict is unsatisfied at the join (for example a BLOCKED `architecture_review_as_built` verdict) or, for `manual_test`, whose results carry FAIL rows, when a judgement halt is written, then that sibling is not recorded `done` and is dispatched again when the halt is cleared and the conductor resumes.

### Done When
- [ ] A conductor test that drives an over-scope halt with a satisfied `architecture_review_as_built` reads `conduct-state.json` after the halt and finds `prd_audit` `refused` and both `architecture_review_as_built` and `validation__architecture_review_as_built` `done`, for both a `pending` and a `stale` starting status.
- [ ] The same test, after clearing the HALT and resuming with HEAD unchanged, records exactly one `prd_audit` dispatch and no `architecture_review_as_built` dispatch, and the persisted events carry no `step_started` for `architecture_review_as_built`.
- [ ] A parametrized conductor test covers each other judgement halt with a satisfied sibling and asserts the sibling's bare and member keys read `done`; variants with a BLOCKED-verdict sibling or a FAIL-row `manual_test` assert it is not `done` and is dispatched again on resume.

## Story 2: The group fan-out preserves a stale member whose stored verdict still holds

**Requirement:** #3363 desired outcomes 2, 3

As a daemon operator, I want a validation-group member restaged `stale` to keep its still-valid verdict when the group fans out, so that a kickback that never touched that member's inputs does not pay for a fresh review.

### Acceptance Criteria

#### Happy Path
- Given the group fans out from an entry member that needs dispatch, and a later member is `stale` with a clean stored verdict whose code stamp is still valid for that member's gate surface, when the fan-out runs, then the later member is not dispatched, a `verdict_freshness` event with outcome `preserved_surface_miss` names it, its status is recorded `done`, and the entry member is dispatched.
- Given each pairing of an entry member and a later stale member (`manual_test` then `prd_audit`, `manual_test` then `architecture_review_as_built`, and `prd_audit` then `architecture_review_as_built`), when the later member's verdict still holds, then that later member is preserved as above.

#### Negative Paths
- Given a later `stale` member whose gate surface changed after its verdict was stamped, when the fan-out runs, then the member is dispatched, a `step_started` event names it, it is listed in the `parallel_started` branches, and no `verdict_freshness` event with outcome `preserved_surface_miss` names it.
- Given a later `stale` member and any of these conditions (its preservation check reports it not preserved, as `prd_audit`'s does under `gate_code_validity.enabled: false`; artifact verification off; or the preservation check throws), when the fan-out runs, then the member is dispatched, a `step_started` event names it, it is listed in the `parallel_started` branches, its status is not saved `done` before that dispatch, and no `verdict_freshness` event with outcome `preserved_surface_miss` names it.
- Given a later member whose status is `failed`, `refused`, or `pending` rather than `stale`, when the fan-out runs, then it is dispatched and no pre-dispatch preservation check runs for it.

### Done When
- [ ] A conductor test in auto mode with a preserving completion check observes, for each listed pairing, zero dispatches of the later member, one `verdict_freshness` (`preserved_surface_miss`) event naming it, its state `done`, and a dispatch of the entry member.
- [ ] Conductor tests observe a dispatch, and no pre-dispatch completion check, for a later member that is `failed`, `refused`, or `pending`, and a dispatch for each of the verification-off and throwing-check cases.
- [ ] A real-git acceptance test with stored typed verdicts stamped at HEAD shows a stale `architecture_review_as_built` preserved without dispatch on fan-out, and dispatched after a commit that changes one of its gate-surface inputs; and a stale `prd_audit` with a stamped clean verdict is dispatched on fan-out when `gate_code_validity.enabled` is `false`.
