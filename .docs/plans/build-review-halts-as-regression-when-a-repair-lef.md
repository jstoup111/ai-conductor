# Implementation Plan: a bound build_review re-raise of a resolved action case routes a judged residual gap to BUILD under the lineage limit (#3362)

**Date:** 2026-10-28
**Design:** `.docs/architecture/build-review-halts-as-regression-when-a-repair-lef.md` (technical track; no PRD)
**Stories:** `.docs/stories/build-review-halts-as-regression-when-a-repair-lef.md`
**Conflict check:** Clean as of 2026-10-28 (five contradictions resolved by in-place story amendments; `.docs/conflicts/2026-10-28-build-review-halts-as-regression-when-a-repair-lef.md`)

## Summary

A `remediate` case row with disposition `act` that binds a resolved `act` case with an applied action effect may declare `reRaise: { kind: residual-gap | repeat, reason }`. A residual or undeclared rebind no longer halts as `regressed`: it is reconciled as a new `act` case stamped `recurrenceOf` the bound case, routed to BUILD, and bounded by the existing lineage limit of three applied attempts. A declared repeat still halts, and its halt names the lineage and its applied attempts. The kind is reported on the existing events. 9 tasks, delivered as a single PR.

## Technical Approach

- **Artifact** (`src/conductor/src/engine/remediation-case-artifact.ts`). `RemediationCaseRow` gains optional `reRaise?: { readonly kind: 'residual-gap' | 'repeat'; readonly reason: string }`. `parseCaseRow` adds `reRaise` to the expected keys when present, the same way it adds `distinctFrom`, and parses it with exact keys `kind` and `reason`, `kind` one of the two values and `reason` a bounded string (`isBoundedString`, default `MAX_TEXT_LENGTH` of 8,000). Any other shape returns `invalid-case-keys`.
- **Validator** (`src/conductor/src/engine/remediation-case-validator.ts`). `RemediationCaseValidationReferences` gains `reRaiseEligibleCaseIds?: readonly string[]`. A shape check beside `hasValidDistinctFrom` returns `invalid-case-keys` for a malformed `reRaise`. A retain step beside `retainAllowedDistinctFrom` keeps `reRaise` only on a row with disposition `act` whose `existingCaseId` is in the eligible ids, and otherwise drops the key without rejecting.
- **Reconciler** (`src/conductor/src/engine/remediation-case-reconciler.ts`). The reconcile input gains `recurrenceOwnersByCaseRef?: ReadonlyMap<string, string>`. For an unbound `act` row with an entry, the minted case's `recurrenceOf` is the exact-source owners followed by the explicit owner, de-duplicated, and provenance is not consulted. The minted record is built field by field, so `reRaise` is never persisted.
- **Coordinator** (`src/conductor/src/engine/build-review-adjudication-coordinator.ts`).
  - It computes the eligible ids from `prior.state.cases` (disposition `act`, resolution `resolved`, an `action` effect with status `applied`) and passes them to `validateRemediationCaseGraph`.
  - In the pre-reconciliation reuse loop, a `halt-regression` row whose record is eligible and whose `reRaise.kind` is not `repeat` is a **residual rebind**. Its lineage is `buildReviewRecurrenceLineage(prior.state.cases, owners)`, where `owners` are its exact-source owners plus the bound case id. At `BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT` it halts exactly like the existing recurrence-limit halt (`recordHaltingBinding` of the bound row, then `failUnlessAccepted`), with `caseId` the bound case. Under the limit, the row is rewritten without `existingCaseId`, its caseRef is mapped to the bound id in `recurrenceOwnersByCaseRef`, and its kind (`residual-gap` or `undeclared`) and bound id are kept by caseRef for the `remediation_case_reconciled` emission.
  - A `repeat` row, and a `halt-regression` record that is not eligible, keep today's regression halt. For a `repeat` row the coordinator also computes the bound case's lineage, and the detail adds `declared repeat; lineage <ids> has <n> applied attempts` between the case id and the recovery text produced by `semanticReuseHaltDetail`.
  - `classifyRemediationCaseReuse` is unchanged, so carry and `halt-repeat` keep their order and behavior.
- **Events** (`src/conductor/src/types/events.ts`). `remediation_case_reconciled` gains optional `reRaiseKind?: 'residual-gap' | 'undeclared'` and `boundCaseId?: string`. `remediation_semantic_repeat_halt` gains optional `reRaiseKind?: 'residual-gap' | 'undeclared' | 'repeat'` and `appliedAttempts?: number`. Both variants are already registered in `event-sinks.ts`, so no sink change is needed.
- **Skill** (`skills/remediate/SKILL.md`). The build_review case contract states the `reRaise` field, its two kinds, what each routes to, and that an absent declaration is treated as a residual gap.
- **Pattern basis.** `distinctFrom` (#3124) is the precedent for an optional, bounded, judge-declared case-row field: look for `parseDistinctFrom`, `hasValidDistinctFrom`, `retainAllowedDistinctFrom` and `allowedDistinctFromCaseIdsByCaseRef`. Keep its traits: a malformed shape rejects the artifact, an ineligible declaration is dropped and never halts, and the engine (not the judge) decides eligibility from the store. Unlike it, `reRaise` sits on a bound row and is never persisted. The recurrence-limit halt in the coordinator (look for `reason: 'recurrence-limit'`) is the precedent for the limit halt and its event.

## Prerequisites

- #3461 (landed spec, not yet built) edits the same coordinator, validator and reconciler. This spec is blocked by it. Its bindable set for a resolved `act` case with an applied action is `act`, `defer`, so the bound `act` row this plan routes stays admissible. Tasks name symbols, not lines, so the build rebases onto #3461's code.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Lap classification into infrastructure-only and mixed laps runs before adjudication and is untouched. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | One authoritative remediate judgement per lap is unchanged; the residual rebind is routed after validation of that one judgement. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-7 | fail with a detail beginning `semantic remediation case repeat case-A` |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Confidence-floor suppression happens before the judge is dispatched and is untouched. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-4, task-5, task-6 | the store gains one open `act` case N with source `testQuality:F2` |

## Tasks

### Task 1: Parse a `reRaise` declaration on a case row
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-artifact.test.ts` for every Done-when check below.
2. Verify they fail (RED): today an unknown `reRaise` key returns `invalid-case-keys`.
3. Implement: add `reRaise` to `RemediationCaseRow`, and in `parseCaseRow` add it to the expected keys when present and parse it like `parseDistinctFrom` (exact keys `kind` and `reason`, `kind` one of `residual-gap` and `repeat`, `reason` via `isBoundedString`). Follow the `distinctFrom` precedent: optional key, `invalid-case-keys` on any malformed shape.
4. Verify they pass (GREEN).
5. Commit: "feat(remediation): parse a judge-declared reRaise on a case row".

**Done when:**
- [test] `readRemediationCaseJudgement` accepts a bound `act` row carrying `reRaise` `{ kind: 'residual-gap', reason: 'the repair left a narrower gap' }` and returns the row with `reRaise` deep-equal to that object.
- [test] It accepts the same row carrying `{ kind: 'repeat', reason: 'the same defect is back' }` and returns that `reRaise` deep-equal.
- [test] It rejects as `invalid-case-keys` a `reRaise` whose kind is `maybe`, one whose reason is empty, one whose reason is 8,001 characters, and one with an extra key `note`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-artifact.ts` — `reRaise` type and parsing
- `src/conductor/test/engine/remediation-case-artifact.test.ts` — parser tests

**Dependencies:** none

### Task 2: The validator keeps `reRaise` only on an eligible bound act row
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-validator.test.ts` for every Done-when check below.
2. Verify they fail (RED).
3. Implement: add `reRaiseEligibleCaseIds` to `RemediationCaseValidationReferences`; add a `reRaise` shape check beside `hasValidDistinctFrom` that returns `invalid-case-keys`; add a retain step beside `retainAllowedDistinctFrom` that keeps `reRaise` only on an `act` row whose `existingCaseId` is eligible and otherwise removes the key. Follow the `distinctFrom` precedent: an ineligible declaration is dropped, never rejected.
4. Verify they pass (GREEN).
5. Commit: "feat(remediation): keep reRaise only on a bound act row of a resolved applied action case".

**Done when:**
- [test] With `reRaiseEligibleCaseIds` `['case-R']`, `validateRemediationCaseGraph` returns ok for a bound `act` row on `case-R` with the residual declaration and keeps `reRaise` exactly `{ kind: 'residual-gap', reason: 'the repair left a narrower gap' }`, and keeps the repeat declaration exactly on the same row.
- [test] With the same references, the residual declaration on an unbound `act` row, on an `act` row bound to `case-A`, on an `act` row bound to `case-X`, and on a `defer` row bound to `case-R` each validates ok with no rejection, and each validated row has no `reRaise` key.
- [test] For each of those four rows, the validated graph is deep-equal to the validated graph of the same row without `reRaise`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-validator.ts` — eligibility references, shape check, retain step
- `src/conductor/test/engine/remediation-case-validator.test.ts` — validator tests

**Dependencies:** Task 1

### Task 3: The reconciler stamps an explicit recurrence owner on a minted case
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-reconciler.test.ts` for every Done-when check below.
2. Verify they fail (RED).
3. Implement: add `recurrenceOwnersByCaseRef` to the reconcile input. For an unbound `act` row with an entry, set `recurrenceOf` to the exact-source owners followed by the explicit owner, de-duplicated, and skip provenance. Leave the field-by-field record construction as it is, so `reRaise` is not copied.
4. Verify they pass (GREEN).
5. Commit: "feat(remediation): stamp an explicit recurrence owner on a minted act case".

**Done when:**
- [test] `reconcileRemediationCases` given an unbound `act` row on `testQuality:F2` and `recurrenceOwnersByCaseRef` mapping its caseRef to `case-R` adds one open case with `recurrenceOf` exactly `['case-R']` and a reserved action effect with a fresh id, and the serialized `case-R` record is byte-identical to its bytes before the call.
- [test] Reconciling the same graph again against the resulting state converges on the minted case, with no second case, no second effect id and `recurrenceOf` unchanged.
- [test] When that row also carries `reRaise`, no record in the reconciled state has a `reRaise` key and the store version equals the version before the call.
- [test] Without `recurrenceOwnersByCaseRef`, the same row's `recurrenceOf` comes from exact-source owners only, exactly as before this change.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-reconciler.ts` — explicit recurrence owner input
- `src/conductor/test/engine/remediation-case-reconciler.test.ts` — reconciler tests

**Dependencies:** none

### Task 4: The coordinator routes a residual or undeclared rebind to BUILD
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` for every Done-when check below, with the real store and reconciler and a scripted judge.
2. Verify they fail (RED): today the bound row halts as `regressed`.
3. Implement: compute eligible ids from `prior.state.cases` and pass them to the validator. In the pre-reconciliation reuse loop, treat an eligible `halt-regression` row whose `reRaise.kind` is not `repeat` as a residual rebind: compute its lineage over its exact owners plus the bound id; under the limit rewrite it without `existingCaseId`, map its caseRef to the bound id in `recurrenceOwnersByCaseRef`, and keep its kind and bound id by caseRef. Add `reRaiseKind` and `boundCaseId` to the `remediation_case_reconciled` variant in `types/events.ts` and set them on the minted case's emission. Leave `classifyRemediationCaseReuse` unchanged so carry is still decided first.
4. Verify they pass (GREEN).
5. Commit: "feat(build-review): route a residual rebind of a resolved action case to BUILD as a recurrence".

**Done when:**
- [test] For a lap with `case-R` (one applied lineage attempt) and a bound `act` row on `case-R` with the residual declaration, `coordinateBuildReviewAdjudication` returns `{ ok: true, route: 'build' }`, the store gains one open `act` case N with source `testQuality:F2`, a reserved action effect with a fresh id and `recurrenceOf` exactly `['case-R']`, the serialized `case-R` record is byte-identical to its bytes before the lap, no record in the store has a `reRaise` key, the store version is unchanged, and no `remediation_semantic_repeat_halt` or `remediation_adjudication_failed` event is emitted.
- [test] In that lap exactly one `remediation_case_reconciled` event names N, carrying `recurrenceOf` `['case-R']`, `reRaiseKind` `residual-gap` and `boundCaseId` `case-R`, and the kickback ledger records exactly one charge, for N's effect id.
- [test] The same lap with no `reRaise` on the row returns route `build` with N stamped `recurrenceOf` `['case-R']`, and N's `remediation_case_reconciled` event carries `reRaiseKind` `undeclared` and `boundCaseId` `case-R`.
- [test] Running the coordinator again on the same judgement after that lap converges on N: the store has no second minted case and no second effect, N's `recurrenceOf` is unchanged, and the kickback ledger still holds exactly one charge.
- [test] With `case-R` carry-eligible and the residual declaration, the coordinator returns `{ ok: true }` (no halt), persists no new case and no effect, records no kickback charge, emits no `remediation_semantic_repeat_halt` or `remediation_adjudication_failed` event, and links `testQuality:F2` to `case-R` with outcome `carried`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — eligibility references, residual rebind routing
- `src/conductor/src/types/events.ts` — `remediation_case_reconciled` optional fields
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — coordinator tests

**Dependencies:** Task 2, Task 3

### Task 5: A residual rebind shares the lineage limit and halts at three applied attempts
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` for every Done-when check below.
2. Verify they fail (RED).
3. Implement: when a residual rebind's lineage reaches `BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT`, halt exactly as the existing recurrence-limit halt does: `recordHaltingBinding` of the bound row, a `remediation_semantic_repeat_halt` with reason `recurrence-limit`, `caseId` the bound case and `lineageCaseIds`, then `failUnlessAccepted` with the existing recurrence-limit detail. Add `reRaiseKind` to that variant in `types/events.ts` and set it on this halt.
4. Verify they pass (GREEN).
5. Commit: "feat(build-review): bound a residual rebind by the recurrence lineage limit".

**Done when:**
- [test] With `case-R`'s lineage holding three applied attempts and a residual declaration bound to `case-R`, the coordinator persists no new case or effect, links `testQuality:F2` to `case-R` with outcome `acted`, emits one `remediation_semantic_repeat_halt` with reason `recurrence-limit`, `caseId` `case-R`, `reRaiseKind` `residual-gap` and `lineageCaseIds` naming every lineage case, and fails with a detail beginning `semantic remediation case recurrence limit case-R` and containing `3 applied attempts (limit 3)`.
- [test] With that limit reached and `testQuality:F2` operator-accepted before the halt decision, the coordinator takes the acceptance-terminal exit: it returns ok, writes no halt and emits no `remediation_semantic_repeat_halt`.
- [test] After N, minted from `case-R`, is applied and resolved, a residual declaration bound to N mints M with `recurrenceOf` exactly N's id and returns route `build`, because the lineage checked for that row is `case-R` and N with two applied attempts.
- [test] After M is applied and resolved, a further residual declaration bound to M halts `recurrence-limit` with `lineageCaseIds` exactly `case-R`, N and M, which shows the lineage walk through every minted case.
- [test] With the residual declaration bound to `case-R` (one applied attempt) and the cumulative kickback budget exhausted, the coordinator fails with the existing kickback-cap detail from `applyBuildReviewActionEffects`, beginning `build-review kickback budget exhausted (cumulative)` and naming N's effect id, and neither that detail nor any emitted event contains `semantic remediation case regression`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — limit halt for a residual rebind
- `src/conductor/src/types/events.ts` — `remediation_semantic_repeat_halt.reRaiseKind`
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — limit and lineage tests

**Dependencies:** Task 4

### Task 6: A declared repeat halts as a regression and names its applied attempts
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` and `src/conductor/test/engine/event-sinks.test.ts` for every Done-when check below.
2. Verify they fail (RED).
3. Implement: for an eligible `halt-regression` row whose `reRaise.kind` is `repeat`, compute the bound case's lineage, add `declared repeat; lineage <ids> has <n> applied attempts` to the regression detail between the case id and the existing recovery text, and set `reRaiseKind` `repeat`, `lineageCaseIds` and `appliedAttempts` on its `remediation_semantic_repeat_halt`. Add `appliedAttempts` to that variant in `types/events.ts`.
4. Verify they pass (GREEN).
5. Commit: "feat(build-review): name the applied attempts of a declared repeat regression".

**Done when:**
- [test] With `case-R` (one applied attempt) and the repeat declaration bound to it, the coordinator persists no new case or effect, links `testQuality:F2` to `case-R` with outcome `acted`, and fails with a detail beginning `semantic remediation case regression case-R` that contains `declared repeat` and `lineage case-R has 1 applied attempts`.
- [test] That lap emits exactly one `remediation_semantic_repeat_halt` with reason `regressed`, `caseId` `case-R`, `reRaiseKind` `repeat`, `lineageCaseIds` `['case-R']` and `appliedAttempts` 1.
- [test] The flat-feature halt detail still contains `ai-conductor build-review accept --feature demo` and `--finding F2`, and the same lap run as stacked child 2 still contains `fix the finding on child 2`.
- [test] With `testQuality:F2` operator-accepted before the halt decision, the repeat lap takes the acceptance-terminal exit: the coordinator returns ok, writes no halt, and emits no `remediation_semantic_repeat_halt` or `remediation_adjudication_failed` event.
- [test] `event-sinks.test.ts` asserts the registered event type set is unchanged by this feature, and that a `remediation_case_reconciled` event with `reRaiseKind` and `boundCaseId` and a `remediation_semantic_repeat_halt` event with `reRaiseKind` and `appliedAttempts` route through the existing sink entries for those two types.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — declared-repeat halt detail and event fields
- `src/conductor/src/types/events.ts` — `remediation_semantic_repeat_halt.appliedAttempts`
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — repeat tests
- `src/conductor/test/engine/event-sinks.test.ts` — event registry assertion

**Dependencies:** Task 2

### Task 7: Failed-effect regressions, open-case repeats and unbound recurrences ignore `reRaise`
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write characterization tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` for every Done-when check below. They fail against pre-change code because its parser rejects any row carrying `reRaise` as `invalid-case-keys`.
2. Verify they fail (RED).
3. Implement nothing beyond Tasks 1–6 unless a check fails; a failure here is a defect in the eligibility rule of Task 2 or the routing condition of Task 4.
4. Verify they pass (GREEN).
5. Commit: "test(build-review): pin the regression, repeat and unbound lanes under reRaise".

**Done when:**
- [test] A bound `act` row on `case-X` with the residual declaration, and the same row without it, each make the coordinator fail with a detail beginning `semantic remediation case regression case-X`, emit a `remediation_semantic_repeat_halt` with reason `regressed` and no `reRaiseKind` key, and persist no new case.
- [test] A bound `act` row on `case-A`, with and without the residual declaration, makes the coordinator fail with a detail beginning `semantic remediation case repeat case-A` and emit reason `already-attempted`.
- [test] An unbound `act` row on `testQuality:F2` owned by `case-R`, with and without the residual declaration, mints N with `recurrenceOf` `['case-R']`, and N's `remediation_case_reconciled` event has no `reRaiseKind` key and no `boundCaseId` key.
- [test] For each of four rows (an unbound `act` row on `testQuality:F2`, an `act` row bound to `case-A`, an `act` row bound to `case-X`, a `defer` row bound to `case-R`), running the coordinator with the residual declaration and again without it yields deep-equal coordinator results, byte-identical case stores and deep-equal emitted event lists.

**Files likely touched:**
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — characterization tests

**Dependencies:** Task 4, Task 6

### Task 8: The conductor's build_review step sends the #3348 shape to BUILD
**Story:** Story 2, Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` for every Done-when check below, using its `remediateJudgements` harness and a fixture with prior case `26a04ec0` (resolved, applied effect `74d67e04`).
2. Verify they fail (RED): today the first check writes a `regressed` HALT.
3. Implement nothing beyond Tasks 1–5 unless a check fails; the production entry point is `applyBuildReviewOutcome`, which calls the coordinator with the judge that reads `.pipeline/remediation.json` through `readRemediationCaseJudgement`.
4. Verify they pass (GREEN).
5. Commit: "test(build-review): route the #3348 residual rebind through the build_review step".

**Done when:**
- [test] Through the conductor's build_review step with prior case `26a04ec0` and one `remediateJudgements` entry binding a new testQuality source to `26a04ec0` as `act` with Task-16-scoped tasks and no `reRaise`, no `.pipeline/HALT` is written and the BUILD work order the step publishes lists exactly the judgement's tasks.
- [test] For each of four `remediateJudgements` entries whose bound row carries a malformed `reRaise` (kind `maybe`, an empty reason, an 8,001-character reason, an extra key `note`), the step halts with `.pipeline/HALT` containing `remediate judgement failed: invalid-case-keys`, and the case store, the work-order store and `kickback-ledger.json` are byte-identical to their bytes before the step.

**Files likely touched:**
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — conductor-level tests

**Dependencies:** Task 5

### Task 9: The remediate skill contract states the `reRaise` rule
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediate-skill-contract.test.ts` for every Done-when check below.
2. Verify they fail (RED).
3. Implement: add the `reRaise` rule to the build_review case contract in `skills/remediate/SKILL.md`, next to the `distinctFrom` rule.
4. Verify they pass (GREEN).
5. Commit: "feat(remediate): declare reRaise on a bound re-raise of a resolved action case".

**Done when:**
- [test] The skill-contract test reads `skills/remediate/SKILL.md` and finds, in its build_review case contract, that a row with disposition `act` binding a resolved `act` case with an applied action effect may carry `reRaise` with kind `residual-gap` or `repeat` and a non-empty reason.
- [test] It finds that `residual-gap` routes the repair to BUILD under the lineage limit of three applied attempts, that `repeat` halts the lap, and that an absent `reRaise` is treated as a residual gap.

**Files likely touched:**
- `skills/remediate/SKILL.md` — `reRaise` rule in the build_review case contract
- `src/conductor/test/engine/remediate-skill-contract.test.ts` — contract test

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 4 ──▶ Task 5 ──▶ Task 8
              │          ▲  └──────────▶ Task 7
Task 3 ───────┼──────────┘                 ▲
              └──────▶ Task 6 ─────────────┘
Task 9 (independent)
```

## Integration Points

- After Task 4: a residual rebind reaches BUILD through the coordinator with the real store and reconciler.
- After Task 8: the #3348 shape runs through the conductor's build_review step end to end.

## Verification

- [ ] Every happy-path and negative-path criterion is covered by a task (see the coherence mapping).
- [ ] Every task has a `Done when:` block of falsifiable checks.
- [ ] Dependencies are explicit and acyclic.
- [ ] No task targets another feature's sealed artifact.
