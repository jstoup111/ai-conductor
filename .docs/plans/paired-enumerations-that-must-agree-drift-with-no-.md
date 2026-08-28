# Implementation Plan: paired-enumerations-that-must-agree-drift-with-no-

**Date:** 2026-08-27
**Stories:** .docs/stories/paired-enumerations-that-must-agree-drift-with-no-.md

## Summary

Builds a typed matched-pair registry plus a structural vitest guard that fails one-sided edits to
registered paired enumerations, seeds it with the three known build-review retirement pairs, and
collapses the drifted aggregate reason-prefix alternation by deriving it from the config constant.
Four tasks.

## Technical Approach

- **Registry:** `src/conductor/src/engine/matched-pairs.ts` exports a `MatchedPairId` string-literal
  union and `MATCHED_PAIR_REGISTRY` declared with `satisfies Record<MatchedPairId, MatchedPairDeclaration>`
  so a missing or extra entry fails `tsc` (totality is type-level, per adr-2026-07-26 and the
  config-key registry precedent adr-2026-08-26). A declaration is a discriminated union on `mode`:
  `checked` (both sides named: repo-relative file + a description of the enumeration, plus which
  side is authoritative) or `satisfied-by-derivation` (deriving module, source module, imported
  export name, non-empty `reason`, tracked `ref` — the adr-2026-07-12 negative-declaration grammar).
  The registry never restates member lists; members are read from the live sides.
- **Guard:** `src/conductor/test/structural/matched-pair-registry.test.ts`, following the
  worktree-removal-coverage guard's harness (vitest + the `typescript` package's
  `ts.createSourceFile` AST — never regex over TS source, per adr-2026-08-07). It iterates every
  registry entry: for `satisfied-by-derivation` it asserts the deriving module imports the declared
  export from the source module and references it (AST import + identifier walk); for `checked` it
  extracts both sides' member sets and asserts set equality, failing with a message that names the
  pair id, both file locations, and the differing members (distinct reasons, adr-2026-06-30). A
  zero-member extraction on either side is a FAIL naming the empty side (adr-2026-08-01). TS-side
  members come from importing the engine module and reading the exported const (execute the source,
  the check-25 discipline); markdown-side members come from scoped extraction of backticked ids in
  the named section of the docs file. Hermetic, default suite, no subprocess.
- **Collapse:** `src/conductor/src/engine/build-review-aggregate.ts` currently hand-writes the
  retired-rubric reason-prefix alternation and omits `tautology`. Build the filter regex from the
  imported `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS` instead — the drift closes by construction and the
  pair registers as `satisfied-by-derivation`.
- **Ownership boundary:** check 25 (`test/check_build_review_rubric_skill_vocabularies.sh`) keeps
  the SKILL.md↔engine vocabulary pair; the registry records that ownership in a comment, not a
  duplicate entry (adr-2026-08-16 D5).
- **Sequencing:** registry types first (everything imports them), then the guard with the
  derivation verifier, then the collapse, then the checked docs pair with its drift/empty fixtures.

## Prerequisites

- None beyond the existing conductor toolchain (`vitest`, `typescript` are already dependencies).

## Tasks

### Task 1: Matched-pair registry module with typed total record
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test `src/conductor/test/engine/matched-pairs.test.ts`: every registry entry with mode `satisfied-by-derivation` has a non-empty `reason` and a `ref` matching `#\d+` or an ADR/doc path; every `checked` entry names two distinct repo-relative files that exist; entry count ≥ 3; error message on violation names the pair id and the offending field
2. Verify test fails (RED — module absent)
3. Implement `src/conductor/src/engine/matched-pairs.ts`: `MatchedPairId` union with the three seed ids (`build-review-retired-ids-dispositions`, `build-review-retired-reason-prefix`, `build-review-retired-ids-configuration-doc`), `MatchedPairDeclaration` discriminated union, `MATCHED_PAIR_REGISTRY` via `satisfies Record<MatchedPairId, MatchedPairDeclaration>`; seed entries: dispositions pair as `satisfied-by-derivation` (reason: derived set via import edge; ref: jstoup111/ai-conductor#1833), reason-prefix pair as `satisfied-by-derivation` (ref same; note it becomes true in Task 3), configuration-doc pair as `checked` with the engine const authoritative; module comment records check 25's ownership of the SKILL.md vocabulary pair
4. Verify test passes (GREEN)
5. Commit with message: "feat(engine): typed matched-pair registry with seed declarations"

**Done when:**
- [ ] `matched-pairs.test.ts` passes, and deleting any one seed entry (locally) fails `npm test` via the count/totality assertions and fails `tsc` via the `satisfies` clause
- [ ] Each `satisfied-by-derivation` entry carries non-empty `reason` and `ref`; the test rejects an empty one naming the pair id and field
- [ ] The registry restates no enumeration members — only locations, export names, and modes

**Files likely touched:**
- src/conductor/src/engine/matched-pairs.ts — new registry module
- src/conductor/test/engine/matched-pairs.test.ts — declaration-invariant test

**Dependencies:** none

### Task 2: Structural guard — derivation-link verification
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test `src/conductor/test/structural/matched-pair-registry.test.ts` following the worktree-removal-coverage guard's AST pattern (vitest + `ts.createSourceFile`, recursive source listing; allowed variation: no exec-callee sets needed; search hint: `worktree-removal-coverage.test.ts` for the file-walk and fixture style): for every registry entry with mode `satisfied-by-derivation`, parse the deriving module and assert it imports the declared export from the declared source module AND references that identifier outside the import statement; failure message contains the pair id, both module paths, and which half of the link is missing
2. Add falsifiability fixtures as in-test `ts.createSourceFile` specimens: one with the import edge present + referenced (accepted), one missing the import, one importing but never referencing — the last two must be rejected
3. Verify RED (dispositions entry passes only once the verifier exists; fixtures pin rejection), then GREEN
4. Commit with message: "test(structural): matched-pair derivation-link verifier"

**Done when:**
- [ ] The guard passes for the dispositions seed pair against real source (config const → dispositions derived set)
- [ ] Both broken-link fixtures are rejected with messages naming the pair id and the missing half (import absent, or reference absent)
- [ ] The guard uses the TypeScript compiler API for all TS-source analysis; no regex over TS file text
- [ ] Guard runs in the default `npm test` suite with no network, credential, or subprocess

**Files likely touched:**
- src/conductor/test/structural/matched-pair-registry.test.ts — new structural guard

**Dependencies:** Task 1

### Task 3: Derive the aggregate reason-prefix filter from the retired-ids constant
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test in the existing build-review-aggregate test file: a persisted aggregate carrying a retired rubric and a `[tautology] ...` legacy reason string has that reason filtered on load (RED — the hand-written alternation omits tautology)
2. Verify test fails (RED)
3. Implement in `src/conductor/src/engine/build-review-aggregate.ts`: replace the literal `/^\[(scope|rootCause|causalIntegrity|completeness|wiring)\]/` with a regex constructed once from the imported `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS` (ids are plain identifiers, no escaping needed; keep anchoring and semantics otherwise identical)
4. Verify test passes (GREEN) and the full existing aggregate test file stays green
5. Confirm the structural guard from Task 2 now verifies the reason-prefix registry entry's derivation link against real source
6. Commit with message: "fix(engine): derive retired-rubric reason filter from DEPRECATED_BUILD_REVIEW_RUBRIC_IDS"

**Done when:**
- [ ] The new tautology-reason test passes and the previously passing aggregate compatibility tests are unchanged and green
- [ ] No hand-written retired-id alternation remains in build-review-aggregate.ts (the regex source is the imported constant)
- [ ] The structural guard passes the reason-prefix pair as satisfied-by-derivation against real source

**Files likely touched:**
- src/conductor/src/engine/build-review-aggregate.ts — derive the filter regex
- src/conductor/test/engine/build-review-aggregate.test.ts — tautology legacy-reason filter test

**Dependencies:** Task 2

### Task 4: Checked-pair comparison for the docs retired-ids enumeration
**Story:** 3
**Type:** negative-path

**Steps:**
1. Extend the structural guard with the `checked` mode: extract the engine side by importing `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS` from the built source (dynamic import of the module under test, the execute-don't-read discipline); extract the docs side by scanning only the declared file's backticked ids within the lines enumerating retired rubric ids; assert set equality
2. Write failing fixtures first (RED): a fixture docs excerpt missing one id must fail naming the pair id, both locations, and the missing member; a fixture excerpt with zero extractable ids must FAIL naming the empty side (never pass); a matching excerpt must pass
3. Implement extraction + comparison until fixtures and the real `docs/reference/configuration.md` pair are GREEN (both sides currently enumerate the same six ids — no docs edit expected; if extraction shows real drift, reconcile the docs side to the engine constant, which is declared authoritative)
4. Verify the whole default suite passes
5. Commit with message: "test(structural): checked matched-pair comparison with drift and empty-extraction fixtures"

**Done when:**
- [ ] The configuration-doc pair passes against the real repo; locally removing one id from either side makes the guard fail naming the pair id, both sides, and the differing member
- [ ] The zero-member fixture fails with a message naming the empty side — empty extraction is a FAIL, not a pass
- [ ] Fail-closed enumeration for this guard: the failure classes are exactly {member mismatch, empty extraction, unreadable declared file, broken derivation link}; each produces a distinct message containing the pair id
- [ ] `src/conductor` `npm test` and `test/test_harness_integrity.sh` both pass at the branch head

**Files likely touched:**
- src/conductor/test/structural/matched-pair-registry.test.ts — checked mode + fixtures
- docs/reference/configuration.md — only if real drift is found (engine side authoritative)

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
                └────▶ Task 4
```

## Integration Points

- After Task 2: the registry and guard are live end-to-end for derivation pairs (dispositions seed verifiable).
- After Task 4: all three seed pairs enforced; one-sided edits to any of them fail the default suite.

## Verification

- [ ] All happy path criteria covered by at least one task (Story 1 → Task 1; Story 2 → Tasks 2, 4; Story 3 → Tasks 3, 4)
- [ ] All negative path criteria covered by at least one task (Story 1 negatives → Task 1; Story 2 negatives → Tasks 2, 4; Story 3 negatives → Tasks 3, 4)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks; "fail-closed" is closed by the Task 4 enumeration of failure classes
- [ ] Dependencies are explicit and acyclic
