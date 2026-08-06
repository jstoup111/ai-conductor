# Implementation Plan: FINISH publication progress is not a retry (#1342)

**Date:** 2026-08-06
**Design:** .docs/architecture/a-successful-finish-publication-transition-consume.md
**Architecture review:** .docs/decisions/architecture-review-2026-08-06-a-successful-finish-publication-transition-consume.md
**Stories:** .docs/stories/a-successful-finish-publication-transition-consume.md
**Conflict check:** Clean as of 2026-08-06

## Summary

Stop the production publication adapter from rewriting a verified transition into a retry.
Carry the advance through as its own disposition kind, route it to a conductor arm that
re-enters FINISH without charging the retry budget, and bound that arm with a progress
allowance whose halt names the transition it stopped on. Eight TDD tasks across three engine
modules plus the HARNESS.md contract they rely on.

**Scope note (deliberate reductions, 2026-08-06).** Three things a larger version of this
change could do are excluded, each because no #1342 outcome requires it:

- **No new telemetry event value or renderer arm.** Outcome 4 ("no `↻ finish retry` line
  follows a `✓`") is satisfied the moment the progress arm stops emitting `step_retry`. The
  `✓ FINISH publication: <transition>` line already comes from the existing
  `finish_publication_transition` event, so `types/events.ts` and `daemon-cli.ts` are not
  touched at all.
- **One termination bound, not two.** The total progress allowance alone guarantees
  termination; its halt reason names the transition the run stopped on, which is what
  outcome 3 asks for. A separate per-transition stuck cap is a sharper diagnostic, not a
  correctness requirement, and is left for a follow-up if the allowance halt proves too
  coarse in practice.
- **Negative paths are consolidated into one table task** rather than one task each. The one
  exception is the genuine-failure pass-through (Task 3), which stays its own task because it
  pins the safety property this entire redesign rests on.

## Technical Approach

Three seams change, in this order:

1. **Disposition boundary** (`src/conductor/src/engine/finish-publication.ts`).
   `PublicationDisposition` gains `{ kind: 'publication_progress'; transition:
   PublicationTransition }`, `FinishPublicationRoute` gains `{ kind: 'progress_finish';
   transition: PublicationTransition }`, `routeFinishPublicationDisposition` (`:536`) gains
   the matching arm, and `isExactDisposition` (`:583`) enrolls the new kind under the same
   exact-key discipline it applies to `complete` and `human_required`. The union widening and
   the validator MUST land in the same task — see the architecture review's condition 1.

   `PUBLICATION_RETRY_REASONS` (`:437`) is NOT edited. All five reason strings the adapter
   currently synthesises stay valid, because `advanceFinishPublication` still emits them for
   genuine failures (`:1085`, `:1132`, `:1201`, `:1230`, `:1269`).

2. **Production adapter** (`src/conductor/src/engine/finish-publication-production.ts:338-356`).
   The `if (result.kind === 'advanced')` block currently returns a `publication_retry` with a
   transition-derived reason. It returns `{ kind: 'publication_progress', transition:
   result.transition }` instead. The verify-after-write discipline documented at `:338` is
   untouched — only the label on its successful outcome changes. Every non-`advanced` result
   continues to pass through with `return result`.

3. **Conductor accounting** (`src/conductor/src/engine/conductor.ts:5486-5540`). A new
   `route.kind === 'progress_finish'` arm sits beside the existing `retry_finish` arm. It
   emits no event at all — deliberately, so no `↻` line can follow a `✓` — and `continue`s
   the retry loop after undoing the attempt increment, the same `attempt--` mechanism the
   build progress bypass already uses (`:6296-6303`).

   One counter is declared with the loop's other per-step state near `:4933`, scoped to a
   single `finish` step execution: `publicationProgressAttempts`, checked against a module
   constant equal to twice the publication transition count (six transitions → `12`). It also
   records the last transition seen, so the halt can name it.

   Reaching the allowance writes a `needs-human` HALT via the existing `writeHaltMarker` +
   `saveConductorStepStatus` + `loop_halt` sequence, with a reason naming the transition the
   run stopped on. The constant lives in `finish-publication.ts` beside the transition type so
   the 2× derivation stays adjacent to what it derives from.

Sequencing rationale: the adapter (2) must follow the type + route change (1) or it emits a
kind the boundary rejects; the conductor arm (3) must follow (2) or it is unreachable.
Documentation (Task 8) has no code ordering constraint.

## Prerequisites

- None. No migration, no configuration key, no schema change, no new dependency.
- Release surface: no `bin/conduct` CLI, hook wiring, skill symlink or `settings.json` schema
  change, so no migration block and no release waiver are required.

## Tasks

### Task 1: The disposition boundary admits a progress kind

**Story:** Story 1 — a verified advance arrives as its own disposition kind and routes to
`progress_finish`, not `retry_finish`.
**Type:** happy-path

**Steps:**
1. Write failing test: assert `routeFinishPublicationDisposition({ kind:
   'publication_progress', transition: 'establish_pr' })` returns `{ kind: 'progress_finish',
   transition: 'establish_pr' }`, and assert the same for all six transitions.
2. Verify test fails (RED)
3. Implement: widen `PublicationDisposition` and `FinishPublicationRoute`, add the route arm,
   and enroll `publication_progress` in `isExactDisposition` with `hasOnly('kind',
   'transition')` plus `isPublicationTransition`.
4. Verify test passes (GREEN)
5. Commit with message: "admit a publication progress disposition at the routing boundary"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — disposition union, route union, route arm, validator arm
- src/conductor/test/engine/finish-publication.test.ts — routing test for all six transitions

**Wired-into:** src/conductor/src/engine/conductor.ts#routeFinishPublicationDisposition call site
**Dependencies:** none

### Task 2: The production adapter reports a verified advance as progress

**Story:** Story 1 — the adapter maps `{ kind: 'advanced' }` to `publication_progress`
carrying no reason string.
**Type:** happy-path

**Steps:**
1. Write failing test: drive the production adapter with a stubbed advance returning
   `{ kind: 'advanced', transition: 'write_shipped_record' }`; assert the returned disposition
   is `{ kind: 'publication_progress', transition: 'write_shipped_record' }` and has no `reason`.
2. Verify test fails (RED)
3. Implement: replace the `result.kind === 'advanced'` reason-synthesising block at
   `finish-publication-production.ts:338-356` with the progress disposition.
4. Verify test passes (GREEN)
5. Commit with message: "stop relabelling a verified publication advance as a retry"

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts — advanced-result mapping
- src/conductor/test/engine/finish-publication-production.test.ts — adapter mapping test

**Wired-into:** src/conductor/src/engine/conductor.ts#finish step publication dispatch
**Dependencies:** Task 1

### Task 3: Genuine verification failures still pass through as retries

**Story:** Story 1 negative path — a real `pr_identity_not_verified_after_establish` from the
state machine still routes to `retry_finish`, and all five previously-synthesised reasons stay
valid.
**Type:** negative-path

**Steps:**
1. Write failing test: drive the adapter with a stubbed advance returning
   `{ kind: 'publication_retry', transition: 'establish_pr', reason:
   'pr_identity_not_verified_after_establish' }`; assert it passes through unchanged and routes
   to `retry_finish`. Add a table test asserting all five reasons remain accepted by
   `isExactDisposition` for their transitions.
2. Verify test fails (RED)
3. Implement: confirm the untouched `return result` path and the unedited
   `PUBLICATION_RETRY_REASONS` table satisfy both.
4. Verify test passes (GREEN)
5. Commit with message: "pin that real publication verification failures stay retries"

**Files likely touched:**
- src/conductor/test/engine/finish-publication-production.test.ts — pass-through test
- src/conductor/test/engine/finish-publication.test.ts — reason-validity table test

**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 4: A progress route re-enters FINISH without charging the budget

**Story:** Story 2 — the attempt counter is unchanged across a `progress_finish` route.
**Story:** Story 5 — no retry-announcing event is emitted for a successful transition.
**Type:** happy-path

**Steps:**
1. Write failing test: run the conductor's FINISH step against a publication stub returning one
   `publication_progress` then `complete`; assert the step succeeded and that no `step_retry`
   event was emitted.
2. Verify test fails (RED)
3. Implement: add the `progress_finish` arm at `conductor.ts:5493`, emitting no event and
   `continue`ing after `attempt--`.
4. Verify test passes (GREEN)
5. Commit with message: "re-enter FINISH on publication progress without spending a retry"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — `progress_finish` arm in the finish publication block
- src/conductor/test/engine/conductor-finish-publication.test.ts — progress accounting test

**Wired-into:** src/conductor/src/engine/conductor.ts#finish retry loop
**Dependencies:** Task 2

### Task 5: A five-transition success completes with its retry budget intact

**Story:** Story 2 — the regression #1342 asks for by name.
**Story:** Story 5 — zero `step_retry` events over a fully-successful publication.
**Type:** happy-path

**Steps:**
1. Write failing test: drive FINISH through five successive `publication_progress` dispositions
   then `complete`; assert success, assert zero `step_retry` events over the whole run, then
   assert a following genuine `publication_retry` run still receives the full retry allowance
   before halting.
2. Verify test fails (RED)
3. Implement: no new production code expected — this pins Task 4's behavior end to end. Fix any
   accounting gap the test exposes.
4. Verify test passes (GREEN)
5. Commit with message: "pin a full successful publication leaves the retry budget unspent"

**Files likely touched:**
- src/conductor/test/engine/conductor-finish-publication.test.ts — full-publication regression

**Wired-into:** same as Task 4
**Dependencies:** Task 4

### Task 6: The progress allowance bounds the re-entry and names the stuck transition

**Story:** Story 3 — a publication that never completes halts at the allowance, naming the
transition it stopped on.
**Type:** happy-path

**Steps:**
1. Write failing test: a stub returning `publication_progress` forever — once for alternating
   transitions, once for `ready_pr` repeatedly; assert both halt after the allowance rather than
   looping, with a `needs-human` HALT whose reason contains the last transition seen (`ready_pr`
   in the repeated case).
2. Verify test fails (RED)
3. Implement: declare `publicationProgressAttempts` and the last-transition record near
   `conductor.ts:4933`, and the allowance constant in `finish-publication.ts`; halt when the
   allowance is reached.
4. Verify test passes (GREEN)
5. Commit with message: "bound publication progress re-entry and name the stuck transition"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — progress counter, last-transition record, allowance halt
- src/conductor/src/engine/finish-publication.ts — allowance constant beside the transition type
- src/conductor/test/engine/conductor-finish-publication.test.ts — allowance bound tests

**Wired-into:** same as Task 4
**Dependencies:** Task 4

### Task 7: Consolidated negative paths — fail-closed, revisits, reset, and no routing regression

**Story:** Story 1 negative path — malformed progress dispositions halt fail-closed.
**Story:** Story 3 negative paths — a legitimate revisit is not a stall, and the counter
resets per step entry.
**Story:** Story 4 — every pre-existing routing outcome is unchanged.
**Type:** negative-path

**Steps:**
1. Write failing test: one table covering (a) `publication_progress` with an unknown transition
   and with an extra key, both routing to a halt; (b) the observed PR #1337 replay —
   `establish_pr`, `write_shipped_record`, `establish_pr`, `ready_pr`, `record_outcome`,
   `complete` — succeeding with no halt; (c) a fresh FINISH step entry after a prior execution
   that consumed progress, asserting the counter starts at zero; (d) each of the five
   pre-existing route kinds (retry, exhaustion, non-retryable first-observation, BUILD kickback,
   human-required) asserting charged-attempt counts and terminal outcomes match pre-change
   behavior.
2. Verify test fails (RED)
3. Implement: tighten the validator arm, move the counter into per-step scope, or adjust the new
   arm's placement — whichever the table exposes.
4. Verify test passes (GREEN)
5. Commit with message: "pin fail-closed progress, legitimate revisits, and unchanged routing"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — validator arm
- src/conductor/src/engine/conductor.ts — counter scope, arm placement
- src/conductor/test/engine/conductor-finish-publication.test.ts — consolidated negative table
- src/conductor/test/engine/conductor-finish-publication-defect.test.ts — existing expectations updated only where the adapter's label changed

**Wired-into:** same as Task 4
**Dependencies:** Task 6

### Task 8: HARNESS.md names a verified publication advance in the non-budget class

**Story:** Story 2 — the governing contract this change relies on is stated where readers find it.
**Type:** happy-path

**Steps:**
1. Write failing check: run `test/test_harness_integrity.sh` and confirm it passes before and
   after; assert by inspection that `HARNESS.md`'s non-budget-consuming enumeration currently
   omits publication progress.
2. Verify the gap exists (RED)
3. Implement: extend the `HARNESS.md:307` enumeration to include a verified FINISH publication
   advance, and update the affected page under `docs/` per the documentation-upkeep rule.
4. Verify `test/test_harness_integrity.sh` passes (GREEN)
5. Commit with message: "name publication progress in the non-budget-consuming retry class"

**Files likely touched:**
- HARNESS.md — non-budget-consuming retry enumeration
- docs/explanation/gates.md — publication retry accounting description

**Wired-into:** documentation surface — no production caller
**Dependencies:** none

## Task Dependency Graph

```
Task 1 ── Task 2 ──┬── Task 3
                   └── Task 4 ──┬── Task 5
                                └── Task 6 ── Task 7

Task 8              (documentation — no ordering against 1-7)
```

## Integration Points

- After Task 3: the boundary distinguishes progress from failure, and no failure path has been
  weakened — the correctness precondition for changing the accounting.
- After Task 5: #1342's headline outcome holds — a successful ship spends no retries, keeps a
  full allowance for a real transient, and its daemon log carries no retry line.
- After Task 6: the non-charging re-entry is provably bounded, and a stall names its transition.
- After Task 7: every pre-existing FINISH publication outcome is pinned unchanged and a healthy
  revisit is proven not to be misread as a stall.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
