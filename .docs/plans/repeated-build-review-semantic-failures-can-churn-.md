# Implementation Plan: bounded build_review convergence and removal-anchored Tautology grading

**Date:** 2026-08-12
**Stories:** .docs/stories/repeated-build-review-semantic-failures-can-churn-.md
**Conflict check:** Clean as of 2026-08-12

## Summary

Adds a cumulative, tree-movement-proof convergence bound to `build_review` that terminates in an
operator-visible `needs-human` halt, and an engine-computed removal-evidence channel that narrows
the Tautology rubric so removal maintenance stops being graded as a tautology. 20 tasks.

## Technical Approach

Two independent changes that share no code and are sequenced only by convenience.

**The bound (Tasks 1–12).** `KickbackGateEntry` gains a `cumulative` counter. The existing
`madeProgress` branch in `bumpKickbackGate` decides `count` exactly as it does today and is not
touched; `cumulative` is incremented outside that branch, so tree movement cannot reset it. The
type guard folds a missing `cumulative` to `0` rather than rejecting, so a ledger written by the
current engine reads clean — an in-flight feature gets a fresh budget, never a spurious halt.
A `build_review` PASS clears `cumulative` only. Exceeding the cap of 5 writes
`writeHaltMarker(..., 'needs-human')` — required by `adr-2026-07-28` D1, since retry safety is not
mechanically provable here, and required by `adr-013`'s sweep, which retains `needs-human` and
recycles anything weaker. A config block mirroring `KickbackEscalationConfig` gates the halt only:
when disabled the counter still increments and still rides the event, because the observability is
what keeps the ledger field spine-compliant rather than a parallel channel.

**The evidence (Tasks 13–20).** A new deriver parses the diff `assembleBuildReviewInputs` has
already produced, at the merge base it has already resolved, and issues no `git` subprocess of its
own. It reports three removal kinds — deleted files, deleted exported declarations, and removed
members of exported types. The third is the one that matters: the incident's flagged fixture tracked
a type that lost a member, so a removals-only predicate would not have covered the finding that
caused the churn. The result travels as `removalContext` on `BuildReviewInputs` and renders as a
fourth evidence block beside `repairContext`, `acceptedWidenings`, and `gateInstructions`, reusing
their framing verbatim: evidence, not an exemption. The Tautology rubric then carries a
three-condition per-test predicate. Parsing is deliberately approximate — an under-derived removal
simply means ordinary mutation-sensitivity applies, which is today's behavior, so the deriver fails
in the safe direction.

**Rubric-count independence.** `adr-2026-08-11-wiring-judged-in-build-review` is APPROVED and
extends the all-or-FAIL rule from four items to five; its implementation is unmerged (PR #1517).
The operator sequenced this spec first, so no task may assert how many rubric items exist. Task 20
asserts item-count-agnostically.

**Documentation is not planned here.** This repository configures a gating
`maintain-documentation` step (`.ai-conductor/config.yml:127`, after rebase) which owns
human-facing docs, and `/plan`'s documentation boundary forbids doc tasks. Two obligations are
recorded here so that step does not lose them:

1. `docs/explanation/gates.md` — the narrowed Tautology rubric and the new `build_review` terminal
   state.
2. `docs/runbooks/stalled-or-stuck-feature.md` — **required by conflict-check Conflict 3**: clearing
   a cumulative-cap halt requires resetting the gate's `cumulative` in
   `.pipeline/kickback-ledger.json` or setting the kill-switch. Re-dispatching without either
   re-halts on the next lap, because `cumulative` is durable and only a PASS clears it.

## Prerequisites

None. Every file and seam already exists.

## Tasks

### Task 1: Declare the cumulative field on the ledger entry
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `isKickbackGateEntry` accepts an object carrying `cumulative: 0` and the
   entry type exposes it.
2. Verify test fails (RED)
3. Implement: add `cumulative: number` to `KickbackGateEntry` and to the type guard's checks.
4. Verify test passes (GREEN)
5. Commit with message: "add cumulative counter field to kickback gate entry"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — entry interface and type guard

**Wired-into:** src/conductor/src/engine/conductor.ts#consumeKickbackBudget
**Dependencies:** none

### Task 2: Read a legacy entry with no cumulative key as zero
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a ledger file whose `build_review` entry omits `cumulative` entirely is
   accepted as valid and resolves that entry's `cumulative` to `0` — not rejected, not folded to an
   empty ledger.
2. Verify test fails (RED)
3. Implement: treat a missing `cumulative` as `0` in the guard rather than failing the shape check.
4. Verify test passes (GREEN)
5. Commit with message: "read a pre-cumulative ledger entry as zero rather than rejecting it"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — type guard tolerance

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 3: Reject a malformed cumulative value
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: an entry whose `cumulative` is `"3"` or `null` is rejected by the guard and
   `readKickbackLedger` returns an empty ledger with a warning, matching its behavior for any other
   malformed field.
2. Verify test fails (RED)
3. Implement: type-check `cumulative` when the key is present.
4. Verify test passes (GREEN)
5. Commit with message: "reject a non-numeric cumulative value in the kickback ledger"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — type guard

**Wired-into:** same as Task 1
**Dependencies:** 2

### Task 4: Increment cumulative regardless of tree movement
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: consuming a kickback with a changed `treeHash` against an entry at
   `cumulative: 2` returns `cumulative: 3` and `count: 1`; consuming with an unchanged tree returns
   `cumulative: 3` and `count: 2`.
2. Verify test fails (RED)
3. Implement: increment `cumulative` in `bumpKickbackGate` outside the `madeProgress` branch,
   leaving the `nextCount` computation untouched.
4. Verify test passes (GREEN)
5. Commit with message: "increment the cumulative kickback counter on every lap"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — `bumpKickbackGate`

**Wired-into:** same as Task 1
**Dependencies:** 3

### Task 5: Reproduce the eight-lap incident against the ledger
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: eight successive kickbacks each supplying a distinct `treeHash` yield
   `cumulative` 1..8 while `count` reads 1 on every one — the exact shape of the #1521 event
   ledger. Assert in the same test that a kickback for `test_suite` leaves the `build_review`
   entry's `cumulative` unchanged.
2. Verify test fails (RED)
3. Implement: no production change expected; if the assertion fails, correct `bumpKickbackGate`.
4. Verify test passes (GREEN)
5. Commit with message: "regression-test the eight-lap churn against the cumulative counter"

**Files likely touched:**
- `src/conductor/test/engine/kickback-ledger.test.ts` — regression coverage

**Wired-into:** none (no new production surface)
**Dependencies:** 4

### Task 6: Add a cumulative reset for a single gate
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: resetting `build_review` on an entry at `cumulative: 4, count: 2` yields
   `cumulative: 0, count: 2`, and leaves every other gate's entry untouched.
2. Verify test fails (RED)
3. Implement: export a ledger function that zeroes one gate's `cumulative` and persists atomically
   through the existing write path.
4. Verify test passes (GREEN)
5. Commit with message: "add a per-gate cumulative reset to the kickback ledger"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — reset function

**Wired-into:** none (inert until Task 7)
**Dependencies:** 4

### Task 7: Clear cumulative when build_review passes
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: a `build_review` PASS calls the reset so the entry reads `cumulative: 0`
   with `count` preserved; a FAIL does not reset.
2. Verify test fails (RED)
3. Implement: call the Task 6 reset on the `build_review` PASS path where the step status is
   recorded.
4. Verify test passes (GREEN)
5. Commit with message: "clear the cumulative kickback count when build_review passes"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — build_review PASS path

**Wired-into:** src/conductor/src/engine/conductor.ts#saveConductorStepStatus
**Dependencies:** 6

### Task 8: Survive a missing or unreadable ledger on reset
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: a `build_review` PASS with no ledger file present completes without error,
   creates no spurious entry, and does not fail the passing step; an unreadable ledger likewise
   does not interrupt the run.
2. Verify test fails (RED)
3. Implement: make the reset a tolerant no-op on a missing or unreadable ledger, matching
   `readKickbackLedger`'s existing fail-open stance.
4. Verify test passes (GREEN)
5. Commit with message: "make the cumulative reset a tolerant no-op on a missing ledger"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — reset tolerance

**Wired-into:** same as Task 7
**Dependencies:** 7

### Task 9: Declare the cap and report cumulative exhaustion
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test: an exported cap constant equals 5, and `bumpKickbackGate`'s result reports
   cumulative exhaustion once `cumulative` exceeds it and not at exactly the cap.
2. Verify test fails (RED)
3. Implement: add the named cap constant and a distinct cumulative-exhaustion flag on the bump
   result, leaving the existing `exhausted` flag's meaning unchanged.
4. Verify test passes (GREEN)
5. Commit with message: "declare the cumulative build_review cap and its exhaustion signal"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — cap constant and result shape

**Wired-into:** src/conductor/src/engine/conductor.ts#consumeKickbackBudget
**Dependencies:** 4

### Task 10: Halt for a human when the cumulative cap is exceeded
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: six `build_review` FAIL laps, each with a distinct tree hash, write a halt
   marker on the sixth and navigate back to `build` on the fifth.
2. Verify test fails (RED)
3. Implement: consult the cumulative exhaustion flag in the `build_review` FAIL branch, before the
   existing per-tree `exhausted` branch, and call `writeHaltMarker` with `needs-human`.
4. Verify test passes (GREEN)
5. Commit with message: "halt for a human when build_review exceeds its cumulative cap"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — build_review FAIL branch

**Wired-into:** src/conductor/src/engine/conductor.ts#writeHaltMarker
**Dependencies:** 9

### Task 11: Name the gate, count, cap and reason in the halt
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: the halt reason contains `build_review`, the cumulative lap count, the cap,
   and the entry's `lastReason`; the halt class sidecar reads `needs-human`; a `loop_halt` event
   carrying that reason reaches the event ledger.
2. Verify test fails (RED)
3. Implement: compose the reason string and emit `loop_halt` through the existing halt path.
4. Verify test passes (GREEN)
5. Commit with message: "name gate, lap count, cap and reason in the cumulative cap halt"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — halt reason and emission

**Wired-into:** same as Task 10
**Dependencies:** 10

### Task 12: Emit exactly one halt when both bounds exhaust together
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: a lap on which the per-tree `count` is exhausted AND the cumulative cap is
   exceeded writes exactly one halt marker with an unambiguous reason naming which bound
   terminated the run; a gate other than `build_review` keeps its existing halt reason byte-for-byte.
2. Verify test fails (RED)
3. Implement: make the two branches mutually exclusive at the single call site.
4. Verify test passes (GREEN)
5. Commit with message: "emit a single unambiguous halt when both kickback bounds exhaust"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — build_review FAIL branch ordering

**Wired-into:** same as Task 10
**Dependencies:** 11

### Task 13: Add the kill-switch config block
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test: an absent block resolves to enabled; a block with `enabled: false` resolves
   to disabled; an unknown sibling key is ignored and `enabled` is still honored.
2. Verify test fails (RED)
3. Implement: declare an optional config interface with a single optional `enabled` field and a doc
   comment stating that an absent block resolves to enabled, mirroring `KickbackEscalationConfig`.
4. Verify test passes (GREEN)
5. Commit with message: "add the cumulative convergence bound kill-switch config block"

**Files likely touched:**
- `src/conductor/src/types/config.ts` — config interface

**Wired-into:** none (inert until Task 14)
**Dependencies:** none

### Task 14: Gate only the halt on the kill-switch
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: with `enabled: false`, ten changed-tree FAIL laps produce no cumulative cap
   halt while `cumulative` still increments; the per-tree `count` halt still fires; with the block
   absent, the cap halt fires on the sixth lap.
2. Verify test fails (RED)
3. Implement: consult the resolved switch at the cap check only — never around the increment.
4. Verify test passes (GREEN)
5. Commit with message: "gate the cumulative cap halt on its kill-switch, not the counter"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — cap check

**Wired-into:** same as Task 10
**Dependencies:** 13

### Task 15: Declare cumulativeCount on the kickback event
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: the `kickback` event type accepts an optional `cumulativeCount` and a
   consumer reading only `count` still parses an event carrying it.
2. Verify test fails (RED)
3. Implement: add optional `cumulativeCount: number` to the `kickback` union member with a doc
   comment distinguishing it from `count`.
4. Verify test passes (GREEN)
5. Commit with message: "declare cumulativeCount on the kickback event"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — kickback union member

**Wired-into:** none (inert until Task 16)
**Dependencies:** none

### Task 16: Populate cumulativeCount at the emit site
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: a `build_review` FAIL bringing `cumulative` to 3 emits a `kickback` event
   carrying `cumulativeCount: 3` alongside its existing `count`; the switch being off does not
   suppress the field.
2. Verify test fails (RED)
3. Implement: read the figure from the bump result and pass it at the existing emit call.
4. Verify test passes (GREEN)
5. Commit with message: "carry the cumulative lap count on the kickback event"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — kickback emission

**Wired-into:** src/conductor/src/engine/conductor.ts#emitTracked
**Dependencies:** 15

### Task 17: Make the eight-lap history readable in the event ledger
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: eight successive `build_review` kickbacks emit events reading
   `cumulativeCount` 1..8 with `count` 1 throughout — the history the incident could not show. A
   kickback for a gate the bound does not cover omits the field without breaking the schema.
2. Verify test fails (RED)
3. Implement: no production change expected; correct the emission if the assertion fails.
4. Verify test passes (GREEN)
5. Commit with message: "regression-test the readable cumulative kickback history"

**Files likely touched:**
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts` — regression coverage

**Wired-into:** none (no new production surface)
**Dependencies:** 16

### Task 18: Derive deleted files and deleted exported declarations
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing test: a diff deleting a file reports that path; a diff removing an exported
   declaration from a surviving file reports that name; a purely additive diff reports an empty
   set.
2. Verify test fails (RED)
3. Implement: a new deriver module taking the assembled diff string and returning a structured
   removal set, parsing file-deletion headers and removed export lines.
4. Verify test passes (GREEN)
5. Commit with message: "derive deleted files and exported declarations from the review diff"

**Files likely touched:**
- `src/conductor/src/engine/build-review-removals.ts` — new deriver

**Wired-into:** none (inert until Task 21)
**Dependencies:** none

### Task 19: Derive removed members of exported types
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: a diff removing a member from an exported interface, type alias, or enum in
   a surviving file reports that member attributed to its declaring type — the case the incident's
   five-key-verdict fixture depended on.
2. Verify test fails (RED)
3. Implement: extend the deriver to attribute removed member lines to their enclosing exported
   declaration.
4. Verify test passes (GREEN)
5. Commit with message: "derive removed members of exported types from the review diff"

**Files likely touched:**
- `src/conductor/src/engine/build-review-removals.ts` — member attribution

**Wired-into:** same as Task 18
**Dependencies:** 18

### Task 20: Fail safe on renames, mentions and unparseable declarations
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: a rename is not reported as a deletion; a removed line mentioning an
   exported name only inside a comment or string reports no removed declaration; a multi-line
   declaration the text parse cannot resolve is simply absent from the set and the deriver does not
   throw. Assert the deriver issues no `git` subprocess.
2. Verify test fails (RED)
3. Implement: guard the rename, comment, and string cases and make unresolvable declarations a
   silent omission.
4. Verify test passes (GREEN)
5. Commit with message: "fail safe on renames, textual mentions and unparseable declarations"

**Files likely touched:**
- `src/conductor/src/engine/build-review-removals.ts` — safety guards

**Wired-into:** same as Task 18
**Dependencies:** 19

### Task 21: Carry removalContext on the grader inputs
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: `assembleBuildReviewInputs` returns a populated removal context for a diff
   with removals and an empty one otherwise, derived from the diff and merge base it already
   resolves.
2. Verify test fails (RED)
3. Implement: add the optional field to `BuildReviewInputs` with a doc comment stating it is
   evidence, not an exemption, and call the deriver during input assembly.
4. Verify test passes (GREEN)
5. Commit with message: "carry engine-derived removal context on the grader inputs"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — input field and derivation call

**Wired-into:** src/conductor/src/engine/step-runners.ts#assembleBuildReviewInputs
**Dependencies:** 20

### Task 22: Render the removal evidence block
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: the assembled prompt contains a removal evidence block for a populated set
   and the `(none)` placeholder for an empty one; its framing states the removals are evidence and
   not an exemption; backticks in a removal value are escaped as the gate-instruction block escapes
   them.
2. Verify test fails (RED)
3. Implement: render the block beside the existing three evidence blocks.
4. Verify test passes (GREEN)
5. Commit with message: "render the removal evidence block in the grader prompt"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — prompt assembly

**Wired-into:** src/conductor/src/engine/step-runners.ts#buildGraderPrompt
**Dependencies:** 21

### Task 23: Narrow Tautology with the three-condition per-test predicate
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: the assembled prompt states all three conditions for removal maintenance,
   states explicitly that the exemption is evaluated per changed test and never per diff, and
   states that a test which also adds a new behavioral assertion is still measured on that
   assertion.
2. Verify test fails (RED)
3. Implement: narrow the Tautology rubric text accordingly.
4. Verify test passes (GREEN)
5. Commit with message: "narrow the Tautology rubric with a per-test removal-maintenance predicate"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — Tautology rubric text

**Wired-into:** same as Task 22
**Dependencies:** 22

### Task 24: Render the Tautology exceptions as a closed list
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: the prompt enumerates exactly the rebase-repair exception and the removal
   exemption, each naming its own evidence block, followed by a statement that a changed test
   qualifying under neither is measured normally.
2. Verify test fails (RED)
3. Implement: restructure the two exceptions into an explicitly closed list with that closing
   statement.
4. Verify test passes (GREEN)
5. Commit with message: "render the Tautology exceptions as an explicitly closed list"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — exception rendering

**Wired-into:** same as Task 22
**Dependencies:** 23

### Task 25: Prove the other rubric items and the all-or-FAIL rule are untouched
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: every rubric item other than Tautology has unchanged text and the
   all-or-FAIL rule still requires every rubric item to pass — asserted without hard-coding how
   many rubric items exist, so the test survives PR #1517's fifth item. Assert the new block names
   no host-specific tool, path, or invocation syntax, and introduces no reference to the maker's
   transcript, summary, or task status.
2. Verify test fails (RED)
3. Implement: adjust the rendering if any assertion fails.
4. Verify test passes (GREEN)
5. Commit with message: "prove the untouched rubric items and grader input isolation"

**Files likely touched:**
- `src/conductor/test/engine/build-review-prompt.test.ts` — invariance coverage

**Wired-into:** none (no new production surface)
**Dependencies:** 24

## Task Dependency Graph

```text
The bound
  1 → 2 → 3 → 4 ┬→ 5
                ├→ 6 → 7 → 8
                └→ 9 → 10 → 11 → 12
                          ↑
  13 ─────────────────────┴→ 14
  15 → 16 → 17

The evidence
  18 → 19 → 20 → 21 → 22 → 23 → 24 → 25
```

Tasks 1, 13, 15 and 18 are independent roots. The bound (1–17) and the evidence (18–25) share no
file and may proceed in either order.

## Integration Points

- **After Task 12** — the cumulative bound is end-to-end testable: six FAIL laps produce one
  `needs-human` halt naming the gate, count, cap and reason.
- **After Task 17** — the incident's event history is reproducible and readable, closing outcome O4.
- **After Task 22** — the grader receives removal evidence, though the rubric still measures it
  normally.
- **After Task 25** — the narrowed rubric is complete and outcome O2 is closed.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] `test/test_harness_integrity.sh` passes before commit
