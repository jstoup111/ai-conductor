# Implementation Plan: FINISH publication progress is not a retry (#1342)

**Date:** 2026-08-06
**Design:** .docs/architecture/a-successful-finish-publication-transition-consume.md
**Architecture review:** .docs/decisions/architecture-review-2026-08-06-a-successful-finish-publication-transition-consume.md
**Stories:** .docs/stories/a-successful-finish-publication-transition-consume.md
**Conflict check:** Clean as of 2026-08-06

## Summary

Stop the production publication adapter from rewriting a verified transition into a retry.
Carry the advance through as its own disposition kind, route it to a conductor arm that
re-enters FINISH without charging the retry budget, bound that arm with a progress allowance
and a per-transition stuck cap, and render it in the daemon log as progress rather than as a
retry. Twelve TDD tasks across four engine modules plus one renderer arm and the HARNESS.md
contract it relies on.

## Technical Approach

Four seams change, in this order:

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
   emits `finish_publication_disposition` with the progress value, emits no `step_retry`,
   and `continue`s the retry loop after undoing the attempt increment — the same
   `attempt--` mechanism the build progress bypass already uses (`:6296-6303`).

   Two counters are declared with the loop's other per-step state near `:4933`, scoped to one
   `finish` step execution:
   - `publicationProgressAttempts`, checked against a module constant equal to twice the
     publication transition count (six transitions → `12`);
   - `publicationProgressByTransition: Map<PublicationTransition, number>`, checked against a
     module constant cap of `3`.

   Reaching either bound writes a `needs-human` HALT via the existing `writeHaltMarker` +
   `saveConductorStepStatus` + `loop_halt` sequence, with a reason naming the transition.
   Constants live in `finish-publication.ts` beside the transition type so the 2× derivation
   stays adjacent to what it derives from.

4. **Telemetry** (`src/conductor/src/types/events.ts:44` and
   `src/conductor/src/daemon-cli.ts:2194`). The `finish_publication_disposition` event's
   `disposition` union gains `'progress'`; the renderer gains its line and a distinct glyph.
   `event-sinks.ts` needs no change — the event type is already registered with
   `render: true, persist: true`.

Sequencing rationale: the adapter (2) must follow the type + route change (1) or it emits a
kind the boundary rejects; the conductor arm (3) must follow (2) or it is unreachable; the
event union (4) must precede the conductor arm's emit or it does not typecheck. Documentation
(Task 12) has no code ordering constraint.

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

### Task 2: A malformed progress disposition still fails closed

**Story:** Story 1 negative path — an unknown transition or an extra key is rejected rather
than treated as progress.
**Type:** negative-path

**Steps:**
1. Write failing test: assert `{ kind: 'publication_progress', transition: 'not_a_transition' }`
   and `{ kind: 'publication_progress', transition: 'ready_pr', extra: 1 }` both route to
   `{ kind: 'halt' }` with the unknown-disposition reason.
2. Verify test fails (RED)
3. Implement: confirm the validator arm rejects both; tighten the key check if either slips through.
4. Verify test passes (GREEN)
5. Commit with message: "reject malformed progress dispositions fail-closed"

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — validator arm
- src/conductor/test/engine/finish-publication.test.ts — fail-closed tests

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: The production adapter reports a verified advance as progress

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

### Task 4: Genuine verification failures still pass through as retries

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

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 5: A progress route re-enters FINISH without charging the budget

**Story:** Story 2 — the attempt counter is unchanged across a `progress_finish` route.
**Type:** happy-path

**Steps:**
1. Write failing test: run the conductor's FINISH step against a publication stub returning one
   `publication_progress` then `complete`; assert the step succeeded and that no `step_retry`
   event was emitted.
2. Verify test fails (RED)
3. Implement: add the `progress_finish` arm at `conductor.ts:5493`, emitting the progress
   disposition event and `continue`ing after `attempt--`.
4. Verify test passes (GREEN)
5. Commit with message: "re-enter FINISH on publication progress without spending a retry"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — `progress_finish` arm in the finish publication block
- src/conductor/test/engine/conductor-finish-publication.test.ts — progress accounting test

**Wired-into:** src/conductor/src/engine/conductor.ts#finish retry loop
**Dependencies:** Task 3, Task 11

### Task 6: A five-transition success completes with its retry budget intact

**Story:** Story 2 — the regression #1342 asks for by name.
**Type:** happy-path

**Steps:**
1. Write failing test: drive FINISH through five successive `publication_progress` dispositions
   then `complete`; assert success, assert zero `step_retry` events, then assert a following
   genuine `publication_retry` run still receives the full retry allowance before halting.
2. Verify test fails (RED)
3. Implement: no new production code expected — this pins Task 5's behavior end to end. Fix any
   accounting gap the test exposes.
4. Verify test passes (GREEN)
5. Commit with message: "pin a full successful publication leaves the retry budget unspent"

**Files likely touched:**
- src/conductor/test/engine/conductor-finish-publication.test.ts — full-publication regression

**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 7: The total progress allowance bounds the non-charging re-entry

**Story:** Story 3 — a publication that never completes halts at the allowance.
**Type:** happy-path

**Steps:**
1. Write failing test: a stub returning `publication_progress` for alternating transitions
   forever; assert the run halts after the allowance is reached rather than looping, with a
   `needs-human` HALT.
2. Verify test fails (RED)
3. Implement: declare `publicationProgressAttempts` near `conductor.ts:4933` and the allowance
   constant in `finish-publication.ts`; halt when the allowance is reached.
4. Verify test passes (GREEN)
5. Commit with message: "bound publication progress re-entry with a total allowance"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — progress counter and allowance halt
- src/conductor/src/engine/finish-publication.ts — allowance constant beside the transition type
- src/conductor/test/engine/conductor-finish-publication.test.ts — allowance bound test

**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 8: A stuck transition halts with its name in the reason

**Story:** Story 3 — a single transition exceeding the per-transition cap halts naming it.
**Type:** happy-path

**Steps:**
1. Write failing test: a stub returning `publication_progress` for `ready_pr` repeatedly;
   assert the halt reason contains `ready_pr` and that it fires at the cap, before the total
   allowance would.
2. Verify test fails (RED)
3. Implement: add the per-transition tally and its cap constant; halt with the transition named.
4. Verify test passes (GREEN)
5. Commit with message: "halt naming the publication transition that stopped progressing"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — per-transition tally and stuck halt
- src/conductor/src/engine/finish-publication.ts — cap constant
- src/conductor/test/engine/conductor-finish-publication.test.ts — stuck-transition test

**Wired-into:** same as Task 5
**Dependencies:** Task 7

### Task 9: A legitimate revisit is not a stall, and counters reset per step entry

**Story:** Story 3 negative paths — `establish_pr` twice is permitted; counters do not carry
across step entries.
**Type:** negative-path

**Steps:**
1. Write failing test: replay the observed PR #1337 shape — `establish_pr`,
   `write_shipped_record`, `establish_pr`, `ready_pr`, `record_outcome`, `complete`; assert
   success with no halt. Add a second test re-entering the FINISH step after a prior execution
   that consumed progress, asserting the counters start from zero.
2. Verify test fails (RED)
3. Implement: confirm counter declaration is inside the per-step scope; move it if the second
   test proves otherwise.
4. Verify test passes (GREEN)
5. Commit with message: "permit legitimate transition revisits and reset progress per step"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — counter scope
- src/conductor/test/engine/conductor-finish-publication.test.ts — revisit and reset tests

**Wired-into:** same as Task 5
**Dependencies:** Task 8

### Task 10: Existing publication routing outcomes are provably unchanged

**Story:** Story 4 — failure charging, exhaustion halt, non-retryable first-observation halt,
BUILD kickback, human-required halt and fail-closed halt all behave as before.
**Type:** negative-path

**Steps:**
1. Write failing test: a table driving each of the five pre-existing route kinds through the
   conductor's FINISH block; assert charged-attempt counts and terminal outcomes match the
   pre-change behavior, including the non-retryable path's deliberately-unspent budget.
2. Verify test fails (RED)
3. Implement: adjust the new arm's placement if any existing outcome is captured by it.
4. Verify test passes (GREEN)
5. Commit with message: "pin existing FINISH publication routing outcomes unchanged"

**Files likely touched:**
- src/conductor/test/engine/conductor-finish-publication.test.ts — routing non-regression table
- src/conductor/test/engine/conductor-finish-publication-defect.test.ts — existing expectations updated only where the adapter's label changed

**Wired-into:** same as Task 5
**Dependencies:** Task 9

### Task 11: The daemon log renders progress as progress, not as a retry

**Story:** Story 5 — the disposition event carries a progress value with a distinct glyph, and
existing renderings are unchanged.
**Type:** happy-path

**Steps:**
1. Write failing test: assert the `finish_publication_disposition` event with the progress value
   renders a progress line with a glyph distinct from the retry, halt and complete glyphs, and
   assert the four existing values render exactly as before.
2. Verify test fails (RED)
3. Implement: append `'progress'` to the event union in `types/events.ts:44` and add the
   renderer arm in `daemon-cli.ts:2194`.
4. Verify test passes (GREEN)
5. Commit with message: "render FINISH publication progress distinctly from a retry"

**Files likely touched:**
- src/conductor/src/types/events.ts — disposition value union
- src/conductor/src/daemon-cli.ts — disposition renderer arm
- src/conductor/test/engine/daemon-render.test.ts — rendering tests

**Wired-into:** src/conductor/src/engine/conductor.ts#finish publication disposition emit
**Dependencies:** Task 1

### Task 12: HARNESS.md names a verified publication advance in the non-budget class

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
Task 1 ──┬── Task 2
         ├── Task 11 ──┐
         └── Task 3 ───┼── Task 5 ── Task 6
                │      │      └── Task 7 ── Task 8 ── Task 9 ── Task 10
                └── Task 4

Task 12                (documentation — no ordering against 1-11)
```

## Integration Points

- After Task 4: the boundary distinguishes progress from failure, and no failure path has been
  weakened — the correctness precondition for changing the accounting.
- After Task 6: #1342's headline outcome holds — a successful ship spends no retries and keeps a
  full allowance for a real transient.
- After Task 9: the non-charging re-entry is provably bounded by two independent limits, and a
  healthy revisit is not misread as a stall.
- After Task 10: every pre-existing FINISH publication outcome is pinned unchanged.
- After Task 11: an operator reading a successful ship's daemon log sees forward progress only.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
