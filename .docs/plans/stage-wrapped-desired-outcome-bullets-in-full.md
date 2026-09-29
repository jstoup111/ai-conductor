# Implementation Plan: Stage wrapped Desired-outcome bullets in full

**Date:** 2026-09-28
**Stories:** .docs/stories/stage-wrapped-desired-outcome-bullets-in-full.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change is confined to the Desired-outcome staging extractor, and the staged file shape, intake marker writer, per-line readers, and coherence outcome comparison keep their existing contracts.

## Summary

Three bounded tasks deliver #2620. The staging extractor folds each Desired-outcome bullet's continuation lines into that bullet and emits it as one physical line, so the full text reaches the staged file, the committed intake marker, and the land-time coherence outcome comparison without any reader change. The story-criterion extractor (#2138), historical marker rewrites, and pipe handling in coherence rows are outside this slice.

## Technical Approach

Change only extractDesiredOutcomeSection in outcome-staging.ts. Replace the filter-and-trim pass over the section body with a single left-to-right line scan that keeps a current-bullet accumulator:

- A line matching the existing dash-bullet test (optional leading whitespace, a dash, whitespace) starts a new bullet; its trimmed text is the accumulator's first part. Indented dash lines are therefore still their own bullets, preserving today's outcome count for nested sub-bullets.
- A blank or whitespace-only line, a line starting with a hash heading marker, a line starting with another list marker (asterisk, plus, or a number followed by a dot or parenthesis), or a line matching INBOUND_ARMOR_LINE closes the accumulator. None of these lines is staged, which matches what the current filter keeps.
- Any other line, while the accumulator is open, is a continuation: append a single space and its trimmed text. While no accumulator is open (lead-in prose, or a paragraph after a blank line), the line is ignored, as today.
- Emit each accumulated bullet as one line. The heading, the blank line after it, the newline join, and the zero-bullet form stay exactly as they are, so single-line input produces byte-identical output.

Because intake-marker.ts copies the staged section verbatim and land-spec.ts feeds readStagedIntakeOutcomes (or the readCommittedIntakeOutcomes fallback) straight into runCoherenceGate, a one-line full bullet flows end to end. The two readers are deliberately unchanged: they also parse committed legacy markers and hand-written staging files, and keeping their per-line shape is what guarantees already-landed truncated markers return the same bullets and keep matching their outcome rows. checkOutcomeCoverage already collapses whitespace runs in both the quote and the bullet, so a long joined bullet compares correctly.

Tests follow the write-tests skill: extractor and reader cases are unit tests on temporary directories with no process or network boundary; the land-boundary proof extends the existing coherence acceptance file, which already drives the real landSpec against a real local Git repository with outcomes staged by the real createEngineerWorktree writer and faked GitHub and Mermaid boundaries. Reuse that file's seeding pattern from its real-staging-writer case; vary only the intake body and the coherence outcome quote.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, the writer-only normalization approach, the sub-bullet counting rule, and both stories on 2026-09-28 (delegated).
- Verified: src/conductor/src/engine/engineer/outcome-staging.ts extractDesiredOutcomeSection keeps only lines matching a leading dash and trims them; readStagedIntakeOutcomes and readCommittedIntakeOutcomes use the same per-line filter.
- Verified: stageIntakeOutcomes wraps the extracted section in the body's inbound armor lines when both are present; the existing unit test places the closing armor line directly after the last bullet.
- Verified: src/conductor/src/engine/engineer/intake-marker.ts extractOutcomesSection copies the staged armored block or Desired-outcome section verbatim into the marker.
- Verified: src/conductor/src/engine/engineer/land-spec.ts passes stagedOutcomes.bullets from the staged reader, or the committed-marker fallback, to runCoherenceGate as outcomeBullets.
- Verified: src/conductor/src/engine/engineer/coherence-validator.ts checkOutcomeCoverage reports a quoteMismatch gap for the outcome id when normalizeOutcomeQuote of the row quote differs from that of the bullet; normalization strips the list marker and surrounding quotes and collapses whitespace.
- Verified: src/conductor/src/engine/engineer/worktree-authoring.ts createEngineerWorktree calls stageIntakeOutcomes with the claim's sourceRef and body.
- Verified: src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts has a real-staging-writer landSpec case and an outcome-1 row quoting "The duplicate-spec class dies at land."
- Scope check: repository-only engine behavior; no skill addition; provider-agnostic. Event-spine: no event, metric, span, or report changes.
- Verify-claims verdict: CLEAR. Every path and symbol above was read in this worktree.

## Tasks

### Task 1: Fold continuation lines into their bullet in the staging extractor
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/outcome-staging.ts, src/conductor/test/engine/engineer/outcome-staging.test.ts
**Dependencies:** none

**Steps:**
1. Add unit cases to the stageIntakeOutcomes describe block: a bullet continued over two indented lines and one unindented line; a single-line-bullet body whose staged file is compared byte-for-byte to the exact string today's extractor produces; a lead-in sentence before the first bullet plus a blank-line-separated paragraph after a bullet; a bullet with an indented dash sub-bullet that itself wraps; and an armored body whose closing armor line directly follows a wrapped last bullet.
2. Establish RED with a scoped run of this test file: the wrapped cases stage only the first physical line.
3. Implement the accumulator scan described in Technical Approach inside extractDesiredOutcomeSection, reusing INBOUND_ARMOR_LINE for the armor boundary. Leave stageIntakeOutcomes, both readers, and the staged file layout unchanged.
4. Reach GREEN, run the test-inclusive typecheck, and commit.

**Done when:**
1. The wrapped-bullet unit case shows stageIntakeOutcomes writes the bullet as one line with its full text joined by single spaces, and readStagedIntakeOutcomes returns exactly that full line.
2. The single-line unit case shows the staged file is byte-identical to the pre-change extractor output for the same body.
3. The prose unit case shows neither the lead-in sentence nor the blank-line-separated paragraph appears in any staged bullet or in readStagedIntakeOutcomes output.
4. The sub-bullet unit case shows the indented dash line is staged as its own bullet with its wrapped text, and the bullet count equals the number of dash lines.
5. The armored unit case shows the closing armor line stays on its own line after the full bullet and readStagedIntakeOutcomes returns bullets that do not contain the armor text.

### Task 2: Pin legacy truncated markers to their existing bullets
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/engineer/outcome-staging.test.ts
**Dependencies:** 1

**Steps:**
1. Add a readCommittedIntakeOutcomes unit case whose marker holds bullets cut mid-sentence, each followed directly by the next bullet, with no continuation lines, and a closing armor line after the last one.
2. Assert the exact returned bullet array, then pass those bullets with outcome rows quoting the truncated text to checkOutcomeCoverage; the case guards the readers against later folding changes.
3. Run the scoped test file and commit.

**Done when:**
1. The legacy-marker unit case shows readCommittedIntakeOutcomes returns the truncated bullets exactly as their marker lines, in order, with required true and the marker's Source-Ref.
2. The same case shows checkOutcomeCoverage returns ok true for those bullets against outcome rows quoting the truncated text.
3. readStagedIntakeOutcomes and readCommittedIntakeOutcomes source is unchanged in the feature diff.

### Task 3: Prove full-text outcomes at the land boundary
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Beside the existing real-staging-writer case, add a happy case: create the worktree through createEngineerWorktree with a sourceRef and an intake body whose first bullet is split so that its lines join to the first fixture outcome text, seed the same M-tier artifacts, keep the fixture coherence artifact whose outcome-1 row quotes that full text, and land.
2. Add a negative case with the same wrapped body where the outcome-1 row quotes only the bullet's first physical line.
3. Establish RED: before Task 1 the happy case is refused with an outcome-1 quote mismatch.
4. After Task 1, reach GREEN with a scoped run of this file and commit.

**Done when:**
1. The wrapped-body happy case, whose outcome-1 row quotes the full joined text, shows landSpec resolves, and the intake marker committed on the returned branch contains the full joined bullet line.
2. The fragment-quote case shows landSpec rejects with an error naming outcome-1.
3. Both cases create outcomes only through createEngineerWorktree with a body, never by writing the staging file directly.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an intake body whose Desired-outcome bullet continues over several following lines, when the outcomes are staged, then the staged file carries that bullet as one line holding its full text with each line break replaced by a single space, and the staged reader returns that full text. | 1 | "The wrapped-bullet unit case shows stageIntakeOutcomes writes the bullet as one line with its full text joined by single spaces, and readStagedIntakeOutcomes returns exactly that full line." | diff-local |
| Story 1 happy: Given an intake body whose Desired-outcome bullets are each written on a single line, when the outcomes are staged, then the staged file is byte-identical to what the current extractor produces. | 1 | "The single-line unit case shows the staged file is byte-identical to the pre-change extractor output for the same body." | diff-local |
| Story 1 happy: Given outcomes staged from an issue with a wrapped bullet, when the spec lands, then the committed intake marker carries the full bullet text. | 3 | "The wrapped-body happy case, whose outcome-1 row quotes the full joined text, shows landSpec resolves, and the intake marker committed on the returned branch contains the full joined bullet line." | diff-local |
| Story 1 negative: Given a Desired-outcome section with a lead-in sentence before the first bullet and a paragraph separated from a bullet by a blank line, when the outcomes are staged, then neither prose block appears in any staged bullet. | 1 | "The prose unit case shows neither the lead-in sentence nor the blank-line-separated paragraph appears in any staged bullet or in readStagedIntakeOutcomes output." | diff-local |
| Story 1 negative: Given a bullet with an indented dash sub-bullet beneath it, when the outcomes are staged, then the sub-bullet is staged as its own outcome and the outcome count equals the number of dash lines, as today. | 1 | "The sub-bullet unit case shows the indented dash line is staged as its own bullet with its wrapped text, and the bullet count equals the number of dash lines." | diff-local |
| Story 1 negative: Given an armored intake body whose closing armor line directly follows the last wrapped bullet, when the outcomes are staged, then the armor line is not folded into the bullet and still closes the staged block. | 1 | "The armored unit case shows the closing armor line stays on its own line after the full bullet and readStagedIntakeOutcomes returns bullets that do not contain the armor text." | diff-local |
| Story 2 happy: Given outcomes staged from an issue with a wrapped bullet and a coherence outcome row quoting that bullet's full text, when the spec lands, then the land is accepted. | 3 | "The wrapped-body happy case, whose outcome-1 row quotes the full joined text, shows landSpec resolves, and the intake marker committed on the returned branch contains the full joined bullet line." | diff-local |
| Story 2 negative: Given outcomes staged from an issue with a wrapped bullet and a coherence outcome row quoting only the bullet's first physical line, when the spec lands, then the land is refused naming that outcome id. | 3 | "The fragment-quote case shows landSpec rejects with an error naming outcome-1." | diff-local |
| Story 2 negative: Given a committed intake marker whose bullets were truncated before this change, when its outcomes are read back, then the reader returns the same bullets as before so its existing outcome rows still match. | 2 | "The same case shows checkOutcomeCoverage returns ok true for those bullets against outcome rows quoting the truncated text." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the extractor unit cases for folding, byte identity, prose exclusion, sub-bullet counting, and armor preservation. Task 2 owns the legacy committed-marker reader pin and its outcome-row match. Task 3 owns the cross-boundary integration: the real worktree staging writer through landSpec's intake-marker commit and coherence outcome gate, with GitHub and Mermaid faked as the acceptance file already does. No new aggregate or external-service test is required, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3

Small tier: architecture and coherence artifacts are skipped. No ADR is created or amended.
