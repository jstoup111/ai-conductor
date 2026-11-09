# Implementation Plan: one corrected re-judgement for an inadmissible build_review case binding (#3461)

**Date:** 2026-10-28
**Stories:** .docs/stories/build-review-halts-needs-human-when-the-judge-reje.md
**Conflict check:** Clean as of 2026-10-28 (two contradictions resolved by in-place story amendments; `.docs/conflicts/2026-10-28-build-review-halts-needs-human-when-the-judge-reje.md`)
**Architecture:** `architecture-review-2026-10-28-build-review-halts-needs-human-when-the-judge-reje` (APPROVED); amendments of 2026-10-28 to `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2 and `adr-2026-09-10-portable-build-review-policy` D9

## Summary

A `remediate` judgement that binds a prior case with a disposition the case reconciler will not admit is caught at validation, before reconciliation, and re-judged once with the refused binding named. The judge also sees, for every prior case, which dispositions a binding can take. A second invalid judgement fails closed as today, with a halt naming the case, the proposed disposition and the bindable set. 8 tasks, delivered as a single PR.

## Technical Approach

- **One predicate** (`src/conductor/src/engine/remediation-case-reconciler.ts`). Export `bindableDispositions(record, { attemptedCaseIds, carryInput })`, which returns a sorted, frozen list of `RemediationCaseDisposition` values other than `escalate`:
  - a carry-eligible record (`carryInput` present and `isCarryEligibleRemediationCase` true): `act`, `advisory`, `defer`, `refute`, `reject`;
  - otherwise the record's own disposition, plus `refute` when the record is `act`, `open`, attempted, with an `applied` action effect, plus `defer` when the record is `act` with an `applied` action effect.
  - `reconcileState` replaces `existing.disposition !== caseRow.disposition && !admitsRefutation && !admitsDeferral` with "the proposed disposition is not in `bindableDispositions(existing, …)`", passing its `attemptedIds` and no carry input (carry is decided first, as today). The lane flags, the `refutation-repeat` check and every replacement stay as they are.
- **Context** (`src/conductor/src/engine/build-review-adjudication-context.ts`).
  - `BuildReviewAdjudicationPriorCase` gains `bindableDispositions`; `freezePriorCase` fills it from the predicate with the context's `attemptedCaseIds` and `carryInput`.
  - `AssembleBuildReviewAdjudicationContextInput` gains optional `bindingCorrections: readonly { caseRef, existingCaseId, disposition, bindableDispositions }[]`. `contextFor` adds a top-level `bindingCorrections` only when the list is non-empty. Both fields are inside the existing `maxSerializedBytes` accounting.
- **Validator** (`src/conductor/src/engine/remediation-case-validator.ts`).
  - `RemediationCaseValidationReferences` gains `bindableDispositionsByCaseId`. `RemediationCaseGraphRejection` gains `inadmissible-case-binding`, returned as `InadmissibleCaseBindingRejection { ok: false, reason, bindings }`, with one entry per refused row.
  - The check runs after the consistency check, as the last check before success. So the reason is returned only when every other check passed. It skips `escalate` rows and rows whose `existingCaseId` is absent from the map (the reconciler's `unknown-case-binding` still owns those).
- **Correction round** (`src/conductor/src/engine/build-review-adjudication-coordinator.ts`).
  - The round loop runs up to three dispatches. The expansion round stays available only after the first judgement, as today. The correction round is available once, after any judgement, when validation returns `inadmissible-case-binding`.
  - The coordinator builds `bindableDispositionsByCaseId` from `prior.state.cases` with the same `attemptedCaseIds` and `carryInput` it passes to the context and the reconciler. For a correction round, it re-assembles the context with `bindingCorrections` (and the expansion task ids, when the expansion round already ran) and discards the refused judgement.
  - When the correction round is used, or the rejection comes with other defects, the lap fails through `failUnlessAccepted` with `invalid remediation judgement inadmissible-case-binding (case <id> bound as <disposition>; bindable: <a, b>)`, joining several bindings with `; `.
- **Event** (`src/conductor/src/types/events.ts`). `remediation_adjudication_started` gains optional `bindingCorrectionCaseIds`, set only on the correction round's started event. The variant is already registered in `event-sinks.ts`, so no sink change is needed.
- **Skill** (`skills/remediate/SKILL.md`). The build_review case contract states the binding rule, the `bindingCorrections` round, and that a re-raised finding judged gone from an attempted applied action is answered with an evidence-backed `refute`, never a bound `reject`.
- **Pattern basis.** The expansion round is the precedent. Look for `classifyIndexOnlyAdmission`, `expansionTaskIds` and `round === 0` in the coordinator, and for the coordinator tests asserting `expansionTaskIds` on `remediation_adjudication_started`. Keep its traits: the refused judgement is discarded, never reconciled; the same `input.judge` and context contract are used; no kickback is charged. Unlike it, the new rejection is checked last in the validator, so no re-validation classifier is needed.

## Prerequisites

- None. In-flight PR #3491 edits the semantic repeat and regression halt text in the same coordinator file. Task 6 asserts only the shared prefix `semantic remediation case repeat case-A`, which holds before and after #3491.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Lap classification into infrastructure-only and mixed laps runs before adjudication and is untouched; only content findings still reach the judge. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | task | task-4, task-5 | the coordinator calls the judge exactly twice |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-6 | fails with a detail beginning `semantic remediation case repeat case-A` |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Confidence-floor suppression happens before the judge is dispatched, and suppressed findings never enter a correction round. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | no-change | none | The settled-recurrence predicate runs before the first dispatch and is unchanged; a lap whose live set is empty still skips the judge. |
| adr-2026-09-10-portable-build-review-policy#D1 | no-change | none | The public gate and its declarations are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | Semantic identity resolution through installed-catalog adapters is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | The bound policy bundle and its fingerprint are untouched. |
| adr-2026-09-10-portable-build-review-policy#D4 | no-change | none | The supported installed-policy contract is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D5 | no-change | none | Reviewer access and the frozen view are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D6 | no-change | none | Candidate-preparation cache operations are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D7 | no-change | none | Result identity and the custom result contract are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D8 | task | task-2 | the `priorCases` entry of `case-A` has `bindableDispositions` exactly `['act', 'defer', 'refute']` |
| adr-2026-09-10-portable-build-review-policy#D9 | task | task-3, task-5 | returns `{ ok: false, reason: 'inadmissible-case-binding' }` |
| adr-2026-09-10-portable-build-review-policy#D10 | no-change | none | The shared operation still invokes the adjudication coordinator once per lap; the correction round runs inside that one call. |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-4 | after the lap `kickback-ledger.json` is byte-identical to its bytes before the lap |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-7 | the correction round's `remediation_adjudication_started` event carries `bindingCorrectionCaseIds` exactly `['case-A']` |

## Tasks

### Task 1: One bindable-disposition predicate, used by the reconciler's transition check
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-reconciler.test.ts` for every Done-when check below, using records shaped like the stories' `case-A`, `case-U`, `case-R`, `case-J`, `case-F` and `case-C`.
2. Verify RED.
3. Implement `bindableDispositions` as described in Technical Approach and make `reconcileState`'s transition check call it. Keep the lane flags, the `refutation-repeat` check and the replacements unchanged.
4. Verify GREEN, including the existing transition-table tests.
5. Commit: "refactor(remediation): one bindable-disposition predicate for case bindings".

**Done when:**
- [test] `bindableDispositions` returns exactly `['act', 'defer', 'refute']` for `case-A`, `['act', 'defer']` for `case-U`, `['act']` for `case-R`, `['reject']` for `case-J` and `['refute']` for `case-F`, given `case-A` alone in the attempted case ids.
- [test] `bindableDispositions` returns exactly `['act', 'advisory', 'defer', 'refute', 'reject']` for `case-C` when given a carry input under which `isCarryEligibleRemediationCase(case-C)` is true.
- [test] `reconcileRemediationCases` handed a graph binding `testQuality:F2` to `case-R` as `reject`, with no validation, returns `{ ok: false, reason: 'illegal-disposition-transition' }` and `remediation-cases.json` is byte-identical before and after the call.
- [test] The existing reconciler transition-table cases (unattempted action, reserved effect, failed effect, deferred case, rejected case) still return `illegal-disposition-transition`, and the existing act-to-refute and act-to-defer admissions still reconcile.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-reconciler.ts` — exported predicate; transition check calls it
- `src/conductor/test/engine/remediation-case-reconciler.test.ts` — predicate and backstop tests

**Dependencies:** none

### Task 2: The adjudication context lists each prior case's bindable dispositions
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-context.test.ts` for every Done-when check below.
2. Verify RED.
3. Add `bindableDispositions` to `BuildReviewAdjudicationPriorCase` and fill it in `freezePriorCase` from Task 1's predicate with the input's `attemptedCaseIds` and `carryInput`. Add the optional `bindingCorrections` input and emit the top-level key only when it is non-empty, inside the existing serialized-size accounting.
4. Verify GREEN.
5. Commit: "feat(build-review): list bindable dispositions per prior case in the remediate context".

**Done when:**
- [test] With prior cases `case-A` (attempted), `case-J` and `case-C` (carry-eligible under the input's `carryInput`), the `priorCases` entry of `case-A` has `bindableDispositions` exactly `['act', 'defer', 'refute']`, `case-J` exactly `['reject']` and `case-C` exactly `['act', 'advisory', 'defer', 'refute', 'reject']`.
- [test] With prior cases `case-R`, `case-U` and `case-F` and only `case-A` attempted, their entries have `bindableDispositions` exactly `['act']`, `['act', 'defer']` and `['refute']`, so none of the three lists `reject` and neither `case-R` nor `case-U` lists `refute`.
- [test] Assembled without `bindingCorrections`, or with an empty list, the context has no `bindingCorrections` key; assembled with one correction, `context.bindingCorrections` deep-equals that one entry.
- [test] A context whose prior cases and corrections push the serialized size past `maxSerializedBytes` returns the `serialized-byte-overflow` stop, and one under the ceiling serializes to at most `maxSerializedBytes` bytes.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-context.ts` — prior-case field, corrections input
- `src/conductor/test/engine/build-review-adjudication-context.test.ts` — context tests

**Dependencies:** Task 1

### Task 3: The case-graph validator refuses an inadmissible binding, as its last check
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-validator.test.ts` for every Done-when check below.
2. Verify RED.
3. Add `bindableDispositionsByCaseId` to the references, the `inadmissible-case-binding` reason and its typed rejection, and the binding check after the consistency check, skipping `escalate` rows and unmapped case ids.
4. Verify GREEN.
5. Commit: "feat(remediation): refuse a binding outside the prior case's bindable dispositions".

**Done when:**
- [test] A case-v1 judgement binding `testQuality:F2` to `case-A` as `reject`, validated with `bindableDispositionsByCaseId` `{ 'case-A': ['act', 'defer', 'refute'] }`, returns `{ ok: false, reason: 'inadmissible-case-binding' }` whose `bindings` is exactly one entry with its `caseRef`, `existingCaseId: 'case-A'`, `disposition: 'reject'` and `bindableDispositions: ['act', 'defer', 'refute']`.
- [test] The same judgement with `testQuality:F2` omitted from `sourceOutcomes` returns `missing-source`, not `inadmissible-case-binding`.
- [test] A case-v2 judgement whose only bound row is an `escalate` row on `case-A` is not refused with `inadmissible-case-binding`.
- [test] For every pair of a case among `case-A`, `case-U`, `case-R`, `case-J`, `case-F`, `case-C` and a disposition among `act`, `defer`, `reject`, `refute`, `advisory`, a single-row judgement the validator accepts with the bindable map from Task 1's predicate, reconciled by `reconcileRemediationCases` with the same attempted case ids and with `carry.caseRefs` naming the row exactly when the case is `case-C`, never returns `illegal-disposition-transition`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-validator.ts` — reference, reason, rejection type, last check
- `src/conductor/test/engine/remediation-case-validator.test.ts` — validator and cross-pair tests

**Dependencies:** Task 1

### Task 4: One correction round re-judges an inadmissible binding
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests for every Done-when check below: coordinator tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`, with a scripted `judge` that records each context and returns a `reject` binding of `testQuality:F2` to `case-A` first and an evidence-backed refutation second; and the conductor-level test in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`, using the harness's per-dispatch `remediateJudgements` list, its `retryReasons` for `remediate`, and `haltMarker()`.
2. Verify RED.
3. In `coordinateBuildReviewAdjudication`, build `bindableDispositionsByCaseId` with the lap's `attemptedCaseIds` and `carryInput`, pass it to `validateRemediationCaseGraph`, and on an `inadmissible-case-binding` rejection with the correction round unused, re-assemble the context with `bindingCorrections` from the rejection and re-dispatch. Raise the loop bound to three dispatches and keep the expansion round available only after the first judgement.
4. Verify GREEN.
5. Commit: "feat(build-review): re-judge an inadmissible case binding once before failing".

**Done when:**
- [test] For a lap with prior case `case-A` and the reject-then-refute judge, the coordinator calls the judge exactly twice, returns `{ ok: true }` with route `pass`, leaves `case-A` with disposition `refute` and resolution `resolved`, and emits no `remediation_adjudication_failed` event.
- [test] The second recorded context carries `bindingCorrections` exactly one entry with the first judgement's `caseRef`, `existingCaseId: 'case-A'`, `disposition: 'reject'` and `bindableDispositions: ['act', 'defer', 'refute']`, and the first recorded context has no `bindingCorrections` key.
- [test] The bytes of `remediation-cases.json`, the build-review work-order file and `kickback-ledger.json`, read inside the second judge call, equal their bytes read inside the first judge call, and after the lap `kickback-ledger.json` is byte-identical to its bytes before the lap.
- [test] Through the conductor's build_review step in `conductor-build-review-adjudication.test.ts`, with prior case `case-A` and `remediateJudgements` of a `reject` binding to `case-A` then an evidence-backed refutation of it, `remediate` is dispatched exactly twice, the second dispatch's retry reason contains `"bindingCorrections"` and `"case-A"`, no `.pipeline/HALT` is written, and no BUILD kickback is recorded.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — bindable references, correction round
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — correction-round tests
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — conductor-level correction round

**Dependencies:** Tasks 2, 3

### Task 5: The correction round is bounded and fails closed with a named halt
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests for every Done-when check below, in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` and, for the conductor-level halt, `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`.
2. Verify RED.
3. Format the exhausted rejection as `invalid remediation judgement inadmissible-case-binding (case <id> bound as <disposition>; bindable: <list>)` in `describeInvalidRemediationJudgement`, and fail through `failUnlessAccepted` once the correction round is used.
4. Verify GREEN.
5. Commit: "feat(build-review): name the case, disposition and bindable set when a correction round is exhausted".

**Done when:**
- [test] For a lap with prior case `case-R` and a judge that binds `testQuality:F2` to `case-R` as `reject` twice, the coordinator calls the judge exactly twice and returns `{ ok: false }` whose detail contains `inadmissible-case-binding`, `case case-R bound as reject` and `bindable: act`.
- [test] In that lap exactly one `remediation_adjudication_failed` event is emitted and its `reason` equals the returned detail, and `remediation-cases.json` read after the lap is byte-identical to its bytes read inside the first judge call.
- [test] A first judgement that binds `case-A` as `reject` and omits `testQuality:F2` from `sourceOutcomes` makes the coordinator call the judge exactly once and return detail `invalid remediation judgement missing-source`.
- [test] In a case-v2 lap whose first judgement admits only index-listed tasks and whose next two judgements both bind `testQuality:F2` to `case-A` as `reject`, the coordinator calls the judge exactly three times, the third recorded context carries `bindingCorrections`, and the returned detail contains `inadmissible-case-binding` and `case case-A bound as reject`.
- [test] Through the conductor's build_review step in `conductor-build-review-adjudication.test.ts`, with prior case `case-R` and `remediateJudgements` of two `reject` bindings to `case-R`, `remediate` is dispatched exactly twice and `.pipeline/HALT` contains `inadmissible-case-binding`, `case case-R bound as reject` and `bindable: act`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — exhausted-round detail
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — bound tests
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — conductor-level exhausted halt

**Dependencies:** Task 4

### Task 6: Admissible bindings and the repeat halts keep one dispatch
**Story:** Story 3
**Type:** verification

**Steps:**
1. Write characterization tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` for every Done-when check below. They pin that an admissible binding, a repeated `act` and a repeated refutation take no correction round. They pass after Task 4 by design, and fail against pre-change code because they assert the dispatched context's `bindableDispositions`.
2. Run them with the existing semantic repeat and refutation repeat tests. Commit with a `Task: 6` trailer.

**Done when:**
- [test] A judge whose first judgement binds `testQuality:F2` to `case-A` as an evidence-backed refutation is called exactly once, its context lists `bindableDispositions` `['act', 'defer', 'refute']` for `case-A` and has no `bindingCorrections` key, and `case-A` ends with disposition `refute` and resolution `resolved`.
- [test] A judge whose first judgement binds `testQuality:F2` to `case-A` as `act` is called exactly once and the coordinator fails with a detail beginning `semantic remediation case repeat case-A`.
- [test] A judge whose first judgement binds `testQuality:F2` to `case-F` as an evidence-backed refutation is called exactly once, its context lists `bindableDispositions` `['refute']` for `case-F`, and the coordinator fails with detail `refutation repeat case-F`.

**Files likely touched:**
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — characterization tests

**Verify-only:** yes

**Dependencies:** Task 4

### Task 7: The correction round is visible on the event spine
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` for every Done-when check below.
2. Verify RED.
3. Add optional `bindingCorrectionCaseIds` to the `remediation_adjudication_started` variant in `src/conductor/src/types/events.ts`, and set it on the correction round's started event, from the refused bindings' case ids.
4. Verify GREEN.
5. Commit: "feat(events): mark the build_review binding correction round".

**Done when:**
- [test] In the reject-then-refute lap of Task 4, the correction round's `remediation_adjudication_started` event carries `bindingCorrectionCaseIds` exactly `['case-A']` and is emitted after the first judge call returns and before the second judge call.
- [test] The first round's `remediation_adjudication_started` event in that lap, and every started event of a lap with no correction round, has no `bindingCorrectionCaseIds` key.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — optional field
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — set it on the correction round
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — event tests

**Dependencies:** Task 4

### Task 8: The remediate skill states the binding rule and the correction round
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing assertions in `src/conductor/test/engine/remediate-skill-contract.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the binding rule to the build_review case contract in `skills/remediate/SKILL.md`: the `priorCases[].bindableDispositions` input field, the rule for bound non-escalation rows, the `bindingCorrections` round and its single retry, and the refute-not-reject instruction.
4. Verify GREEN.
5. Commit: "feat(remediate): state the case binding rule and correction round".

**Done when:**
- [test] The skill-contract test reads `skills/remediate/SKILL.md` and finds, in its build_review case contract, the statement that a non-escalation row binding an `existingCaseId` must use a disposition listed in that prior case's `bindableDispositions`.
- [test] The same test finds the statements that a refused binding is named in `bindingCorrections` for one corrected judgement, and that a re-raised finding judged no longer present on an attempted applied action is answered with an evidence-backed `refute`, not a bound `reject`.

**Files likely touched:**
- `skills/remediate/SKILL.md` — case-contract binding rule
- `src/conductor/test/engine/remediate-skill-contract.test.ts` — contract assertions

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2 ─┐
        └─▶ Task 3 ─┴─▶ Task 4 ─┬─▶ Task 5
                                ├─▶ Task 6
                                └─▶ Task 7
Task 8 (independent)
```

## Integration Points

- After Task 4: a build_review lap re-judges an inadmissible binding inside `coordinateBuildReviewAdjudication`.
- After Task 4: the conductor's real build_review step carries `bindingCorrections` into the `remediate` dispatch (Task 4's conductor-level check).
- After Task 5: the conductor's real build_review step writes the named HALT when the correction round is exhausted.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
