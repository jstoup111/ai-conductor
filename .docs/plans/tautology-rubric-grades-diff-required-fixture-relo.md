# Implementation Plan: Tautology fixture-relocation exception (prompt-only)

**Date:** 2026-08-13
**Stories:** .docs/stories/tautology-rubric-grades-diff-required-fixture-relo.md
**Conflict check:** Skipped (Tier S)

## Summary

Adds a third entry to the grader prompt's closed Tautology exception list in
`build-review-prompt.ts` — diff-required fixture relocations — in 4 tasks, all
prompt-text plus deterministic unit tests. No engine evidence channel (deferred to a
follow-up intake issue).

## Technical Approach

The grader prompt (`buildGraderPrompt`) is a pure string assembler; the whole change is
new instruction text plus assertions over the rendered string. The exception list at
`build-review-prompt.ts:95-100` currently has two entries and closes with "A changed
test qualifying under neither exception is measured normally." We add entry 3 (fixture
relocation) with a three-condition per-test predicate the grader judges from the diff
it already receives (rename headers and the production hunks that change path
classification are visible in that diff), update the closing sentence to the
three-entry equivalent ("under none of these exceptions"), and add an
evidence-citation instruction. Rubric item 1's universal definition and the verdict
JSON schema line remain byte-identical. The existing two-entry closed-list test at
`build-review-prompt.test.ts:256-262` is updated to expect three entries — a
relocation forced by the diff, not a loosened rubric.

Sequencing: entry text first (Task 1), then the narrowing conditions (Task 2), then
the citation instruction (Task 3), then the invariance guards (Task 4).

## Prerequisites

- None (single-file prompt change; tests run via the repo's vitest setup).

## Tasks

### Task 1: Render the third closed-list exception entry with its three-condition predicate
**Story:** story-1
**Type:** happy-path

**Steps:**
1. Write failing test: update the existing "renders the two Tautology exceptions as an
   explicitly closed list" test to expect exactly three `^\d\. ` entries, with entry 3
   matching `/3\. Fixture relocation:/`; add a test asserting the entry states all
   three qualifying conditions: (a) the changed test's diff shows a rename/relocation
   of a fixture path (rename headers or delete-plus-recreate of identical fixture
   content at a new path), (b) the same diff's production hunks change
   path-classification or path-handling behavior that strips the old path's pre-diff
   meaning, and (c) the changed test adds no new behavioral assertion beyond the move.
2. Verify tests fail (RED).
3. Implement: add the entry-3 text to the closed list in `buildGraderPrompt`, restating
   the "per changed test, never per diff" scoping for this entry, and update the
   closing sentence to "A changed test qualifying under none of these exceptions is
   measured normally."
4. Verify tests pass (GREEN).
5. Commit with message: "feat(build_review): add fixture-relocation entry to the closed Tautology exception list"

**Files:**
- src/conductor/src/engine/build-review-prompt.ts — third exception entry + closing sentence
- src/conductor/test/engine/build-review-prompt.test.ts — three-entry closed-list assertions

**Dependencies:** none

### Task 2: State the non-qualifying conditions inside the relocation entry
**Story:** story-2
**Type:** negative-path

**Steps:**
1. Write failing test: assert the rendered relocation entry instructs that (i) a
   relocation whose old path keeps its pre-diff meaning (no production hunk in the same
   diff changes how that path is classified or handled) does NOT qualify and is
   measured normally, and (ii) a relocated test that also adds a new behavioral
   assertion is still measured normally on that assertion.
2. Verify test fails (RED).
3. Implement: add both non-qualifying sentences to the entry-3 text, mirroring the
   removal-maintenance condition (3) wording.
4. Verify test passes (GREEN).
5. Commit with message: "feat(build_review): state non-qualifying relocation conditions in the Tautology exception"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 3: Instruct per-relocation evidence citation in the persisted verdict
**Story:** story-3
**Type:** happy-path

**Steps:**
1. Write failing test: assert the rendered prompt instructs the grader, for every
   changed test evaluated under the relocation exception (exempted or not), to record
   in the verdict's existing string fields the rename evidence (old path → new path)
   and the production hunk(s) that do or do not force the move.
2. Verify test fails (RED).
3. Implement: add the citation instruction to the entry-3 text, scoped to existing
   `reasons`/`findings` string fields (no new keys).
4. Verify test passes (GREEN).
5. Commit with message: "feat(build_review): require cited relocation evidence in the persisted verdict"

**Files:** same as Task 1

**Dependencies:** Task 2

### Task 4: Guard rubric item 1 and the verdict schema as unchanged
**Story:** story-2
**Type:** negative-path

**Steps:**
1. Write failing test (or strengthen existing): assert rubric item 1 renders exactly
   as "1. Tautology: every new/changed test would fail without the diff." and the
   verdict JSON schema line renders byte-identically to its current text (no new
   keys), and that the relocation entry is rendered even when `removalContext`,
   `repairContext`, and `acceptedWidenings` are all empty/absent.
2. Verify the assertions hold or fail for the right reason (RED only if a prior task
   drifted these strings).
3. Implement: correct any drift so the assertions pass.
4. Verify tests pass (GREEN).
5. Commit with message: "test(build_review): pin rubric item 1, verdict schema, and unconditional relocation entry"

**Files:** same as Task 1

**Verify-only:** yes

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 -> Task 2 -> Task 3 -> Task 4
```

## Integration Points

- After Task 1: the three-entry closed list renders; graders dispatched from this
  branch already see the new exception.
- After Task 4: full story coverage; `build-review-prompt.test.ts` pins the invariants.

## Verification

- [ ] All happy path criteria covered by at least one task (S1→T1, S3→T3)
- [ ] All negative path criteria covered by at least one task (S1 negatives→T1/T4, S2→T2/T4, S3 negative→T4)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic (linear chain)
