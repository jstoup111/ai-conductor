# Implementation Plan: build_review remediate context scoped to the findings

**Date:** 2026-10-23
**Design:** [architecture review](../decisions/architecture-review-2026-10-23-build-review-remediate-context-grows-with-the-whol.md); [sequence](../architecture/build-review-remediate-context-grows-with-the-whol.md)
**Stories:** .docs/stories/build-review-remediate-context-grows-with-the-whol.md
**Conflict check:** Clean as of 2026-10-23

## Summary

This plan scopes the remediate adjudication context's plan-task bodies to the current findings and open cases, and adds an index of every task. It adds one bounded expansion round for an index-only admission and carries the provider's exit facts into the remediate halt. There are 9 tasks.

## Technical Approach

- **Selection is a pure function in the coordinator module.** `selectAdmittedTaskContracts` in `src/conductor/src/engine/build-review-adjudication-coordinator.ts` takes the plan text, the dispatched sources' match paths and the open cases' admitted task ids. It reuses the existing parsers `parsePlanTaskBodies`, `parsePlanTaskTitles` and `parsePlanTaskPaths` (`plan-task-parse.ts`) and the dependency parser in `plan-dependencies.ts`, and adds no new parser. A task body is selected when any of these holds:
  - its declared paths contain a dispatched source's match path. Match paths are the path portion of each `evidenceLocations` entry (the text before a trailing `:<line>` or `:<line>-<line>` suffix) plus the `anchor.locus.path` of the source's finding, looked up in the aggregate by `findingId`. The anchor path is the input `planContractPointers` matches, so every pointer-named task of a dispatched source is selected;
  - an open prior action case admitted it. Persisted case effects carry no tasks; the admitted ids live on the published work order (`BuildReviewWorkOrderTask.admittedTaskIds` in `build-review-work-order.ts`). The coordinator takes them from every row of the `publishedOrder` it already reads whose `caseId` names a prior case with `resolution: 'open'`, attempted or not.

  Every match is kept, unlike `planContractPointers`, which keeps only a unique match. The pointer output itself is unchanged. The local pattern is `planContractPointers` in `remediation-context-pointers.ts`: deterministic, plan-text-only, path-exact matching.
- **The plan read stays where it is, and both context assemblies get a scoped contract.** `sourcePlanContract` keeps reading and parsing the plan once. The coordinator assembles the context twice: once as the pre-dispatch fail-closed check (`context`) and again as `freshContext`. Both receive a scoped contract, never the full one. The first uses the current sources at that point, and the second uses `dispatchSources`. Otherwise the first assembly would still stop with `field-overflow` or `serialized-byte-overflow` on a large plan before selection runs. `dispatchSources` is the set left after operator-accepted, settled, suppressed and threshold-advisory sources are excluded. The validator's `admittedTaskIds` comes from the same scoped contract, so admission closure follows automatically.
- **The context gains `planContract.index`**, entries of `{ id, title, dependencies }`. It is bounded by new `LIMITS.maxPlanIndexEntries` (1024) and the existing per-field text limits. `maxAdmittedTaskContracts` (128) now bounds only the selected bodies.
- **The validator classifies an unknown admission.** `validateRemediationCaseGraph` takes an optional `planTaskIds` reference. Its `unknown-admission-task` rejection carries `indexOnlyTaskIds` and `absentTaskIds`. The validator returns at its first defect, so a new export, `classifyIndexOnlyAdmission`, re-validates with the index-only ids added to `admittedTaskIds`. It returns `{ kind: 'index-only', taskIds }` only when that re-validation succeeds and `absentTaskIds` is empty. Otherwise it returns `{ kind: 'other', reason }`, where `reason` is the re-validation's own rejection code (for example `missing-source`), or `unknown-admission-task` when ids are absent from the plan. This is a mechanical "only defect" test, not a parse of the reason text, and the halt reports the defect the re-validation found.
- **The expansion round is inside the coordinator, around the existing `input.judge` call.** A loop of at most two rounds runs only when `freshContext.context.mode === 'case-v2'`. Round 2 reassembles the context with the requested bodies added, under the same ceiling. Round 1's judgement is dropped before the operator-resolution re-read, reconciliation and effects, so nothing downstream changes. The expansion round sets `expansionTaskIds` on the existing `remediation_adjudication_started` event (`src/conductor/src/types/events.ts`).
- **Exit facts go from the step result to the halt.** `toStepRunResult` (`step-runners.ts`) already forwards `exitFacts`, and now also forwards `actualProvider` as `provider`. The conductor's remediate `judge` closure throws a `RemediateDispatchError` carrying the provider and facts. The coordinator's judgement-failed branch renders `remediate judgement failed` plus `formatProviderExitFacts(provider, facts)` and, on round 2, `(expansion round)`. The rendering is limited to the allowlisted `ProviderExitFacts` fields, so no raw stderr can reach the halt.
- **The skill contract** (`skills/remediate/SKILL.md`) tells the judge that index-only tasks may be cited, but admitting one costs an expansion round.

Sequencing: Tasks 1, 2 and 7 are independent foundations. Task 3 wires selection. Tasks 4–6 build the expansion on Tasks 1 and 3. Task 8 needs Task 7, and Task 9 documents the contract for the judge.

## Prerequisites

- jstoup111/ai-conductor#3298 (PR #3374) is merged. It edits the same coordinator, context and validator modules, and adds the threshold-advisory exclusion that Story 1 relies on. Land records this as a dependency.

## Tasks

### Task 1: Validator names index-only and absent admitted task ids
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-validator.test.ts`:
   - a case-v2 graph admitting only supplied ids validates ok;
   - a graph admitting supplied `3` and index-only `9` fails `unknown-admission-task` with `indexOnlyTaskIds: ['9']`;
   - an id `T-99` absent from `planTaskIds` lands in `absentTaskIds`;
   - a graph with index-only `9` plus an omitted dispatched source is classified by `classifyIndexOnlyAdmission` as `{ kind: 'other', reason: 'missing-source' }`;
   - a case-v1 graph validates unchanged with `planTaskIds` supplied.
2. Verify RED.
3. Implement:
   - add optional `planTaskIds` to `RemediationCaseValidationReferences`;
   - attach `indexOnlyTaskIds` and `absentTaskIds` to the `unknown-admission-task` rejection, computed over every act task in the graph;
   - export `classifyIndexOnlyAdmission(sourceIds, judgement, references, rejection)`. It re-runs `validateRemediationCaseGraph` with `admittedTaskIds ∪ indexOnlyTaskIds` and returns `{ kind: 'index-only', taskIds }` only when that run is ok and `absentTaskIds` is empty. Otherwise it returns `{ kind: 'other', reason }`, with the re-run's rejection code, or `unknown-admission-task` when `absentTaskIds` is non-empty.
4. Verify GREEN.
5. Commit: "feat(remediation): name unsupplied admitted task ids".

**Done when:**
- [test] `validateRemediationCaseGraph` returns ok for a case-v2 graph whose every act task admits only supplied ids, and returns `unknown-admission-task` with `indexOnlyTaskIds` equal to `['9']` for a graph admitting supplied `3` and index-only `9`, as asserted in `remediation-case-validator.test.ts`.
- [test] For an admitted id `T-99` absent from `planTaskIds`, validation fails with `unknown-admission-task` and the rejection lists `T-99` in `absentTaskIds` and not in `indexOnlyTaskIds`, and `classifyIndexOnlyAdmission` returns `{ kind: 'other', reason: 'unknown-admission-task' }`.
- [test] For a graph whose index-only admission of `9` is combined with an omitted dispatched source, `classifyIndexOnlyAdmission` returns `{ kind: 'other', reason: 'missing-source' }`, so the graph defect is the reported failure and the result is not classified as an index-only admission.
- [test] A case-v1 graph with `planTaskIds` supplied validates with the same result as without it, because the admission-closure check reads only case-v2 act tasks.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-validator.ts` — rejection ids and `classifyIndexOnlyAdmission`
- `src/conductor/test/engine/remediation-case-validator.test.ts` — tests

**Dependencies:** none

### Task 2: Pure task selection with a full plan index
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` for the exported `selectAdmittedTaskContracts`:
   - a 56-task plan fixture with one source at `src/a.ts:14`, where task 3 declares `src/a.ts`, selects only task 3 and indexes 56 ids with titles and dependency ids;
   - two tasks declaring `src/shared.ts` are both selected;
   - an open-case admitted id `12` selects task 12;
   - a source whose evidence paths match no task but whose finding anchor path `src/only7.ts` is declared only by task 7 selects task 7.
2. Verify RED.
3. Implement `selectAdmittedTaskContracts({ plan, matchPaths, openCaseAdmittedTaskIds })` in the coordinator module. Reuse `parsePlanTaskBodies`, `parsePlanTaskTitles` and `parsePlanTaskPaths`, plus the dependency parser in `plan-dependencies.ts`. Follow the `planContractPointers` traits: deterministic, plan-text-only and path-exact, but keep every matching task instead of only a unique one. Match paths are supplied by the caller: Task 3 derives them from evidence locations, stripping a trailing `:<line>` or `:<line>-<line>`, and from finding anchor paths. Sort the bodies and index by task id.
4. Verify GREEN.
5. Commit: "feat(build-review): select admitted task bodies from findings and open cases".

**Done when:**
- [test] `selectAdmittedTaskContracts` over the 56-task fixture returns bodies for task 3 only and an index of all 56 task ids, each carrying its title and its declared dependency ids.
- [test] Two tasks that both declare the finding's evidence path `src/shared.ts` are both returned with full bodies.
- [test] An open-case admitted id `12` selects task 12's full body, and a match path `src/only7.ts` declared only by task 7 selects task 7's full body.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — `selectAdmittedTaskContracts`
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — unit tests

**Dependencies:** none

### Task 3: Wire scoped bodies and the index into the adjudication context
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - in `build-review-adjudication-context.test.ts`: an `index` field assembles and serializes; more than 1024 index entries stops with `field-overflow` on `index`; and `path: null` yields empty bodies and an empty index.
   - in `build-review-adjudication-coordinator.test.ts` through `coordinateBuildReviewAdjudication`, with a fake judge capturing the context:
     - a 140-task plan whose findings touch 4 tasks assembles with 4 bodies and 140 index entries;
     - with a persisted case store holding an open action case and a published work order whose row for that case admits task 12, task 12's body is supplied, and the same case with `resolution: 'resolved'` supplies no body for task 12;
     - a source at `src/a.ts:14-20` matches task 3, which declares `src/a.ts`, and a finding whose anchor path is `src/only7.ts` supplies task 7;
     - an operator-accepted, settled, suppressed or advisory source's path selects no body;
     - a lap with no matching path supplies zero bodies and still calls the judge once;
     - the serialized `priorCases` is byte-identical to the pre-change projection for the same store;
     - an over-ceiling context stops with `serialized-byte-overflow` and makes zero judge calls.
2. Verify RED.
3. Implement:
   - add `index` to `BuildReviewAdjudicationPlanContract` and `LIMITS.maxPlanIndexEntries`, with validation in `build-review-adjudication-context.ts`;
   - in the coordinator, derive match paths from each source's `evidenceLocations` (line suffix stripped) and from its finding's `anchor.locus.path` (looked up in `input.aggregate` by `findingId`);
   - derive open-case admitted ids from every row of the already-read `publishedOrder` whose `caseId` names a `resolution: 'open'` prior case;
   - apply `selectAdmittedTaskContracts` to both assemblies: to the current sources for the pre-dispatch `context`, and to `dispatchSources` for `freshContext`. Neither assembly may receive the unscoped contract;
   - pass the scoped contract's ids as `admittedTaskIds` and the index ids as `planTaskIds` to `validateRemediationCaseGraph`.

   Update only those existing fixtures that asserted every plan body was supplied.
4. Verify GREEN, including the existing adjudication suites.
5. Commit: "feat(build-review): scope the remediate context to the findings".

**Done when:**
- [test] `coordinateBuildReviewAdjudication` hands the judge a context whose `planContract.admittedTaskContracts` holds the 4 selected tasks and whose `planContract.index` holds all 140 tasks, and both the pre-dispatch and the fresh assembly return ok rather than `field-overflow` on `admittedTaskContracts`.
- [test] Through `coordinateBuildReviewAdjudication` with a persisted case store and published work order, an open action case whose work-order row admits task 12 supplies task 12's full body, the same case with `resolution: 'resolved'` supplies none, and a source at `src/a.ts:14-20` or a finding anchored at `src/only7.ts` supplies task 3 or task 7 respectively.
- [test] A source that is operator-accepted, settled, suppressed or threshold-advisory contributes no task body, and a lap with no matching evidence path supplies zero bodies, a full index, and still calls the judge exactly once.
- [test] The judge context's serialized `priorCases` is byte-identical with and without scoping for the same case store, including cases that touch no supplied task; an over-ceiling context stops with `serialized-byte-overflow` naming actual and limit bytes and makes zero judge calls; and an unbound plan yields `path: null` with no bodies and no index entries.
- The existing `build-review-adjudication-context.test.ts`, `build-review-adjudication-coordinator.test.ts` and `conductor-build-review-adjudication.test.ts` suites pass, with only full-plan-body fixture assertions changed to the selected set.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-context.ts` — `index` field and limit
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — selection wiring and validator references
- `src/conductor/test/engine/build-review-adjudication-context.test.ts` — tests
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — tests

**Dependencies:** Task 1, Task 2

### Task 4: One expansion round recovers an index-only admission
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing coordinator tests with a fake judge. Round 1 admits index-only tasks `9` and `14` in case-v2, and round 2 returns a valid judgement. Assert:
   - exactly two judge calls;
   - the round-2 supplied ids equal the round-1 ids plus `9` and `14`, and the prior cases are unchanged;
   - the persisted case store and work order contain only round-2 cases;
   - the kickback charge equals a single-judgement lap's.
2. Verify RED.
3. Implement a bounded round loop (at most 2) around `input.judge`. After an invalid validation in case-v2, call `classifyIndexOnlyAdmission`. On `kind: 'index-only'`, reassemble the context with those bodies added (same `LIMITS`), discard round 1, and re-dispatch once. Reconciliation, effects and the charge run only on the accepted judgement.
4. Verify GREEN.
5. Commit: "feat(build-review): one bounded expansion round for index-only admission".

**Done when:**
- [test] The coordinator calls the fake judge exactly twice when round 1's case-v2 judgement fails only on index-only tasks `9` and `14`, and the second context's supplied task ids equal the first context's ids plus `9` and `14`, with an identical prior-case list.
- [test] After the recovered lap, the remediation case store and the published work order contain only cases from the round-2 judgement, and round 1 leaves no case, effect or work-order entry.
- [test] The recovered lap records the same kickback charge as a lap with one valid judgement, because `chargeInput` is applied once, after the accepted judgement.
- [test] A lap whose round-1 case-v2 judgement admits only supplied task ids makes exactly one judge call, and its reconciliation, case effects and published work order equal those of the same lap before this change.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — round loop
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — tests

**Dependencies:** Task 1, Task 3

### Task 5: Mark the expansion round on the event spine
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing coordinator test asserting two `remediation_adjudication_started` events for an expanded lap: round 1 without `expansionTaskIds`, and round 2 with `expansionTaskIds: ['14', '9']` sorted.
2. Verify RED.
3. Implement: add optional `expansionTaskIds?: string[]` to the `remediation_adjudication_started` variant in `src/conductor/src/types/events.ts`, and emit it from the coordinator's round-2 dispatch only.
4. Verify GREEN.
5. Commit: "feat(events): record remediate expansion rounds".

**Done when:**
- [test] An expanded lap emits two `remediation_adjudication_started` events through `input.emit`: the round-2 event carries `expansionTaskIds` listing tasks `9` and `14`, and the round-1 event has no `expansionTaskIds` key.
- [test] A single-round lap emits exactly one `remediation_adjudication_started` event with no `expansionTaskIds` key, as before this change.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — optional field
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — emit
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — tests

**Dependencies:** Task 4

### Task 6: Expansion bounds and refusals
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing coordinator tests:
   - round 2 again admits index-only `21`, so two judge calls are made and the halt names `unknown-admission-task` and `21`;
   - round 2 omits a source, so two calls are made and the existing `invalid remediation judgement` reason is used;
   - round 1 admits absent `T-99`, so one call is made and the halt names `T-99` as absent from the plan;
   - round 1 admits index-only `9` and omits a dispatched source, so one call is made and the halt reason is `invalid remediation judgement missing-source`;
   - a case-v1 invalid judgement makes one call and gives the unchanged halt;
   - adding the bodies overflows, so one call is made and the halt is `serialized-byte-overflow`;
   - every source is operator-accepted during round 2, so the lap finalizes operator-resolved with no reconciliation.
2. Verify RED.
3. Implement:
   - the loop never exceeds 2 rounds;
   - on `kind: 'other'`, the halt reason uses the classification's `reason`, plus the rejection's `indexOnlyTaskIds` and `absentTaskIds` when that reason is `unknown-admission-task`;
   - case-v1 skips classification;
   - a round-2 assembly stop returns the existing context-stop failure;
   - the existing operator re-read runs after whichever round's judgement is final.
4. Verify GREEN.
5. Commit: "test(build-review): bound the expansion round".

**Done when:**
- [test] When round 2 again admits index-only task `21`, the coordinator makes no third judge call and fails the lap needs-human with a reason containing `unknown-admission-task` and `21`; when round 2 has any other defect, the reason is the existing `invalid remediation judgement` one after exactly two calls.
- [test] A round-1 admission of `T-99`, absent from the plan, makes exactly one judge call and fails with a reason naming `T-99` as absent from the plan, and a case-v1 invalid judgement makes exactly one call with the reason unchanged from before this change.
- [test] When adding the requested bodies exceeds `maxSerializedBytes`, the coordinator makes no round-2 judge call and fails with `serialized-byte-overflow` naming actual and limit bytes.
- [test] A round-1 case-v2 judgement that admits index-only task `9` and also omits a dispatched source makes exactly one judge call and fails with the reason `invalid remediation judgement missing-source`, with no expansion round.
- [test] When every dispatched source becomes operator-accepted while round 2 runs, the lap finalizes as operator-resolved and neither round's judgement is reconciled or effected.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — bounds and reasons
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — tests

**Dependencies:** Task 4

### Task 7: Step results name the provider that produced exit facts
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/step-runners.test.ts`. It asserts that a `ProviderExecutionResult` with `actualProvider: 'claude'` and `exitFacts: { processErrorCode: 'E2BIG' }` maps to a `StepRunResult` with `provider: 'claude'` and the same `exitFacts`, and that a result with no `actualProvider` falls back to `preferredProvider`.
2. Verify RED.
3. Implement: add `provider?: string` to `StepRunResult` (`step-runner-types.ts`), and set it in `toStepRunResult` from `actualProvider ?? preferredProvider`.
4. Verify GREEN.
5. Commit: "feat(engine): carry the provider name on step results".

**Done when:**
- [test] `toStepRunResult` maps `actualProvider: 'claude'` with `exitFacts.processErrorCode: 'E2BIG'` to a `StepRunResult` whose `provider` is `claude` and whose `exitFacts` is unchanged.
- [test] A provider result without `actualProvider` yields `provider` equal to its `preferredProvider`, and a result without `exitFacts` carries no `exitFacts` key.

**Files likely touched:**
- `src/conductor/src/engine/step-runner-types.ts` — `provider` field
- `src/conductor/src/engine/step-runners.ts` — `toStepRunResult`
- `src/conductor/test/engine/step-runners.test.ts` — test

**Dependencies:** none

### Task 8: The remediate halt carries the provider's exit facts
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`, through the conductor's build_review outcome path with a stub step runner whose remediate result fails. Cover:
   - with `provider: 'claude'` and `exitFacts: { processErrorCode: 'E2BIG' }`, the HALT marker text contains `remediate judgement failed`, `claude` and `processErrorCode=E2BIG`;
   - with `exitCode: 137, signal: 'SIGKILL'`, the text contains `exitCode=137` and `signal=SIGKILL`;
   - with no exit facts, the text contains the provider and no `=` fact fields;
   - when the dispatch succeeds but the judgement file is missing, and separately when it is unparseable, the text names the judgement read failure and no exit facts;
   - with stub stderr and output containing the sentinel `/home/secret/token-abc`, the halt never contains it and holds only allowlisted fact keys;
   - when the round-2 dispatch fails, the text contains `expansion round` and that round's facts.
2. Verify RED.
3. Implement:
   - in `conductor.ts`'s `judge` closure, throw `RemediateDispatchError { provider, exitFacts }` when `dispatched.success` is false, keeping the judgement-read error distinct;
   - in the coordinator, catch that error type and render `remediate judgement failed: ${formatProviderExitFacts(provider, exitFacts ?? {})}`, plus `(expansion round)` on round 2;
   - any other error keeps its own message after `remediate judgement failed:`.
4. Verify GREEN.
5. Commit: "fix(build-review): name the provider and exit facts in remediate halts".

**Done when:**
- [test] A failed remediate dispatch reporting `provider: 'claude'` and `processErrorCode: 'E2BIG'` makes the conductor write a needs-human HALT marker whose text contains `remediate judgement failed: claude subprocess exited without a classifiable result: processErrorCode=E2BIG`, and one reporting `exitCode: 137` and `signal: 'SIGKILL'` yields text containing `remediate judgement failed: claude`, `exitCode=137` and `signal=SIGKILL`.
- [test] A failed dispatch without exit facts yields HALT text containing `remediate judgement failed` and the provider name and no `=` fact field, and a successful dispatch whose judgement file is missing or unparseable yields text naming the judgement read failure and no provider exit facts, each case asserted separately.
- [test] With the path and credential sentinel `/home/secret/token-abc` placed in the stub provider's raw stderr and output, the HALT text contains no part of the sentinel, and every `key=value` fact it contains has a key among `processErrorCode`, `exitCode`, `signal`, `stdoutBytes` and `stderrBytes`.
- [test] When the expansion round's dispatch fails, the HALT text contains `expansion round` and that round's exit facts.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `judge` closure error
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — failure rendering
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — tests

**Dependencies:** Task 4, Task 7

### Task 9: Remediate skill states the index and expansion contract
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write a failing assertion in `src/conductor/test/engine/remediate-skill-contract.test.ts`. The assertion requires the case-v2 section to state three things: `planContract.index` lists every task without a body; `admittedTaskIds` must name supplied bodies; and admitting an index-only task triggers at most one expansion round.
2. Verify RED.
3. Implement the case-v2 contract text in `skills/remediate/SKILL.md`.
4. Verify GREEN.
5. Commit: "docs(remediate): state the plan index and expansion round".

**Done when:**
- [test] The skill-contract test reads `skills/remediate/SKILL.md` and finds, in its case-v2 contract section, the statements that `planContract.index` lists every plan task without its body and that `admittedTaskIds` must name tasks whose bodies were supplied.
- [test] The same test finds the statement that admitting an index-only task causes at most one engine-run expansion round, after which an unsupplied admission halts.

**Files likely touched:**
- `skills/remediate/SKILL.md` — case-v2 contract text
- `src/conductor/test/engine/remediate-skill-contract.test.ts` — contract assertions

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ─┐
Task 2 ─┴─▶ Task 3 ─▶ Task 4 ─┬─▶ Task 5
                              ├─▶ Task 6
                              ├─▶ Task 9
Task 7 ───────────────────────┴─▶ Task 8
```

## Integration Points

- After Task 3: a real build_review lap hands remediate a scoped context through `coordinateBuildReviewAdjudication`.
- After Task 8: a failed remediate dispatch reaches the HALT marker with exit facts through the conductor's build_review outcome path.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Selection runs after the lap is classified; infrastructure-only versus mixed classification is untouched. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | task | task-4, task-6 | The coordinator calls the fake judge exactly twice when round 1's case-v2 judgement fails only on index-only tasks `9` and `14` |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-4 | round 1 leaves no case, effect or work-order entry |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | task | task-3 | A source that is operator-accepted, settled, suppressed or threshold-advisory contributes no task body |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | no-change | none | Settled-recurrence skips happen before any dispatch and are unchanged; settled sources select no task body. |
| adr-2026-09-10-portable-build-review-policy#D1 | no-change | none | The public gate and its declarations are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | Semantic identity resolution through installed-catalog adapters is untouched. |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | The bound policy bundle and its fingerprint are untouched; the plan contract is not part of the bundle. |
| adr-2026-09-10-portable-build-review-policy#D4 | no-change | none | The supported installed-policy contract is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D5 | no-change | none | Reviewer access and the frozen view are unchanged; no reviewer read or write path is added. |
| adr-2026-09-10-portable-build-review-policy#D6 | no-change | none | Candidate-preparation cache operations are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D7 | no-change | none | Result identity and the custom result contract are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D8 | task | task-2, task-3, task-4 | an open action case whose work-order row admits task 12 supplies task 12's full body |
| adr-2026-09-10-portable-build-review-policy#D9 | task | task-1, task-4, task-6 | the rejection lists `T-99` in `absentTaskIds` and not in `indexOnlyTaskIds` |
| adr-2026-09-10-portable-build-review-policy#D10 | no-change | none | The shared operation still invokes the adjudication coordinator once per lap; the expansion round is internal to that one invocation. |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-4 | The recovered lap records the same kickback charge as a lap with one valid judgement |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-5 | the round-2 event carries `expansionTaskIds` listing tasks `9` and `14` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
