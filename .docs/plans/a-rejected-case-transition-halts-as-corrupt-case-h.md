# Implementation Plan: A rejected case transition halts as corrupt case history

**Date:** 2026-10-10
**Stories:** .docs/stories/a-rejected-case-transition-halts-as-corrupt-case-h.md
**Conflict check:** Not required (Tier S)

## Summary

Make the remediation case store report a refused proposed next state as a typed rejected
transition with its violated invariant and offending case and source ids, carry that through the
reconciler and the build-review adjudication coordinator onto the existing
`remediation_adjudication_failed` event and the needs-human HALT, and prove recovery without
editing history. 5 tasks.

## Technical Approach

- **Store seam (Task 1).** `RemediationCaseStore.mutate` in
  `src/conductor/src/engine/remediation-case-store.ts` already parses persisted state in `load()`
  and the proposed state in `parseState(mutation.nextState)`; today both failures surface as the
  same `malformed-state`. Add `'rejected-transition'` to `RemediationCaseStoreFailureReason` and an
  exported `RemediationCaseTransitionViolation` type
  `{ invariant: 'source-linked-by-multiple-cases' | 'duplicate-case-id' | 'duplicate-effect-id' | 'invalid-next-state'; caseIds: readonly string[]; sourceIds: readonly string[] }`.
  `parseBuildReviewCases` records which check failed (the cross-case source check knows the prior
  owner case id, the current case id and the source id; the case-id and effect-id checks know their
  ids); `parseState` carries that as an optional `violation` on its failure. `load()` keeps
  returning only the existing reason (persisted-history reasons are unchanged). `mutate` maps any
  `parseState(nextState)` failure to `{ ok: false, reason: 'rejected-transition', violation }`,
  defaulting the violation to `invalid-next-state` with empty id lists when no specific check
  fired. The mutation failure variant of `RemediationCaseStoreMutationResult` gains optional
  `violation`. Nothing is written on rejection; the existing early return precedes `atomicReplace`.
- **Reconciler (Task 2).** `reconcileRemediationCases` in
  `src/conductor/src/engine/remediation-case-reconciler.ts` copies `mutation.violation` onto its
  `store-failure` result as optional `violation`.
- **Event and coordinator (Tasks 3, 4).** Extend the existing `remediation_adjudication_failed`
  member of the `ConductorEvent` union in `src/conductor/src/types/events.ts` with optional
  `rejectedTransition?: { invariant; caseIds; sourceIds }` (event-spine extension, no new channel;
  the sink row in `event-sinks.ts` is per type and stays persist-only). In
  `src/conductor/src/engine/build-review-adjudication-coordinator.ts`, `fail` accepts an optional
  violation and sets `rejectedTransition` on the event; one helper formats every case-store
  failure the coordinator reports (the `case store …`, `decision stop …` and
  `blocked consistency stop …` sites). For `rejected-transition` the detail reads
  `case transition rejected: <invariant> (cases <ids>; sources <ids>)` followed by
  `persisted case history is valid and unchanged` and the recovery sentence: inspect with
  `ai-conductor build-review findings --feature <slug>`, then clear with
  `ai-conductor halt clear --feature <slug> --rationale "<why>"` once the proposed transition is
  admissible (an engine that admits it or a judgement that no longer proposes it). Every other
  store reason keeps today's `case store <reason>` text. The conductor already prefixes
  `build_review adjudication halted:` and writes the HALT `needs-human`; no conductor change is
  expected.
- **Recovery proof (Task 5).** An integration test in
  `src/conductor/test/integration/remediation-case-recovery.integration.test.ts` drives the
  coordinator over one unedited store file across a rejected lap and a re-run.
- Other `mutate` callers (`remediation-case-effects.ts`, `build-review-suppression-history.ts`,
  `prd-widening-*.ts`) only propagate or stringify the reason and stay fail-closed; the read-only
  `readRemediationCaseStoreFeature` path never sees the new reason.

**Pattern context.** Existing store tests in `src/conductor/test/engine/remediation-case-store.test.ts`
inject an in-memory filesystem (`filesystem` option) and a lock; reuse that shape. Coordinator
tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` collect emitted
events through `emit`; conductor-level halt tests in
`src/conductor/test/engine/conductor-build-review-adjudication.test.ts` use the `fixture()` helper
and `run.haltMarker()`. Search hints: `malformed-state`, `haltMarker`, `remediation_adjudication_failed`.

## Prerequisites

- None.

## Tasks

### Task 1: The store types a refused next state as a rejected transition
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-store.test.ts` using the injected in-memory filesystem: (a) persisted store holding resolved case R linking source S, operation returns a next state adding case N also linking S; (b) persisted valid store, next state repeating a case id; (c) the same R and N both linking S written to disk as persisted state, read and mutated; (d) an invalid-JSON file read and mutated.
2. Verify RED: (a) and (b) currently return `malformed-state`.
3. Implement per Technical Approach: add `rejected-transition` and `RemediationCaseTransitionViolation`; record the failed check and ids in `parseBuildReviewCases`; map next-state parse failures in `mutate` to `rejected-transition` with the violation; leave `load` reasons unchanged.
4. Verify GREEN and commit: "fix(remediation): report a rejected case-store transition separately from corrupt history".

**Done when:**
- [test] `RemediationCaseStore.mutate` over fixture (a) returns reason `rejected-transition` with violation invariant `source-linked-by-multiple-cases`, caseIds containing both R and N, and sourceIds equal to [S], and that result is not any persisted-history reason.
- [test] `RemediationCaseStore.mutate` over fixture (b) returns reason `rejected-transition` with violation invariant `duplicate-case-id` and caseIds containing the repeated case id.
- [test] After the fixture (a) rejection the injected filesystem holds the store file byte-identical to its pre-mutation content, recorded no `writeFile` or `rename` call, and holds no `.tmp` file.
- [test] For fixture (c) both `read()` and `mutate()` return reason `malformed-state` with no violation, and for fixture (d) both return `malformed-json`.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** none

### Task 2: The reconciler carries the rejected transition's violation
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/remediation-case-reconciler.test.ts`: a valid store with resolved case R linking S and a validated graph whose unbound new case links S; `reconcileRemediationCases` result.
2. Verify RED (no `violation` field today).
3. Implement: copy `mutation.violation` onto the `store-failure` result as optional `violation`.
4. Verify GREEN and commit: "fix(remediation): carry the rejected transition through reconciliation".

**Done when:**
- [test] `reconcileRemediationCases` for that store and graph returns `{ ok: false, reason: 'store-failure', storeReason: 'rejected-transition' }` with a `violation` naming invariant `source-linked-by-multiple-cases`, R and the new case id, and S.
- [test] The same reconciliation leaves the store file byte-identical to its pre-call content.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-reconciler.ts
- src/conductor/test/engine/remediation-case-reconciler.test.ts

**Dependencies:** Task 1

### Task 3: The adjudication failure event names the rejected transition
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`: (a) store holding resolved case R linking S and a judgement proposing a new action case on S; (b) a persisted store file that itself links S from two cases.
2. Verify RED.
3. Implement per Technical Approach: add optional `rejectedTransition` to the `remediation_adjudication_failed` union member; let `fail` take the violation; route every coordinator case-store failure through one formatter that emits `case transition rejected: <invariant> (cases <ids>; sources <ids>)` for `rejected-transition` and keeps `case store <reason>` otherwise.
4. Verify GREEN and commit: "fix(remediation): name the rejected case transition on the adjudication failure event".

**Done when:**
- [test] `coordinateBuildReviewAdjudication` on fixture (a) emits exactly one `remediation_adjudication_failed` whose `reason` starts with `case transition rejected: source-linked-by-multiple-cases` and whose `rejectedTransition` has that invariant, caseIds containing R and the new case id, and sourceIds equal to [S].
- [test] On fixture (b) the emitted `remediation_adjudication_failed` has `reason` `case store malformed-state`, has no `rejectedTransition` field, and its reason does not contain `persisted case history is valid`.
- The `remediation_adjudication_failed` member of `ConductorEvent` in `src/conductor/src/types/events.ts` declares `rejectedTransition` as optional, and its `event-sinks.ts` row is unchanged (persist only).

**Files likely touched:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Task 2

### Task 4: The needs-human HALT says history is valid and names the recovery path
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` through the Conductor `fixture()` entry point: (a) a lap whose store holds resolved case R linking S and whose remediate judgement proposes a new action case on S; (b) a lap whose persisted store links S from two cases.
2. Verify RED (the HALT today reads `case store malformed-state`).
3. Implement in the coordinator's rejected-transition formatter: append `persisted case history is valid and unchanged` and the recovery sentence naming `ai-conductor build-review findings --feature <slug>` and `ai-conductor halt clear --feature <slug> --rationale "<why>"` once the proposed transition is admissible. Use no wording that directs deleting `.pipeline/remediation-cases.json` or accepting a finding.
4. Verify GREEN and commit: "fix(remediation): state valid history and the recovery path on a rejected-transition halt".

**Done when:**
- [test] For lap (a) the Conductor writes a HALT whose class is `needs-human` and whose text contains `build_review adjudication halted: case transition rejected: source-linked-by-multiple-cases`, R, the new case id, S, and `persisted case history is valid and unchanged`.
- [test] For lap (a) the HALT text contains `ai-conductor build-review findings` and `ai-conductor halt clear`, and contains neither `build-review accept` nor any instruction to delete or remove `remediation-cases.json`.
- [test] For lap (a) the store file after the halt is byte-identical to its content before the lap, and BUILD is not dispatched.
- [test] For lap (b) the HALT text contains `case store malformed-state`, its class is `needs-human`, and it contains neither `case transition rejected` nor `persisted case history is valid`.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/conductor-build-review-adjudication.test.ts

**Dependencies:** Task 3

### Task 5: Prove recovery of a rejected-transition halt against one unedited store
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write the test in `src/conductor/test/integration/remediation-case-recovery.integration.test.ts`: on a real temp directory, save a store holding resolved case R (applied effect) linking S; run a coordinator lap whose judgement proposes a new case on S and assert the rejected-transition failure; remove the HALT marker pair; (i) re-run with a lap whose judgement proposes an admissible transition (its new case links only a source that no case links yet) and (ii) separately re-run with the same rejected proposal.
2. Run it; it exercises behavior delivered by Tasks 1-4 and adds no production change.
3. Commit: "test(remediation): prove recovery from a rejected-transition halt keeps case history".

**Done when:**
- [test] After clearing the HALT, the admissible re-run reconciles successfully against the same store file and R's resolution, applied effect and S link are byte-identical in the resulting store to the saved store.
- [test] After clearing the HALT, the repeated proposal again returns `ok: false` from `coordinateBuildReviewAdjudication` and emits a `remediation_adjudication_failed` whose `rejectedTransition` names `source-linked-by-multiple-cases`, R, the new case id and S, and the store file stays byte-identical to the saved store.

**Files likely touched:**
- src/conductor/test/integration/remediation-case-recovery.integration.test.ts

**Verify-only:** yes

**Dependencies:** Task 4

## Task Dependency Graph

```text
Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5
```

## Integration Points

- After Task 4: a build-review lap with a rejected transition halts through the Conductor with the new diagnostic.
- After Task 5: a halted feature resumes by clearing its HALT with case history untouched.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the fixture, when the store applies the mutation proposing N, then it returns a rejected-transition failure distinct from every persisted-history failure and writes nothing. | 1 | "After the fixture (a) rejection the injected filesystem holds the store file byte-identical to its pre-mutation content, recorded no `writeFile` or `rename` call, and holds no `.tmp` file." | diff-local |
| Story 1 happy: Given the fixture, when the store returns that rejected-transition failure, then the failure names the violated invariant as a source linked from more than one case, names the case ids R and N, and names the source id S. | 1 | "`RemediationCaseStore.mutate` over fixture (a) returns reason `rejected-transition` with violation invariant `source-linked-by-multiple-cases`, caseIds containing both R and N, and sourceIds equal to [S], and that result is not any persisted-history reason." | diff-local |
| Story 1 happy: Given a valid persisted store and a proposed next state that repeats a case id, when the store applies the mutation, then it returns a rejected-transition failure naming that invariant and the repeated case id. | 1 | "`RemediationCaseStore.mutate` over fixture (b) returns reason `rejected-transition` with violation invariant `duplicate-case-id` and caseIds containing the repeated case id." | diff-local |
| Story 1 negative: Given a persisted store file that itself links S from two cases, when it is read or mutated, then the store still fails with the existing malformed-state reason and never with a rejected transition. | 1 | "For fixture (c) both `read()` and `mutate()` return reason `malformed-state` with no violation, and for fixture (d) both return `malformed-json`." | diff-local |
| Story 1 negative: Given a persisted store file that is not valid JSON, when it is read or mutated, then the store still fails with the existing malformed-json reason. | 1 | "For fixture (c) both `read()` and `mutate()` return reason `malformed-state` with no violation, and for fixture (d) both return `malformed-json`." | diff-local |
| Story 1 negative: Given the fixture, when the mutation is rejected, then the store file is byte-identical to its content before the mutation and no temporary file remains. | 1 | "After the fixture (a) rejection the injected filesystem holds the store file byte-identical to its pre-mutation content, recorded no `writeFile` or `rename` call, and holds no `.tmp` file." | diff-local |
| Story 2 happy: Given the fixture and a judgement proposing N, when build-review adjudication runs, then it emits `remediation_adjudication_failed` whose reason identifies a rejected case transition and whose structured fields carry the invariant, the case ids R and N, and the source id S. | 3 | "`coordinateBuildReviewAdjudication` on fixture (a) emits exactly one `remediation_adjudication_failed` whose `reason` starts with `case transition rejected: source-linked-by-multiple-cases` and whose `rejectedTransition` has that invariant, caseIds containing R and the new case id, and sourceIds equal to [S]." | diff-local |
| Story 2 happy: Given that failed adjudication, when the conductor halts the feature, then the needs-human HALT reason names the rejected transition, the invariant, R, N and S, and states that persisted case history is valid and unchanged. | 4 | "For lap (a) the Conductor writes a HALT whose class is `needs-human` and whose text contains `build_review adjudication halted: case transition rejected: source-linked-by-multiple-cases`, R, the new case id, S, and `persisted case history is valid and unchanged`." | diff-local |
| Story 2 happy: Given that HALT reason, when the operator reads it, then it names the recovery path and contains no instruction to delete case history or accept a finding. | 4 | "For lap (a) the HALT text contains `ai-conductor build-review findings` and `ai-conductor halt clear`, and contains neither `build-review accept` nor any instruction to delete or remove `remediation-cases.json`." | diff-local |
| Story 2 negative: Given a persisted store that is itself corrupt, when build-review adjudication runs, then the event and HALT still report a malformed case store, carry no rejected-transition fields, and never state that history is valid. | 3, 4 | "On fixture (b) the emitted `remediation_adjudication_failed` has `reason` `case store malformed-state`, has no `rejectedTransition` field, and its reason does not contain `persisted case history is valid`." | diff-local |
| Story 2 negative: Given a rejected transition, when the feature halts, then the halt class is needs-human and the case store bytes are unchanged. | 4 | "For lap (a) the store file after the halt is byte-identical to its content before the lap, and BUILD is not dispatched." | diff-local |
| Story 3 happy: Given a feature halted by the fixture's rejected transition, when the HALT is cleared and the next lap's judgement proposes an admissible transition, then the lap reconciles against the same store file and R keeps its resolution, applied effect and source link byte for byte. | 5 | "After clearing the HALT, the admissible re-run reconciles successfully against the same store file and R's resolution, applied effect and S link are byte-identical in the resulting store to the saved store." | diff-local |
| Story 3 negative: Given a feature halted by the fixture's rejected transition, when the HALT is cleared and the next lap proposes the same rejected transition, then adjudication fails closed again with the same rejected-transition diagnostic and the store file stays byte-identical. | 5 | "After clearing the HALT, the repeated proposal again returns `ok: false` from `coordinateBuildReviewAdjudication` and emits a `remediation_adjudication_failed` whose `rejectedTransition` names `source-linked-by-multiple-cases`, R, the new case id and S, and the store file stays byte-identical to the saved store." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
