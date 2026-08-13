# Implementation Plan: Tautology fixture-relocation exception (prompt-only)

**Date:** 2026-08-13
**Stories:** .docs/stories/tautology-rubric-grades-diff-required-fixture-relo.md
**Conflict check:** Skipped (Tier S)

## Summary

Adds a third entry to the grader prompt's closed Tautology exception list in
`build-review-prompt.ts` — diff-required fixture relocations — in 3 tasks, all
prompt-text plus deterministic unit tests. No engine evidence channel (deferred to a
follow-up intake issue).

## Technical Approach

The grader prompt (`buildGraderPrompt`) is a pure string assembler; the whole change is
new instruction text plus assertions over the rendered string. The exception list at
`build-review-prompt.ts:95-100` currently has two entries and closes with "A changed
test qualifying under neither exception is measured normally." Task 1 adds entry 3
with a three-condition per-test predicate the grader judges from the diff it already
receives. The relocation evidence explicitly includes the #1545 form: a test hunk
changes fixture-construction code from `writeFile(oldPath, content)` to directory
creation plus `writeFile(newPath, content)` with unchanged content, even though the
repository diff has no Git rename header. Task 2 pins the non-qualifying cases and
keeps the universal rubric definition intact. Task 3 requires one
`[relocation-audit]` `reasons` entry per evaluated relocation on PASS or FAIL and
amends the surrounding `reasons` prose so that requirement does not conflict with the
general failure-summary rule. The verdict JSON schema remains byte-identical and
`findings` stays failure-only.

Sequencing: qualifying behavior first (Task 1), explicit negative paths second
(Task 2), then persisted audit evidence and verdict-contract consistency (Task 3).

## Prerequisites

- None (single-file prompt change; tests run via the repo's vitest setup).

## Verify-Claims Ledger

### Claims
- [verified] The #1545 relocation is an in-code fixture-construction change with no Git
  rename header — observed in commit `d19af6140`.
- [verified] `buildGraderPrompt` receives the complete diff and renders the verdict-writing
  contract; `validateBuildReviewVerdict` already accepts `reasons` on PASS, so audit entries
  need no parser or schema change.

### Assumptions
- [load-bearing, APPROVED by operator 2026-08-13] The immediate fix may rely on the grader
  reading raw diff evidence and following the prompt contract. If that proves unreliable,
  #1547 owns the deterministic engine-derived evidence channel; it is deliberately outside
  this feature's prompt-only scope.

**Verdict:** CLEAR — no unconfirmed load-bearing assumptions remain.

## Tasks

### Task 1: Render the qualifying relocation exception, including in-code fixtures
**Story:** story-1
**Type:** happy-path

**Steps:**
1. Write failing test: update the existing "renders the two Tautology exceptions as an
   explicitly closed list" test to expect exactly three `^\d\. ` entries, with entry 3
   matching `/3\. Fixture relocation:/`; add a test asserting the entry states all
   three qualifying conditions: (a) the changed test's diff shows a fixture path move,
   including removed `writeFile(oldPath, content)` plus added directory creation and
   `writeFile(newPath, content)` with unchanged content when Git emits no rename header,
   as well as tracked-file rename/delete-plus-create evidence; (b) the same diff's
   production hunks change path-classification or path-handling behavior that strips
   the old path's pre-diff meaning; and (c) the changed test adds no new behavioral
   assertion beyond the move. Use the #1545 `c.md` → `docs/c.md` hunk shape as the
   concrete rendered-diff fixture and assert the prompt says absence of Git rename
   headers does not disqualify it.
2. Verify tests fail (RED).
3. Implement: add the entry-3 text to the closed list in `buildGraderPrompt`, explicitly
   covering both in-code fixture-construction moves and tracked-file renames,
   instructing that a qualifying move must not receive a Tautology finding solely
   because it passes pre-diff, and updating the closing sentence to "A changed test
   qualifying under none of these exceptions is measured normally."
4. Verify tests pass (GREEN).
5. Commit with message: "feat(build_review): add the diff-required fixture-relocation exception"

**Files:**
- src/conductor/src/engine/build-review-prompt.ts — third exception entry + closing sentence
- src/conductor/test/engine/build-review-prompt.test.ts — three-entry closed-list assertions

**Dependencies:** none

### Task 2: Keep unforced moves and new assertions under ordinary Tautology
**Story:** story-1 negative paths; story-2
**Type:** negative-path

**Steps:**
1. Write failing test: assert the rendered relocation entry instructs that (i) a
   relocation whose old path keeps its pre-diff meaning (no production hunk in the same
   diff changes how that path is classified or handled) does NOT qualify and is
   measured normally, (ii) a relocated test that also adds a new behavioral assertion
   is still measured normally on that assertion, (iii) the predicate applies per
   changed test and never to a whole diff, (iv) the relocation entry remains identical
   when `removalContext`, `repairContext`, and `acceptedWidenings` are empty/absent, and
   (v) rubric item 1 remains exactly "1. Tautology: every new/changed test would fail
   without the diff."
2. Verify test fails (RED).
3. Implement: add both non-qualifying sentences and the per-test scope to entry 3,
   mirroring the removal-maintenance condition (3) wording without tying the entry to
   optional evidence blocks or changing rubric item 1.
4. Verify test passes (GREEN).
5. Commit with message: "feat(build_review): preserve Tautology checks for unforced fixture moves"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 3: Persist non-conflicting audit evidence for every relocation decision
**Story:** story-3
**Type:** happy-path

**Steps:**
1. Write failing test: assert the rendered prompt instructs the grader, for every
   changed test evaluated under the relocation exception, to append one
   `[relocation-audit]` `reasons` entry on PASS or FAIL containing `EXEMPTED` or
   `MEASURED`, old path → new path, and the production hunk(s) that do or do not force
   the move. Assert the surrounding verdict prose explicitly permits these audit-only
   entries in addition to failing-rubric summaries, requires them on PASS when a
   relocation was evaluated, still allows empty `reasons` on PASS when none was
   evaluated, keeps `findings` failure-only/empty on PASS, and renders the existing JSON
   schema line byte-identically.
2. Verify test fails (RED).
3. Implement: add the audit instruction to entry 3 and reconcile the general verdict
   prose with it. Store audit entries only in `reasons`; do not add schema keys or use
   `findings` for exempted relocations.
4. Verify test passes (GREEN).
5. Commit with message: "feat(build_review): persist fixture-relocation audit evidence"

**Files:** same as Task 1

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 -> Task 2 -> Task 3
```

## Integration Points

- After Task 1: the three-entry closed list renders; graders dispatched from this
  branch already see the new exception.
- After Task 3: full story coverage; `build-review-prompt.test.ts` pins the verdict
  schema and resolves the PASS-evidence instruction without introducing new keys.

## Verification

- [ ] All happy path criteria covered by at least one task (S1→T1, S3→T3)
- [ ] All negative path criteria covered by at least one task (S1 negatives→T2, S2→T2, S3 negatives→T3)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic (linear chain)
