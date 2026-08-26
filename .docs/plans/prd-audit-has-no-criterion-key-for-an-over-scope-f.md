# Implementation Plan: PRD-audit no-owner OVER_SCOPE findings

**Date:** 2026-08-25
**Stories:** .docs/stories/prd-audit-has-no-criterion-key-for-an-over-scope-f.md
**Conflict check:** Clean as of 2026-08-25

## Summary

Make the prd-audit engine parse and route OVER_SCOPE findings that own no story criterion
(`NC.<n>` keys in the report's no-owner section), reject duplicate keys per-row, salvage
correctly-parsed rows past bad rows (which still block, named), and bind no-owner decisions to
key + summary. 9 tasks.

## Technical Approach

- `parsePrdAuditReport` (src/conductor/src/engine/artifacts.ts) gains: a second section scan
  for `## Findings without an owning criterion` (table headed `Finding`, keys `/^NC\.\d+$/i`,
  grade OVER_SCOPE only); per-row rejection collection `rejectedRows: {rowText, key?, reason}[]`
  on the parse result instead of returning a whole-report mechanical fault for row-level
  defects; and duplicate-key detection that rejects every row carrying a duplicated key.
  Report-level faults (missing PRD marker, missing Verdict Table) keep the existing
  `mechanical-fault` result. `PrdAuditFinding` keeps `criterion: string` carrying either key
  form so existing consumers compile unchanged; a helper distinguishes NC keys.
- `accepted-widenings.ts`: `OverScopeDecision` already carries `summary`; the matching rule
  changes — for NC-keyed entries a decision matches only when both `criterion` and `summary`
  equal the re-reported finding's key and summary; criterion-keyed entries keep criterion-only
  matching. `classifyOverScopeCriterion` gains the finding's summary as an input for the NC
  case; `overScopeRelations` additionally reads the no-owner section.
- `routePrdAuditOverScope` (src/conductor/src/engine/conductor.ts:659) and the harvest path
  (`parseClearedOverScopeDecisions` call site ~:3087) widen `blockingCriteria` and the decision
  entries to NC keys; the summary a decision binds to is the same summary rendered into the
  decision block (finding evidence text), so operator-edited entries round-trip byte-identically.
- The prd_audit gate route in artifacts.ts (~:2848-2882 and the preserve-path recheck
  ~:2785-2807) treats any non-empty `rejectedRows` as blocking and appends each row's key text
  and reason to the blocking reason, which flows into the halt body via the existing seam.
- Local test pattern: existing parser tests live in `src/conductor/test/engine/artifacts.test.ts`
  (inline report strings, direct `parsePrdAuditReport` assertions) and routing tests in
  `src/conductor/test/prd-audit-kickback.test.ts`; follow their inline-fixture style — search
  hints: `parsePrdAuditReport(`, `routePrdAuditOverScope(`, `classifyOverScopeCriterion(`.
  Isolated implementers: keep fixtures as inline strings in the test files, not fixture files,
  matching the existing tests.

## Prerequisites

None — #1873's decision-block machinery is already on main.

## Tasks

### Task 1: Parse the no-owner findings section
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in artifacts.test.ts: a report with a valid Verdict Table plus a no-owner section (`Finding`-headed table, rows `NC.1`/`NC.2`, grade OVER_SCOPE, intent relations, evidence) parses ok with both NC findings present and distinguishable by key; a well-formed report without the section returns a result identical to today's.
2. Verify RED.
3. Implement: locate the section heading, parse its table with the existing cell helpers, validate keys against `/^NC\.\d+$/i` (uppercase-normalized), push findings alongside criterion findings; export an `isNoOwnerKey` helper.
4. Verify GREEN; run the artifacts test file.
5. Commit: "feat(prd-audit): parse the no-owner findings section (NC keys)".

**Done when:**
- Named tests pass: NC.1/NC.2 findings returned with grade, relation source intact, evidence; keys unique in result.
- The sectionless well-formed fixture's parse result deep-equals the pre-change shape (no new required fields on criterion findings).
- `isNoOwnerKey('NC.1')` true; `isNoOwnerKey('S1.2')` false.

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — section scan + key form
- src/conductor/test/engine/artifacts.test.ts — new tests

**Dependencies:** none

### Task 2: Per-row rejection diagnostics replace whole-report row faults
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: a report with 3 valid criterion rows and 2 invented-key rows (`OS.1`, `OS.2`) parses ok with 3 findings and 2 `rejectedRows` entries each carrying the offending key text and a reason naming the accepted key forms; a row with a non-OVER_SCOPE grade inside the no-owner section rejects with a section-grade reason while siblings survive; a row carrying an NC key outside its section (an NC key in the Verdict Table) rejects with a section reason while siblings survive; a report missing the PRD marker, and one missing the Verdict Table, still return the whole-report mechanical fault.
2. Verify RED.
3. Implement: add `rejectedRows` to `PrdAuditReport`; convert the row-level `mechanical-fault` returns (malformed criterion, invalid grade, invalid/missing plan task) into rejection entries that continue the loop; keep report-level faults unchanged.
4. Verify GREEN.
5. Commit: "feat(prd-audit): salvage parseable rows, collect per-row rejection diagnostics".

**Done when:**
- The mixed fixture yields exactly 3 findings + 2 diagnostics with key text and reason.
- The two report-level fixtures still return `{ ok: false, class: 'mechanical-fault' }`.
- No row-level defect path returns a whole-report fault (enumerated: bad key, bad grade, bad plan task, FIXABLE without task, FIXABLE with absent task, non-OVER_SCOPE grade in the no-owner section, NC key outside its section).

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — rejection collection
- src/conductor/test/engine/artifacts.test.ts — new tests

**Dependencies:** Task 1

### Task 3: Duplicate keys reject per-row
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests reproducing issue #1848 case 2: a table grading S1.3 both PASS and OVER_SCOPE and S4.1 both PASS and OVER_SCOPE parses with those 4 rows rejected (diagnostics name S1.3 and S4.1 as duplicated) and remaining rows consumed; a no-owner section with two NC.1 rows rejects both; a report with all-unique keys yields zero duplicate diagnostics.
2. Verify RED.
3. Implement: after row collection, group by normalized key across each section; move every row of a duplicated key from findings to rejectedRows with a duplicate reason.
4. Verify GREEN.
5. Commit: "feat(prd-audit): reject duplicate finding keys per-row".

**Done when:**
- The #1848-case-2 fixture yields 4 rejected rows naming both duplicated keys; siblings consumed.
- Duplicate NC ordinals reject both carriers.
- Post-parse invariant test: no result ever contains two findings with the same key.

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — duplicate detection
- src/conductor/test/engine/artifacts.test.ts — new tests

**Dependencies:** Task 2

### Task 4: Rejected rows block the prd_audit gate by name
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests against the prd_audit gate route (the artifacts.ts completion check): a fresh report whose parse yields rejectedRows does not satisfy the gate even when every parsed finding is PASS, and the blocking reason contains each rejected row's key text and reason; the preserve-path recheck likewise treats rejectedRows as not-clean.
2. Verify RED.
3. Implement: in both gate consumers, treat non-empty rejectedRows as blocking; render `rejected rows: <key> (<reason>); ...` into the reason string that reaches the halt body.
4. Verify GREEN.
5. Commit: "feat(prd-audit): rejected rows block the gate and are named in the halt".

**Done when:**
- Gate test: all-PASS-plus-one-rejected-row fixture scores not-done with the row named in the reason.
- Preserve-path test: a sidecar-preserved verdict is invalidated when the current report carries rejectedRows.
- No consumer of the parse result ignores rejectedRows (enumerated call sites of parsePrdAuditReport in artifacts.ts and conductor.ts each asserted or updated).

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — gate + preserve-path
- src/conductor/test/engine/artifacts.test.ts — new tests

**Dependencies:** Task 2

### Task 5: NC relations and classification
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests: `overScopeRelations` returns relations for NC rows in the no-owner section; `classifyOverScopeCriterion` classifies an NC key `not-blocking` for within/outside-harmless and `blocking-undecided` for outside-visible with no decision.
2. Verify RED.
3. Implement: extend `overScopeRelations` to scan the no-owner section table; no semantic change for criterion keys.
4. Verify GREEN.
5. Commit: "feat(prd-audit): NC findings carry intent relations and classify uniformly".

**Done when:**
- Relations map contains NC keys with their declared relation; criterion-key behavior byte-identical on existing fixtures.
- Classification matrix test covers NC x {within, outside-harmless, outside-visible} x {no decision}.

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — relations + classification
- src/conductor/test/prd-audit-kickback.test.ts — new tests

**Dependencies:** Task 1

### Task 6: NC decisions bind key + summary; mismatch re-asks
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests: an accepted NC.1 decision with summary X applies (classification `accepted`) when the re-reported NC.1 finding carries summary X; renumbered (same summary under NC.2) or reworded (NC.1, summary Y) findings classify `blocking-undecided`; criterion-keyed decisions keep matching on criterion alone with drifted summaries; last-decision-wins holds per matched NC identity; a cleared-entry key the current report does not flag records nothing and surfaces the defect by name.
2. Verify RED.
3. Implement: pass the finding summary into classification/matching for NC keys (matcher: criterion equality AND, for NC keys, summary equality after trim); harvest path (`parseClearedOverScopeDecisions` call site) widens blockingCriteria to NC keys and validates entries against the current report's key+summary pairs.
4. Verify GREEN.
5. Commit: "feat(prd-audit): NC decisions bind key+summary, mismatch re-asks".

**Done when:**
- Apply-on-match, re-ask-on-renumber, re-ask-on-reword tests pass for NC entries.
- Criterion-only matching regression tests unchanged-pass.
- Unknown-key cleared entry yields the existing named defect, over the widened key space.

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — matcher
- src/conductor/src/engine/conductor.ts — harvest blockingCriteria
- src/conductor/test/prd-audit-kickback.test.ts — new tests

**Dependencies:** Task 5

### Task 7: Route NC findings through the decision block; never work
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests on `routePrdAuditOverScope`: an undecided outside-visible NC.1 finding produces a halt route whose undecided set contains NC.1 with its summary and relation; a within/outside-harmless NC finding is recorded and non-blocking; a refused matched NC finding appears in the refused set (rework-required rendering) and is not re-offered pending; no route outcome for an NC finding appends plan tasks or emits kickback work (assert the route kinds reachable for NC findings exclude work-bearing kinds).
2. Verify RED.
3. Implement: routePrdAuditOverScope consumes NC findings uniformly — key from the finding, summary from evidence text (the same string the decision block renders); no change to task-append paths.
4. Verify GREEN.
5. Commit: "feat(prd-audit): NC findings route to the operator decision block only".

**Done when:**
- Halt-route test shows an NC pending entry with summary + relation in the rendered block.
- Refused-matched NC finding renders as refused, absent from pending.
- Grep-backed assertion in test: NC findings reach no plan-task append path (route result kinds enumerated).

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — route
- src/conductor/test/prd-audit-kickback.test.ts — new tests

**Dependencies:** Task 6

### Task 8: End-to-end lap fixture
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write a failing integration test driving the full lap in-process with a temp project root: report with NC.1 outside-visible → gate blocks → halt body contains the decision block entry → simulate the operator-cleared body with an accept decision → harvest records it (key+summary) → re-evaluate the same report → NC.1 classifies accepted and the gate no longer blocks on it.
2. Verify RED (fails until Tasks 4-7 are integrated).
3. Wire any seams the test exposes (no new behavior beyond prior tasks).
4. Verify GREEN.
5. Commit: "test(prd-audit): end-to-end NC decision lap".

**Done when:**
- The single test exercises parse → route → decision block render → cleared-body harvest → record → re-route, all in one run.
- The recorded decision in the temp store carries both key and summary.

**Files likely touched:**
- src/conductor/test/prd-audit-kickback.test.ts — integration test

**Dependencies:** Task 4, Task 7

### Task 9: Skill teaches the NC contract; shape parity proven
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write a failing parity test: extract the no-owner section example from skills/prd-audit/SKILL.md (or embed the skill's documented example verbatim in the test with a comment naming its source section) and assert it parses with zero rejected rows; add a test that an old-guidance section row without an NC key rejects per-row with a key-naming diagnostic, not a whole-report fault.
2. Verify RED.
3. Edit skills/prd-audit/SKILL.md: document the NC.«n» key contract in the OVER_SCOPE bullet and the no-owner section (first column values `NC.1`, `NC.2`, ...), state the duplicate and one-grade rules, and remove the "engine cannot route those findings today (#1848)" caveat; update the report example.
4. Verify GREEN; run test/test_harness_integrity.sh.
5. Commit: "docs(prd-audit): NC key contract; parser and skill teach the same shape".

**Done when:**
- Parity test passes against the skill's documented example.
- The caveat sentence is absent from skills/prd-audit/SKILL.md.
- test/test_harness_integrity.sh exits 0.

**Files likely touched:**
- skills/prd-audit/SKILL.md — NC contract
- src/conductor/test/engine/artifacts.test.ts — parity tests

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3 ──▶ Task 9
   │           └────▶ Task 4 ──▶ Task 8
   └──▶ Task 5 ──▶ Task 6 ──▶ Task 7 ──▶ Task 8
```

## Integration Points

- After Task 4: a malformed-row report can be driven through the gate and produces a named,
  blocking, salvaged result.
- After Task 7: the full decision lifecycle for NC findings works unit-level; Task 8 proves it
  end-to-end.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (Stories 2/3 negatives: Tasks 3-4; Story 1 negatives: Tasks 1-2; Story 4 negatives: Task 6; Story 5 negatives: Task 7; Story 6 negative: Task 9)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done when block
- [ ] Dependencies are explicit and acyclic
