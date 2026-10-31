# Implementation Plan: As-built review re-raises reworded findings as new obligations

**Date:** 2026-10-28
**Stories:** .docs/stories/as-built-review-re-raises-reworded-findings-as-new.md
**Conflict check:** Clean as of 2026-10-28, one blocking contradiction resolved in DECIDE (.docs/conflicts/2026-10-28-as-built-review-re-raises-reworded-findings-as-new.md)

## Summary

Reconcile each current as-built finding against prior as-built cases inside the existing remediate
`gap-plan` dispatch. Persist the result as an `as_built` domain in the shared remediation case
store. A reworded (`same`) or recurring finding binds its prior repair task instead of minting a new
one. Every as-built finding, including DESIGN and planner-halt findings, is recorded with its
relation and reason and emitted on the event spine. 14 tasks. Source: jstoup111/ai-conductor#3127.

## Technical Approach

- **Governing decision.** `adr-2026-10-28-as-built-finding-reconciliation` D1–D7.
  - **Applied unchanged:** `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
    D3.1 and D9, and `adr-2026-09-07-durable-prd-widening-decision-reconciliation` D2 and D6.4.
  - **Binding exclusions from the track marker:** PRD-audit reconciliation (#3126), cross-gate
    links (#2441), combined routing (#2060), corrupt-history recovery (#3128), and the build_review
    case and prd-widening-reconciliation remediate modes.
- **Store (D1).** Add `RemediationCaseAsBuiltRecord` with `domain: 'as_built'` and a fourth
  collection, `asBuiltCases`, in a new `v4` envelope in `remediation-case-store.ts`. Upgrade
  `v1`–`v3` states at the mutation seam the way `appendRemediationCaseOutbox` upgrades to `v3`
  today: carry every collection, suppression and outbox entry, and start `asBuiltCases` empty.
  Widen `RemediationCaseDomain` in `remediation-case-artifact.ts`, and parse the collection with
  its own exact-keys parser.
  - **Pattern to follow:** the `prd_widening` record. It is a domain-tagged, effect-free record
    parsed by its own exact-keys function, and selected by a `selectPrdWideningRemediationCases`
    style filter. Mirror its traits: exact keys, bounded strings, a domain guard, and
    `malformed-state` on any violation.
  - **Allowed variation:** the field set, which ADR D1 fixes.
  - **Search hints:** `parsePrdWideningRecord`-style parse near `parseRemediationCaseDomainRecord`,
    and `withPrdWideningCases`.
- **Pure helpers.** These live in a new module, `as-built-case-reconciliation.ts`, beside the
  store. `recordAsBuiltReconciliation` joins `same` and `recurrence` sources to the prior case,
  increments the recurrence count on `recurrence`, and creates a case for `materially-changed`
  (with `changedFrom`) and `new`. Recording a finding id already present is a no-op.
  `recordAsBuiltNeedsHuman` and `resolveOpenAsBuiltCases` complete the lifecycle. They are pure
  `state → state` functions that also append outbox entries, applied through
  `RemediationCaseStore.mutate` so the store lease serializes writers.
- **Projection (D2).** `buildRemediationProjection` adds `priorAsBuiltCases` only when the request
  includes as-built. It is measured against a new named limit `priorAsBuiltCasesBytes` with fault
  dimension `prior-as-built-cases`, and never truncated. `projectActiveTasks` adds each prior
  case's repair task ids to the projected task context. An undeclared id is a preparation fault.
- **Contract (D3, D4).** `REMEDIATION_PLAN_SCHEMA` gains an optional `reconciliation` object on
  dispositions. `validateRemediationPlan` requires it on `as-built-finding` references only and
  rejects it elsewhere. It checks the relation set, the `priorCaseId` rules, and the non-empty
  reason. For `same` and `recurrence` it checks the disposition (`existing-task` or `halt`), at
  least one prior repair task bound, and the owner still bound. Non-owner ids are admitted only
  when they are repair tasks of the named prior case.
- **Admission and recording (D4, D6).** In `conductor.ts` `planRemediation`, after the existing
  append or `existing-task` binding succeeds, the engine records cases through the helpers. A
  store write failure halts `needs-human` before BUILD dispatch.
  - **DESIGN halts:** both DESIGN halt sites, the validation-group join and the serial as-built
    branch, call one `recordAsBuiltDesignHalt` method before `writeHaltMarker`.
  - **Planner halt:** a planner `halt` disposition records `needs-human`.
- **Gate pass (D6).** `projectPendingAsBuiltRemediationFindings` is the single seam both gate-pass
  paths already call. It also resolves open `as_built` cases.
- **Spine (D7).** A new `as_built_finding_reconciled` variant in `types/events.ts` joins
  `RemediationCaseOutboxEvent`. The helpers append one outbox entry per recorded source in the
  same state transition as the case write. `conductor.ts` drains with `drainRemediationCaseOutbox`
  and `this.events.emitOrThrow` right after each recording mutation and before each as-built
  projection, so a crash between the two replays the same `eventId`.
- **Skill.** `skills/remediate/SKILL.md` gap-plan guidance explains the four relations and the
  binding rule. Output format stays engine-owned.

## Prerequisites

- None. #2748 and #2522 are merged, and the shared store already carries two domains.

## Tasks

### Task 1: Persist the as_built record domain in the shared case store
**Story:** Story 6
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `remediation-case-store.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `RemediationCaseAsBuiltRecord` (fields per ADR D1: id, `domain: 'as_built'`, sources each with findingId, attemptId, class, reference, summary, relation or `needs-human`, reason, priorCaseId optional; status `open`, `resolved` or `needs-human`; repairTaskIds; changedFrom optional; recurrenceCount), add the `v4` envelope with an `asBuiltCases` collection and its mutation-seam upgrade from `v1`–`v3`, move every current-version check (including `build-review-cli.ts`'s pending-outbox display and the tests that narrow a mutated store to `v3`, such as `prd-widening-offers.test.ts` and `conductor-prd-widening-routing.test.ts`) to the current version, widen `RemediationCaseDomain`, and add an exact-keys `asBuiltCases` parser, mirroring the `prd_widening` record's parse traits (exact keys, bounded strings, domain guard, `malformed-state` on violation). Add `selectAsBuiltRemediationCases`.
4. Verify GREEN and commit.

**Done when:**
- [test] `RemediationCaseStore.mutate` writing an `as_built` record with two sources, status `open`, repairTaskIds and recurrenceCount 1 is followed by `read()` returning those exact values, and `selectAsBuiltRemediationCases` returns only that record.
- [test] A `v3` fixture store holding one `build_review` case, one `prd_widening` record, one suppression and one pending outbox entry, mutated to add one `as_built` record, is written as `v4` with each pre-existing record, suppression and outbox entry serialized byte-identically and `asBuiltCases` holding the new record.
- [test] `read()` of a `v3` store returns no as-built cases, and a non-`as_built` record placed in `asBuiltCases` returns reason `foreign-domain`.
- [test] After a mutation upgrades a store to `v4`, the build-review findings CLI still lists its pending outbox entries, and `prd-widening-offers.test.ts` and `conductor-prd-widening-routing.test.ts` pass against the current version.
- [test] `read()` of an `as_built` record with an unknown status, an empty source reason, an extra key, or a non-integer recurrenceCount returns reason `malformed-state`.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/src/engine/remediation-case-artifact.ts; src/conductor/src/engine/build-review-cli.ts; src/conductor/test/engine/remediation-case-store.test.ts; src/conductor/test/engine/prd-widening-offers.test.ts; src/conductor/test/engine/conductor-prd-widening-routing.test.ts

### Task 2: Pure as-built case reconciliation helpers
**Story:** Story 6
**Type:** infrastructure
**Dependencies:** Task 1

**Steps:**
1. Write failing unit tests in a new `as-built-case-reconciliation.test.ts` for `recordAsBuiltReconciliation`, `recordAsBuiltNeedsHuman` and `resolveOpenAsBuiltCases`.
2. Verify RED.
3. Implement them in `as-built-case-reconciliation.ts` as pure functions over the store state. Each returns the next state, with one `as_built_finding_reconciled` outbox entry per recorded source appended in that same state, plus the list of recorded sources. `same` and `recurrence` append the source to the prior case and set it `open`, and `recurrence` increments recurrenceCount. `materially-changed` creates a case with `changedFrom`, and `new` creates a case. A finding id already recorded is skipped and not returned. Case ids are engine-stamped (`as-built-case:` plus a UUID).
4. Verify GREEN and commit.

**Done when:**
- [test] `recordAsBuiltReconciliation` given prior `resolved` case c1 and results `same`→c1, `recurrence`→c1, `materially-changed`→c1, `new` returns c1 `open` with both sources and recurrenceCount increased by exactly one, one new case with `changedFrom` c1, and one new case with no `changedFrom`.
- [test] `recordAsBuiltReconciliation` appends one outbox entry per recorded source carrying finding id, case id, attempt, outcome, priorCaseId when present and reason, and applied twice with the same results returns an identical state, with no new outbox entry, the second time and an empty recorded-source list.
- [test] `recordAsBuiltNeedsHuman` records every given finding as a source of a new case with status `needs-human` and outcome `needs-human`, and `resolveOpenAsBuiltCases` sets every `open` case `resolved` while leaving `needs-human` and `resolved` cases unchanged.

**Files:** src/conductor/src/engine/as-built-case-reconciliation.ts; src/conductor/test/engine/as-built-case-reconciliation.test.ts

### Task 3: Project prior as-built cases and their repair tasks into the gap plan
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `remediation-projection.test.ts` covering Story 1's happy paths and negative paths.
2. Verify RED.
3. Implement in `buildRemediationProjection`. When the request includes as-built, read the store, select `as_built` cases, and render `priorAsBuiltCases`. Each case carries id, status, recurrenceCount, sources (summary, reference, relation, reason), and repair tasks with their resolution from task-status. Add the repair task ids to `projectActiveTasks`' id set. Add `priorAsBuiltCasesBytes` to the named limits with fault dimension `prior-as-built-cases`. Never truncate. An unreadable or malformed store, or a repair task id the active plan does not declare, is a preparation fault. Omit the key entirely when as-built is not included. Increment `REMEDIATION_PROJECTION_VERSION` to 2, since the deterministic input contract changes, and update the version-1 fixture in `step-runners-remediate-gap-plan.test.ts` and the exact limit-object and total-envelope assertions in `remediation-projection-limits.test.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `buildRemediationProjection` over a store with one `open` case (unresolved `rem-as-built-t1`) and one `resolved` case (resolved repair task) lists both with case id, status, recurrenceCount, each source's summary, reference, relation and reason, and each repair task id with its resolution, and puts both repair tasks with title and Done-when checks in `tasks` beside the owner tasks.
- [test] `buildRemediationProjection` with no `as_built` cases returns `priorAsBuiltCases: []` and ok, and over a store also holding `build_review` cases, including one with an operator acceptance, and `prd_widening` records projects none of them as prior as-built cases.
- [test] `buildRemediationProjection` returns a fault with dimension `prior-as-built-cases`, the actual byte size and the limit when the cases exceed `priorAsBuiltCasesBytes`, and the fault result carries no projection, so no dispatch can be made from it and no case is truncated.
- [test] `buildRemediationProjection` returns a preparation fault naming the undeclared task id when a case's repair task is absent from the active plan, and a fault naming the store as unreadable for a malformed `remediation-cases.json`, never an empty prior-case list.
- [test] For a PRD-audit-only request, the structured projection has no `priorAsBuiltCases` key and, with its `version` field set back to 1, serializes byte-identically to the projection built from the same fixture before this change; `REMEDIATION_PROJECTION_VERSION` is 2 and `remediation-projection-limits.test.ts` asserts the new `priorAsBuiltCasesBytes` limit within the total envelope.

**Files:** src/conductor/src/engine/remediation-projection.ts; src/conductor/test/engine/remediation-projection.test.ts; src/conductor/test/engine/step-runners-remediate-gap-plan.test.ts; src/conductor/test/corpus/remediation-projection-limits.test.ts

### Task 4: Validate the reconciliation field on as-built dispositions
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 3

**Steps:**
1. Write failing tests in `remediation-plan-contract.test.ts` for Story 2's acceptance and each rejection diagnostic.
2. Verify RED.
3. Implement: add `reconciliation: { relation: enum same, recurrence, materially-changed, new; priorCaseId?: string; reason: string }` to `REMEDIATION_PLAN_SCHEMA` disposition items. In `validateRemediationPlan`, require it on `as-built-finding` references, reject it on every other reference kind, require a non-empty reason, require `priorCaseId` to name a projected `as_built` case for the three linked relations, and forbid it for `new`. Accepted dispositions retain the reconciliation. Update the shared plan fixtures and every existing test that builds an as-built disposition so each supplies a `new` reconciliation and keeps its original asserted diagnostic.
4. Verify GREEN and commit.

**Done when:**
- [test] `validateRemediationPlan` accepts a plan whose as-built dispositions carry `same`, `recurrence` and `materially-changed` naming projected case c1 and `new` with no priorCaseId, including two dispositions naming c1, and each accepted disposition retains its relation, priorCaseId and reason.
- [test] `validateRemediationPlan` accepts a mixed plan whose `prd-criterion` dispositions carry no reconciliation exactly as before, and rejects a `prd-criterion` disposition carrying one with a diagnostic stating reconciliation applies only to as-built findings.
- [test] `validateRemediationPlan` rejects, naming the field, an as-built disposition missing `reconciliation`, with a blank `reconciliation.reason`, with an unknown relation (diagnostic names the closed relation set), and a linked relation with no `priorCaseId` or an unknown one (diagnostic names `reconciliation.priorCaseId` and the unknown id).
- [test] `validateRemediationPlan` rejects a `new` relation carrying a priorCaseId with a diagnostic stating that `new` forbids a prior case id.
- [test] `renderRemediationPlanShape()` output contains `reconciliation`, `relation`, `priorCaseId` and each of the four relation values, and the existing as-built cases in `remediation-projection.test.ts`, `plan-growth-existing-task-restage.acceptance.test.ts` and `conductor-residue-routing-judge.test.ts` pass with a `new` reconciliation and their original asserted diagnostics.

**Files:** src/conductor/src/engine/remediation-plan-contract.ts; src/conductor/test/engine/remediation-plan-contract.test.ts; src/conductor/test/engine/remediation-plan-fixtures.ts; src/conductor/test/engine/remediation-projection.test.ts; src/conductor/test/acceptance/plan-growth-existing-task-restage.acceptance.test.ts; src/conductor/test/engine/conductor-residue-routing-judge.test.ts

### Task 5: Enforce relation-specific binding rules for same and recurrence
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 4

**Steps:**
1. Write failing tests in `remediation-plan-contract.test.ts` for each Story 3 binding rule and Story 4's owner-binding negative.
2. Verify RED.
3. Implement in `validateRemediationPlan`. `same` and `recurrence` admit only `existing-task` or `halt`. An `existing-task` must bind at least one repair task of the named prior case. For a plan-task-cited finding the owner must still be bound. Non-owner ids are admitted only when they are repair tasks of that prior case. `new` and `materially-changed` keep today's owner-only binding.
4. Verify GREEN and commit.

**Done when:**
- [test] `validateRemediationPlan` accepts a `recurrence` binding owner task `4` and `rem-as-built-t1` of c1, and a `same` with `halt`.
- [test] `validateRemediationPlan` rejects a `same` or `recurrence` with an appending disposition with a diagnostic stating the relation admits only `existing-task` or `halt`, and one binding none of c1's repair tasks with a diagnostic naming c1 and its repair task ids.
- [test] `validateRemediationPlan` rejects a plan-task-cited `recurrence` binding `rem-as-built-t1` without task `4` with a diagnostic naming owner task `4`, and one also binding an unrelated active task with a diagnostic naming that non-owner task id.
- [test] `validateRemediationPlan` rejects a `new` finding citing task `4` that binds another case's repair task instead of `4` with the existing owner-binding diagnostic naming task `4`.

**Files:** src/conductor/src/engine/remediation-plan-contract.ts; src/conductor/test/engine/remediation-plan-contract.test.ts

### Task 6: Admit same and recurrence rounds without growth and record their cases
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Tasks 2, 5

**Steps:**
1. Write failing conductor tests in `conductor-groups-and-signals.test.ts` driving a BLOCKED as-built verdict through the real `planRemediation` path with a stubbed remediate result.
2. Verify RED.
3. Implement in `planRemediation`: after the existing `existing-task` binding and restage succeed, apply `recordAsBuiltReconciliation` through `RemediationCaseStore.mutate`. Add the `as_built_finding_reconciled` variant to `ConductorEvent` (finding id, case id, attempt, outcome, priorCaseId optional, reason) and to `RemediationCaseOutboxEvent`, declare its sink in the exhaustive `EVENT_SINKS` registry in `event-sinks.ts`, add it to the exhaustive event fixtures in `audit-trail-completeness.integration.test.ts`, then drain with `drainRemediationCaseOutbox` and `this.events.emitOrThrow` right after the mutation.
4. Verify GREEN and commit.

**Done when:**
- [test] Through `planRemediation`, a `same` binding of `rem-as-built-t1` to open case c1 appends no block to the plan file, leaves `growth.byGate` unchanged, restages `rem-as-built-t1` `pending` in task-status, and records a lap-only pending repair for the as-built gate.
- [test] Through `planRemediation`, a `recurrence` binding of `rem-as-built-t1` to resolved case c1 appends no block, leaves growth unchanged, restages the task `pending`, and leaves c1 `open` with recurrenceCount increased by one in `.pipeline/remediation-cases.json`.
- [test] Through `planRemediation`, a plan-task-cited `recurrence` binding task `4` and `rem-as-built-t1` restages both `pending`, and a `same` answered `halt` and a `recurrence` answered `halt` each take the existing planner-halt path with no append or restage.
- [test] After an admitted round reconciling `same` and `recurrence`, each finding id is a source in `.pipeline/remediation-cases.json` carrying its relation, reason and attempt, and the store outbox is empty after the drain.
- [test] After an admitted round, `.pipeline/events.jsonl` holds one `as_built_finding_reconciled` line per as-built finding carrying finding id, case id, attempt, outcome, priorCaseId when present, and reason.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/types/events.ts; src/conductor/src/engine/remediation-case-store.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts; src/conductor/test/integration/audit-trail-completeness.integration.test.ts

### Task 7: Fail closed on restage failure and bound recurrence by the lap cap
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 6

**Steps:**
1. Write failing conductor tests for a restage failure on a `recurrence` binding and for recurrence rounds at the tier lap cap.
2. Verify RED.
3. Implement: order recording after a successful restage, so a failed restage writes no case. The existing D9 fail-closed restage halt stays in force. Confirm no recurrence-specific halt path exists.
4. Verify GREEN and commit.

**Done when:**
- [test] When the restage of a bound task fails, `planRemediation` writes a HALT, dispatches no BUILD, and leaves `.pipeline/remediation-cases.json` unchanged for that round.
- [test] Recurrence rounds at the Medium tier allowance end with the existing `kickback-cap` HALT whose text names tier `M` and allowance 3, and no HALT text contains `recurrence limit`.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts

### Task 8: Record materially-changed and new findings under today's accounting
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 6

**Steps:**
1. Write failing conductor tests for `materially-changed` with an append, `new` with an append, `new` with an owner `existing-task`, and growth exhaustion.
2. Verify RED.
3. Implement recording for these relations after the existing append or binding succeeds. Store the appended or bound task ids as the new case's repairTaskIds.
4. Verify GREEN and commit.

**Done when:**
- [test] Through `planRemediation`, a `materially-changed` append to c1 appends one `rem-as-built-*` block, writes a pending repair receipt drawing one growth unit while `growth.byGate` stays unchanged until its BUILD dispatch settles and then increases by one, and records a new case with `changedFrom` c1 whose repairTaskIds is that appended id.
- [test] After an admitted round reconciling `same`, `materially-changed` and `new`, each finding id is a source in `.pipeline/remediation-cases.json` carrying its relation, reason and attempt, and `.pipeline/events.jsonl` holds one `as_built_finding_reconciled` line for each of the three findings carrying finding id, case id, attempt, outcome, priorCaseId when present, and reason.
- [test] Through `planRemediation`, a `new` finding appends or binds its owner exactly as before this change, and a new case records that finding with its repair task ids.
- [test] A `materially-changed` append and a `new` append that each exceed the shared growth allowance end with the existing `kickback-cap` HALT at BUILD dispatch, with text identical to an appending disposition's before this change.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts

### Task 9: Record DESIGN-halt and planner-halt findings as needs-human
**Story:** Story 6
**Type:** happy-path
**Dependencies:** Task 6

**Steps:**
1. Write failing conductor tests for a BLOCKED verdict with one DESIGN and one REMEDIABLE finding, on both the validation-group join path and the serial as-built path, and for a planner `halt` disposition.
2. Verify RED.
3. Implement a `recordAsBuiltDesignHalt` conductor method that applies `recordAsBuiltNeedsHuman` and emits events. Call it before `writeHaltMarker` at both `blocked-design` halt sites. The planner-halt branch in `planRemediation` records its `halt`-answered findings the same way.
4. Verify GREEN and commit.

**Done when:**
- [test] On the validation-group join path, a BLOCKED verdict with one DESIGN and one REMEDIABLE finding records both as sources of `needs-human` cases and persists one `as_built_finding_reconciled` event with outcome `needs-human` per finding before the HALT file exists.
- [test] On the serial as-built path, the same verdict produces the same `needs-human` cases and events before the HALT file exists.
- [test] Through `planRemediation`, an as-built finding answered `halt` is recorded with status `needs-human` and its event is persisted.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts

### Task 10: Resolve open cases only at a fresh as-built gate pass
**Story:** Story 5
**Type:** happy-path
**Dependencies:** Task 6

**Steps:**
1. Write failing tests for the gate-pass resolution and for BLOCKED verdicts after reconciled laps.
2. Verify RED.
3. Implement: call `resolveOpenAsBuiltCases` inside `projectPendingAsBuiltRemediationFindings`, the seam both gate-pass paths already use. Make no change to `asBuiltOutcome`, the as-built gate predicate, or routing.
4. Verify GREEN and commit.

**Done when:**
- [test] After reconciled `same` and `recurrence` laps, an `APPROVED` as-built verdict marks the gate done and sets every `open` `as_built` case `resolved` in the same `projectPendingAsBuiltRemediationFindings` call that clears pending findings.
- [test] A `BLOCKED` verdict after reconciled laps, including one whose findings all match `resolved` cases, leaves the as-built gate predicate not done, keeps the verdict BLOCKED, and routes through the same `planRemediation` path as with an empty store.
- [test] A store holding operator-accepted `build_review` cases and `prd_widening` records leaves the as-built gate outcome unchanged from an empty store's for both a BLOCKED verdict (not done) and an APPROVED verdict (done), and a prior-contract-version as-built verdict creates or resolves no `as_built` case.
- [test] A prior-contract-version as-built verdict is not authoritative: the as-built gate predicate is not done and the as-built step is re-dispatched exactly as before this change.
- [test] A later as-built run on the same feature lists a case resolved at an earlier gate pass in its `gap-plan` projection.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts

### Task 11: Halt on store write failure and stay idempotent on replay and contention
**Story:** Story 6
**Type:** negative-path
**Dependencies:** Task 6

**Steps:**
1. Write failing tests that inject a store write failure after a successful binding, replay an admitted round after a simulated restart, and race an as-built write against a `prd_widening` write.
2. Verify RED.
3. Implement: a failed `mutate` after a successful append or binding halts `needs-human`, naming the store write fault, before BUILD dispatch. Replay relies on the helper's finding-id no-op. Writes go through `RemediationCaseStore.mutate`'s existing lease. Add `as_built_finding_reconciled` to `REMEDIATION_CASE_OCCURRENCE_TYPES` in `event-persister.ts` so a replayed `eventId` is deduplicated. In `planRemediation`, drain the case-store outbox before building an as-built `gap-plan` projection, so a pending entry left by a crash is delivered on the next production pass.
4. Verify GREEN and commit.

**Done when:**
- [test] When `RemediationCaseStore.mutate` rejects after a successful append, and again when it rejects after a successful binding, the HALT text names the remediation case store write fault, its class is `needs-human`, and no BUILD dispatch is recorded.
- [test] Replaying the same admitted round after a simulated restart leaves each finding id appearing once as a source and emits no further `as_built_finding_reconciled` event naming a new case.
- [test] When the process stops after a recording mutation but before its drain, the next as-built `planRemediation` drains the case-store outbox before building its projection, delivering each pending `as_built_finding_reconciled` entry with its original `eventId`, and after `EventPersister` receives the same `eventId` again `.pipeline/events.jsonl` holds each exactly once.
- [test] Concurrent `mutate` calls adding an `as_built` case and a `prd_widening` record both persist, and a subsequent `read()` returns both records.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/as-built-case-reconciliation.ts; src/conductor/src/engine/event-persister.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts; src/conductor/test/engine/as-built-case-reconciliation.test.ts; src/conductor/test/engine/event-persister.test.ts

### Task 12: Record nothing for a rejected, missing, or unapplied plan
**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 6

**Steps:**
1. Write failing conductor tests in which remediate returns a reconciliation-invalid plan on every attempt, returns no plan, or returns a valid plan whose append fails.
2. Verify RED.
3. Implement: recording runs only after the append or binding succeeds. Retry exhaustion takes the existing no-plan handling and keeps the last rejection diagnostics in the halt reason.
4. Verify GREEN and commit.

**Done when:**
- [test] When every remediate attempt returns a reconciliation-invalid plan, the round takes the existing no-plan handling, appends no task, and its HALT text contains the last rejection's diagnostic naming the `reconciliation` field.
- [test] For a rejected plan, a missing plan, a valid plan whose append fails, or a valid plan whose `existing-task` binding fails, `.pipeline/remediation-cases.json` gains no `as_built` case or source for that round, every pre-existing `as_built` case is byte-identical to its seeded serialization, and `.pipeline/events.jsonl` gains no `as_built_finding_reconciled` line.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts

### Task 13: Teach gap-plan reconciliation in the shared remediate skill
**Story:** Story 2
**Type:** infrastructure
**Dependencies:** Task 4

**Steps:**
1. Add gap-plan judgement guidance to `skills/remediate/SKILL.md` defining `same`, `recurrence`, `materially-changed` and `new`, the non-empty reason, and the rule that `same` and `recurrence` bind a prior case's repair task through `existing-task` or answer `halt`.
2. Do not restate the output schema, which stays engine-owned and is rendered from `REMEDIATION_PLAN_SCHEMA`. Per `HARNESS.md`, add no test that matches the guidance wording; Task 4's schema and validator tests own the executable contract.
3. Commit.

**Done when:**
- The `skills/remediate/SKILL.md` diff adds gap-plan guidance that defines each of `same`, `recurrence`, `materially-changed` and `new`, states that the reason must be non-empty, and states that `same` and `recurrence` bind a prior case's repair task through `existing-task` or answer `halt`.
- The `skills/remediate/SKILL.md` diff adds no JSON schema block and no new test file matches its wording.

**Files:** skills/remediate/SKILL.md

### Task 14: Halt before dispatch when the prior-case projection faults
**Story:** Story 1
**Type:** negative-path
**Dependencies:** Task 3

**Steps:**
1. Write failing conductor tests in `conductor-groups-and-signals.test.ts` that drive a BLOCKED as-built verdict through `planRemediation` with an empty store, an oversize case set, a case naming an undeclared repair task, a present but unreadable store file, and a malformed store file.
2. Verify RED.
3. Implement: route every `buildRemediationProjection` fault from Task 3 through the existing preparation-fault halt in `planRemediation`, so no remediate dispatch is made and the HALT is `needs-human` with the fault detail. An empty prior-case list is not a fault.
4. Verify GREEN and commit.

**Done when:**
- [test] Through `planRemediation`, a BLOCKED as-built verdict with no `as_built` cases dispatches remediate `gap-plan` exactly once and its rendered input contains `priorAsBuiltCases` as an empty list.
- [test] Through `planRemediation`, an oversize prior-case set makes no remediate dispatch and writes a `needs-human` HALT whose text names `prior-as-built-cases`, the actual byte size and the limit.
- [test] Through `planRemediation`, a case naming a repair task the active plan does not declare makes no remediate dispatch and writes a `needs-human` HALT naming that task id.
- [test] Through `planRemediation`, a present `remediation-cases.json` that cannot be read and one that is malformed each make no remediate dispatch and write a `needs-human` HALT naming the store as unreadable.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-groups-and-signals.test.ts

## Task Dependency Graph

```
Task 1 ─┬─> Task 2 ─────────────────────────┐
        └─> Task 3 ─┬─> Task 4 ─┬─> Task 5 ─┴─> Task 6 ─┬─> Task 7
                    └─> Task 14
                              └─> Task 13              ├─> Task 8
                                                        ├─> Task 9
                                                        ├─> Task 10
                                                        ├─> Task 11
                                                        └─> Task 12
```

## Integration Points

- **After Task 6:** a reworded as-built finding drives the real `planRemediation` path end to end:
  no growth, the bound repair restaged, the case recorded, and the event persisted.
- **After Task 9:** DESIGN halts on both paths leave traceable `needs-human` cases.
- **After Task 10:** the gate-pass lifecycle closes cases, and later laps see them as history.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose remediation case store holds two `as_built` cases, one `open` with an unresolved `rem-as-built-*` repair task and one `resolved` with a resolved repair task, when a BLOCKED as-built verdict contributes REMEDIABLE findings to a `gap-plan` dispatch, then the rendered projection lists both cases with their case id, status, recurrence count, every source's summary, typed reference, relation and reason, and each repair task id with its current resolution. | 3 | "lists both with case id, status, recurrenceCount, each source's summary, reference, relation and reason, and each repair task id with its resolution" | diff-local |
| Story 1 happy: Given a prior `as_built` case whose repair task is an appended `rem-as-built-*` task cited by no current finding, when the `gap-plan` projection is built, then that repair task appears in the projected task context with its title and Done-when checks alongside the owner tasks. | 3 | "puts both repair tasks with title and Done-when checks in `tasks` beside the owner tasks" | diff-local |
| Story 1 happy: Given a feature with no `as_built` cases in its store, when a BLOCKED as-built verdict contributes REMEDIABLE findings to a `gap-plan` dispatch, then the projection carries an empty prior-case list and the dispatch proceeds. | 14, 3 | "a BLOCKED as-built verdict with no `as_built` cases dispatches remediate `gap-plan` exactly once and its rendered input contains `priorAsBuiltCases` as an empty list" | diff-local |
| Story 1 negative: Given prior `as_built` cases whose rendered bytes exceed the projection's named limit, when the `gap-plan` projection is built, then no remediate dispatch runs, no case is dropped or truncated, and the feature halts `needs-human` with a preparation fault naming the prior-as-built-cases dimension, its actual size and its limit. | 14, 3 | "an oversize prior-case set makes no remediate dispatch and writes a `needs-human` HALT whose text names `prior-as-built-cases`, the actual byte size and the limit" | diff-local |
| Story 1 negative: Given a prior `as_built` case naming a repair task id that the active plan no longer declares, when the `gap-plan` projection is built, then no remediate dispatch runs and the feature halts `needs-human` with a preparation fault naming that task id. | 14, 3 | "a case naming a repair task the active plan does not declare makes no remediate dispatch and writes a `needs-human` HALT naming that task id" | diff-local |
| Story 1 negative: Given a remediation case store that is present but unreadable or malformed, when the `gap-plan` projection is built for an as-built verdict, then no remediate dispatch runs and the preparation fault names the store as unreadable instead of projecting an empty prior-case list. | 14, 3 | "a present `remediation-cases.json` that cannot be read and one that is malformed each make no remediate dispatch and write a `needs-human` HALT naming the store as unreadable" | diff-local |
| Story 1 negative: Given only a PRD-audit FIXABLE verdict and no as-built verdict in the round, when the `gap-plan` projection is built, then it carries no prior-as-built-cases section and, apart from its projection version, it is byte-identical to the same projection built without this feature. | 3 | "the structured projection has no `priorAsBuiltCases` key and, with its `version` field set back to 1, serializes byte-identically to the projection built from the same fixture before this change" | diff-local |
| Story 2 happy: Given a `gap-plan` projection with prior `as_built` case `c1`, when the planner returns one disposition per as-built finding, each with a `reconciliation` of relation `same`, `recurrence` or `materially-changed` naming `priorCaseId` `c1`, or relation `new` with no `priorCaseId`, each with a non-empty reason, then `validateRemediationPlan` accepts the plan and every accepted disposition retains its relation, prior case id and reason. | 4 | "each accepted disposition retains its relation, priorCaseId and reason" | diff-local |
| Story 2 happy: Given a round with both PRD-audit FIXABLE criteria and as-built REMEDIABLE findings, when the planner answers the `prd-criterion` references without any `reconciliation` field, then those dispositions are accepted exactly as before this feature. | 4 | "accepts a mixed plan whose `prd-criterion` dispositions carry no reconciliation exactly as before" | diff-local |
| Story 2 happy: Given two current as-built findings that restate one prior case, when both dispositions name the same `priorCaseId`, then the plan is accepted. | 4 | "including two dispositions naming c1" | diff-local |
| Story 2 negative: Given an as-built finding disposition with no `reconciliation` field, when the plan is validated, then it is rejected with a diagnostic naming that disposition's `reconciliation` field. | 4 | "rejects, naming the field, an as-built disposition missing `reconciliation`" | diff-local |
| Story 2 negative: Given an as-built finding disposition whose reconciliation reason is empty or whitespace, when the plan is validated, then it is rejected with a diagnostic naming the `reconciliation.reason` field. | 4 | "with a blank `reconciliation.reason`" | diff-local |
| Story 2 negative: Given an as-built finding disposition with relation `same`, `recurrence` or `materially-changed` and either no `priorCaseId` or a `priorCaseId` that names no `as_built` case in the projection, when the plan is validated, then it is rejected with a diagnostic naming `reconciliation.priorCaseId` and the unknown id when one was given. | 4 | "a linked relation with no `priorCaseId` or an unknown one (diagnostic names `reconciliation.priorCaseId` and the unknown id)" | diff-local |
| Story 2 negative: Given an as-built finding disposition with relation `new` and a `priorCaseId`, when the plan is validated, then it is rejected with a diagnostic stating that `new` forbids a prior case id. | 4 | "rejects a `new` relation carrying a priorCaseId with a diagnostic stating that `new` forbids a prior case id" | diff-local |
| Story 2 negative: Given an as-built finding disposition with a relation outside `same`, `recurrence`, `materially-changed` and `new`, when the plan is validated, then it is rejected with a diagnostic naming the closed relation set. | 4 | "with an unknown relation (diagnostic names the closed relation set)" | diff-local |
| Story 2 negative: Given a `prd-criterion` disposition that carries a `reconciliation` field, when the plan is validated, then it is rejected with a diagnostic stating that reconciliation applies only to as-built findings. | 4 | "rejects a `prd-criterion` disposition carrying one with a diagnostic stating reconciliation applies only to as-built findings" | diff-local |
| Story 2 negative: Given the planner returns a reconciliation-invalid plan on every attempt, when remediate's existing retry allowance is exhausted, then the round takes the existing no-plan handling, no task is appended, no case is recorded, and the last rejection's diagnostics remain visible in the halt. | 12 | "the round takes the existing no-plan handling, appends no task, and its HALT text contains the last rejection's diagnostic naming the `reconciliation` field" | diff-local |
| Story 3 happy: Given prior `open` case `c1` with unresolved repair task `rem-as-built-t1` and a current ADR-cited finding reconciled `same` to `c1` with an `existing-task` disposition binding `rem-as-built-t1`, when the plan is admitted, then no plan task is appended, the shared growth count is unchanged, `rem-as-built-t1` is `pending` in task-status, and the round charges only the as-built gate's lap. | 6 | "appends no block to the plan file, leaves `growth.byGate` unchanged, restages `rem-as-built-t1` `pending` in task-status, and records a lap-only pending repair for the as-built gate" | diff-local |
| Story 3 happy: Given prior `resolved` case `c1` whose repair task `rem-as-built-t1` is resolved and a current finding reconciled `recurrence` to `c1` with an `existing-task` disposition binding `rem-as-built-t1`, when the plan is admitted, then no plan task is appended, `rem-as-built-t1` is restaged `pending`, the shared growth count is unchanged, and case `c1` becomes `open` with its recurrence count increased by one. | 6 | "appends no block, leaves growth unchanged, restages the task `pending`, and leaves c1 `open` with recurrenceCount increased by one" | diff-local |
| Story 3 happy: Given a current finding that cites plan task `4` and is reconciled `recurrence` to case `c1` with repair task `rem-as-built-t1`, when its `existing-task` disposition binds both `4` and `rem-as-built-t1`, then the plan is accepted and both tasks are restaged `pending`. | 6, 5 | "a plan-task-cited `recurrence` binding task `4` and `rem-as-built-t1` restages both `pending`" | diff-local |
| Story 3 happy: Given a current finding reconciled `same` or `recurrence` with a `halt` disposition, when the plan is admitted, then the existing planner-halt path runs and no task is appended or restaged. | 6 | "a `same` answered `halt` and a `recurrence` answered `halt` each take the existing planner-halt path with no append or restage" | diff-local |
| Story 3 negative: Given a finding reconciled `same` or `recurrence` with an appending disposition, when the plan is validated, then it is rejected with a diagnostic stating that the relation admits only `existing-task` or `halt`. | 5 | "rejects a `same` or `recurrence` with an appending disposition with a diagnostic stating the relation admits only `existing-task` or `halt`" | diff-local |
| Story 3 negative: Given a finding reconciled `same` or `recurrence` to case `c1` whose `existing-task` binding names none of `c1`'s repair tasks, when the plan is validated, then it is rejected with a diagnostic naming `c1` and its repair task ids. | 5 | "one binding none of c1's repair tasks with a diagnostic naming c1 and its repair task ids" | diff-local |
| Story 3 negative: Given a finding that cites plan task `4` and is reconciled `recurrence` to case `c1`, when its binding names `rem-as-built-t1` but omits task `4`, then the plan is rejected with a diagnostic naming owner task `4`. | 5 | "rejects a plan-task-cited `recurrence` binding `rem-as-built-t1` without task `4` with a diagnostic naming owner task `4`" | diff-local |
| Story 3 negative: Given a finding reconciled `recurrence` to case `c1`, when its binding also names an active task that is neither its owner nor a repair task of `c1`, then the plan is rejected with a diagnostic naming that non-owner task id. | 5 | "one also binding an unrelated active task with a diagnostic naming that non-owner task id" | diff-local |
| Story 3 negative: Given an admitted `same` or `recurrence` binding whose restage of a bound task to `pending` fails, when the round would dispatch BUILD, then it halts instead of dispatching, and no case is updated for that round. | 7 | "`planRemediation` writes a HALT, dispatches no BUILD, and leaves `.pipeline/remediation-cases.json` unchanged for that round" | diff-local |
| Story 3 negative: Given a recurrence round at the as-built gate's tier lap cap, when its BUILD dispatch settles the lap, then the existing `kickback-cap` halt is written naming the tier and allowance, and no separate recurrence-limit halt exists. | 7 | "end with the existing `kickback-cap` HALT whose text names tier `M` and allowance 3, and no HALT text contains `recurrence limit`" | diff-local |
| Story 4 happy: Given a current finding reconciled `materially-changed` to prior case `c1` with an appending disposition, when the plan is admitted, then one `rem-as-built-*` task is appended, its pending repair receipt draws one unit of shared growth that is charged when its BUILD dispatch settles, and a new case records `changedFrom` `c1` with the appended task as its repair. | 8 | "writes a pending repair receipt drawing one growth unit while `growth.byGate` stays unchanged until its BUILD dispatch settles and then increases by one, and records a new case with `changedFrom` c1 whose repairTaskIds is that appended id" | diff-local |
| Story 4 happy: Given a current finding reconciled `new` with an appending or owner `existing-task` disposition, when the plan is admitted, then the append or binding behaves as before this feature, and a new case records that finding with its repair task ids. | 8 | "a `new` finding appends or binds its owner exactly as before this change, and a new case records that finding with its repair task ids" | diff-local |
| Story 4 negative: Given a `materially-changed` or `new` appending disposition whose append would exceed the shared plan-growth allowance, when its BUILD dispatch settles, then the existing `kickback-cap` halt is written, exactly as for an appending disposition before this feature. | 8 | "a `new` append that each exceed the shared growth allowance end with the existing `kickback-cap` HALT at BUILD dispatch" | diff-local |
| Story 4 negative: Given a finding reconciled `new` that cites plan task `4`, when its `existing-task` binding names a repair task of an unrelated prior case instead of task `4`, then the plan is rejected with the existing owner-binding diagnostic naming task `4`. | 5 | "rejects a `new` finding citing task `4` that binds another case's repair task instead of `4` with the existing owner-binding diagnostic naming task `4`" | diff-local |
| Story 5 happy: Given a lap in which every finding was reconciled `same` or `recurrence` and the bound repairs were rebuilt, when as-built review next returns `APPROVED`, then the gate is done, and every `open` `as_built` case becomes `resolved` in the same step that projects pending findings today. | 10 | "an `APPROVED` as-built verdict marks the gate done and sets every `open` `as_built` case `resolved` in the same `projectPendingAsBuiltRemediationFindings` call that clears pending findings" | diff-local |
| Story 5 happy: Given a lap in which every finding was reconciled `same` or `recurrence`, when as-built review next returns `BLOCKED`, then the gate is not done and the BLOCKED verdict routes exactly as a BLOCKED verdict with no prior cases would. | 10 | "leaves the as-built gate predicate not done, keeps the verdict BLOCKED, and routes through the same `planRemediation` path as with an empty store" | diff-local |
| Story 5 negative: Given every current finding matches a `resolved` `as_built` case, when as-built review returns `BLOCKED`, then the gate is not done and the verdict is not converted, suppressed or marked approved. | 10 | "including one whose findings all match `resolved` cases, leaves the as-built gate predicate not done, keeps the verdict BLOCKED" | diff-local |
| Story 5 negative: Given the store holds build_review cases, including operator-accepted ones, and PRD widening records, when the as-built verdict is routed or reconciled, then none of those records appears in the as-built prior-case projection and none changes the as-built gate outcome. | 10, 3 | "A store holding operator-accepted `build_review` cases and `prd_widening` records leaves the as-built gate outcome unchanged from an empty store's for both a BLOCKED verdict (not done) and an APPROVED verdict (done)" | diff-local |
| Story 5 negative: Given an as-built verdict of a prior contract version, when the as-built gate is evaluated, then it is not authoritative and reruns as before this feature, and no case is created or resolved from it. | 10 | "A prior-contract-version as-built verdict is not authoritative: the as-built gate predicate is not done and the as-built step is re-dispatched exactly as before this change" | diff-local |
| Story 6 happy: Given an admitted gap plan reconciling three as-built findings as `same`, `materially-changed` and `new`, when the round's append or binding succeeds, then the store records each finding id as a source with its relation, reason and attempt, and `.pipeline/events.jsonl` holds one `as_built_finding_reconciled` event per finding carrying the finding id, case id, attempt, outcome, `priorCaseId` when present, and reason. | 8, 6 | "After an admitted round reconciling `same`, `materially-changed` and `new`, each finding id is a source in `.pipeline/remediation-cases.json` carrying its relation, reason and attempt" | diff-local |
| Story 6 happy: Given a BLOCKED as-built verdict that carries one DESIGN and one REMEDIABLE finding, when the existing `needs-human` halt is written, then before the halt both findings are recorded as sources of new cases with status `needs-human`, and one `as_built_finding_reconciled` event with outcome `needs-human` is persisted per finding. | 9 | "records both as sources of `needs-human` cases and persists one `as_built_finding_reconciled` event with outcome `needs-human` per finding before the HALT file exists" | diff-local |
| Story 6 happy: Given an as-built finding the planner answers with `halt`, when the planner-halt path runs, then that finding is recorded with status `needs-human` and its event is persisted. | 9 | "an as-built finding answered `halt` is recorded with status `needs-human` and its event is persisted" | diff-local |
| Story 6 happy: Given a `resolved` case from an earlier gate pass, when a later as-built run on the same feature contributes findings to a `gap-plan` dispatch, then that resolved case is still listed in the projection. | 10 | "A later as-built run on the same feature lists a case resolved at an earlier gate pass in its `gap-plan` projection" | diff-local |
| Story 6 happy: Given a feature whose case store is at an earlier envelope version holding build_review cases and PRD widening records, when its first as-built finding is recorded, then the store is upgraded to the current version with every existing record, suppression and pending outbox entry unchanged and the new as-built case added. | 1 | "is written as `v4` with each pre-existing record, suppression and outbox entry serialized byte-identically and `asBuiltCases` holding the new record" | diff-local |
| Story 6 negative: Given a gap plan that is rejected or never produced, when the round ends, then no `as_built` case is created or changed and no `as_built_finding_reconciled` event is emitted for that round. | 12 | "gains no `as_built` case or source for that round, every pre-existing `as_built` case is byte-identical to its seeded serialization, and `.pipeline/events.jsonl` gains no `as_built_finding_reconciled` line" | diff-local |
| Story 6 negative: Given an admitted gap plan whose append or binding fails, when the round ends, then no case records the round's findings as admitted and no reconciliation event claims them. | 12 | "a valid plan whose append fails, or a valid plan whose `existing-task` binding fails, `.pipeline/remediation-cases.json` gains no `as_built` case or source for that round" | diff-local |
| Story 6 negative: Given the case store write fails after a successful append or binding, when the round would dispatch BUILD, then the feature halts `needs-human` naming the store write fault and BUILD is not dispatched. | 11 | "rejects after a successful append, and again when it rejects after a successful binding, the HALT text names the remediation case store write fault, its class is `needs-human`, and no BUILD dispatch is recorded" | diff-local |
| Story 6 negative: Given the same admitted round is replayed after a process restart, when its cases are recorded again, then each finding id appears once as a source and no duplicate event claims a new case. | 11 | "leaves each finding id appearing once as a source and emits no further `as_built_finding_reconciled` event naming a new case" | diff-local |
| Story 6 negative: Given the process stops after a recording is written but before its events are delivered, when the engine next drains the case store, then each pending `as_built_finding_reconciled` event is delivered with its original event id and the spine holds it exactly once. | 11 | "the next as-built `planRemediation` drains the case-store outbox before building its projection, delivering each pending `as_built_finding_reconciled` entry with its original `eventId`" | diff-local |
| Story 6 negative: Given two validation-group members finish concurrently, when the as-built round records cases while another domain writes the store, then both writes are serialized by the store's existing lease and neither domain's records are lost. | 11 | "Concurrent `mutate` calls adding an `as_built` case and a `prd_widening` record both persist" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-28-as-built-finding-reconciliation#D1 | task | task-1 | `RemediationCaseStore.mutate` writing an `as_built` record with two sources, status `open`, repairTaskIds and recurrenceCount 1 is followed by `read()` returning those exact values |
| adr-2026-10-28-as-built-finding-reconciliation#D2 | task | task-3 | returns a fault with dimension `prior-as-built-cases`, the actual byte size and the limit |
| adr-2026-10-28-as-built-finding-reconciliation#D3 | task | task-4 | each accepted disposition retains its relation, priorCaseId and reason |
| adr-2026-10-28-as-built-finding-reconciliation#D4 | task | task-5, task-6 | appends no block to the plan file, leaves `growth.byGate` unchanged, restages `rem-as-built-t1` `pending` in task-status |
| adr-2026-10-28-as-built-finding-reconciliation#D5 | task | task-10, task-7 | leaves the as-built gate predicate not done, keeps the verdict BLOCKED |
| adr-2026-10-28-as-built-finding-reconciliation#D6 | task | task-2, task-9, task-10 | records both as sources of `needs-human` cases and persists one `as_built_finding_reconciled` event with outcome `needs-human` per finding before the HALT file exists |
| adr-2026-10-28-as-built-finding-reconciliation#D7 | task | task-6 | holds one `as_built_finding_reconciled` line per as-built finding carrying finding id, case id, attempt, outcome, priorCaseId when present, and reason |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-refusal-b82bb720-5137-4cff-9a14-e5b3b1fd0b12: conductor.ts:4200-4211: pass 'needs-human' to haltForRemediationValidatorFault only for the prior-as-built-cases dimension/case-store faults and restore the default 'mechanical' class for every other buildRemediationProjection fault; revert test/engine/conductor-kickback-ledger.test.ts and test/prd-audit-kickback.test.ts haltClass expectations for the unreadable kickback ledger fault to 'mechanical'
**Gate:** prd-audit
**Rationale:** Verified in conductor.ts:4200-4211: every buildRemediationProjection fault halts 'needs-human'. Plan Task 14 admits needs-human only for prior-as-built-case projection faults (oversize, undeclared repair task, unreadable or malformed store). This removal-only rework narrows the reclassification to that dimension and keeps the mechanical class for all other sources and dimensions. It adds no behavior.
**Criterion:** NC-1
**Governing clause:** Refused NC-1 (decision b82bb720-5137-4cff-9a14-e5b3b1fd0b12 r1)
**Done when:**
- [test] NC-1 is satisfied by this task.
- Refused NC-1 (decision b82bb720-5137-4cff-9a14-e5b3b1fd0b12 r1) is satisfied by this task.
- The repair for task rem-prd-audit-refusal-b82bb720-5137-4cff-9a14-e5b3b1fd0b12 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg-design-halt-join: conductor.ts validation-group join blocked-design halt (~9832-9845): call recordAsBuiltNeedsHumanFindings for every verdict finding (DESIGN and REMEDIABLE) before writeHaltMarker(reason,'needs-human'), halting needs-human on a store-write fault; add a conductor-groups-and-signals.test.ts test asserting needs-human cases and one as_built_finding_reconciled event per finding exist before the HALT file
**Gate:** prd-audit
**Rationale:** Verified (grep, 97%): recordAsBuiltNeedsHumanFindings has a single caller at conductor.ts:5218 (planner-halt). Plan Task 9 Step 3 requires recording before writeHaltMarker at both blocked-design halt sites. The prior lap restaged Task 9 with no explicit work and the defect remained, so this appends a concrete task scoped to the validation-group site. Approved architecture stays authoritative; this is conforming BUILD work.
**Criterion:** S6.2
**Parent task:** 9
**Done when:**
- [test] S6.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg-design-halt-join is committed and its targeted tests pass.

### Task rem-as-built-rem-vg-design-halt-serial: conductor.ts serial as-built blocked-design halt (~15046): call recordAsBuiltNeedsHumanFindings for every verdict finding before writeHaltMarker; add a conductor-groups-and-signals.test.ts test asserting the same needs-human cases and as_built_finding_reconciled events exist before the HALT file
**Gate:** as-built
**Rationale:** Verified (99%): the serial as-built DESIGN halt (conductor.ts ~15046) also bypasses recording. Plan Task 9 admits recording at both blocked-design halt sites per ADR decision 6. The join site is handled under S6.2, so this task covers the serial site only. Conforming BUILD work; no architecture decision needed.
**Governing clause:** adr-2026-10-28-as-built-finding-reconciliation decision 6
**Done when:**
- adr-2026-10-28-as-built-finding-reconciliation decision 6 is satisfied by this task.
- The repair for task rem-as-built-rem-vg-design-halt-serial is committed and its targeted tests pass.

### Task rem-as-built-rem-vg-resolve-on-gate-pass: conductor.ts projectPendingAsBuiltRemediationFindings: resolve open as_built cases on every authoritative as-built gate pass (APPROVED, APPROVED WITH DRIFT NOTES, delivered PLAN_GAP) independently of whether pending findings exist; add conductor-groups-and-signals.test.ts tests for drift-notes and empty-pending gate passes resolving open cases
**Gate:** as-built
**Rationale:** Verified by reading conductor.ts:1340-1365: settlement returns early when pending findings are empty and resolves only for literal 'APPROVED'. Plan Task 10 admits resolving open cases at the gate-pass seam projectPendingAsBuiltRemediationFindings, and ADR decision 6 and the approved diagram define the edge as any authoritative gate pass. Fixing it changes no routing or asBuiltOutcome, so this is conforming BUILD work (90%).
**Governing clause:** adr-2026-10-28-as-built-finding-reconciliation decision 6
**Done when:**
- adr-2026-10-28-as-built-finding-reconciliation decision 6 is satisfied by this task.
- The repair for task rem-as-built-rem-vg-resolve-on-gate-pass is committed and its targeted tests pass.

### Task rem-as-built-rem-vg-drain-before-projection: conductor.ts planRemediation: drain the remediation case-store outbox through drainRemediationCaseOutbox and events.emitOrThrow before buildRemediationProjection for an as-built gap-plan; add a conductor-groups-and-signals.test.ts test where a crash-left pending as_built_finding_reconciled entry is delivered once with its original eventId before the projection is built
**Gate:** as-built
**Rationale:** Verified (99%): conductor.ts:4188 calls buildRemediationProjection with no prior outbox drain. Plan Task 11 Step 3 explicitly requires draining the case-store outbox before building an as-built gap-plan projection (ADR decision 7). This is a direct omission of admitted work and goes to BUILD.
**Governing clause:** adr-2026-10-28-as-built-finding-reconciliation decision 7
**Done when:**
- adr-2026-10-28-as-built-finding-reconciliation decision 7 is satisfied by this task.
- The repair for task rem-as-built-rem-vg-drain-before-projection is committed and its targeted tests pass.

### Task rem-as-built-rem-vg-mixed-append-halt: conductor.ts planRemediation planner-halt branch: before recording halt-answered findings and returning, record reconciliation for findings whose append or existing-task binding already succeeded in the same round; add a conductor-groups-and-signals.test.ts test for a mixed append-and-halt plan asserting the appended finding's case source and as_built_finding_reconciled event persist alongside the needs-human halt finding
**Gate:** as-built
**Rationale:** Verified (98%): in a mixed plan, appends succeed at conductor.ts:4922 and the planner-halt branch then records only the halt dispositions and returns at :5208-5224, skipping reconciliation at :5406-5428. Plan Tasks 8 and 9 admit recording appended findings after a successful append and halt-answered findings as needs-human. Recording both before the halt is conforming BUILD work.
**Governing clause:** adr-2026-10-28-as-built-finding-reconciliation decision 6
**Done when:**
- adr-2026-10-28-as-built-finding-reconciliation decision 6 is satisfied by this task.
- The repair for task rem-as-built-rem-vg-mixed-append-halt is committed and its targeted tests pass.
