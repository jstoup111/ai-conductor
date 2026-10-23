# Implementation Plan: A recurring concern at a resolved anchor escapes its prior case's retry limits

**Date:** 2026-10-23
**Stories:** .docs/stories/a-recurring-concern-at-a-resolved-anchor-escapes-i.md
**Conflict check:** Clean as of 2026-10-23, one degrading overlap accepted (.docs/conflicts/2026-10-23-a-recurring-concern-at-a-resolved-anchor-escapes-i.md)

## Summary

Record an undeclared unbound `act` re-raise of a resolved action case as a recurrence of that
case, and let the judge declare it distinct with a reason. Bound each recurrence lineage to three
applied BUILD attempts. Persist both facts and show them on the existing event spine and in
`build-review findings`. 12 tasks. Source: jstoup111/ai-conductor#3124.

## Technical Approach

- **Governing decisions.** adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
  D5.8–D5.11, plus the predecessor adr-2026-08-29-build-review-remediate-case-adjudication notes
  beside D4, D5 and D7. The track marker's exclusions are binding:
  - non-`act` dispositions;
  - decision and consistency stops (#3005);
  - explicit `existingCaseId` rebinds, which keep the regression halt and carry;
  - no rewrite of resolved rows;
  - no configurable limit;
  - no store version change.
- **Store fields (Task 1).** `RemediationCaseRecord` in
  `src/conductor/src/engine/remediation-case-store.ts` gains optional `recurrenceOf: readonly
  string[]` and `distinctFrom: readonly { caseId; reason }[]`. `parseCase` admits each key only
  when present, mirroring how it admits `operatorAcceptance`. An empty list, a self-reference, or an
  empty or over-bound reason fails `malformed-state`. Records without the keys serialize exactly as
  today.
- **Pure lineage helpers (Task 2).** These go next to `currentBuildReviewSourceLinks` in the same
  module, all pure and read-only:
  - `BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT = 3`.
  - `classifyBuildReviewRecurrence(cases, sourceIds, declared)` maps each source to its D5.5
    authoritative link. It keeps owners that are resolved `act` cases, counts only declared entries
    naming such an owner, and returns `{ recurrenceOf, distinctFrom }`.
  - `buildReviewRecurrenceLineage(cases, caseIds)` walks `recurrenceOf` with a visited set and
    returns `{ caseIds, appliedAttempts }`. An attempt is a distinct lineage `act` case whose action
    effect is `applied`.

  Work-order `attemptedCaseIds` is deliberately not used, because it covers only the current order.
- **Provider contract (Tasks 3, 11).** `RemediationCaseRow` in `remediation-case-artifact.ts`
  gains optional `distinctFrom`. The case-row exact-key sets admit it on every disposition. A
  malformed shape rejects the artifact through the existing parse failure. Entries are
  semantically filtered later, never here. `skills/remediate/SKILL.md` is the one contract every
  provider renders (`skill-invocation.ts` maps `remediate` to one skill name), and it documents the
  declaration and the limit.
- **Reconciler stamping (Task 4).** In `reconcileState` (`remediation-case-reconciler.ts`), only
  the unbound mint branch with disposition `act` calls `classifyBuildReviewRecurrence` against the
  pre-reconcile `state.cases`. It stamps non-empty results onto the new record. Converged, bound and
  non-act rows are untouched.
- **Context and events (Tasks 5, 6).** `freezePriorCase` (`build-review-adjudication-context.ts`)
  copies both fields. `types/events.ts` adds optional `recurrenceOf` and `distinctFrom` to
  `remediation_case_reconciled`, and adds `'recurrence-limit'` plus optional `lineageCaseIds` to
  `remediation_semantic_repeat_halt`. The coordinator's existing open-case emit in
  `coordinateBuildReviewAdjudication` copies the fields from the reconciled record. No sink entry
  changes; both members are already registered in `event-sinks.ts`.
- **Limit check (Task 7).** This goes in the coordinator's existing pre-reconcile halt loop, for
  the reason recorded there: halting after reservation strands sibling effects. For each admitted
  unbound `act` proposal with live sources, classify against `priorCasesBeforeReconcile`, take the
  lineage of its `recurrenceOf`, and halt when `appliedAttempts >= 3`. The halt does four things:
  - it links the proposal's sources to the authoritative owner through `recordHaltingBinding`, with
    `existingCaseId` set to that owner;
  - it emits `remediation_semantic_repeat_halt` with reason `recurrence-limit`;
  - it returns through `failUnlessAccepted` with the reason text `semantic remediation case
    recurrence limit <owner>: lineage <ids> has <n> applied attempts (limit 3)`;
  - it passes `caseSourceIds` covering the proposal's sources, so an operator acceptance clears it
    as it clears the regression halt.
- **Integration owners.** Task 8 owns the coordinator path for Stories 2 and 3. Task 9 owns the
  conductor `build_review` entry point. Task 10 owns the `build-review findings` CLI entry point.
  Task 11 owns the provider-contract surface.

## Prerequisites

- None. Every seam named above exists on `main` (verified by reading the source on 2026-10-23).
- Sequencing: implementation PRs #3374 (#3298) and #3310 (#3271) edit the same files. This
  spec's build is sequenced after #3298 by a dependency edge recorded at land.

## Tasks

### Task 1: Persist optional recurrence and distinct fields on build_review case records
**Story:** Story 2
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `remediation-case-store.test.ts`. A record with `recurrenceOf` and `distinctFrom` round-trips through `mutate` then `read`. A store file captured from an engine without this change round-trips byte-identically. Malformed lineage fields fail `malformed-state`.
2. Verify RED.
3. Implement: add both optional fields to `RemediationCaseRecord`, then admit and parse them in `parseCase` only when present. Follow the existing `operatorAcceptance` and `operatorResolution` optional-key pattern: an `Object.hasOwn` guard feeding `expectedKeys`, a dedicated parse helper, and spread on output.
4. Verify GREEN and commit: "feat(case-store): persist optional recurrence and distinct fields".

**Done when:**
- [test] `RemediationCaseStore.mutate` writing a case with `recurrenceOf: [R]` and `distinctFrom: [{ caseId: R2, reason }]` is followed by `read()` returning those exact values.
- [test] A fixture store holding no `recurrenceOf` or `distinctFrom` keys, read then written by a mutation that adds one unrelated case, leaves every pre-existing row's serialized bytes identical.
- [test] `read()` of a persisted case whose `recurrenceOf` is an empty list, names its own id, or whose `distinctFrom` entry has an empty reason returns reason `malformed-state`.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/test/engine/remediation-case-store.test.ts

### Task 2: Classify recurrence owners and count lineage attempts
**Story:** Story 3
**Type:** infrastructure
**Dependencies:** Task 1

**Steps:**
1. Write failing unit tests in `remediation-case-store.test.ts` for `classifyBuildReviewRecurrence`, `buildReviewRecurrenceLineage` and `BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT`.
2. Verify RED.
3. Implement the three exports next to `currentBuildReviewSourceLinks`. The classifier reads each source through `currentBuildReviewSourceLinks` and keeps owners whose record has `resolution: 'resolved'` and disposition `act`. It counts a declared entry only when its `caseId` is one of those owners. It returns `recurrenceOf` as the remaining owners and `distinctFrom` as the counted entries, both in first-source order. Lineage walks `recurrenceOf` with a visited set and counts distinct `act` records whose effect has kind `action` and status `applied`.
4. Verify GREEN and commit: "feat(case-store): classify recurrence owners and lineage attempts".

**Done when:**
- [test] `classifyBuildReviewRecurrence` over resolved act R owning S returns `recurrenceOf: [R]` with no declaration, and `distinctFrom: [{ caseId: R, reason }]` with `recurrenceOf: []` when R is declared.
- [test] `classifyBuildReviewRecurrence` drops a declared entry naming an unknown id, an open act case, or a resolved `defer` case that owns no row source, and returns `recurrenceOf: [R]` in each case.
- [test] `classifyBuildReviewRecurrence` returns empty `recurrenceOf` and `distinctFrom` when every row source's authoritative owner is an open case or no case.
- [test] `buildReviewRecurrenceLineage` counts zero attempts for a resolved act case whose action effect is `failed`, and counts a case reachable through two `recurrenceOf` paths exactly once.
- [test] `BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT` equals 3 and the lineage of R → N → N2, all applied, returns `appliedAttempts: 3` with case ids R, N and N2.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/test/engine/remediation-case-store.test.ts

### Task 3: Parse an optional distinctFrom declaration on remediate case rows
**Story:** Story 1
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `remediation-case-artifact.test.ts`: a well-formed `distinctFrom` on an `act` row parses, and each malformed shape rejects the whole artifact.
2. Verify RED.
3. Implement: add `distinctFrom?: readonly { caseId: string; reason: string }[]` to `RemediationCaseRow`, and admit the optional key in every case-row exact-key set in `parseCaseRow`. Parse entries with exact keys `caseId` and `reason`, bounded like `existingCaseId` and `rationale`, with a list length from 1 to the existing case-row bound. Pass the field through `validateRemediationCaseGraph` unchanged.
4. Verify GREEN and commit: "feat(remediate): parse distinctFrom declarations".

**Done when:**
- [test] `readRemediationCaseJudgement` admits an unbound `act` row whose `distinctFrom` is `[{ "caseId": "R", "reason": "asserts daemon-liveness staleness" }]` and returns the row with that exact field.
- [test] `readRemediationCaseJudgement` rejects as malformed an artifact whose `distinctFrom` is an empty list, has an entry with an empty or over-bound reason, or has an entry with an extra key, through the same failure result as any other malformed case row.
- [test] `validateRemediationCaseGraph` returns the admitted graph with `distinctFrom` preserved on the row.
- [test] `coordinateBuildReviewAdjudication` given each artifact whose `distinctFrom` is an empty list, has an entry with an empty or over-bound reason, or has an entry with an extra key fails through the existing malformed remediation artifact path, and in each the case store file is byte-identical with no case or effect id written.

**Files:** src/conductor/src/engine/remediation-case-artifact.ts; src/conductor/src/engine/remediation-case-validator.ts; src/conductor/test/engine/remediation-case-artifact.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 4: Stamp recurrenceOf and distinctFrom on a newly minted act case
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 2, Task 3

**Steps:**
1. Write failing tests in `remediation-case-reconciler.test.ts` that call `reconcileRemediationCases` with the real store.
2. Verify RED.
3. Implement: in `reconcileState`'s unbound mint branch, only when `caseRow.disposition === 'act'`, call `classifyBuildReviewRecurrence(state.cases, sources, caseRow.distinctFrom ?? [])` and spread each non-empty result onto the added record.
4. Verify GREEN and commit: "feat(reconciler): stamp recurrence lineage on new act cases".

**Done when:**
- [test] Reconciling an undeclared unbound `act` row on S over resolved act R persists new open case N with `recurrenceOf: [R]` and a reserved action effect, and R's serialized row is byte-identical.
- [test] Reconciling an undeclared unbound `act` row on S1 and S2 owned by resolved act R1 and R2 persists N with `recurrenceOf: [R1, R2]`.
- [test] Reconciling an unbound `act` row on S declaring `distinctFrom` R with reason "asserts daemon-liveness staleness, not in-flight age" persists N with `distinctFrom: [{ caseId: R, reason }]` and no `recurrenceOf`, and R's serialized row is byte-identical.
- [test] Reconciling an unbound `act` row on S1 and S2 declaring `distinctFrom` R1 only persists N with `distinctFrom` naming only R1 and `recurrenceOf: [R2]`, and R1's and R2's rows are byte-identical.
- [test] Reconciling the same judgement a second time converges on N: the store holds no second case or effect id and N's `recurrenceOf` is unchanged.

**Files:** src/conductor/src/engine/remediation-case-reconciler.ts; src/conductor/test/engine/remediation-case-reconciler.test.ts

### Task 12: Leave rows the recurrence rule does not govern unstamped
**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 4

**Steps:**
1. Write failing tests in `remediation-case-reconciler.test.ts` with the real store for each row shape the rule must not stamp.
2. Verify RED.
3. Implement: keep `classifyBuildReviewRecurrence` confined to the unbound `act` mint branch. Leave the converged branch, the bound branch, and every non-act branch unchanged, so a declaration on those rows is ignored. A dropped declaration entry is never copied to the record.
4. Verify GREEN and commit: "test(reconciler): leave ungoverned rows without lineage".

**Done when:**
- [test] Unbound `defer` and `reject` rows on S over resolved act R, and an `existingCaseId`-bound row carrying `distinctFrom`, persist records carrying neither `recurrenceOf` nor `distinctFrom`, each equal to the record produced for the same row without the declaration.
- [test] An undeclared unbound `act` row whose sources' authoritative owners are all open cases or no case persists a new case carrying neither `recurrenceOf` nor `distinctFrom`.
- [test] An unbound `act` row on S declaring `distinctFrom` an unknown case id persists N with `recurrenceOf: [R]` and no `distinctFrom`, and N's row contains no occurrence of the dropped id.
- [test] Two separate undeclared unbound `act` judgements on S whose rationale differs only in wording, one stating in prose that it is distinct from R, each persist N with `recurrenceOf: [R]` and no `distinctFrom`.

**Files:** src/conductor/test/engine/remediation-case-reconciler.test.ts; src/conductor/src/engine/remediation-case-reconciler.ts

### Task 5: Expose lineage fields in the judge's frozen prior-case projection
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write a failing test in `build-review-adjudication-context.test.ts`: a prior case with `recurrenceOf` and `distinctFrom` appears in the frozen context with both fields.
2. Verify RED.
3. Implement: in `freezePriorCase`, copy `recurrenceOf` and `distinctFrom` as frozen arrays when present, and add both optional fields to `BuildReviewAdjudicationPriorCase`.
4. Verify GREEN and commit: "feat(build-review): expose recurrence lineage to the judge".

**Done when:**
- [test] The context assembled from a store holding N with `recurrenceOf: [R]` lists N in `priorCases` with `recurrenceOf` exactly `[R]`.
- [test] The context assembled from a store whose cases carry neither field produces `priorCases` entries with neither key present.

**Files:** src/conductor/src/engine/build-review-adjudication-context.ts; src/conductor/test/engine/build-review-adjudication-context.test.ts

### Task 6: Carry lineage fields on the case-opened event
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 4

**Steps:**
1. Write failing tests in `build-review-adjudication-coordinator.test.ts`. They use the real store and reconciler and assert the emitted `remediation_case_reconciled` for a distinct case, a recurrence case and a plain case.
2. Verify RED.
3. Implement: add optional `recurrenceOf?: string[]` and `distinctFrom?: { caseId: string; reason: string }[]` to `remediation_case_reconciled` in `types/events.ts`, and `'recurrence-limit'` plus optional `lineageCaseIds?: string[]` to `remediation_semantic_repeat_halt`. In the coordinator's open-case emit loop, spread each field from the reconciled record when present.
4. Verify GREEN and commit: "feat(events): report recurrence lineage on case-opened events".

**Done when:**
- [test] `coordinateBuildReviewAdjudication` reconciling an unbound `act` row declaring `distinctFrom` R emits `remediation_case_reconciled` with resolution `open` for N carrying `distinctFrom: [{ caseId: R, reason }]`.
- [test] `coordinateBuildReviewAdjudication` reconciling an undeclared unbound `act` row over R emits `remediation_case_reconciled` with resolution `open` for N carrying `recurrenceOf: [R]`.
- [test] A case opened with neither field emits `remediation_case_reconciled` with no `recurrenceOf` and no `distinctFrom` key, and an event for a declaration whose entry was dropped names no dropped case id.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 7: Halt an undeclared recurrence whose lineage has used three attempts
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 2, Task 6

**Steps:**
1. Write failing tests in `build-review-adjudication-coordinator.test.ts` with the real store and reconciler, a lineage of R → N → N2 (all resolved, all applied), and an injected `chargeEffect` adapter.
2. Verify RED.
3. Implement in the pre-reconcile halt loop in `coordinateBuildReviewAdjudication`, before `reconcileRemediationCases`. For each admitted unbound `act` proposal with a live source, compute `classifyBuildReviewRecurrence` and `buildReviewRecurrenceLineage` over `priorCasesBeforeReconcile`. When `appliedAttempts >= BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT`, call `recordHaltingBinding` with the proposal rebound to the authoritative owner by `existingCaseId`. Then emit `remediation_semantic_repeat_halt` with reason `recurrence-limit` and `lineageCaseIds`, and return `failUnlessAccepted` with the reason text from Technical Approach and `caseSourceIds` covering the proposal's sources. A declared owner is not in `recurrenceOf`, so it never reaches this check.
4. Verify GREEN and commit: "feat(build-review): bound recurrence lineages at three attempts".

**Done when:**
- [test] With lineage R → N → N2 resolved and applied, an undeclared unbound `act` re-raise of N2's source returns a halt whose reason is `semantic remediation case recurrence limit N2: lineage R, N, N2 has 3 applied attempts (limit 3)`, and the store holds no new case and no new effect id.
- [test] That lap emits one `remediation_semantic_repeat_halt` with reason `recurrence-limit`, caseId N2 and `lineageCaseIds` [R, N, N2], and after the halt the halting sources are linked to N2 while R's and N's rows and N2's other fields are byte-identical.
- [test] A sibling unbound `act` row on an unrelated source in the same judgement reserves no action effect and the charge adapter records no charge.
- [test] When the halting proposal's sources are operator-accepted before the halt decision, `coordinateBuildReviewAdjudication` returns no halt of any kind for that lap, so the lap does not halt.
- [test] The same at-limit re-raise declaring `distinctFrom` N2 with a reason persists a new case with no `recurrenceOf`, whose lineage `appliedAttempts` is 0, and routes BUILD.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 8: Replay the #2423 recurrence through the real coordinator path
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 4, Task 7

**Steps:**
1. Write failing coordinator tests that replay the #2423 shape through `coordinateBuildReviewAdjudication` with the real store, reconciler and an injected `chargeEffect` adapter. The shape is resolved act R with an applied effect and source `testQuality:sha256:cbf7…`, and an undeclared unbound `act` re-raise of that source whose rationale names daemon-liveness staleness assertions.
2. Verify RED. Fix any coordinator wiring defect the tests expose, without widening scope.
3. Verify GREEN and commit: "test(build-review): replay a recurring concern at a resolved anchor".

**Done when:**
- [test] The #2423 replay persists N with `recurrenceOf: [R]`, leaves R's serialized row byte-identical, routes BUILD with a work order carrying N, and emits no `remediation_adjudication_failed` and no `remediation_semantic_repeat_halt`.
- [test] The #2423 replay's charge adapter records exactly one charge, for N's effect id, including after the same judgement is coordinated a second time.
- [test] With R and its recurrence N resolved and applied, a second undeclared re-raise of N's source persists N2 with `recurrenceOf: [N]` and routes BUILD.
- [test] A judgement binding S to R by `existingCaseId` with disposition `act` still halts `semantic remediation case regression R` with no new case, and an undeclared unbound `act` row on S while open O owns S still halts with `source-linked-by-multiple-cases` naming O, the proposed case id and S, with no `recurrenceOf` written.
- [test] Unbound `defer`, `reject`, `advisory` and `escalate` rows on S over R each produce a case carrying no `recurrenceOf`, with the same route and halt text as the same fixture before this change.

**Files:** src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/src/engine/build-review-adjudication-coordinator.ts

### Task 9: Bound recurrences through the conductor build_review step
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 7

**Steps:**
1. Write failing tests in `conductor-build-review-adjudication.test.ts` through the conductor `build_review` step on a flat fixture: one with an at-limit lineage, and one with an under-limit recurrence on another lineage and the cumulative kickback cap exhausted.
2. Verify RED, implement any wiring the tests expose, verify GREEN, and commit: "test(build-review): bound recurrence lineages through the conductor".

**Done when:**
- [test] Through the conductor `build_review` step, an at-limit undeclared re-raise writes a HALT whose text contains `semantic remediation case recurrence limit` and every lineage case id, and dispatches no BUILD.
- [test] Through the conductor `build_review` step with the cumulative kickback cap exhausted, an under-limit recurrence halts with `build-review kickback budget exhausted (cumulative): blocked cases` naming the recurrence's case and effect id, and the HALT text contains no `recurrence limit`.

**Files:** src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 10: Show lineage and distinct declarations in build-review findings
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 2

**Steps:**
1. Write failing tests in `build-review-cli.test.ts` through `dispatchBuildReviewFindings` with a store fixture.
2. Verify RED.
3. Implement in `renderCase`: for a case with `distinctFrom`, print one `distinct from <id>: <reason>` line per entry. For a case with `recurrenceOf`, print `recurs from <ids>` with the lineage's applied attempts and the limit from `buildReviewRecurrenceLineage`. For a case that another case declares distinct from, print `declared distinct by <id>: <reason>`. Print nothing new for a case with no lineage relation. JSON output already serializes case records, so it carries the fields unchanged.
4. Verify GREEN and commit: "feat(build-review): show recurrence lineage in findings".

**Done when:**
- [test] `dispatchBuildReviewFindings` over a store holding N with `distinctFrom` R prints, under N, `distinct from R: <reason>`, and under R, `declared distinct by N: <reason>`.
- [test] `dispatchBuildReviewFindings` over a store holding N with `recurrenceOf: [R]` and applied R and N prints, under N, `recurs from R` with `2 of 3 applied attempts`.
- [test] `dispatchBuildReviewFindings` over a fixture store with no lineage fields produces output byte-identical to the expected pre-change output captured in the test.

**Files:** src/conductor/src/engine/build-review-cli.ts; src/conductor/test/engine/build-review-cli.test.ts

### Task 11: Publish the distinctFrom contract to every remediate provider
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 3

**Steps:**
1. Write a failing test in `skill-invocation.test.ts`. Rendering the `remediate` step for the Claude and Codex provider keys resolves the same skill name. That skill's `skills/remediate/SKILL.md` text contains the `distinctFrom` entry shape, the non-empty reason, the three-attempt lineage limit, and the rule that entries for non-qualifying cases are ignored.
2. Verify RED.
3. Implement: in `skills/remediate/SKILL.md`'s case-row section, document the optional `distinctFrom` on an unbound `act` row. Explain that a re-raise over a resolved action case is a recurrence unless declared distinct with a reason, that a lineage gets three applied attempts, that a malformed shape rejects the artifact, and that a non-qualifying entry is ignored. Add no provider-specific remediate file.
4. Verify GREEN and commit: "docs(remediate): declare distinct re-raises explicitly".

**Done when:**
- [test] `renderSkillInvocation` for the `remediate` descriptor under the Claude and Codex provider keys names the same skill `remediate`, and only `skills/remediate/SKILL.md` exists as the remediate contract.
- [test] `skills/remediate/SKILL.md` contains `distinctFrom`, `caseId`, `reason`, the statement that the reason must be non-empty, the phrase `three applied attempts`, and the statement that an entry not naming a resolved action owner of a row source is ignored.

**Files:** skills/remediate/SKILL.md; src/conductor/test/engine/skill-invocation.test.ts

## Task Dependency Graph

```text
Task 1 ─▶ Task 2 ─▶ Task 4 ─▶ Task 6 ─▶ Task 7 ─▶ Task 8
Task 3 ─▶ Task 4 ─▶ Task 12            Task 7 ─▶ Task 9
Task 1 ─▶ Task 5
Task 2 ─▶ Task 7
Task 2 ─▶ Task 10
Task 3 ─▶ Task 11
Task 4 ─▶ Task 8
```

## Integration Points

- After Task 4, an unbound act re-raise reconciles with its lineage stamped.
- After Task 7, `coordinateBuildReviewAdjudication` enforces the lineage limit before reservation.
- After Task 9, the conductor `build_review` step halts an exhausted lineage and still honors the cumulative cap.
- After Task 10, `build-review findings` shows lineages and declarations.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given R owns S, when a judgement's unbound act row on S carries `distinctFrom` naming R with a non-empty reason, then the artifact is admitted and the declaration counts for R. | 3, 2 | "admits an unbound `act` row whose `distinctFrom` is" | diff-local |
| Story 1 happy: Given resolved act cases R1 owning S1 and R2 owning S2, when an unbound act row on S1 and S2 declares `distinctFrom` naming only R1, then the declaration counts for R1 and not for R2. | 4 | "declaring `distinctFrom` R1 only persists N with `distinctFrom` naming only R1 and `recurrenceOf: [R2]`" | diff-local |
| Story 1 happy: Given the remediate skill contract, when a Claude dispatch and a Codex dispatch render the remediate step, then both read the same `skills/remediate/SKILL.md`, which describes the `distinctFrom` entry shape, its non-empty reason, the three-attempt lineage limit, and the rule that entries for non-qualifying cases are ignored. | 11 | "contains `distinctFrom`, `caseId`, `reason`, the statement that the reason must be non-empty, the phrase `three applied attempts`" | diff-local |
| Story 1 negative: Given R owns S, when an unbound act row on S declares `distinctFrom` naming a case id absent from the supplied prior cases, then that entry is dropped, the judgement is admitted, and the row is treated as a recurrence of R. | 2, 12 | "drops a declared entry naming an unknown id, an open act case, or a resolved `defer` case that owns no row source" | diff-local |
| Story 1 negative: Given an open act case O and R both appear in prior cases, when an unbound act row on S declares `distinctFrom` naming O, then that entry is dropped because O is not a resolved act owner of a row source. | 2 | "drops a declared entry naming an unknown id, an open act case, or a resolved `defer` case that owns no row source" | diff-local |
| Story 1 negative: Given a resolved `defer` case D that owns no source of the row, when an unbound act row on S declares `distinctFrom` naming D, then that entry is dropped and the row is treated as a recurrence of R. | 2 | "drops a declared entry naming an unknown id, an open act case, or a resolved `defer` case that owns no row source" | diff-local |
| Story 1 negative: Given a `distinctFrom` on a row bound by `existingCaseId`, or on a row whose disposition is not `act`, when the artifact is validated, then the declaration is ignored and that row is reconciled exactly as it would be without it. | 12 | "an `existingCaseId`-bound row carrying `distinctFrom`, persist records carrying neither `recurrenceOf` nor `distinctFrom`" | diff-local |
| Story 1 negative: Given an unbound act row whose `distinctFrom` is an empty list, an entry with an empty or over-bound reason, or an entry with extra keys, when the artifact is parsed, then the whole artifact is rejected as malformed exactly like any other malformed remediate artifact, and no case or effect is written. | 3 | "rejects as malformed an artifact whose `distinctFrom` is an empty list" | diff-local |
| Story 1 negative: Given two unbound act rows with identical source sets and rationale prose that differs only in wording, when neither declares `distinctFrom`, then neither is treated as distinct on the basis of its prose. | 12 | "whose rationale differs only in wording, one stating in prose that it is distinct from R" | diff-local |
| Story 2 happy: Given R owns S, when a judgement proposes an undeclared unbound act row on S and the lineage has fewer than three applied attempts, then a new open case N is persisted with `recurrenceOf` exactly [R], a freshly reserved action effect, and R byte-identical. | 4 | "persists new open case N with `recurrenceOf: [R]` and a reserved action effect" | diff-local |
| Story 2 happy: Given N was minted as a recurrence, when the effect stage applies N's action, then the kickback budget is charged exactly once for N's effect id and the lap routes BUILD with N, without halting. | 8 | "routes BUILD with a work order carrying N" | diff-local |
| Story 2 happy: Given resolved act cases R1 owning S1 and R2 owning S2, when an undeclared unbound act row covers S1 and S2, then N's `recurrenceOf` names both R1 and R2. | 4 | "persists N with `recurrenceOf: [R1, R2]`" | diff-local |
| Story 2 happy: Given N is persisted, when the same judgement is reconciled again, then it converges on N with no second case, no second effect, no change to `recurrenceOf`, and no second kickback charge. | 4, 8 | "the store holds no second case or effect id and N's `recurrenceOf` is unchanged" | diff-local |
| Story 2 happy: Given N is persisted, when the next lap's judge context is assembled, then N's frozen prior-case entry carries `recurrenceOf` [R]. | 5 | "lists N in `priorCases` with `recurrenceOf` exactly `[R]`" | diff-local |
| Story 2 happy: Given the #2423 shape (resolved R with an applied effect, and an undeclared unbound act re-raise of R's source with a changed concern), when the lap runs through the real store, reconciler and coordinator, then N is persisted with `recurrenceOf` [R], R is byte-identical, and no `remediation_adjudication_failed` or halt event is emitted. | 8 | "The #2423 replay persists N with `recurrenceOf: [R]`" | diff-local |
| Story 2 negative: Given an unbound act row whose sources' authoritative owners are all open cases or have no owner, when it is reconciled, then the new case carries no `recurrenceOf` and no `distinctFrom`. | 12 | "whose sources' authoritative owners are all open cases or no case" | diff-local |
| Story 2 negative: Given R owns S, when the judgement proposes an unbound `defer`, `reject`, `advisory` or `escalate` row on S, then the case it produces carries no `recurrenceOf` and behaves exactly as before this change. | 12, 8 | "Unbound `defer` and `reject` rows on S over resolved act R" | diff-local |
| Story 2 negative: Given R holds no operator acceptance, when the judgement binds S to R by `existingCaseId` with disposition `act`, then the lap still halts `semantic remediation case regression R` and no new case is persisted. | 8 | "still halts `semantic remediation case regression R` with no new case" | diff-local |
| Story 2 negative: Given an open case O owns S, when an undeclared unbound act row on S with a different source set is proposed, then the lap still halts with a rejected transition naming `source-linked-by-multiple-cases`, and no `recurrenceOf` is written. | 8 | "still halts with `source-linked-by-multiple-cases` naming O, the proposed case id and S" | diff-local |
| Story 2 negative: Given a store that an engine without this change wrote, holding no `recurrenceOf` or `distinctFrom` keys, when it is read, reconciled and written, then it parses and every pre-existing row is byte-identical. | 1 | "leaves every pre-existing row's serialized bytes identical" | diff-local |
| Story 2 negative: Given a persisted case whose `recurrenceOf` is an empty list or names its own id, when the store is read, then the read fails with the existing `malformed-state` reason. | 1 | "names its own id, or whose `distinctFrom` entry has an empty reason returns reason `malformed-state`" | diff-local |
| Story 3 happy: Given R and its recurrence N are both resolved with applied action effects, when an undeclared unbound act re-raise of N's source arrives, then N2 is admitted with `recurrenceOf` [N] and routes BUILD, because the lineage counts two attempts. | 8 | "persists N2 with `recurrenceOf: [N]` and routes BUILD" | diff-local |
| Story 3 happy: Given R, N and N2 are resolved with applied action effects in one lineage, when an undeclared unbound act re-raise of N2's source arrives, then the lap halts with reason text `semantic remediation case recurrence limit N2`, the halt names R, N and N2 and the attempt count 3, and no new case or effect is persisted. | 7 | "semantic remediation case recurrence limit N2: lineage R, N, N2 has 3 applied attempts (limit 3)" | diff-local |
| Story 3 happy: Given that recurrence-limit halt, when the lap ends, then `remediation_semantic_repeat_halt` is emitted with reason `recurrence-limit`, case id N2, and `lineageCaseIds` naming R, N and N2. | 7 | "emits one `remediation_semantic_repeat_halt` with reason `recurrence-limit`, caseId N2 and `lineageCaseIds` [R, N, N2]" | diff-local |
| Story 3 happy: Given that recurrence-limit halt, when the store is read afterwards, then the halting proposal's live sources are linked to N2 and every lineage row other than that source link is byte-identical. | 7 | "the halting sources are linked to N2 while R's and N's rows and N2's other fields are byte-identical" | diff-local |
| Story 3 happy: Given the halting proposal's sources are operator-accepted before the halt decision, when the coordinator re-reads authority, then the lap does not halt, exactly as the existing regression halt behaves under acceptance. | 7 | "returns no halt of any kind for that lap, so the lap does not halt" | diff-local |
| Story 3 negative: Given a lineage whose resolved act case R has a `failed` action effect that was never applied, when its attempt count is computed, then R contributes zero attempts. | 2 | "counts zero attempts for a resolved act case whose action effect is `failed`" | diff-local |
| Story 3 negative: Given an at-limit lineage and a sibling unbound act row in the same judgement on an unrelated source, when the lap halts on the recurrence limit, then no action effect is reserved for the sibling. | 7 | "reserves no action effect and the charge adapter records no charge" | diff-local |
| Story 3 negative: Given an at-limit lineage, when the judgement declares the re-raise `distinctFrom` the lineage's authoritative owner with a reason, then the case is admitted as a new case with no `recurrenceOf`, and its own lineage starts at zero attempts. | 7 | "whose lineage `appliedAttempts` is 0, and routes BUILD" | diff-local |
| Story 3 negative: Given an at-limit lineage and an exhausted cumulative kickback cap, when an under-limit recurrence on another lineage is proposed, then the lap halts with the existing kickback-cap halt naming that recurrence's effect. | 9 | "build-review kickback budget exhausted (cumulative): blocked cases" | diff-local |
| Story 3 negative: Given two lineages merge through one recurrence whose `recurrenceOf` names owners in both, when the attempt count is computed, then each applied case is counted once even if reachable by two paths. | 2 | "counts a case reachable through two `recurrenceOf` paths exactly once" | diff-local |
| Story 4 happy: Given R owns S, when an unbound act row on S declares `distinctFrom` R with reason "asserts daemon-liveness staleness, not in-flight age", then the new case N persists `distinctFrom` with R's id and that reason, carries no `recurrenceOf` for R, and R is byte-identical. | 4 | "persists N with `distinctFrom: [{ caseId: R, reason }]` and no `recurrenceOf`" | diff-local |
| Story 4 happy: Given N was persisted with that declaration, when `remediation_case_reconciled` is emitted for N opening, then it carries `distinctFrom` with R's id and the reason. | 6 | "for N carrying `distinctFrom: [{ caseId: R, reason }]`" | diff-local |
| Story 4 happy: Given N was persisted as a recurrence of R, when `remediation_case_reconciled` is emitted for N opening, then it carries `recurrenceOf` [R]. | 6 | "for N carrying `recurrenceOf: [R]`" | diff-local |
| Story 4 happy: Given a store holding N with `distinctFrom` R, when the operator runs `build-review findings` for the feature, then the output for N names R and the reason, and the output for R names N as declared distinct from it. | 10 | "`declared distinct by N: <reason>`" | diff-local |
| Story 4 happy: Given a store holding N with `recurrenceOf` [R], when the operator runs `build-review findings`, then the output names R as the case N recurs from, with the lineage's applied attempt count. | 10 | "with `2 of 3 applied attempts`" | diff-local |
| Story 4 negative: Given a declaration entry that was dropped as non-qualifying, when N is persisted and its event emitted, then neither N's row nor the event mentions the dropped case id. | 12, 6 | "N's row contains no occurrence of the dropped id" | diff-local |
| Story 4 negative: Given a case with neither field, when `remediation_case_reconciled` is emitted for it, then the event carries neither `recurrenceOf` nor `distinctFrom`. | 6 | "with no `recurrenceOf` and no `distinctFrom` key" | diff-local |
| Story 4 negative: Given a store holding no lineage fields, when `build-review findings` runs, then its output is identical to the output before this change. | 10 | "produces output byte-identical to the expected pre-change output" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Infrastructure-only versus mixed-lap classification is untouched: no task changes the raw join, the mechanical lane or the coverage-retry route. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | The single remediate dispatch is unchanged; its frozen prior-case projection only gains two copied optional fields (Task 5) and dispatch selection is not touched. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | no-change | none | Content action and infrastructure blocking still compose through the existing reducer; the recurrence-limit halt returns through the existing `failUnlessAccepted` lane without changing precedence. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Grader confidence, the operator floor and the advisory threshold act before remediate; advisory rows are excluded from recurrence stamping (Task 8). |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-2, task-4, task-6, task-7 | returns a halt whose reason is `semantic remediation case recurrence limit N2: lineage R, N, N2 has 3 applied attempts (limit 3)` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | no-change | none | Independent rubric judgement and the mechanical raw join are untouched. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | no-change | none | Operator dispositions keep separate, prior authority; the recurrence-limit halt yields to operator acceptance exactly as the regression halt does (Task 7). |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | no-change | none | The remediate dispatch inputs are the same closed projection; prior cases gain only the two optional lineage fields. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | task | task-3, task-11 | admits an unbound `act` row whose `distinctFrom` is |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-1 | is followed by `read()` returning those exact values |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | task | task-4 | the store holds no second case or effect id and N's `recurrenceOf` is unchanged |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-7, task-8 | records exactly one charge, for N's effect id |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | no-change | none | The effective verdict still derives only after required effects settle; the limit check runs before any effect is reserved, so no effect is left unsettled. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-6 | carrying `recurrenceOf: [R]` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | no-change | none | Rollout gating is unchanged; the optional fields ship without a flag because every store the current engine wrote still parses identically (Task 1). |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
