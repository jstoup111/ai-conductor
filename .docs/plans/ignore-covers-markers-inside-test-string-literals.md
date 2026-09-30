# Implementation Plan: Ignore Covers markers inside test string literals

**Date:** 2026-09-28
**Stories:** .docs/stories/ignore-covers-markers-inside-test-string-literals.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to adr-2026-09-06-engine-owned-test-quality-scope decisions 3, 4 and 7: the existing TypeScript parser, unchanged marker association rules, and unmarked tests remaining unbound.

## Summary

Four bounded tasks deliver #2597 option A: parser-backed Covers comment collection, scope-level proof that unmarked tests stay unbound, and a scope-incomplete HALT body that names each indeterminate candidate's file and start line. Desired outcome 2 is declined per the track scope boundary.

## Technical Approach

Replace the scanner-based comments() collector in build-review-test-bindings.ts with a parser-backed collector. Parse the decoded text once with ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true), letting TypeScript infer the script kind from the file extension, and walk every node with ts.forEachChild, collecting ts.getLeadingCommentRanges(text, node.pos) and ts.getTrailingCommentRanges(text, node.end), plus the end-of-file token's leading ranges. Deduplicate by start offset and return ranges in ascending order with the same start, end and text shape the current collector returns, so coversMarkers, nextNonTriviaStart and the association loop stay unchanged. Comment ranges come from the parser's trivia positions, so text inside string, template, and substituted template literals is never a comment. titleMarkers is untouched: it already reads a suite title as a single literal token. bindCoversMarkers gains the source fileName as the collector's input; no exported signature changes.

The scope analyzer in build-review-test-scope.ts needs no production change. Once the literal text stops producing uncertain-association markers, an added unmarked test falls through to its existing unbound note, and an unchanged file-level marker is still consumed as an unchanged association and never becomes a candidate, exactly as decisions 4 and 7 of the governing ADR require.

Add describeBuildReviewScopeIncompleteFaults(faults) to build-review-outcome.ts beside describeBuildReviewDecisionStops. It renders one line per indeterminate candidate as "scope-incomplete <rubric> <path>:<startLine>-<endLine> (<display>): <missingEvidenceReason>" and returns the empty string for no faults. In conductor.ts, at the existing branch that writes "build_review adjudication halted: ..." for an infrastructure halt, filter aggregate.scopeIncomplete to the uncoveredScopeIncomplete rubrics already computed in that block and append the rendered lines before the trace. The aggregate format, fault detail string, ledger, and events are unchanged; the HALT reason already flows through emitLoopHalt, so no new channel is added.

Local test patterns: build-review-test-bindings.test.ts builds inline source strings through its bindings() helper and asserts toMatchObject on the bindings array; build-review-test-scope.test.ts compares base and head inline sources through analyzeBuildReviewTestScope; conductor-build-review-adjudication.test.ts drives the real conductor branch with fixture({ scopeIncomplete: 'uncovered' }) and reads the HALT through run.haltMarker(). Reuse those helpers; no exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, option A, technical track, and all three stories on 2026-09-28; outcome 2 declined for the ADR conflict.
- Verified: build-review-test-bindings.ts comments() uses ts.createScanner over the whole text and feeds coversMarkers and nextNonTriviaStart.
- Verified: on the repository's build-review-inputs.test.ts the scanner reports a false comment at line 730 inside a template literal and finds 29 comments where parser comment ranges find 92.
- Verified: build-review-test-scope.ts builds candidates from introduced uncertain-association markers, and pushes an unbound note when a changed declaration has no bound marker.
- Verified: compareCoversMarkerBindings keys uncertain associations by reference only, so an unchanged file-level marker yields no added change and no candidate.
- Verified: build-review-outcome.ts exports describeBuildReviewDecisionStops and conductor.ts imports it; the infrastructure-halt branch has aggregate and uncoveredScopeIncomplete in scope.
- Verified: BuildReviewScopeIncompleteFault carries candidates whose sourceRegion has path, startLine, endLine and display, and conductor-build-review-adjudication.test.ts has a scopeIncomplete uncovered fixture with path test/example.test.ts and startLine 2.
- Scope check: consumer-facing engine behavior; no skill addition; provider-agnostic. Event-spine: no new channel.
- Verify-claims verdict: CLEAR. No pending product or scope assumptions.

## Tasks

### Task 1: Collect Covers comments from the parsed syntax tree
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/build-review-test-bindings.ts, src/conductor/test/engine/build-review-test-bindings.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests through the existing bindings() helper: a file with Covers text inside a double-quoted string, a single-quoted string, and a template literal containing a substitution (the incident shape), followed by a real leading "// Covers: task:7" comment on a later test; plus literal-only Covers text with an empty and a malformed reference list.
2. Verify RED: the substituted template case yields a marker span inside the literal or loses the later real comment.
3. Replace comments() with the parser-backed collector described in Technical Approach, passing the source fileName; keep the returned start, end and text shape and leave coversMarkers, nextNonTriviaStart and titleMarkers unchanged.
4. Verify GREEN with the scoped test file and commit.

**Done when:**
1. bindCoversMarkers returns no binding whose marker span lies inside any of the double-quoted, single-quoted, or substituted template literals in the unit fixture.
2. bindCoversMarkers binds the test after the substituted template literal to task 7 with owner association leading-comment.
3. bindCoversMarkers produces zero unresolved-reference and zero uncertain-association bindings for the literal-only empty and malformed Covers fixture.
4. Existing build-review-test-bindings.test.ts cases for leading comments, suite titles, and inheritance still pass unchanged.

### Task 2: Prove unmarked tests stay unbound at the scope layer
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/build-review-test-scope.test.ts
**Dependencies:** 1

**Steps:**
1. Add an analyzeBuildReviewTestScope fixture reproducing the incident: base and head share a file-level "// Covers: task:1, task:8" comment above an import; head adds a test with no leading marker whose body assigns a string and a substituted template literal both containing "// Covers: task:8".
2. Add a second fixture where the file-level marker is unchanged and the added test body contains no Covers text.
3. Verify both pass on top of Task 1, and confirm the incident fixture fails against the scanner-based collector by reading the pre-change file with git show rather than stashing.
4. Commit the tests.

**Done when:**
1. analyzeBuildReviewTestScope reports an unbound note for the added test in the incident fixture and returns an empty candidates list and no target for it.
2. analyzeBuildReviewTestScope reports the added unmarked test in the unchanged file-level marker fixture as an unbound note, and no candidate or target carries the task:1 or task:8 references.

### Task 3: Render scope-incomplete candidates with file and line
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/build-review-outcome.ts, src/conductor/test/engine/build-review-outcome.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests for describeBuildReviewScopeIncompleteFaults with one fault holding two indeterminate candidates and with an empty fault list.
2. Implement the renderer in the line format given in Technical Approach, following describeBuildReviewDecisionStops' shape.
3. Verify GREEN and commit.

**Done when:**
1. describeBuildReviewScopeIncompleteFaults returns one line per indeterminate candidate containing the rubric, the path:startLine-endLine location, the display, and the missing-evidence reason.
2. describeBuildReviewScopeIncompleteFaults returns the empty string for an empty fault list.

### Task 4: Name scope-incomplete candidates in the build_review HALT body
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/conductor-build-review-adjudication.test.ts
**Dependencies:** 3

**Steps:**
1. Extend the existing uncovered scope-incomplete conductor test to require the HALT marker to contain "test/example.test.ts:2" and "the pinned binding is incomplete"; extend the uncovered-infrastructure test to require the HALT marker contains no "scope-incomplete testQuality" line.
2. Verify RED for the scope-incomplete assertion.
3. In the infrastructure-halt branch, append describeBuildReviewScopeIncompleteFaults over aggregate.scopeIncomplete filtered to uncoveredScopeIncomplete, only when non-empty, after the halt detail and before the trace.
4. Verify GREEN for the conductor adjudication test file and commit.

**Done when:**
1. The conductor run for fixture scopeIncomplete uncovered writes a HALT marker containing "uncovered build-review coverage failure", "test/example.test.ts:2", and "the pinned binding is incomplete".
2. The conductor run for fixture reportUncoveredInfrastructure writes a HALT marker containing "build_review adjudication halted" and no "scope-incomplete testQuality" line.
3. The kickback ledger assertions of both existing tests (mechanicalFaults 3, count 0) still pass unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a test file in which a template literal with a substitution contains the text "// Covers: task:8", when Covers marker bindings are computed for that file, then no binding carries a marker whose span lies inside that literal. | 1 | "bindCoversMarkers returns no binding whose marker span lies inside any of the double-quoted, single-quoted, or substituted template literals in the unit fixture." | diff-local |
| Story 1 happy: Given a real leading "// Covers: task:7" comment on a test that follows such a template literal in the same file, when Covers marker bindings are computed, then that test is bound to task 7 through a leading-comment association. | 1 | "bindCoversMarkers binds the test after the substituted template literal to task 7 with owner association leading-comment." | diff-local |
| Story 1 negative: Given string and template literals whose Covers text has an empty or malformed reference list, when Covers marker bindings are computed, then no unresolved-reference or uncertain-association binding is produced from that text. | 1 | "bindCoversMarkers produces zero unresolved-reference and zero uncertain-association bindings for the literal-only empty and malformed Covers fixture." | diff-local |
| Story 2 happy: Given an added test with no leading marker whose body contains Covers text only inside string literals, when test-quality scope is analyzed, then the test is reported as an unbound note and no scope candidate is produced for it. | 2 | "analyzeBuildReviewTestScope reports an unbound note for the added test in the incident fixture and returns an empty candidates list and no target for it." | diff-local |
| Story 2 negative: Given an unchanged file-level Covers comment above the imports and an added test with no marker of its own, when test-quality scope is analyzed, then the test remains an unbound note and no candidate or target carries the file-level marker's references. | 2 | "analyzeBuildReviewTestScope reports the added unmarked test in the unchanged file-level marker fixture as an unbound note, and no candidate or target carries the task:1 or task:8 references." | diff-local |
| Story 3 happy: Given build_review halts on an uncovered scope-incomplete testQuality fault, when the HALT marker is written, then its body names each indeterminate candidate's test file path and start line together with its missing-evidence reason. | 3, 4 | "The conductor run for fixture scopeIncomplete uncovered writes a HALT marker containing "uncovered build-review coverage failure", "test/example.test.ts:2", and "the pinned binding is incomplete"." | diff-local |
| Story 3 negative: Given build_review halts on uncovered infrastructure failure with no scope-incomplete fault, when the HALT marker is written, then the body keeps the existing halt text and contains no scope-incomplete candidate line. | 4 | "The conductor run for fixture reportUncoveredInfrastructure writes a HALT marker containing "build_review adjudication halted" and no "scope-incomplete testQuality" line." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against inline fixtures. Task 1 owns unit proof of comment collection at the bindCoversMarkers boundary. Task 2 owns integration proof through the real analyzeBuildReviewTestScope, which runs real binding comparison and declaration analysis with no external boundary. Task 3 owns the pure renderer's unit proof. Task 4 owns the cross-boundary integration through the real conductor build_review branch with the existing fake provider fixture, observed at the HALT marker. No LLM, network, or aggregate suite run is required, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 3 -> Task 4

Small tier: architecture and coherence artifacts are skipped. No new ADR or amendment is required; the governing ADR's association rules are preserved and outcome 2 is declined.
