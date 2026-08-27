# Implementation Plan: Coherence artifact passes engineer land, then blocks the merged spec as unparseable

**Date:** 2026-08-26
**Design:** .docs/decisions/adr-2026-08-26-shared-coherence-parser-at-discovery.md
**Stories:** .docs/stories/coherence-artifact-passes-engineer-land-then-block.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Extract the pure coherence-artifact parser into one lean shared module consumed by both `engineer
land` and daemon dispatch discovery, delete the bespoke discovery triple-scan, and enrich parse
failures with line-level structural detail. 7 tasks.

## Technical Approach

- **New lean module `src/conductor/src/engine/coherence-parse.ts`** receives, move-only, the pure
  parsing core currently in `src/conductor/src/engine/engineer/coherence-validator.ts`: the row
  types (`CoherenceRow`, `LegacyCoherenceRow`, `CriterionCoherenceRow`, verdict/disposition types),
  `CoherenceParseFailureReason`, `CoherenceParseResult`, and the functions `parseCoherenceArtifact`,
  `splitRow`, `isSeparatorRow`, `unquote`, plus the `LEGACY_ROW_CLASSES` set and verdict/disposition
  predicates. The module imports nothing beyond the standard library type surface — no
  overlap-scan, rebase, owner-gate, blocker-resolver, no filesystem/git access (condition C-B).
  `coherence-validator.ts` re-exports everything it moved so its existing callers are untouched.
- **Failure detail is additive:** the `ok: false` branch gains an optional
  `detail?: { line: number; message: string }` populated for `unparseable-coherence-artifact` and
  `unparseable-criterion-row` (wrong cell count with expected-vs-actual, missing separator row,
  unknown row class, bad verdict/disposition token). Reason ids are byte-for-byte unchanged
  (condition C-C); missing/empty failures carry no `detail`.
- **Discovery swap:** `hasCoherenceTableDataRow` in `src/conductor/src/engine/daemon-backlog.ts`
  is deleted; the single call site in `discoverBacklog`'s non-S coherence branch calls
  `parseCoherenceArtifact(coherenceContent)` and blocks on `!parsed.ok` with the existing
  `missing-coherence` reason, appending `detail` to the `remedy` string and the `warnOnce` line.
- **Sequencing:** extraction first (1–2), then detail (3) and its land surfacing (4), then the
  discovery swap (5), then the no-regression corpus test (6) and dispatch fail-closed fixtures (7).
- **Local pattern:** follow the extraction shape of `adrApprovalStatus` in
  `src/conductor/src/engine/artifacts.ts` (single parser, multiple rungs, bespoke predicate
  deleted; search hint: `adrApprovalStatus`). Allowed variation: a new dedicated module rather
  than `artifacts.ts`, because `artifacts.ts` itself carries non-parser imports.

## Prerequisites

None — no migrations, config, or new dependencies.

## Tasks

### Task 1: Extract the pure parser into coherence-parse.ts
**Story:** Story 1 — shared module happy paths (identical rows/reasons; re-export compatibility)
**Type:** refactor

**Steps:**
1. Create `src/conductor/src/engine/coherence-parse.ts`; move (verbatim, move-only) the types,
   predicates, `LEGACY_ROW_CLASSES`, `unquote`, `splitRow`, `isSeparatorRow`, and
   `parseCoherenceArtifact` from `coherence-validator.ts`.
2. In `coherence-validator.ts`, delete the moved code and re-export the moved names from the new
   module (`export { … } from '../coherence-parse.js'`), keeping every existing import path valid.
3. Run the existing coherence-validator test suite; verify green with zero test edits.
4. Commit.

**Done when:**
- The moved function bodies in `coherence-parse.ts` are byte-identical to their prior definitions (move-only; no grammar change).
- `coherence-parse.ts` imports none of: overlap-scan, rebase, owner-gate, blocker-resolver, `node:fs`, `node:child_process`.
- Existing coherence-validator tests pass unchanged.

**Files likely touched:**
- src/conductor/src/engine/coherence-parse.ts — new module
- src/conductor/src/engine/engineer/coherence-validator.ts — deletions + re-exports

**Dependencies:** none

### Task 2: Import-isolation test for the shared module
**Story:** Story 1 — negative path (module loads in isolation, no land-only transitive imports)
**Type:** negative-path

**Steps:**
1. Write a test that imports `coherence-parse.ts` directly and asserts (a) `parseCoherenceArtifact`
   parses a minimal valid table, and (b) the module's static import list (read via a small
   source-text scan of its own file in the test, or via `import` success in isolation) contains
   none of the banned modules named in Task 1.
2. Verify it fails if a banned import is added (temporarily add one locally to see RED, then
   remove).
3. Commit.

**Done when:**
- A named test asserts the shared module's import list excludes overlap-scan, rebase, owner-gate, blocker-resolver, `node:fs`, `node:child_process`, and passes.
- The test demonstrably fails when a banned import is introduced (verified once during authoring).

**Files likely touched:**
- src/conductor/test/engine/coherence-parse.test.ts — new test

**Dependencies:** 1

### Task 3: Line-level structural detail on parse failures
**Story:** Story 3 — happy paths (wrong cell count, missing separator, unknown row class) and the
missing/empty no-fabricated-detail negative path
**Type:** happy-path

**Steps:**
1. Write failing tests in the shared-parser test file: wrong-cell-count criterion row yields
   `reason: 'unparseable-criterion-row'` with `detail.line` = its 1-based file line and a message
   stating expected 6 vs actual N; first table row not followed by a separator yields
   `unparseable-coherence-artifact` with the offending line and "separator row expected"; unknown
   row class names the line and the token; `null`/empty input failures carry `detail === undefined`.
2. Verify RED.
3. Implement: track the source line number while iterating in `parseCoherenceArtifact`; populate
   `detail` on the enumerated failure sites. Reason id strings untouched.
4. Verify GREEN; run the full coherence-validator suite.
5. Commit.

**Done when:**
- Tests assert `detail.line` and message content for the three structural cases, and absence of `detail` for missing/empty — all passing.
- `CoherenceParseFailureReason`'s four id strings are unchanged in the diff (condition C-C).
- All pre-existing parser tests still pass.

**Files likely touched:**
- src/conductor/src/engine/coherence-parse.ts — detail population
- src/conductor/test/engine/coherence-parse.test.ts — new assertions

**Dependencies:** 1

### Task 4: Land rejection message carries the detail
**Story:** Story 3 — land rejection includes structural detail; waiver negative path
**Type:** happy-path

**Steps:**
1. Write a failing test: `runCoherenceGate` over an artifact with a wrong-cell-count row throws an
   error whose message includes the reason id, the line number, and the expected-vs-actual text.
2. Verify RED.
3. Implement: in the gate's parse-failure throw in `coherence-validator.ts`, append
   `parsed.detail` (line + message) when present.
4. Add/confirm a test that a waiver naming a parse failure does not bypass the throw (parse
   failures stay non-waivable — the throw happens before waiver evaluation).
5. Verify GREEN; commit.

**Done when:**
- A test asserts the land gate's thrown message contains the line number and disagreement text for a structurally defective artifact, and passes.
- A test (new or existing, named in the test file) proves the parse-failure throw is unaffected by any waiver content.

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — enriched throw
- src/conductor/test/engine/coherence-validator.test.ts — assertions

**Dependencies:** 3

### Task 5: Discovery consumes the shared parser; triple-scan deleted
**Story:** Story 2 — ragged and six-wide-header shapes dispatch; Story 3 — remedy/log carry detail
**Type:** happy-path

**Steps:**
1. Write failing tests in the daemon-backlog test file: a merged non-S spec fixture whose
   coherence artifact has a six-wide header over five-cell rows is in the eligible `items` set; a
   fixture with the documented ragged shape (five-cell legacy + six-cell criterion rows) is
   eligible; a structurally defective fixture is blocked with reason `missing-coherence` and a
   `remedy` containing the parser's line-level detail.
2. Verify RED (the six-wide-header fixture is today blocked).
3. Implement: delete `hasCoherenceTableDataRow` (per `/code-removal`: the surviving observable
   behavior is the fail-closed non-S coherence branch, now backed by the shared parser); import
   `parseCoherenceArtifact` from `coherence-parse.js`; replace the call site with a `!parsed.ok`
   check appending `detail` to `remedy` and the `warnOnce` message. `BlockedSpecItem.reason` union
   untouched.
4. Verify GREEN; run the full daemon-backlog suite.
5. Commit.

**Done when:**
- The six-wide-header and ragged-shape fixtures are dispatched (eligible) and the defective fixture is blocked with line detail in `remedy` — tests pass.
- The diff removes the `hasCoherenceTableDataRow` function and adds no other discovery behavior change; `BlockedSpecItem.reason` is byte-for-byte unchanged.
- `daemon-backlog.ts` imports only `coherence-parse.js` for this, not `coherence-validator.js`.

**Files likely touched:**
- src/conductor/src/engine/daemon-backlog.ts — call-site swap, deletion
- src/conductor/test/engine/daemon-backlog.test.ts — new fixtures

**Dependencies:** 3

### Task 6: No-regression corpus test and zero-criterion pin update
**Story:** Story 2 — no-regression guarantee; zero-criterion rows stay eligible
**Type:** negative-path

**Steps:**
1. Write a test embedding the retired triple-scan verbatim as a fixture oracle (a local test
   helper, not production code) plus a fixture set spanning: minimal valid table, ragged shape,
   six-wide header, zero-criterion artifact, absent/empty/table-less content. Assert every fixture
   the oracle accepts is accepted by `parseCoherenceArtifact`, and every divergence is a
   new-parser acceptance (closed enumeration: the six-wide-header shape).
2. Update the existing zero-criterion pinning test in the daemon-backlog suite (the one asserting
   discovery accepts an artifact with no criterion rows) so it pins the same behavior through the
   shared parser; do not delete it.
3. Verify GREEN; commit.

**Done when:**
- The no-regression test passes: zero oracle-accepted fixtures rejected by the shared parser; divergences limited to the enumerated new acceptances (condition C-A).
- The zero-criterion pin test still exists in the daemon-backlog suite and passes.

**Files likely touched:**
- src/conductor/test/engine/coherence-parse.test.ts — oracle + corpus fixtures
- src/conductor/test/engine/daemon-backlog.test.ts — pin update

**Dependencies:** 5

### Task 7: Dispatch fail-closed negatives preserved
**Story:** Story 2 — negative paths (absent, empty, table-less blocked at non-S; S-tier exempt)
**Type:** negative-path

**Steps:**
1. Write (or extend existing) daemon-backlog tests: merged non-S spec with no coherence file →
   blocked `missing-coherence`, skipped with a once-per-slug log; empty file → blocked; file with
   prose but no table → blocked; merged S-tier spec with no coherence file → not blocked.
2. Verify each assertion (some may already be GREEN from existing suites — that is the point:
   prove the swap preserved them; any RED means Task 5 regressed and is fixed there).
3. Commit (empty commit with evidence trailer if no code change is needed).

**Done when:**
- Named tests cover all four cases (absent / empty / table-less at non-S blocked; S exempt) and pass against the shared-parser discovery path.
- The blocked cases assert the `warnOnce` single-log behavior is retained.

**Files likely touched:**
- src/conductor/test/engine/daemon-backlog.test.ts — fixtures/assertions

**Verify-only:** yes

**Dependencies:** 5

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2
        ├─▶ Task 3 ─┬─▶ Task 4
        │           └─▶ Task 5 ─┬─▶ Task 6
        │                       └─▶ Task 7
```

## Integration Points

- After Task 4: land-side behavior complete — a defective artifact is rejected at land with line
  detail.
- After Task 5: end-to-end fix live — the #1881 artifact shape lands AND dispatches.

## Verification

- [ ] All happy path criteria covered by at least one task (S1→T1; S2→T5/T6; S3→T3/T4/T5)
- [ ] All negative path criteria covered by at least one task (S1→T1/T2; S2→T6/T7; S3→T3/T4)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has falsifiable Done-when checks; "move-only", "no-regression", and "fail-closed"
      are each closed by enumeration or a named mechanism in their tasks
- [ ] Dependencies are explicit and acyclic
