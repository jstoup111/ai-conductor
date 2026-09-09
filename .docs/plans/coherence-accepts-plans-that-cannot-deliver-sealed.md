# Implementation Plan: Coherence criterion correction layer at land (engine half of #2419)

**Date:** 2026-09-07
**Design:** .docs/decisions/architecture-review-2026-09-07-coherence-accepts-plans-that-cannot-deliver-sealed.md
**Stories:** .docs/stories/coherence-accepts-plans-that-cannot-deliver-sealed.md
**Conflict check:** Clean as of 2026-09-07 (.docs/conflicts/2026-09-07-coherence-accepts-plans-that-cannot-deliver-sealed.md; one degrading conflict resolved by companion PR jstoup111/ai-conductor#2421)
**Source-Ref:** jstoup111/ai-conductor#2419

## Summary

9 tasks add an optional seventh correction cell to `fail` criterion coherence rows, per-layer cannot-deliver gap ids with actionable detail, and land-time resolution of `architecture:` references against the change set's enumerated ADR decisions. All work is land-time DECIDE machinery; no BUILD or SHIP path changes.

## Technical Approach

- **Parser (Task 1-2).** `parseCoherenceArtifact` in `src/conductor/src/engine/coherence-parse.ts` widens the `criterion` branch from exactly six cells to six or seven. The seventh cell parses into a discriminated `correction` (`{ layer: 'plan' }` | `{ layer: 'architecture', decisionRef }`) using the same parse-don't-validate trait as the diff-locality disposition cell: a closed grammar checked at the parser, a `null` for anything else, never inference from prose. A malformed value, an empty architecture reference, or a correction on a non-`fail` row is the existing non-waivable `unparseable-criterion-row` with a line-numbered detail. Search hints: `isCriterionDiffLocalityDisposition`, `structuralParseFailure`, `CriterionDiffLocalityDisposition`.
- **Validator (Task 3-6).** `checkCriterionCoverage` in `src/conductor/src/engine/engineer/coherence-validator.ts` emits `criterion:cannot-deliver-plan:<n>` / `criterion:cannot-deliver-architecture:<n>` for a `fail` row that carries a correction, with a detail naming criterion, cited task ids, quote, constraint reference, and layer; a `fail` or `gap` row without the cell keeps `criterion:verdict:<n>` byte-for-byte (gap-id stability is an API). The decision-id enumeration that `runCoherenceGate` already performs for the ADR layer (`parseAdrDecisions` + `formatArchitectureDecisionId` over non-deleted change-set ADRs) is hoisted into a helper so it also runs when any row carries an `architecture` correction; a new `checkCorrectionReferences` reports `criterion:correction-unknown-decision:<n>` for a reference outside that set. All three new ids join the aggregated `gaps` list ahead of `evaluateCoherenceWaiver`; `coherence-waiver.ts` is untouched because its vocabulary is the validator's reported set.
- **Consumers (Task 7-9).** Discovery (`daemon-backlog.ts`) and `coverage-binding-inputs.ts` already read through the shared parser and need no change; tests pin that a seven-cell row is tolerated and never required, and that a rejection writes nothing. Sequencing: parser first, then validator emission, then gate-level resolution, then consumer pins.
- **Governing decisions.** `adr-2026-08-31-coverage-binding-judge-step` D10 (cell grammar, gap ids, waivability) and D11 (decision resolution reuse, no routing).

## Prerequisites

- None beyond the current `main` engine; no config, schema, or migration.

## Tasks

### Task 1: Widen the shared parser to an optional correction cell
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coherence-parse.test.ts`: a seven-cell `fail` row with `plan`, one with `architecture:adr-x#D2`, and a corpus assertion that every existing six-cell fixture parses deep-equal to today's value with no `correction` key.
2. Verify RED.
3. In `src/conductor/src/engine/coherence-parse.ts` add `CriterionCorrection = { layer: 'plan' } | { layer: 'architecture'; decisionRef: string }` and an optional `correction` on `CriterionCoherenceRow`; accept `cells.length === 6 || cells.length === 7` for `criterion` rows; parse the seventh cell with a sibling of `isCriterionDiffLocalityDisposition` (`parseCriterionCorrection`) that returns the discriminated value or `null`. Follow the disposition cell's parse-don't-validate trait: closed grammar at the parser, never inferred. Keep the cell-count detail message shape `criterion row expected 6 or 7 and actual <n> cells`.
4. Verify GREEN; commit.

**Done when:**
- `parseCoherenceArtifact` returns `ok: true` for a criterion row of six or seven cells and a seven-cell `fail` row yields `correction` equal to `{ layer: 'plan' }` or `{ layer: 'architecture', decisionRef }`
- every six-cell row in the corpus fixtures parses to a deep-equal value with no `correction` key
- `coherence-parse.test.ts` names the new cases `accepts a seven-cell fail row with a plan correction`, `accepts a seven-cell fail row with an architecture correction`, and `six-cell rows parse identically`

**Files:** src/conductor/src/engine/coherence-parse.ts, src/conductor/test/engine/coherence-parse.test.ts, src/conductor/test/engine/coherence-corpus.ts
**Dependencies:** none

### Task 2: Reject malformed or misplaced correction cells as evidentiary defects
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests: seventh cell `rewrite-plan`; seventh cell `architecture:`; seventh cell `plan` on a `covered` row. Each expects `ok: false`, reason `unparseable-criterion-row`, and the exact detail text named in Done when plus the line number.
2. Verify RED.
3. Implement the three structural failures in the criterion branch of `parseCoherenceArtifact`, reusing `structuralParseFailure`. No new `CoherenceParseFailureReason` id.
4. Verify GREEN; commit.

**Done when:**
- a seventh cell outside the closed grammar returns `unparseable-criterion-row` with detail `unknown criterion correction "<value>"` and the line number
- `architecture:` with an empty reference returns `unparseable-criterion-row` with detail `architecture correction must reference a decision`
- a seventh cell on a row whose verdict is not `fail` returns `unparseable-criterion-row` with detail `only a fail row may carry a correction`

**Files:** src/conductor/src/engine/coherence-parse.ts, src/conductor/test/engine/coherence-parse.test.ts
**Dependencies:** Task 1

### Task 3: Emit per-layer cannot-deliver gaps with actionable detail
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/coherence-validator.test.ts` for `checkCriterionCoverage`: a `fail` row with `plan` correction at index 3 and one with `architecture` correction `adr-x#D2` at index 5, asserting gap ids and that the detail contains criterion text, cited task ids, the row quote, and `correction: plan` / `constraint: adr-x#D2`; and a `renderGapReport` test asserting the one-line rendering.
2. Verify RED.
3. In `checkCriterionCoverage`, when `row.verdict === 'fail' && row.correction`, push `criterion:cannot-deliver-<layer>:<n>` with the composed detail instead of `criterion:verdict:<n>`; keep the subsequent disposition/task/quote checks running as they do for a `fail` row today.
4. Verify GREEN; commit.

**Done when:**
- a `fail` row with a `plan` correction at criterion index n yields gap id `criterion:cannot-deliver-plan:n` and its detail contains the criterion text, every cited task id, the row quote, and `correction: plan`
- a `fail` row with an `architecture` correction at criterion index n yields gap id `criterion:cannot-deliver-architecture:n` and its detail contains the criterion text, every cited task id, the row quote, and `constraint: <decisionRef>`
- `renderGapReport` prints each cannot-deliver gap on one line carrying that detail verbatim

**Files:** src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** Task 1

### Task 4: Preserve legacy fail verdict ids and suppress cannot-deliver on unresolvable tasks
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a `fail` row without correction pins the exact pre-existing `criterion:verdict:<n>` detail string; a `fail` row with correction citing a task absent from the plan yields `criterion:task-missing:<n>:<id>` and no `criterion:cannot-deliver-*` gap.
2. Verify RED.
3. Order the checks so task resolution runs before the cannot-deliver emission for corrected rows; leave the uncorrected `fail` path byte-identical.
4. Verify GREEN; commit.

**Done when:**
- a `fail` row with no correction yields exactly the pre-existing `criterion:verdict:n` gap and detail, asserted by a test that pins the detail string
- a `fail` row with a correction whose cited task is absent from the plan yields `criterion:task-missing:n:<id>` and no `criterion:cannot-deliver-*` gap for that row

**Files:** src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** Task 3

### Task 5: Resolve architecture correction references against enumerated change-set decisions
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing `runCoherenceGate` tests using the existing temp-repo pattern in the `runCoherenceGate ADR pool` describe block (git init, seed, worktree, changed files): an ADR with a numbered Decision item `2.` and a `fail` row with `architecture:<stem>#D2` yields only `criterion:cannot-deliver-architecture:<n>`; an ADR whose `D10` lives in an amendment blockquote resolves; a run with the `adr` layer not engaged still enumerates.
2. Verify RED.
3. Hoist the decision-id enumeration in `runCoherenceGate` out of the `required.layers.has('adr')` branch into a helper invoked when that layer is engaged OR any parsed row carries an `architecture` correction; feed the set into a new `checkCorrectionReferences(rows, decisionIds)` that returns `CriterionGapFinding[]`.
4. Verify GREEN; commit.

**Done when:**
- `runCoherenceGate` enumerates decision ids via `parseAdrDecisions` and `formatArchitectureDecisionId` over non-deleted change-set ADRs whenever any row carries an `architecture` correction, even when `required.layers` lacks `adr`
- a `fail` row whose `architecture` reference matches an enumerated decision id produces only the `criterion:cannot-deliver-architecture:n` gap for that row
- a decision id introduced by an additive amendment blockquote in a change-set ADR resolves

**Files:** src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** Task 3

### Task 6: Report unknown, out-of-range, and deleted-ADR correction references
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing gate tests: no ADR in the change set; ADR `adr-y` with `D1`..`D3` and a reference `#D9`; ADR `adr-z` deleted in the worktree diff and a reference to it. Each expects `criterion:correction-unknown-decision:<n>` with the detail text named in Done when.
2. Verify RED.
3. Implement in `checkCorrectionReferences`; the detail lists the enumerated decision ids joined by `, ` or states `enumerated decision set is empty`.
4. Verify GREEN; commit.

**Done when:**
- with no ADR path in the change set an `architecture` reference yields `criterion:correction-unknown-decision:n` whose detail names the reference and states the enumerated decision set is empty
- a reference to a decision number the ADR does not declare yields `criterion:correction-unknown-decision:n` whose detail lists every enumerated decision id
- a reference to an ADR deleted in the change set yields `criterion:correction-unknown-decision:n`

**Files:** src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** Task 5

### Task 7: Route cannot-deliver gaps through the unchanged waiver; refuse malformed cells first
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing gate tests: a fresh `.docs/coherence-waivers/<stem>.md` listing exactly `criterion:cannot-deliver-plan:2` and `criterion:correction-unknown-decision:4` passes; one listing only one of two cannot-deliver ids is rejected naming the other; a malformed seventh cell throws before `evaluateCoherenceWaiver` (spy via `vi.mock` of `./coherence-waiver.js`).
2. Verify RED (the waiver-pass case fails until Tasks 3-6 exist; the throw-ordering case is RED only if ordering regresses — assert it explicitly).
3. No production change expected beyond Tasks 1-6; if a test exposes ordering drift, fix it in `runCoherenceGate` only.
4. Verify GREEN; commit.

**Done when:**
- a gate run whose only gaps are `criterion:cannot-deliver-plan:2` and `criterion:correction-unknown-decision:4` passes when a fresh waiver lists exactly those ids with a rationale
- a fresh waiver covering only one of two cannot-deliver gaps is rejected naming the unwaived id
- a malformed seventh cell throws the `unparseable-criterion-row` refusal before `evaluateCoherenceWaiver` is called, asserted with a spy that records zero calls
- `coherence-waiver.ts` has no diff in this task

**Files:** src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** Task 6

### Task 8: Pin discovery and coverage_binding tolerance of a seven-cell row
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/daemon-backlog.test.ts` a merged non-S spec whose coherence artifact carries a seven-cell `fail` row is eligible, and the zero-criterion-rows fixture stays eligible; in `src/conductor/test/engine/coverage-binding-inputs.test.ts` a seven-cell row yields the same criterion/task ids/quote/disposition as its six-cell twin.
2. Verify RED (the seven-cell cases fail until Task 1 lands).
3. No production change: both consumers already call the shared parser. Add the seven-cell shape to `coherence-corpus.ts` divergence fixtures.
4. Verify GREEN; commit.

**Done when:**
- `discoverBacklog` marks a merged non-S spec eligible when its coherence artifact carries a seven-cell `fail` criterion row
- `discoverBacklog` marks a merged non-S spec whose artifact has zero criterion rows eligible, pinned by the existing invariant test
- `coverage-binding-inputs` returns the same criterion, task ids, quote, and disposition for a seven-cell row as for its six-cell twin

**Files:** src/conductor/test/engine/daemon-backlog.test.ts, src/conductor/test/engine/coverage-binding-inputs.test.ts, src/conductor/test/engine/coherence-corpus.ts
**Dependencies:** Task 1

### Task 9: Prove a cannot-deliver rejection has no side effects
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write a failing gate test: after `runCoherenceGate` rejects with `criterion:cannot-deliver-architecture:<n>`, read the worktree plan file and assert byte equality with the seeded bytes; assert `.pipeline/HALT`, `.pipeline/HALT.class`, and any `decide-grant*` or dispatch file are absent in the worktree.
2. Add a source-scan test (readFileSync over `src/conductor/src`, excluding the two owning modules) asserting no other module references the `correction` field of a criterion row.
3. Verify RED, then GREEN with no production change; commit.

**Done when:**
- after a gate rejection carrying `criterion:cannot-deliver-architecture:n` the worktree plan file bytes are unchanged and no `.pipeline/HALT`, decide-grant, or dispatch record exists in the worktree
- `grep -rn correction src/conductor/src` matches only `coherence-parse.ts` and `coherence-validator.ts`

**Files:** src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 ─┬─> Task 2
        ├─> Task 3 ─┬─> Task 4
        │           └─> Task 5 ──> Task 6 ─┬─> Task 7
        │                                  └─> Task 9
        └─> Task 8
```

## Integration Points

- After Task 2: the shared parser accepts and rejects the full seven-cell grammar; discovery and `coverage_binding` already tolerate it.
- After Task 6: `engineer land` reports cannot-deliver and unknown-decision gaps end to end through `runCoherenceGate`.
- After Task 7: the waiver path is proven over the new ids with no waiver-module change.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a coherence artifact with a seven-cell `criterion` row whose verdict is `fail` and whose seventh cell is `plan`, when the artifact is parsed, then the row parses with a correction of layer `plan` and every other field identical to the six-cell reading | 1 | "`parseCoherenceArtifact` returns `ok: true` for a criterion row of six or seven cells and a seven-cell `fail` row yields `correction` equal to `{ layer: 'plan' }` or `{ layer: 'architecture'" | diff-local |
| Story 1 happy: Given a seven-cell `criterion` row whose verdict is `fail` and whose seventh cell is `architecture:adr-2026-08-31-coverage-binding-judge-step#D10`, when the artifact is parsed, then the row parses with a correction of layer `architecture` carrying the decision reference `adr-2026-08-31-coverage-binding-judge-step#D10` | 1 | "`parseCoherenceArtifact` returns `ok: true` for a criterion row of six or seven cells and a seven-cell `fail` row yields `correction` equal to `{ layer: 'plan' }` or `{ layer: 'architecture'" | diff-local |
| Story 1 happy: Given every six-cell `criterion` row in the landed coherence corpus, when the artifact is parsed, then each row parses to exactly the same value as before and carries no correction | 1 | "every six-cell row in the corpus fixtures parses to a deep-equal value with no `correction` key" | diff-local |
| Story 1 negative: Given a seven-cell `criterion` row whose seventh cell is `rewrite-plan`, when the artifact is parsed, then the parse fails with reason `unparseable-criterion-row` and a detail naming the line and the unknown correction value | 2 | "a seventh cell outside the closed grammar returns `unparseable-criterion-row` with detail `unknown criterion correction "<value>"` and the line number" | diff-local |
| Story 1 negative: Given a seven-cell `criterion` row whose seventh cell is `architecture:` with nothing after the colon, when the artifact is parsed, then the parse fails with reason `unparseable-criterion-row` and a detail stating that an architecture correction must reference a decision | 2 | "`architecture:` with an empty reference returns `unparseable-criterion-row` with detail `architecture correction must reference a decision`" | diff-local |
| Story 1 negative: Given a seven-cell `criterion` row whose verdict is `covered`, when the artifact is parsed, then the parse fails with reason `unparseable-criterion-row` and a detail stating that only a `fail` row may carry a correction | 2 | "a seventh cell on a row whose verdict is not `fail` returns `unparseable-criterion-row` with detail `only a fail row may carry a correction`" | diff-local |
| Story 2 happy: Given a parsed `fail` criterion row with correction layer `plan` at criterion index 3, when the criterion layer runs, then it reports gap id `criterion:cannot-deliver-plan:3` whose detail contains the criterion text, the cited task id(s), the row's quoted `Done when` text, and the words `correction: plan` | 3 | "a `fail` row with a `plan` correction at criterion index n yields gap id `criterion:cannot-deliver-plan:n` and its detail contains the criterion text" | diff-local |
| Story 2 happy: Given a parsed `fail` criterion row with correction layer `architecture` referencing `adr-x#D2` at criterion index 5, when the criterion layer runs, then it reports gap id `criterion:cannot-deliver-architecture:5` whose detail contains the criterion text, the cited task id(s), the quoted `Done when` text, and `constraint: adr-x#D2` | 3 | "a `fail` row with an `architecture` correction at criterion index n yields gap id `criterion:cannot-deliver-architecture:n` and its detail contains the criterion text" | diff-local |
| Story 2 negative: Given a parsed `fail` criterion row with no correction cell at criterion index 3, when the criterion layer runs, then it reports gap id `criterion:verdict:3` with today's detail and no cannot-deliver id | 4 | "a `fail` row with no correction yields exactly the pre-existing `criterion:verdict:n` gap and detail" | diff-local |
| Story 2 negative: Given a parsed `fail` criterion row with correction layer `plan` whose cited task id does not exist in the plan, when the criterion layer runs, then it reports `criterion:task-missing:<n>:<id>` and does not additionally report a cannot-deliver gap for that row | 4 | "a `fail` row with a correction whose cited task is absent from the plan yields `criterion:task-missing:n:<id>` and no `criterion:cannot-deliver-*` gap for that row" | diff-local |
| Story 3 happy: Given a spec change set containing a non-deleted ADR whose Decision section yields decision `D2`, and a `fail` criterion row with correction `architecture:<that-adr-stem>#D2`, when the coherence gate runs, then the only gap reported for that row is `criterion:cannot-deliver-architecture:<n>` | 5 | "a `fail` row whose `architecture` reference matches an enumerated decision id produces only the `criterion:cannot-deliver-architecture:n` gap for that row" | diff-local |
| Story 3 happy: Given a spec change set whose only ADR is one this feature amends additively, and a `fail` criterion row citing a decision id introduced by that amendment, when the coherence gate runs, then the reference resolves and no unknown-decision gap is reported | 5 | "a decision id introduced by an additive amendment blockquote in a change-set ADR resolves" | diff-local |
| Story 3 negative: Given a spec change set with no ADR path at all, and a `fail` criterion row with correction `architecture:adr-elsewhere#D1`, when the coherence gate runs, then it reports `criterion:correction-unknown-decision:<n>` naming `adr-elsewhere#D1` and the enumerated decision set as empty | 6 | "with no ADR path in the change set an `architecture` reference yields `criterion:correction-unknown-decision:n` whose detail names the reference and states the enumerated decision set is empty" | diff-local |
| Story 3 negative: Given a spec change set containing ADR `adr-y` with decisions `D1`..`D3`, and a `fail` criterion row with correction `architecture:adr-y#D9`, when the coherence gate runs, then it reports `criterion:correction-unknown-decision:<n>` naming `adr-y#D9` and listing the decision ids that were enumerated | 6 | "a reference to a decision number the ADR does not declare yields `criterion:correction-unknown-decision:n` whose detail lists every enumerated decision id" | diff-local |
| Story 3 negative: Given a spec change set whose ADR `adr-z` is deleted in the diff, and a `fail` criterion row with correction `architecture:adr-z#D1`, when the coherence gate runs, then it reports `criterion:correction-unknown-decision:<n>` because a deleted ADR contributes no decisions | 6 | "a reference to an ADR deleted in the change set yields `criterion:correction-unknown-decision:n`" | diff-local |
| Story 4 happy: Given a land whose only reported gaps are `criterion:cannot-deliver-plan:2` and `criterion:correction-unknown-decision:4`, and a fresh `.docs/coherence-waivers/<plan-stem>.md` in the change set whose `Waives:` line lists exactly those two ids with a non-empty rationale, when the coherence gate runs, then the land succeeds | 7 | "a gate run whose only gaps are `criterion:cannot-deliver-plan:2` and `criterion:correction-unknown-decision:4` passes when a fresh waiver lists exactly those ids with a rationale" | diff-local |
| Story 4 negative: Given a land whose reported gaps are `criterion:cannot-deliver-plan:2` and `criterion:cannot-deliver-architecture:7`, and a fresh waiver listing only `criterion:cannot-deliver-plan:2`, when the coherence gate runs, then the land is rejected naming `criterion:cannot-deliver-architecture:7` as unwaived | 7 | "a fresh waiver covering only one of two cannot-deliver gaps is rejected naming the unwaived id" | diff-local |
| Story 4 negative: Given a coherence artifact with a seven-cell row whose seventh cell is malformed, and a fresh waiver whose `Waives:` line names `unparseable-criterion-row`, when the coherence gate runs, then the land is rejected with the `unparseable-criterion-row` refusal before any waiver is evaluated | 7 | "a malformed seventh cell throws the `unparseable-criterion-row` refusal before `evaluateCoherenceWaiver` is called" | diff-local |
| Story 5 happy: Given a merged spec whose coherence artifact contains a seven-cell `criterion` row (landed under a waiver), when daemon discovery parses the artifact, then the spec is eligible for dispatch with no `missing-coherence` block | 8 | "`discoverBacklog` marks a merged non-S spec eligible when its coherence artifact carries a seven-cell `fail` criterion row" | diff-local |
| Story 5 happy: Given a land rejected with a `criterion:cannot-deliver-architecture:<n>` gap, when the rejection is inspected, then the worktree's plan file is unchanged and no halt marker, decide-grant, or step re-dispatch was written | 9 | "after a gate rejection carrying `criterion:cannot-deliver-architecture:n` the worktree plan file bytes are unchanged and no `.pipeline/HALT`" | diff-local |
| Story 5 negative: Given a merged spec whose coherence artifact has zero `criterion` rows, when daemon discovery parses the artifact, then the spec remains eligible exactly as before this change | 8 | "`discoverBacklog` marks a merged non-S spec whose artifact has zero criterion rows eligible, pinned by the existing invariant test" | diff-local |
| Story 5 negative: Given the `coverage_binding` input reader of the coherence artifact, when it reads a seven-cell `criterion` row, then it yields the same criterion, task ids, quote, and disposition as for a six-cell row and ignores the correction | 8 | "`coverage-binding-inputs` returns the same criterion, task ids, quote, and disposition for a seven-cell row as for its six-cell twin" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-31-coverage-binding-judge-step#D1 | no-change | none | D1's tuple `(criterion, task ids, quote, disposition?)` is preserved; D10 widens the M/L carrier additively and the tier-S plan carrier is untouched, so no implementation change follows from D1 itself. |
| adr-2026-08-31-coverage-binding-judge-step#D2 | existing | none | `checkCriterionCoverage` already scopes the quote match to `parsePlanTaskDoneWhen` and emits `criterion:quote-not-done-when:<n>`; this feature keeps that path unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D3 | no-change | none | The tier-S plan-carrier engagement is unchanged; the seventh cell exists only on the M/L coherence-artifact carrier. |
| adr-2026-08-31-coverage-binding-judge-step#D4 | no-change | none | The `coverage_binding` step's registration, phase, and inputs are unchanged; Task 8 only pins that its input reader tolerates the new cell. |
| adr-2026-08-31-coverage-binding-judge-step#D5 | no-change | none | The judge dispatch and verdict vocabulary are not touched by a land-time parser and validator change. |
| adr-2026-08-31-coverage-binding-judge-step#D6 | no-change | none | No halt, task append, or routing is added; D11 restates the rule for the correction label and Task 9 proves no side effect. |
| adr-2026-08-31-coverage-binding-judge-step#D7 | no-change | none | The `coverage_binding.judge.enabled` gate and its default are untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D8 | no-change | none | Legacy tolerance of tasks without a `Done when` block is a BUILD-step concern this land-time change does not reach. |
| adr-2026-08-31-coverage-binding-judge-step#D9 | no-change | none | No new event joins the spine; the correction layer is rendered in the land rejection text only. |
| adr-2026-08-31-coverage-binding-judge-step#D10 | task | task-1, task-2, task-3, task-4 | a seven-cell `fail` row yields `correction` equal to `{ layer: 'plan' }` or `{ layer: 'architecture', decisionRef }` |
| adr-2026-08-31-coverage-binding-judge-step#D11 | task | task-5, task-6 | `runCoherenceGate` enumerates decision ids via `parseAdrDecisions` and `formatArchitectureDecisionId` over non-deleted change-set ADRs whenever any row carries an `architecture` correction |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
