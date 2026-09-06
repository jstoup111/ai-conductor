# Implementation Plan: Accept bold Outcome delivered line in as-built parser

**Date:** 2026-09-06
**Stories:** .docs/stories/accept-bold-outcome-delivered-line-in-as-built-par.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent preserves the existing as-built contract exactly — the closed verdict vocabulary, the four invalid causes, the fail-closed missing-outcome result, and the routing keyed off each classification are all unchanged, and only the accepted spelling of two label lines widens.

## Summary

Four bounded tasks deliver #2175 by extracting the as-built verdict line's existing marker
tolerance into one shared reader and routing the outcome line and the shipped-record association
through it. The heading form of the verdict line, the conductor's duplicate blocked-detection
regex, the findings-table parser, and the verdict vocabulary are outside this small slice.

## Technical Approach

Today three independent regexes read the same two as-built label lines with three different
grammars. The verdict reader tolerates up to two marker characters before the label, between the
label and its colon, and on both sides of the value, then strips marker characters from the
captured value and trims it. The outcome read inside the classifier repeats that grammar but omits
the marker tolerance after the colon, which is the defect: a value written inside bold markers
never matches, so a well-formed report falls through to the missing-outcome invalid cause and the
gate re-dispatches until the retry budget halts the feature. The shipped-record association's
delivered-plan-gap projection carries a third, stricter copy that tolerates no markers at all, so
widening only the classifier would let a bold report ship while silently dropping its recorded
finding.

The fix is one reader, not a wider regex. Add a focused module exporting a single function that
takes the report text and a label name and returns the cleaned value of the first matching line, or
null. Its grammar is exactly the verdict reader's grammar today, extended with the marker tolerance
after the colon that the verdict reader already has and the outcome read lacks: line-anchored,
horizontal whitespace and up to two marker characters before the label, optional markers between
the label and one or more colons, optional markers around the value, marker characters stripped
from the captured value, trimmed, and null when the remainder is empty. Case-insensitive on the
label. Callers keep their own vocabulary: the verdict path upper-cases the returned value and keeps
its closed set, the outcome path lower-cases it and accepts only yes or no, so an unrecognized or
absent value keeps its existing fail-closed result.

The new module takes no dependencies. This matters: the shipment association module currently
imports nothing at all, and the artifacts module is a large module with filesystem and Git
dependencies, so putting the shared reader in artifacts would force the association module to
depend on it. A standalone module keeps both callers light and gives the anti-drift test one
subject to address.

Anti-drift is a property of the code, not only of a test: after this change there is exactly one
grammar, so the two readers cannot diverge by construction. The test makes that visible rather than
enforcing it — one spelling corpus, defined once, is applied to both label names, so a style added
for one label is asserted for the other. The corpus is deliberately limited to inline label lines;
a value carried on a following line is a different shape, owned by a sibling issue, and is asserted
here only as it behaves today.

Tests follow the repository's test-design rules. The reader is a pure exported helper, so its
spelling corpus belongs at unit level in a new test file beside the module. The two entry points
are covered where they already are: the as-built classification and completion-predicate cases live
in the existing as-built verdict test file, which already writes report fixtures into a temporary
pipeline directory and calls the completion predicate; the shipped-record projection cases live in
the existing shipped-record test file, which already calls the exported recorded-findings function
with report text. Both keep the real internal path, need no third-party boundary, and touch no
network, provider, or process. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the shared-reader approach over an in-place regex widening, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `readAsBuiltVerdictLine` in the engine artifacts module matches a line-anchored marker-tolerant pattern, strips marker characters from the captured value, trims it, and returns a not-found result when the remainder is empty.
- Verified: the outcome read inside `classifyAsBuiltReviewOutcome` uses the same shape without marker tolerance after the colon and constrains the capture to yes or no, so a bold value yields the missing-outcome invalid cause.
- Verified: `deliveredPlanGapFinding` in the engine shipment-association module requires a marker-free verdict line and a marker-free outcome line before it retains a delivered plan-gap finding.
- Verified: the engine shipment-association module has no import statements today, and the engine artifacts module imports many sibling modules including filesystem and Git seams.
- Verified: the existing as-built verdict test file imports the verdict reader, the classifier, the invalid-reason renderer, and the completion predicate, and already writes as-built report fixtures into a temporary pipeline directory.
- Verified: the existing shipped-record test file imports the exported recorded-findings function and drives it with as-built report text containing a plain verdict line, a plain outcome line, and a recorded-findings section.
- Verified: an existing case asserts that a verdict line whose value is only marker characters yields the no-verdict-line cause; the shared reader preserves it by stripping markers before the empty check.
- Verified: the conductor's blocked-findings halt renderer carries a fourth, verdict-only copy of the marker-tolerant pattern; it is deliberately out of scope and is left unchanged.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no event, metric, span, log line, or report channel is added or changed.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior claim above was read in the worktree. No unconfirmed assumption remains that could change the approach or the task breakdown.

## Tasks

### Task 1: Shared reader for as-built label lines
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/as-built-label-line.ts, src/conductor/test/engine/as-built-label-line.test.ts
**Dependencies:** none

**Steps:**
1. Create the new test file beside the other engine unit tests and define one spelling corpus there: a helper that, given a label name and a value, returns the plain line, the line with markers around the label, the line with markers wrapping the label and its colon, the line with markers around only the value, the wholly bold line, a form padded with leading and trailing horizontal whitespace, and a doubled-colon form.
2. Write the failing table-driven case: for both the verdict label and the outcome-delivered label, every corpus spelling returns the same cleaned value from the new reader.
3. Write the failing negative cases: a line whose value after the colon is only marker characters, a line with no value, a label occurring after other text on the same line, and a heading whose value sits on a following line each return null.
4. Verify RED, then implement the reader as described in the Technical Approach: build the pattern from the requested label, match at line start with a case-insensitive multiline pattern, capture lazily, strip marker characters from the capture, trim it, and return null when the remainder is empty.
5. Verify GREEN with the repository's narrowest scoped test invocation for this file, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. The shared reader returns the identical cleaned value for every corpus spelling, for both label names, in one table-driven test.
2. The reader returns null for a marker-only value, an absent value, a mid-line label occurrence, and a heading whose value sits on a later line.
3. The spelling corpus is defined once and consumed for both label names, so a style asserted for one label is asserted for the other.

### Task 2: Route the as-built gate's two label lines through the shared reader
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/test/as-built-verdict.test.ts
**Dependencies:** 1

**Steps:**
1. Add failing cases to the existing as-built verdict test file: for a PLAN_GAP report, the marker-around-label, marker-around-value, and wholly bold outcome spellings each classify identically to the unstyled spelling, for both yes and no.
2. Add the failing gate-level case using the file's existing temporary-fixture helpers: a report whose verdict line is plain PLAN_GAP and whose outcome line carries markers around the label reports done from the as-built completion predicate.
3. Verify RED, then replace the inline pattern inside the verdict reader and the inline outcome pattern inside the classifier with calls to the shared reader. The verdict path upper-cases the returned value and keeps its closed vocabulary and its not-found result for a null return; the outcome path lower-cases the returned value and accepts only yes or no, keeping every other value on the existing missing-outcome cause.
4. Verify GREEN by running the whole as-built verdict test file plus the other test files that assert as-built classification, run the typecheck target that covers test files, and commit.

**Done when:**
1. The as-built completion predicate reports done for a PLAN_GAP report whose outcome line is written with bold markers around the label.
2. Bold-label, bold-value, and wholly bold outcome lines classify identically to the unstyled line, for both yes and no.
3. Every pre-existing case in the as-built verdict test file passes unchanged, including the closed verdict vocabulary, the four invalid causes, and the blocked classifications.

### Task 3: Route the shipped-record plan-gap projection through the shared reader
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/shipment-association.ts, src/conductor/test/shipped-record.test.ts
**Dependencies:** 1

**Steps:**
1. Add the failing case to the existing shipped-record test file: recorded review findings computed from an as-built report whose verdict and outcome lines both carry markers are deep-equal to the findings computed from the same report written without markers.
2. Verify RED, then replace the two inline patterns in the delivered-plan-gap projection with calls to the shared reader, comparing the upper-cased verdict value against the plan-gap token and the lower-cased outcome value against yes.
3. Keep the projection's remaining behavior untouched: the narrative-section scan, the fenced-block exclusion, the labelled outcome and summary extraction, and the additive combination with the projected remediation findings.
4. Verify GREEN by running the whole shipped-record test file and the other test files that exercise recorded shipment findings, run the typecheck target that covers test files, and commit.

**Done when:**
1. A delivered plan-gap finding is recorded for a PLAN_GAP report whose verdict and outcome lines both carry bold markers.
2. The recorded findings for the bold report are deep-equal to the recorded findings for its unstyled counterpart.
3. The existing unstyled shipped-record cases, including the additive combination with projected remediation findings, pass unchanged.

### Task 4: Pin the fail-closed results at both entry points
**Story:** Story 1
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/as-built-verdict.test.ts, src/conductor/test/shipped-record.test.ts
**Dependencies:** 2, 3

**Steps:**
1. Add the failing gate cases to the as-built verdict test file: a PLAN_GAP report whose bold outcome line carries a value that is neither yes nor no, and one whose outcome line carries markers but no value, each classify as the missing-outcome invalid cause, and the rendered operator reason for that cause is unchanged.
2. Add the failing shipped-record case: an as-built report whose verdict line carries markers and whose bold outcome line records no yields no delivered plan-gap finding.
3. Add the failing shared-reader case exercised through both entry points: a label line whose only content after the colon is marker characters is read as no value, so a marker-only verdict keeps the no-verdict-line cause and a marker-only outcome keeps the missing-outcome cause.
4. Verify RED where the widened acceptance would otherwise have leaked, confirm the implementations from Tasks 2 and 3 already satisfy every case without further production change, and if any case fails, correct the reader or the caller vocabulary rather than the assertion.
5. Verify GREEN across both test files, run the typecheck target that covers test files, then run the repository's configured aggregate test command once and commit.

**Done when:**
1. A bold outcome line whose value is neither yes nor no keeps the missing-outcome invalid cause and its existing operator reason.
2. A bold outcome line carrying markers but no value keeps the missing-outcome invalid cause rather than being read as delivered.
3. A bold-styled PLAN_GAP report recording an outcome of no yields no delivered plan-gap finding.
4. A label line whose only content after the colon is marker characters yields no value from both the verdict reader and the outcome reader.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a PLAN_GAP as-built report whose outcome line carries bold markers around the label, when the as-built completion gate classifies the report, then it classifies as a delivered plan gap and the step is satisfied. | 2 | "The as-built completion predicate reports done for a PLAN_GAP report whose outcome line is written with bold markers around the label." | diff-local |
| Story 1 happy: Given a PLAN_GAP as-built report whose outcome line carries bold markers around only the value, or around the whole line, when the gate classifies the report, then the result equals the result for the unstyled spelling of that same line. | 2 | "Bold-label, bold-value, and wholly bold outcome lines classify identically to the unstyled line, for both yes and no." | diff-local |
| Story 1 happy: Given a PLAN_GAP as-built report whose bold outcome line records no, when the gate classifies the report, then it classifies as an undelivered plan gap and the step stays unsatisfied. | 2 | "Bold-label, bold-value, and wholly bold outcome lines classify identically to the unstyled line, for both yes and no." | diff-local |
| Story 1 negative: Given a PLAN_GAP as-built report whose bold outcome line carries a value that is neither yes nor no, when the gate classifies the report, then it stays invalid for a missing outcome and the operator reason still names the required yes-or-no outcome line. | 4 | "A bold outcome line whose value is neither yes nor no keeps the missing-outcome invalid cause and its existing operator reason." | diff-local |
| Story 1 negative: Given a PLAN_GAP as-built report whose outcome line carries marker characters but no value, when the gate classifies the report, then it stays invalid for a missing outcome rather than being read as delivered. | 4 | "A bold outcome line carrying markers but no value keeps the missing-outcome invalid cause rather than being read as delivered." | diff-local |
| Story 2 happy: Given a spelling of an as-built label line that is accepted for the verdict label, when the same spelling is applied to the outcome-delivered label, then it is accepted with the same extracted value. | 1 | "The spelling corpus is defined once and consumed for both label names, so a style asserted for one label is asserted for the other." | diff-local |
| Story 2 happy: Given a shipped record assembled from a PLAN_GAP as-built report whose verdict and outcome lines both carry bold markers, when the recorded review findings are computed, then the delivered plan-gap finding is retained exactly as it is for the unstyled report. | 3 | "The recorded findings for the bold report are deep-equal to the recorded findings for its unstyled counterpart." | diff-local |
| Story 2 negative: Given an as-built label line whose only content after the colon is marker characters, when either label is read, then both readers report no value rather than an empty one. | 1, 4 | "A label line whose only content after the colon is marker characters yields no value from both the verdict reader and the outcome reader." | diff-local |
| Story 2 negative: Given a shipped record assembled from a bold-styled PLAN_GAP as-built report that records an outcome of no, when the recorded review findings are computed, then no delivered plan-gap finding is retained. | 4 | "A bold-styled PLAN_GAP report recording an outcome of no yields no delivered plan-gap finding." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by report text supplied in the test and the
readers in this diff, and no commit outside this feature can change whether it holds. Task 1 owns
the pure spelling corpus at unit level, which is the lowest sufficient layer for the shared grammar.
Task 2 owns the integration proof for the as-built gate: its gate-level case reaches the reader
through the real completion predicate and a report fixture on disk, not through a direct call to the
helper, so it proves the gate actually reaches the widened grammar. Task 3 owns the integration
proof for the shipped record, driving the exported recorded-findings entry point with report text so
the projection's own narrative scan and additive combination stay in the path. Task 4 owns the
fail-closed assertions at both of those entry points. No third-party boundary is involved, so no
fake is required beyond the temporary directories the existing files already create; no test reaches
a provider, a network service, or a subprocess. No terminal catch-all validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 4
Task 1 -> Task 3 -> Task 4
