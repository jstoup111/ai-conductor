# Implementation Plan: One branch, one PR, one halt state (#1415)

**Date:** 2026-08-09
**Stories:** .docs/stories/auto-opened-needs-remediation-pr-occupies-the-bran.md
**Design:** .docs/decisions/review-2026-08-09-halt-pr-occupies-retained-slot-1415.md
**Conflict check:** Clean as of 2026-08-09 (1 blocking conflict resolved, 1 degrading accepted)
**Complexity:** M

## Summary

Unbinds the existing halt-PR repair from the SHIP-entry `published` path so every retained-PR
resolution returns a usable implementation PR, and adds a resume-time clear that removes the
`needs-remediation` label and the body marker atomically while preserving draft status. 14 tasks.

## Technical Approach

The repair machinery already exists and is correct — `makeRetainedPrPresentable`
(`halt-pr-rehabilitation.ts`), `cleanupHaltPresentation` with `preserveDraft`
(`pr-labels.ts`), `rehabilitateHaltPr`, `retitleFloor`, `bodyFloor`. Nothing here writes a new
GitHub mechanic. The defect is **placement**: the repair has one call site, guarded by
`step.phase === 'SHIP'` and an `openShipDraftPr` outcome of `published`, so a HALT that lands in
BUILD is never repaired.

Three changes, in ascending order of blast radius:

1. **New engine primitive** `clearHaltStateForResume` in `halt-pr-rehabilitation.ts`. It wraps
   `cleanupHaltPresentation(..., { preserveDraft: true })` and the marker strip in one confirmed
   operation, and supersedes the halt comment in place via `upsertComment`. Returns
   `'cleared' | 'not-halted' | 'partial' | 'gh-unavailable'` — never throws, one log line per
   outcome, matching the advisory contract of every neighbour in this module. The marker and the
   label are cleared together because the marker is `reconcileHaltPrs`'s sole selector
   (`halt-pr-reconciliation.ts:129`); a label-only clear is re-healed on the next daemon tick.

2. **Repair on resolution.** `resolveRetainedShipDraftPrUrl` (`conductor.ts:3092`) currently
   returns any OPEN head/base PR unrepaired to the pre-finish snapshot (`:3141`) and the self-host
   release gate (`:3199`). It gains a repair call before it memoizes and returns, so no consumer
   can receive a placeholder. The existing memoization keeps this to one repair per run, and the
   ordinary never-halted PR still costs exactly one state read and zero writes.

3. **Dispatch-boundary clear.** `conductor.ts`'s `run()` loop calls the clear once per run, before
   the first step executes — not gated on phase. This is the change that unblocks a BUILD task,
   which resolves the PR itself through `gh` rather than through the conductor's resolver.

**PR timing is out of scope.** `adr-2026-07-29-ship-start-draft-pr` keeps sole ownership of when
the draft PR is born; SHIP entry stays its only birth site, and this plan neither moves nor
duplicates it. A HALT on a branch with no PR still creates the placeholder — the retry then
adopts it, which is what tasks 5 and 13 prove.

**`conductor.ts` stays a minimal insertion.** Roughly 40 unmerged spec branches touch that file
(overlap scan, 2026-08-09), so all new logic lives in `halt-pr-rehabilitation.ts`;
`conductor.ts` receives two call lines and one small private wrapper.

## Prerequisites

- None. No migration, no config key, no new dependency.

## Tasks

### Task 1: Add the resume-clear primitive with its happy path
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: given a PR with the `needs-remediation` label and the body marker,
   `clearHaltStateForResume` returns `'cleared'` and the fake gh records both a label-remove call
   and a body edit that no longer contains `<!-- conductor:needs-remediation -->`.
2. Verify test fails (RED)
3. Implement `clearHaltStateForResume` in `halt-pr-rehabilitation.ts`: one state read, then
   `cleanupHaltPresentation(gh, cwd, prUrl, log, sleep, { preserveDraft: true })`.
4. Verify test passes (GREEN)
5. Commit: "feat(halt-pr): add clearHaltStateForResume primitive"

**Files likely touched:**
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — new exported function
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — new describe block

**Wired-into:** none (inert until src/conductor/src/engine/conductor.ts)
> **Amended 2026-08-10 by #1415:** The primitive is now called by the dispatch-boundary
> wrapper, so Tasks 1–5 have a reachable production surface. The original inert declaration
> remains as the historical pre-wiring assertion.

**Wired-into:** src/conductor/src/engine/conductor.ts#clearRetainedHaltStateForDispatch
**Dependencies:** none

### Task 2: Preserve draft status through the clear
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: given a halted **draft** PR, after `clearHaltStateForResume` the fake gh
   received no `pr ready` call and the PR's `isDraft` is still true.
2. Verify test fails (RED)
3. Implement: assert the `preserveDraft: true` option is threaded; no ready-flip path exists in
   this function.
4. Verify test passes (GREEN)
5. Commit: "test(halt-pr): resume clear never flips a draft ready"

**Files likely touched:**
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — option threading
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — draft-preservation case

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 3: Report `partial` when either facet cannot be confirmed
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: with a fake gh whose re-read still shows the label (or still shows the
   marker), `clearHaltStateForResume` returns `'partial'` — never `'cleared'` — after its retries.
2. Verify test fails (RED)
3. Implement: fold `cleanupHaltPresentation`'s `'partial'` outcome and an unconfirmed marker
   re-read into a `'partial'` return.
4. Verify test passes (GREEN)
5. Commit: "fix(halt-pr): unconfirmed clear reports partial, never success"

**Files likely touched:**
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — outcome folding
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — two unconfirmed cases

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 4: Tolerate an unreachable GitHub and a marker-less PR
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: (a) a gh that rejects every call yields `'gh-unavailable'` and does not
   throw; (b) a PR carrying the label but no marker still has its label removed and returns
   `'cleared'`.
2. Verify test fails (RED)
3. Implement: wrap the state read in try/catch returning `'gh-unavailable'`; do not require the
   marker to be present before removing the label.
4. Verify test passes (GREEN)
5. Commit: "fix(halt-pr): resume clear degrades without throwing"

**Files likely touched:**
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — error handling
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — degradation cases

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 5: Supersede the halt comment in place on clear
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: after two successive clears, exactly one comment carrying
   `NEEDS_REMEDIATION_MARKER` exists and its body reads as a resolution note, not a halt.
2. Verify test fails (RED)
3. Implement: `upsertComment` with the same marker, mirroring
   `halt-pr-reconciliation.ts`'s resolution-comment pattern.
4. Verify test passes (GREEN)
5. Commit: "feat(halt-pr): supersede the halt comment when the state clears"

**Files likely touched:**
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — comment upsert
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — idempotency case

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 6: Repair the retained PR before resolution returns it
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a conductor whose branch carries a placeholder PR resolves the retained PR
   and the returned identity's PR has been repaired — no label, no marker, `feat:` title.
2. Verify test fails (RED)
3. Implement: call the repair from `resolveRetainedShipDraftPrUrl` before memoizing into
   `shipDraftPrUrl`, reusing the existing private `makeRetainedShipPrPresentable` wrapper.
4. Verify test passes (GREEN)
5. Commit: "fix(conductor): repair the retained PR at resolution, not only at SHIP entry"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — repair call inside the resolver
- `src/conductor/test/engine/conductor-retained-draft-pr-identity.test.ts` — repair-on-resolve case

**Wired-into:** src/conductor/src/engine/conductor.ts#resolveRetainedShipDraftPrUrl
**Dependencies:** none

### Task 7: Keep the never-halted path free of mutations
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: resolving a retained PR with no halt signal issues exactly one `pr view`
   read and zero mutating gh calls; resolving twice in one run issues no second repair.
2. Verify test fails (RED)
3. Implement: rely on `makeRetainedPrPresentable`'s `not-halt-pr` early return and the existing
   `shipDraftPrUrl` memoization; add no unconditional writes.
4. Verify test passes (GREEN)
5. Commit: "test(conductor): retained-PR resolution stays read-only for healthy PRs"

**Files likely touched:**
- `src/conductor/test/engine/conductor-retained-draft-pr-identity.test.ts` — cost assertions

**Wired-into:** none (no new production surface)
**Dependencies:** 6

### Task 8: Never adopt or rewrite a closed or merged PR
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: with only a CLOSED (then MERGED) PR on the branch, resolution returns
   undefined and no repair call is issued against it.
2. Verify test fails (RED)
3. Implement: keep the resolver's existing OPEN-only predicate ahead of the repair call so the
   repair can never see a non-open PR.
4. Verify test passes (GREEN)
5. Commit: "test(conductor): closed and merged PRs are never adopted as retained"

**Files likely touched:**
- `src/conductor/test/engine/conductor-retained-draft-pr-identity.test.ts` — closed/merged cases

**Wired-into:** none (no new production surface)
**Dependencies:** 6

### Task 9: Run the clear once at the dispatch boundary
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test: a run whose branch PR carries the halt state clears it before the first
   step executes, and a second dispatch in the same process does not repeat the clear.
2. Verify test fails (RED)
3. Implement: a once-per-run latched call to the new primitive in `conductor.ts`'s `run()` loop,
   before step dispatch and not gated on phase.
4. Verify test passes (GREEN)
5. Commit: "feat(conductor): clear a resumed feature's halt state at the dispatch boundary"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — latched call in the run loop
- `src/conductor/test/engine/conductor-ship-draft-pr.test.ts` — boundary-ordering case

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** 1, 3

### Task 10: Escalation adopts an existing implementation PR untouched
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: with an OPEN draft PR titled `feat: x` on the branch, `escalateBuildFailure`
   leaves the title and body prose unchanged while adding the label, the marker, and one halt
   comment.
2. Verify test fails (RED)
3. Implement: confirm `findOrCreatePr`'s adoption path is used and that no `pr edit --title` is
   issued on the adopted PR; correct it if the current path rewrites either.
4. Verify test passes (GREEN)
5. Commit: "test(escalation): a HALT decorates the existing PR instead of reshaping it"

**Files likely touched:**
- `src/conductor/src/engine/build-failure-escalation.ts` — adoption assertions or fix
- `src/conductor/test/engine/build-failure-escalation.test.ts` — adoption case

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 11: Escalation stays a no-op with no commits and a failed push
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: zero commits over base yields no gh call at all; a failing push yields no
   PR, no label, and no comment.
2. Verify test fails (RED)
3. Implement: assert the existing `commitCount === 0` and push-failure early returns; add coverage
   where absent.
4. Verify test passes (GREEN)
5. Commit: "test(escalation): no GitHub artifacts without commit and push evidence"

**Files likely touched:**
- `src/conductor/test/engine/build-failure-escalation.test.ts` — two guard cases

**Wired-into:** none (no new production surface)
**Dependencies:** 10

### Task 12: The reconciliation sweep leaves a cleared PR alone
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: clear a PR's halt state, then tick `reconcileHaltPrs` against a fake gh —
   the PR is absent from the marked set and receives zero mutating calls.
2. Verify test fails (RED)
3. Implement: no production change expected — the marker strip already removes it from the
   selector; fix the clear if the test proves otherwise.
4. Verify test passes (GREEN)
5. Commit: "test(halt-pr): a cleared PR is not re-healed by the reconciliation sweep"

**Files likely touched:**
- `src/conductor/test/acceptance/halt-pr-rehabilitation.acceptance.test.ts` — sweep-after-clear case

**Wired-into:** none (no new production surface)
**Dependencies:** 1, 9

### Task 13: A partial clear converges instead of oscillating
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: a clear that removed the label but not the marker is re-healed by the next
   sweep tick, and the following dispatch's clear then succeeds — the system reaches a stable
   cleared state rather than alternating indefinitely.
2. Verify test fails (RED)
3. Implement: ensure the `partial` outcome leaves the next dispatch free to retry (no latch that
   suppresses a retry after a partial).
4. Verify test passes (GREEN)
5. Commit: "test(halt-pr): partial clears converge across dispatches"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — latch only on a confirmed clear
- `src/conductor/test/acceptance/halt-pr-rehabilitation.acceptance.test.ts` — convergence case

**Wired-into:** same as Task 9
**Dependencies:** 9, 12

### Task 14: An already-placeholdered branch recovers without hand-editing
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: a branch whose only PR is the `needs-remediation:` placeholder shape
   (#1412) reaches a `feat:`-titled draft PR with no label, no marker, and a floored body through
   re-dispatch alone — with a hand-repaired title left untouched in a second case.
2. Verify test fails (RED)
3. Implement: no production change expected beyond tasks 6 and 9; fix the ordering if the
   placeholder is consumed before the repair runs.
4. Verify test passes (GREEN)
5. Commit: "test(halt-pr): placeholder-shaped branches recover through re-dispatch"

**Files likely touched:**
- `src/conductor/test/acceptance/halt-pr-rehabilitation.acceptance.test.ts` — #1412-shape case

**Wired-into:** same as Task 9
**Dependencies:** 6, 9

### Task 15: Recovery eligibility is restored once the PR is ready
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: a cleared + ready PR is a ci-fix candidate and is not denied the
   `mergeable` label; a still-labelled PR remains ineligible on both paths; a cleared but still
   draft PR is skipped by both.
2. Verify test fails (RED)
3. Implement: no production change expected — assert `ci-fix.ts`'s label gate and
   `mergeable-sweep.ts`'s label and draft gates against the post-clear state.
4. Verify test passes (GREEN)
5. Commit: "test(sweep): cleared PRs re-enter ci-fix and mergeable eligibility"

**Files likely touched:**
- `src/conductor/test/engine/mergeable-sweep.test.ts` — eligibility matrix
- `src/conductor/test/engine/ci-fix.test.ts` — sticky-label gate after clear

**Wired-into:** none (no new production surface)
**Dependencies:** 9

## Task Dependency Graph

```
Task 1 ─┬─ Task 2
        ├─ Task 3 ─┐
        ├─ Task 4  │
        ├─ Task 5  │
        └──────────┴─ Task 9 ─┬─ Task 12 ─ Task 13
                              ├─ Task 14
                              └─ Task 15

Task 6 ─┬─ Task 7
        ├─ Task 8
        └─ Task 14

Task 10 ─ Task 11
```

Tasks 1, 6 and 10 are independent roots and may run in any order.

## Integration Points

- **After Task 9:** the full resume path is exercisable end-to-end — a halted branch clears its
  state at the next dispatch and hands a usable PR to the first consumer.
- **After Task 14:** the branches stranded today (#1395, #1412) are recoverable by clearing their
  HALT markers and letting the daemon re-dispatch.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Review conditions 1–5 covered: c1 → Tasks 1–5, 12, 13; c2 → Tasks 10, 11; c3 → Task 14;
      c4 → Task 11; c5 → Tasks 6, 9 (conductor.ts receives two call lines only)

### Wiring anchors — judged pass (2026-08-09)

`conduct-ts validate-wired-into` reports **0 FAIL** across 15 declarations. Two anchors were
examined further per the judged-pass rule:

- **Task 6 → `conductor.ts#resolveRetainedShipDraftPrUrl`.** The matcher resolved it to
  `private async resolveRetainedShipDraftPrUrl(` — the definition of the *calling* symbol, not of
  the surface being wired. Correct: the repair call is added inside this method. Not
  self-referential; `conductor.ts` is not created by this task.
- **Tasks 9, 13, 14 → `conductor.ts#run`.** The matcher resolved it to a comment line
  (`//   - verdictSteps        → either of the above (verdict recomputed after run)`), because
  `run` is a short and common token. Judged **not decorative**: `async run()` at
  `conductor.ts:3247` is genuinely the enclosing caller, and the boundary call belongs in its step
  loop beside the existing `shipDraftPrAttempted` latch (`conductor.ts:4021`). The matched line is
  a matcher artifact, not a false wiring claim — the surface is reachable. BUILD should place the
  call in that loop.
