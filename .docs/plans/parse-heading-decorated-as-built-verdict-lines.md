# Implementation Plan: Parse heading-decorated as-built verdict lines

**Date:** 2026-09-06
**Stories:** .docs/stories/parse-heading-decorated-as-built-verdict-lines.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing as-built gate contract — the closed verdict vocabulary, the fail-closed invalid causes, the blocking-findings table grammar, and the outcome-line condition are all preserved, and only the decoration tolerated around the verdict label changes.

## Summary

Five bounded tasks deliver #2203: the as-built verdict-line reader moves into a dependency-free
module, widens to tolerate markdown heading decoration around an otherwise recognized verdict, and
becomes the single reader the halt renderer and the shipment finding collector both use. The
`Outcome delivered:` line, the verdict vocabulary, the diagnostics for an absent or unrecognized
verdict, and the reviewer prompt are out of scope.

## Technical Approach

The gate reader currently matches optional leading horizontal whitespace and bold markers before the
verdict label, so an ATX heading prefix falls through to a not-found result and the validation group
halts with the missing-verdict-line cause even though the value is in the recognized vocabulary.
Widen exactly that leading segment to also tolerate up to six `#` characters followed by optional
horizontal whitespace, and tolerate a trailing closing heading marker on the same line, since a
closed ATX heading is the natural pair of an opened one and the closed vocabulary contains no `#`.
Everything downstream of the capture — the marker strip, the trim, the upper-casing, and the closed
recognized set — stays byte-for-byte as it is, so an unrecognized value and an empty value keep
their present classifications.

The engine currently carries three readers of the same line: the gate reader, a narrower blocked
detection inside the halt-body renderer, and a narrower delivered-plan-gap detection inside the
shipment finding collector. Widening only the first would let the gate accept a report the other two
then ignore, silently dropping a blocking-findings detail from an operator halt or a plan-gap entry
from the shipped record. So lift the reader into a new dependency-free engine module,
`src/conductor/src/engine/as-built-verdict-line.ts`, holding the function and its result type and
nothing else; re-export it from the artifacts module under its existing name so every current
importer and test compiles unchanged; and replace the two duplicate regexes with calls to it. The
shipment collector is deliberately import-free today, which is why the reader moves to its own
module rather than being imported from the artifacts module: a pure collector must not acquire a
filesystem-heavy dependency. The shipment collector's second condition, the plain `Outcome
delivered: yes` line, is not touched — that half is the subject of #2175 and this change must not
pre-empt it.

Prove the widening at the pure-reader seam, where the behavior lives: table-driven cases over the
decorated and undecorated forms of each recognized verdict, and over the three fail-closed inputs.
Prove the two agreement criteria through the seams that own them — the existing bounded as-built
routing fixture in the as-built verdict test file for the halt body, and the existing collector-level
fixtures in the shipped-record test file for the retained finding. Neither needs a new fixture shape:
both files already build the report bodies inline, so a decorated body is a one-line variation of an
existing case. No conductor run beyond the existing bounded routing fixture is added, no third-party
boundary is reached, and no exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved the Small scope, the technical track, parser tolerance over a prompt pin, and both stories on 2026-09-06 (delegated).
- Verified: the gate reader's regex in the artifacts module allows only horizontal whitespace and bold markers before the verdict label, and its captured value is stripped of markers, trimmed, and upper-cased before the closed-set comparison.
- Verified: the invalid classification for a not-found reader result is the missing-verdict-line cause, which is the exact halt text quoted in the issue.
- Verified: the halt-body renderer in the conductor module carries its own blocked-verdict regex, and the conductor module already imports the blocking-findings parser from the artifacts module, so adding the shared reader to that import list is a one-line change.
- Verified: the shipment finding collector module has no imports at all and detects a delivered plan gap with its own verdict regex plus a separate plain outcome-line regex.
- Verified: the as-built verdict test file already asserts that a `Verdict` heading with no colon and a value on a later line is not a verdict line, and that a marker-only value is not a verdict line; both fixtures remain correct under the widening because neither carries a colon-terminated label with a recognized value.
- Verified: the shipped-record test file already exercises the collector directly with inline delivered plan-gap report bodies.
- Verified: the reviewer prompt's report template already prescribes the undecorated verdict line, and the reference documentation states the requirement only as a verdict line, so neither becomes stale.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no event, metric, span, log line, or report channel is added or changed — the halt body and the retained finding are existing outputs whose content is unchanged for every input the engine accepts today.
- Verify-claims verdict: CLEAR. No load-bearing assumption remains unconfirmed; every claim above was read in the worktree.

## Tasks

### Task 1: Lift the verdict reader into its own module and widen its decoration
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/as-built-verdict-line.ts, src/conductor/src/engine/artifacts.ts, src/conductor/test/as-built-verdict.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven failing unit cases over the reader for each recognized verdict in its undecorated form and in decorated forms: a heading prefix, a heading prefix with bold markers, a lower-case value, and an opened-and-closed heading. Assert the decorated result equals the undecorated result for the same verdict.
2. Add a failing case asserting the as-built outcome classifier returns the approved outcome for a report whose only verdict line is a heading carrying the approved-with-drift-notes value.
3. Verify both fail (RED).
4. Create the new dependency-free module holding the reader and its result type, move the function there unchanged, and re-export it from the artifacts module under its existing name so current importers are untouched.
5. Widen the reader's leading segment to tolerate up to six heading characters followed by optional horizontal whitespace, and tolerate a trailing closing heading marker, leaving the capture handling and the closed recognized set exactly as they are.
6. Verify GREEN, run the project's typecheck target that covers test files, and commit.

**Done when:**
1. The reader accepts up to six leading heading characters, optional bold markers, and an optional closing heading marker around a recognized verdict, and returns a result identical to the undecorated line for each of the four recognized values.
2. The as-built outcome classifier returns the approved outcome for a report whose only verdict line is a heading carrying the approved-with-drift-notes value.
3. The reader and its result type live in the new dependency-free module and are re-exported from the artifacts module under the existing name, so no current importer changes.

### Task 2: Keep the fail-closed verdict diagnostics unchanged
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/as-built-verdict.test.ts
**Dependencies:** 1

**Steps:**
1. Add a case asserting a report whose only verdict heading carries no colon, with its value on a later line, still classifies invalid with the missing-verdict-line cause.
2. Add a case asserting a heading-decorated verdict line stating a value outside the closed vocabulary classifies invalid with the unrecognized-verdict cause carrying that raw value.
3. Add a case asserting a heading-decorated verdict line whose value is empty or consists only of markers classifies invalid with the missing-verdict-line cause.
4. Run the file's tests, confirm the two pre-existing heading and marker-only assertions still pass alongside the new ones, and commit.

**Done when:**
1. A report whose verdict heading carries no colon and states its value on a later line classifies invalid with the missing-verdict-line cause.
2. A heading-decorated verdict line stating a value outside the closed vocabulary classifies invalid with the unrecognized-verdict cause carrying that raw value.
3. A heading-decorated verdict line whose value is empty or marker-only classifies invalid with the missing-verdict-line cause.

### Task 3: Render the blocked halt body through the shared reader
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/as-built-verdict.test.ts
**Dependencies:** 1

**Steps:**
1. Add a failing case to the existing bounded as-built routing fixture that supplies a heading-decorated blocked report carrying a design finding, and assert the resulting operator-facing halt body enumerates that finding.
2. Verify RED — today the decorated report never reaches the blocked branch.
3. Replace the halt renderer's own blocked-verdict regex with the shared reader, comparing its recognized value to the blocked verdict, and add the reader to the existing artifacts import list.
4. Verify GREEN, confirm the pre-existing routing assertions over undecorated blocked reports still pass, and commit.

**Done when:**
1. The halt-body renderer detects the blocked verdict through the shared reader and carries no verdict regex of its own.
2. The bounded routing fixture's heading-decorated blocked report halts with a body enumerating its blocking finding, and the existing undecorated routing assertions are unchanged.

### Task 4: Retain the delivered plan-gap finding through the shared reader
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/shipment-association.ts, src/conductor/test/shipped-record.test.ts
**Dependencies:** 1

**Steps:**
1. Add a failing collector case whose report carries a heading-decorated delivered plan-gap verdict line, the plain outcome line, and the existing narrative findings section, and assert the retained finding equals the one produced for the undecorated body.
2. Verify RED.
3. Replace the collector's own verdict regex with the shared reader from the new module, comparing its recognized value to the plan-gap verdict, and leave the plain outcome-line condition exactly as it is.
4. Verify GREEN, confirm the collector module's only import is the new reader module, and commit.

**Done when:**
1. The delivered plan-gap collector detects its verdict through the shared reader while its plain outcome-line condition is unchanged.
2. A heading-decorated delivered plan-gap report yields a retained finding equal to the one produced for the same body with an undecorated verdict line.
3. The collector module gains no dependency other than the new reader module.

### Task 5: Prove no verdict remains readable in two ways
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/as-built-verdict.test.ts, src/conductor/test/shipped-record.test.ts
**Dependencies:** 3, 4

**Steps:**
1. Add a collector case whose report carries the narrative findings section and the plain outcome line but no recognizable verdict line, asserting no plan-gap finding is retained.
2. Add a routing-fixture case whose blocked-shaped report carries no recognizable verdict line, asserting the halt body carries no blocking-findings detail.
3. Verify both pass against the implemented readers, run the project's aggregate test command, and commit.

**Done when:**
1. A report with no recognizable verdict line yields no retained plan-gap finding and a halt body with no blocking-findings detail.
2. Searching the engine source tree for a regex matching the verdict label finds exactly one, in the new reader module.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an as-built report whose verdict line is written as a markdown heading carrying `APPROVED WITH DRIFT NOTES`, when the as-built outcome is classified, then it is classified as approved rather than as a missing verdict line. | 1 | "The as-built outcome classifier returns the approved outcome for a report whose only verdict line is a heading carrying the approved-with-drift-notes value." | diff-local |
| Story 1 happy: Given an as-built report whose verdict line combines a heading prefix, bold markers, a closing heading marker, and a lower-case value, when the verdict line is read, then it yields the same recognized verdict as the undecorated form of that line. | 1 | "The reader accepts up to six leading heading characters, optional bold markers, and an optional closing heading marker around a recognized verdict, and returns a result identical to the undecorated line for each of the four recognized values." | diff-local |
| Story 1 negative: Given an as-built report whose only `Verdict` heading carries no colon and states its value on a later line, when the as-built outcome is classified, then it is still classified invalid with the missing-verdict-line cause. | 2 | "A report whose verdict heading carries no colon and states its value on a later line classifies invalid with the missing-verdict-line cause." | diff-local |
| Story 1 negative: Given an as-built report whose heading-decorated verdict line states a value outside the closed vocabulary, when the as-built outcome is classified, then it is classified invalid with the unrecognized-verdict cause carrying that raw value. | 2 | "A heading-decorated verdict line stating a value outside the closed vocabulary classifies invalid with the unrecognized-verdict cause carrying that raw value." | diff-local |
| Story 2 happy: Given a heading-decorated blocked report carrying a valid blocking-findings table, when the as-built halt body is rendered, then it lists the parsed blocking findings instead of an empty detail. | 3 | "The bounded routing fixture's heading-decorated blocked report halts with a body enumerating its blocking finding, and the existing undecorated routing assertions are unchanged." | diff-local |
| Story 2 happy: Given a heading-decorated delivered plan-gap report whose outcome line is in its plain form, when the retained shipment findings are collected, then the plan-gap finding is recorded exactly as it is for the undecorated report. | 4 | "A heading-decorated delivered plan-gap report yields a retained finding equal to the one produced for the same body with an undecorated verdict line." | diff-local |
| Story 2 negative: Given a report carrying no recognizable verdict line, when the halt body is rendered and the retained shipment findings are collected, then the halt body carries no blocking-findings detail and no plan-gap finding is recorded. | 5 | "A report with no recognizable verdict line yields no retained plan-gap finding and a halt body with no blocking-findings detail." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by the reader and the two call sites this
diff changes, against report bodies the tests construct inline. Task 1 owns the pure-reader unit
cases and the classifier case for Story 1's happy criteria; Task 2 owns Story 1's fail-closed unit
cases. The two production boundaries that consume the verdict line each get exactly one integration
owner: Task 3 owns the halt-body boundary, proved through the existing bounded as-built routing
fixture that ends at the observed halt with an injected step runner and no third-party call, and
Task 4 owns the shipped-record retention boundary, proved through the existing collector-level
fixtures. Task 5 closes both boundaries' negative case and the single-reader diff property. No new
conductor run, no real provider, registry, or network call, and no new aggregate test is introduced;
the existing suites supply the unchanged permutations for undecorated reports.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 1 -> Task 4
Task 3 -> Task 5
Task 4 -> Task 5

Small tier: architecture, conflict-check, and coherence artifacts are skipped. No architecture
decision record is added or amended, because the verdict vocabulary, the fail-closed diagnostics,
and the routing that consumes them are all preserved.
