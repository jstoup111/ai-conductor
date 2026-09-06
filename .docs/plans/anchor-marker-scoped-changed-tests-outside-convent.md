# Implementation Plan: Anchor marker-scoped changed tests outside conventional test paths

**Date:** 2026-09-06
**Stories:** .docs/stories/anchor-marker-scoped-changed-tests-outside-convent.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the existing test-quality contract: Covers markers alone decide scope, the coordinator alone decides what the grader sees, and anchors remain immutable content-region references.

## Summary

Three bounded tasks deliver #2165 by making the changed-test title snapshot cover every selector the marker-derived test-quality scope already admits. Covers-marker resolution, the coordinator's in-scope filter, the anchor grammar, the tautology preflight, and rubric judgement are unchanged.

## Technical Approach

The build_review input assembler computes two independent selector sets over the same graded diff. `snapshotChangedTestTitles` extracts static test titles for the path-classified changed tests only. `snapshotTestQualityScope` computes review scope from resolvable Covers markers and deliberately does not path-filter, because technical-track suites are often outside conventional test directories. The coordinator then intersects the titles with that marker-derived set to build content regions, and the anchor validator rejects every finding when the resulting region array is empty. A feature whose in-scope changed files all sit at unconventional paths therefore has scope but no regions, so every finding fails validation.

Close the gap at the one seam where the two sets meet. Order the two snapshot helpers so scope is computed first, then pass its in-scope selectors into title extraction. Extract titles for the deduplicated, lexicographically sorted union of the path-classified changed tests and the marker-derived in-scope selectors.

The union is deliberate rather than a replacement. Replacing the path classification would drop titles for conventional changed tests that carry no resolvable marker and would rewrite several existing extraction fixtures for no behavioral gain. The union leaves every current extraction intact, and because the coordinator's in-scope filter is untouched, the wider candidate set never reaches the grader: only marker-derived in-scope selectors survive into the projection. Sorting keeps the snapshot digest deterministic across assemblies of the same head.

No new fallback machinery is needed. Title extraction already emits exactly one entry carrying the static-extraction fallback flag when the source cannot be read at the graded head, when the source declares no recognized test call, and when a declaration's title is not a static literal. That existing behavior is what guarantees every newly-included in-scope selector produces at least one anchorable region, and the negative-path task proves it holds for the newly-included selectors rather than adding a second mechanism.

Test dispositions follow the repository test-authoring rules. Input-assembly behavior is proven at the assembler seam: the existing real-git fixture block already commits a plan, a selected stories artifact, and a non-test file carrying a resolvable task marker, so it is the faithful place to observe the union. The coordinator seam is exercised with hand-built frozen inputs and an injected dispatch function, matching the existing relocated-test fixture in that file. No test reaches a real LLM, network, or third-party service, and no test runs a full conductor.

## Preconditions and claim ledger

- Operator approved Small scope, the union approach over replacement, technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/build-review-inputs.ts` line 501 sources title selectors from `classifyTautologyPaths(changedPathsFromDiff(diff)).tests`, and line 617 calls that helper before the scope helper at line 618.
- Verified: `snapshotTestQualityScope` at `build-review-inputs.ts` line 279 filters only the plan path and the docs directory before resolving Covers markers, so it admits non-test paths.
- Verified: `classifyTautologyPaths` at `src/conductor/src/engine/build-review-test-quality-preflight.ts` line 236 classifies by filename pattern only and returns a sorted list.
- Verified: `src/conductor/src/engine/build-review-coordinator.ts` line 337 filters snapshot titles to the marker-derived in-scope set before projection, so widening the candidate set cannot widen review.
- Verified: `buildReviewFindingReferenceContext` and `parseBuildReviewFindingAnchor` in `src/conductor/src/engine/build-review-domain.ts` line 63 and line 64 build regions from projected titles and reject an anchor when no projected region matches, including when the region array is empty.
- Verified: `staticTestTitles` in `build-review-inputs.ts` returns a single entry with the fallback flag when extraction is malformed or yields no titles, and `snapshotChangedTestTitles` substitutes the same single fallback entry when the source read fails.
- Verified: the changed-test titles field is consumed only by the coordinator filter and the projection that feeds anchoring; no other consumer reads it.
- Verified: `src/conductor/test/engine/build-review-inputs.test.ts` contains a real-git fixture block whose in-scope set resolves a non-test source file through a task marker, and `src/conductor/test/engine/build-review-coordinator.test.ts` contains an in-scope and out-of-scope anchor fixture with an injected dispatch function.
- Scope check: A — consumer-facing shipped engine behavior, no repo-only signal, and no rule text in either instruction file because the change is code only; B — not applicable, no new skill; C — provider-agnostic. Event spine: no new event, metric, span, log line, or report.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree. No unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Extract titles for the marker-derived in-scope union
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/build-review-inputs.ts, src/conductor/test/engine/build-review-inputs.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing real-git fixture case that resolves Covers markers so it also asserts the assembled changed-test titles, expecting an entry for the non-test source file the fixture already binds through its task marker. Establish RED.
2. Give the title-extraction helper an in-scope selector parameter, and build its selector list as the deduplicated, lexicographically sorted union of the path-classified changed tests and those in-scope selectors.
3. Compute the test-quality scope before the title snapshot in the assembler and pass its in-scope selectors into the title helper. Change nothing else about the assembler's returned shape.
4. Verify GREEN, confirm the existing conventional-path extraction cases still pass, then run the repository's narrowest invocation for both touched files plus its typecheck target that covers tests, and commit.

**Done when:**
1. Assembling inputs over the real-git Covers fixture returns changed-test titles that include an entry whose selector is the fixture's non-test source file.
2. The existing conventional-path extraction cases in the assembler test file pass unchanged, with the same expected entries and the same order.
3. The extracted selector list is the deduplicated, lexicographically sorted union of the path-classified changed tests and the marker-derived in-scope selectors.

### Task 2: Guarantee one fallback entry for every newly-included in-scope selector
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/build-review-inputs.test.ts
**Dependencies:** 1

**Steps:**
1. Add an assembler case whose in-scope set contains a non-test source file declaring no recognized test call, asserting exactly one entry for it with empty title text and the static-extraction fallback flag set. Establish RED against pre-change code.
2. Add a case whose in-scope selector cannot be read at the graded head, using the existing scripted fake git runner to return a non-zero result for that show, asserting exactly one fallback entry for it.
3. Add an assertion that every selector present in the assembled scope appears at least once among the assembled changed-test titles, so a future selector source cannot silently drop one.
4. Verify GREEN, run the repository's narrowest invocation for the file plus its typecheck target that covers tests, and commit.

**Done when:**
1. An in-scope selector whose source declares no recognized test call yields exactly one entry with empty title text and the static-extraction fallback flag set.
2. An in-scope selector whose source cannot be read at the graded head yields exactly one entry with the static-extraction fallback flag set.
3. Every selector in the assembled test-quality scope appears at least once among the assembled changed-test titles.

### Task 3: Prove anchoring works at the coordinator boundary without widening scope
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/build-review-coordinator.test.ts
**Dependencies:** 1

**Steps:**
1. Add a coordinator case whose frozen snapshot carries a title entry for a non-conventional in-scope selector and a title entry for a changed conventional test path that the marker-derived scope excludes, following the existing relocated-test fixture's shape.
2. Assert the injected dispatch function receives a projection whose changed-test titles contain only the in-scope selector, proving the wider candidate set never widens review.
3. Have the injected dispatch function return a judged result anchored to the in-scope selector's content region and assert the coordinated branch is a judged FAIL rather than a rejection. Establish RED for the pre-change case where that selector carried no title.
4. Add a sibling case whose dispatch function anchors to the excluded conventional test path and assert the branch is an infrastructure failure reporting an invalid provider result.
5. Verify GREEN, run the repository's narrowest invocation for the file plus its typecheck target that covers tests, and commit.

**Done when:**
1. The dispatched test-quality projection contains a changed-test title entry for the non-conventional in-scope selector.
2. The dispatched projection's changed-test titles omit the changed conventional test path that the marker-derived scope excludes.
3. A judged result anchored to the in-scope selector's content region yields a judged FAIL branch rather than a rejection.
4. A judged result anchored to the excluded conventional test path yields an infrastructure-failure branch reporting an invalid provider result.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a changed file outside conventional test paths carries a Covers marker that resolves against the active plan or its selected stories, when build_review assembles its inputs, then the snapshot's changed-test titles include an entry whose selector is that file. | 1 | "Assembling inputs over the real-git Covers fixture returns changed-test titles that include an entry whose selector is the fixture's non-test source file." | diff-local |
| Story 1 happy: Given a changed file at a conventional test path carries no resolvable Covers marker, when build_review assembles its inputs, then the snapshot's changed-test titles still include an entry whose selector is that file. | 1 | "The existing conventional-path extraction cases in the assembler test file pass unchanged, with the same expected entries and the same order." | diff-local |
| Story 1 negative: Given an in-scope changed file declares no static test title or its source cannot be read at the graded head, when build_review assembles its inputs, then that file contributes exactly one title entry carrying the static-extraction fallback flag. | 2 | "An in-scope selector whose source cannot be read at the graded head yields exactly one entry with the static-extraction fallback flag set." | diff-local |
| Story 2 happy: Given the assembled snapshot carries a title entry for an in-scope file outside conventional test paths, when the coordinator derives the test-quality projection, then the dispatched projection carries a content region for that file and a finding anchored to it is accepted. | 3 | "A judged result anchored to the in-scope selector's content region yields a judged FAIL branch rather than a rejection." | diff-local |
| Story 2 negative: Given a changed file at a conventional test path is absent from the marker-derived in-scope set, when the coordinator derives the test-quality projection, then that file contributes no content region and a finding anchored to it is rejected. | 3 | "A judged result anchored to the excluded conventional test path yields an infrastructure-failure branch reporting an invalid provider result." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: each is decided entirely by code and fixtures inside this diff, and no commit outside the feature can change whether it holds. Task 1 owns the assembler happy paths at the input-assembly seam, using the existing real-git fixture for marker resolution and the existing scripted fake git runner for the conventional-path cases. Task 2 owns the negative paths at the same seam, exercising the existing per-selector fallback rather than adding a second mechanism. Task 3 owns the single cross-boundary integration proof: the observable behavior is that a finding on an in-scope file reaches a judged verdict through the coordinator's dispatch and anchor validation, while a finding on an excluded file does not. No aggregate, conductor-run, or third-party test is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
