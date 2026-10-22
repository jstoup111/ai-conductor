# Implementation Plan: Operator acceptance survives a build_review re-raise (respec of #3271)

**Date:** 2026-10-21
**Stories:** .docs/stories/operator-acceptance-survives-a-build-review-re-rai.md
**Conflict check:** Clean as of 2026-10-21 (.docs/conflicts/2026-10-21-operator-acceptance-survives-a-build-review-re-rai.md)

## Summary

Make operator acceptance durable remediation-case state. `finalize` records acceptance origins on
the case. One reconciler lane carries a later adjudicator binding to an accepted case. One shared
predicate retires accepted, absent or operator-resolved failed cases at a clean PASS. A TTY-gated
`build-review resolve-case` command resolves a blocking case. Every new occurrence is delivered
through a case-store outbox, exactly once. 24 tasks in two slices. Source: jstoup111/ai-conductor#3271,
which also delivers #3303.

## Technical Approach

- **Baseline.** #3292 builds first (#3271 is blocked by #3292). This plan targets the post-#3292
  engine:
  - `currentBuildReviewSourceLinks` exists in `remediation-case-store.ts`, and
    `finalizedBuildReviewSourceIds` reads through it (mixed-laps D5.5);
  - source ownership is open-scoped (D5.4);
  - an unbound re-raise is a new, charged case (D5.6);
  - decision stops converge (D5.7).
- **Governing decisions.** `adr-2026-10-20-operator-acceptance-is-durable-case-state` D1–D9 and
  the amendment notes it adds to the remediate-case, mixed-laps, stable-dispositions and
  portable-policy ADRs. The track's exclusions are binding:
  - no custom-rubric identity stabilization;
  - no cross-feature acceptance;
  - no carry decided without an adjudicator `existingCaseId` binding.
- **Single owners (architecture-review condition 1).** Every task that touches one of these rules
  names its owner. No other production file may make the owner's decision. Task 22's guard test
  enforces this.

  | Rule | Owner | Consumers (route only) |
  | --- | --- | --- |
  | Carry eligibility and decision | `classifyRemediationCaseReuse` plus its exported eligibility helper `isCarryEligibleRemediationCase`, in `remediation-case-reconciler.ts` | coordinator partitions, adjudication context |
  | Carried-link write | the reconciler carry lane (`admitsCarry`) | none |
  | Acceptance-origin write | the coordinator's `finalize` mutation | carry eligibility, context, findings CLI |
  | Open-case retirement | the exported reconciler predicate `retiresOpenBuildReviewCase` | reconciler absence resolution, `finalize`, `resolveAbsentFailedBuildReviewCases`, `settleRemediationCasesOnCleanBuildReview` |
  | Carry as settled | `finalizedBuildReviewSourceIds` | effective verdict, CLI, coordinator live set |
  | Occurrence delivery | `drainRemediationCaseOutbox` | coordinator entry and post-mutate, settlement entry and exit |
  | Operator case resolution | `RemediationCaseStore.resolveByOperator`, called only by `dispatchBuildReviewResolveCase` | carry eligibility, findings CLI, renderer |

- **Store (Task 1).** `remediation-case-store.ts` adds `STORE_VERSION='v3'` and keeps `v2` and
  `v1` readable through `parseState`. Both legacy versions are upgraded on the next `mutate()`. The
  exact-key parsers gain:
  - case `operatorAcceptance: { origins: [{ sourceId, lapId }] }`;
  - case `operatorResolution: { operator, rationale, resolvedAt }`;
  - the source outcome `carried`, in `remediation-case-artifact.ts`'s `RemediationCaseSourceOutcome`
    and in `parseSourceLink`;
  - the envelope `outbox: [{ eventId, occurredAt, event }]`. Its `event` must parse as one of the
    three outbox event types.

  The provider judgement parser in `remediation-case-artifact.ts` stays exact-keyed and rejects all
  three operator-owned shapes.
- **Outbox (Tasks 2, 3, 18).** The local precedent is `drainOutbox` in
  `src/conductor/src/engine/routing/route-record-store.ts`. Traits to keep:
  - the head entry is persisted before it is removed;
  - removal is a separate durable write;
  - a crash between the two yields a duplicate that `EventPersister.persistDurably` drops by
    `eventId`;
  - the envelope `eventId` and `occurredAt` are authoritative.

  Allowed variation: a leased `RemediationCaseStore.mutate()` replaces the git-ref compare-and-swap,
  and emission uses the conductor's `events.emitOrThrow` (`src/conductor/src/ui/events.ts`) so live
  subscribers also see the event. Search hints: `drainOutbox`, `withOutboxEvent`,
  `observationEventId`, `ROUTING_OCCURRENCE_TYPES`.

  The coordinator today receives only a fire-and-forget `emit`, so it gains an `emitOrThrow` input.
- **Carry (Tasks 6–8, 10).** The local precedent is the per-lane admission predicates in
  `remediation-case-reconciler.ts` (`admitsRefutation`, `admitsDeferral`, `admitsActionRetry`).
  Trait: one admission predicate per lane, applied inside the single `mutate()`.

  `classifyRemediationCaseReuse` gains the result `carry` and runs before:
  - the coordinator's `neverBuilt` strip;
  - both reuse-halt branches;
  - the escalation split into `persistBuildReviewDecisionStop`;
  - action authorization.

  Every switch over `RemediationCaseReuseDisposition` stays exhaustive, with no default branch.
- **Current sources.** Every new rule keys sources through `buildReviewAdjudicationSourceId` over
  `projectBuildReviewAggregateSources(aggregate)`, which covers built-in and custom rubrics. No
  built-in-only map is admitted (architecture-review condition 3).
- **Effective verdict (Task 15).** `resolveEffectiveBuildReviewVerdict` in `build-review-effective.ts`
  gains required deps `child` and `adjudicationEnabled`. There are seven production call sites:

  | File | Sites | Where `child` and `adjudicationEnabled` come from |
  | --- | --- | --- |
  | `conductor.ts` | 3, all in `run()`: the initial effective resolution, the `resolveOperatorResolvedFindingIds` closure, and the `reenterBuildReviewIfEffectivePass` closure | the active child context and `buildReviewAdjudicationEnabled()` |
  | `step-runners.ts` | 2: `runRubricBuildReviewInner` and `publishCustomOnlyBuildReview` | the step's child context and resolved build_review config |
  | `artifacts.ts` | 2, both in `CUSTOM_COMPLETION_PREDICATES.build_review`: the code-stamp preserve branch and the fresh-aggregate branch | the predicate context's child and config |

  `build-review-cli.ts` calls `finalizedBuildReviewSourceIds` directly (architecture-review
  condition 4).
- **Operator command (Task 19).** `build-review resolve-case` sits beside `accept`:
  - `detectBuildReviewResolveCaseCommand` in `src/conductor/src/cli.ts`;
  - an entry in `PRE_DISPATCH_COMMANDS` in `src/conductor/src/cli-pre-dispatch.ts`;
  - a declaration in `createProgram()`;
  - dispatch in `dispatchCliCommand()` in `src/conductor/src/index.ts`.

  It reuses `accept`'s inline gate: interactive TTY plus `resolveOperator`.
- **Event spine.** `build_review_acceptance_carried` and `remediation_case_operator_resolved` join
  the `ConductorEvent` union, `EVENT_SINKS` and the persister's eventId dedup set.
  `remediation_case_reconciled` gains an optional `eventId`. No second channel is added.

## Prerequisites

- #3292's build has merged to `main`. The native edge "#3271 blocked by #3292" makes the daemon wait
  for it (ADR A8).

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Durable acceptance, carry, settlement and resolve-case | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 |
| 2 | Operator visibility of carried and resolved state | 23, 24 |

## Tasks

### Task 1: Case store v3 schema with v2 and v1 upgrade
**Story:** Story 11
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `remediation-case-store.test.ts` for the v2 read, the v1 and v2 write upgrade, and the malformed-v3 refusals.
2. Verify RED.
3. Implement in `remediation-case-store.ts`: `STORE_VERSION='v3'`, with `parseState` dispatching v1, v2 and v3. Extend the exact-key lists in `parseCase` for the two optional case fields, `parseSourceLink` for `carried`, and the envelope for `outbox`. An outbox `event` must parse as `build_review_acceptance_carried`, `remediation_case_operator_resolved` or `remediation_case_reconciled`. Add `carried` to `RemediationCaseSourceOutcome` in `remediation-case-artifact.ts`. This task decides no carry and no retirement.
4. Verify GREEN and commit: "feat(remediation): case store v3 with acceptance, resolution and outbox".

**Done when:**
- [test] `RemediationCaseStore.read()` over a valid v2 fixture returns every case, link, effect and suppression deep-equal to the pre-change parse of the same fixture.
- [test] The first `mutate()` over a valid v1 fixture and over a valid v2 fixture writes `version: "v3"` with every prior case, link, effect and suppression field-for-field identical, and no `operatorAcceptance`, `operatorResolution` or `outbox` entry present.
- [test] `read()` and `mutate()` over v3 fixtures with an unknown key at the envelope, case, source-link or effect level, an unknown source outcome, an outbox entry whose `event` type is not one of the three outbox event types, or an outbox entry of one of those types whose event body fails that event's shape each return `malformed-state`, and no `writeFile` or `rename` is recorded.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/src/engine/remediation-case-artifact.ts; src/conductor/test/engine/remediation-case-store.test.ts

### Task 2: Register the carry, operator-resolution and retirement occurrences
**Story:** Story 8
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `event-sinks.test.ts` and `event-persister.test.ts`.
2. Verify RED.
3. Implement:
   - In `src/conductor/src/types/events.ts`, add `build_review_acceptance_carried` `{ eventId, feature, child?, lapId, sourceId, caseId, originSourceIds, originLapIds }` and `remediation_case_operator_resolved` `{ eventId, feature, child?, caseId, sourceIds }`, and an optional `eventId` on `remediation_case_reconciled`.
   - Declare both new types in `EVENT_SINKS` (`event-sinks.ts`).
   - Add all three to `EventPersister`'s eventId dedup set (`event-persister.ts`) beside `ROUTING_OCCURRENCE_TYPES`.
4. Verify GREEN and commit: "feat(events): register acceptance carry and operator resolution occurrences".

**Done when:**
- [test] The `EVENT_SINKS` registry test asserts declarations for `build_review_acceptance_carried` and `remediation_case_operator_resolved`, and the event-sink registry exhaustiveness test passes.
- [test] `EventPersister.persistDurably` called twice with the same `eventId` for each of `build_review_acceptance_carried`, `remediation_case_operator_resolved` and an `eventId`-bearing `remediation_case_reconciled` writes exactly one line to `.pipeline/events.jsonl` and reports the second call `duplicate`.
- [test] A `remediation_case_reconciled` without `eventId` is still persisted on every call exactly as before.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/event-persister.ts; src/conductor/test/engine/event-sinks.test.ts; src/conductor/test/engine/event-persister.test.ts

### Task 3: Drain the case-store outbox exactly once
**Story:** Story 8
**Type:** happy-path
**Dependencies:** Task 1, Task 2

**Steps:**
1. Write failing tests in a new `remediation-case-outbox.test.ts` for the drain over a store holding entries, with an injected `emitOrThrow` backed by a real `EventPersister`.
2. Verify RED.
3. Implement `drainRemediationCaseOutbox(store, emitOrThrow)` in `remediation-case-store.ts`. It is the only occurrence-delivery owner. It reads the head entry, awaits `emitOrThrow(entry.event)` carrying `entry.eventId` and `entry.occurredAt`, then removes that entry by a separate `mutate()`, and repeats until the outbox is empty. A thrown emit stops the drain and leaves the entry. Follow the `drainOutbox` precedent (`routing/route-record-store.ts`): persist the head before removal; removal is its own durable write; a crash in between is a duplicate dropped by `eventId`. Allowed variation: a leased `mutate()` instead of compare-and-swap. Search hints: `drainOutbox`, `withOutboxEvent`.
4. Verify GREEN and commit: "feat(remediation): drain the case-store outbox through the event spine".

**Done when:**
- [test] `drainRemediationCaseOutbox` over a store with three entries persists exactly one `.pipeline/events.jsonl` line per `eventId`, carrying each entry's `occurredAt`, and leaves the outbox empty.
- [test] A drain interrupted after `emitOrThrow` resolves and before the removal `mutate()`, followed by a second drain, leaves exactly one line for that `eventId` (the repeat reported `duplicate`) and an empty outbox.
- [test] When `emitOrThrow` rejects, the drain returns without removing the entry, the outbox is byte-identical, and a later drain with a working persister delivers the entry exactly once.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/test/engine/remediation-case-outbox.test.ts

### Task 4: Provider output cannot write operator-owned case state
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `remediation-case-artifact.test.ts` and `build-review-adjudication-coordinator.test.ts` with judgements that set `operatorAcceptance`, `operatorResolution`, or a `carried` source outcome.
2. Verify RED.
3. Implement in `remediation-case-artifact.ts`: the judgement parser rejects all three, because `carried` is not a provider-admissible outcome and the two case fields are not judgement keys. `validateRemediationCaseGraph` refuses them too.
4. Verify GREEN and commit: "fix(remediation): reject operator-owned fields in provider judgements".

**Done when:**
- [test] The judgement parser rejects a judgement carrying `operatorAcceptance`, one carrying `operatorResolution`, and one whose source outcome is `carried`, each with a validation failure naming the field.
- [test] `coordinateBuildReviewAdjudication` given each of those judgements fails closed with no `mutate()` write, and the case store file is byte-identical.

**Files:** src/conductor/src/engine/remediation-case-artifact.ts; src/conductor/test/engine/remediation-case-artifact.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 5: finalize records acceptance origins on the owning case
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing coordinator tests in `build-review-adjudication-coordinator.test.ts` for origin writes on open and resolved cases, each with a built-in finding and a custom-rubric twin.
2. Verify RED.
3. Implement in `finalize` (`build-review-adjudication-coordinator.ts`), the only acceptance-origin writer. Inside the existing retirement `mutate()`, append origin `{ sourceId, lapId }` for every source that meets all four conditions:
   - it is linked to the case;
   - it is in the current-lap projection `projectBuildReviewAggregateSources` keyed by `buildReviewAdjudicationSourceId`;
   - it is in the exact-disposition accepted set (not `suppressedFindingIds`, not carried);
   - it has no origin on that case yet.

   Retirement itself is left to Task 16's predicate. Do not compare origin laps here.
4. Verify GREEN and commit: "feat(build-review): record operator acceptance origins at finalize".

**Done when:**
- [test] After a lap in which the operator accepts F1, the only source of open action case O, finalize leaves O `resolved` with `operatorAcceptance.origins` exactly `[{ sourceId: F1, lapId: L1 }]`, for a built-in finding and for a custom-rubric finding.
- [test] For open O with sources F1 and F2 where only F1 is accepted and F2 is still raised, finalize leaves O `open` with origins exactly `[F1 on L1]`, and a later lap binding a finding to O by `existingCaseId` is not carried and takes the pre-change reuse result.
- [test] A finding below the confidence floor and not accepted by an exact disposition gains no origin, and a finalize replayed after a simulated crash leaves exactly one origin for F1 on L1.
- [test] A disposition record whose feature identity differs from the current feature writes no origin on any case.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 6: Classify a binding to a carry-eligible case as carry
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `remediation-case-reconciler.test.ts` for `isCarryEligibleRemediationCase` and `classifyRemediationCaseReuse`.
2. Verify RED.
3. Implement in `remediation-case-reconciler.ts`, the only carry-eligibility and carry-decision owner. Export `isCarryEligibleRemediationCase(record, { currentLapId, effectiveAcceptedSourceIds })`. It returns true for a case with an `operatorResolution`, or for a `resolved` case with at least one origin, all of whose origins' source ids are in `effectiveAcceptedSourceIds` and none of whose `lapId`s equal `currentLapId`. Extend `RemediationCaseReuseDisposition` with `carry`. `classifyRemediationCaseReuse(record, attempted, carryInput)` returns `carry` whenever the case is carry-eligible, for every disposition, before any other result. Make every switch over the union exhaustive, with no default branch.
4. Verify GREEN and commit: "feat(remediation): classify bindings to accepted cases as carry".

**Done when:**
- [test] `classifyRemediationCaseReuse` returns `carry` for a resolved action case with an `applied` effect whose origin F1 on L1 is still accepted, evaluated on L2, and for an operator-resolved case, for each of the `act`, `escalate`, `defer`, `reject` and `refute` proposals.
- [test] It returns `halt-regression` for a resolved action case with an `applied` or `failed` effect that holds no origin and no operator resolution, and the pre-change result for an open case.
- [test] It does not return `carry` when the only origin's `lapId` equals the current lap, or when an origin's source id is absent from the effective accepted set.

**Files:** src/conductor/src/engine/remediation-case-reconciler.ts; src/conductor/test/engine/remediation-case-reconciler.test.ts

### Task 7: The reconciler carry lane appends carried links and their outbox entries
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 6

**Steps:**
1. Write failing reconciler tests with the real store for a `carry` proposal.
2. Verify RED.
3. Implement the lane `admitsCarry` in `reconcileState` (`remediation-case-reconciler.ts`), the only carried-link writer. Follow the lane precedent (`admitsRefutation`, `admitsDeferral`): one admission predicate, applied inside the single `mutate()`. For each new live source it appends a link with outcome `carried`, plus one outbox entry `build_review_acceptance_carried` carrying a fresh `eventId`. It reserves no effect and leaves the case's disposition, resolution, effect and earlier links unchanged.
4. Verify GREEN and commit: "feat(remediation): carry lane for bindings to accepted cases".

**Done when:**
- [test] `reconcileRemediationCases` given a `carry` proposal binding F2 to resolved case C appends exactly one link `{ sourceId: F2, outcome: "carried" }` and exactly one outbox entry naming F2, C and C's origin source ids and laps, in one `mutate()`.
- [test] After the carry, C's `disposition`, `resolution`, `effect` and earlier links are deep-equal to before, and no effect id is reserved in the store.
- [test] Replaying the same carry proposal after it was applied writes no second link and no second outbox entry.

**Files:** src/conductor/src/engine/remediation-case-reconciler.ts; src/conductor/test/engine/remediation-case-reconciler.test.ts

### Task 8: Route an action re-raise bound to an accepted case as carry through the coordinator
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 5, Task 7, Task 9

**Steps:**
1. Write failing tests:
   - coordinator tests with the real store and reconciler;
   - conductor build_review tests replaying the #3211 sequence, with a built-in finding and with a custom eventSpine finding whose id changes per lap.
2. Verify RED.
3. Implement in `coordinateBuildReviewAdjudication`. Compute the carry input from the current lap id and the re-read effective accepted set, then call `classifyRemediationCaseReuse` for every `existingCaseId` proposal before the `neverBuilt` strip and both reuse-halt branches. `carry` proposals go only to the reconciler carry lane: they publish no work order, call no `chargeEffect` and deny no sibling action. Do not evaluate eligibility in the coordinator.
4. Verify GREEN and commit: "feat(build-review): carry action re-raises bound to accepted cases".

**Done when:**
- [test] A coordinator lap binding F2 by `existingCaseId` with `act` to resolved case C (applied effect, F1 accepted on L1) returns no `semantic remediation case regression` or `semantic remediation case repeat` detail, publishes no BUILD work order, records zero `chargeEffect` calls, and leaves C with one new `carried` link for F2 and every other field unchanged.
- [test] Through the conductor build_review step, the #3211 two-lap sequence on a custom eventSpine finding and on a built-in finding publishes effective PASS on lap 2 with zero kickback ledger increments and no second `build-review accept`.
- [test] A three-lap test binding F3 to C on L3 carries F3 from C's L1 origin, and a lap binding F2 to an unaccepted resolved action case still halts `semantic remediation case regression C` with no carried link.
- [test] In a lap that carries F2 and also raises unbound content finding G, G's route, case and charge are identical to the same lap without F2, and a lap that also has an infrastructure failure does not publish PASS.
- [test] When C's only origin was written on the current lap, a same-lap rebinding of another finding to C is not carried and takes the pre-change reuse result.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 9: Count carried authoritative links as settled
**Story:** Story 12
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `remediation-case-store.test.ts` and `build-review-effective.test.ts`.
2. Verify RED.
3. Implement in `finalizedBuildReviewSourceIds` (`remediation-case-store.ts`), the only reader path for carry. A source is settled when its authoritative link from `currentBuildReviewSourceLinks` has outcome `carried`, in addition to the existing rules.
4. Verify GREEN and commit: "feat(remediation): carried sources are settled".

**Done when:**
- [test] `finalizedBuildReviewSourceIds` includes F2 when F2's only link is `carried` on resolved case C, for a built-in and a custom-rubric source id.
- [test] When an open case also links F2, the open case's link decides and F2 is not in the settled set.
- [test] On a fixture with no `carried` link, the settled set equals the pre-change result for the same cases.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/test/engine/remediation-case-store.test.ts; src/conductor/test/engine/build-review-effective.test.ts

### Task 10: Carry non-action bindings ahead of the escalation split
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 8

**Steps:**
1. Write failing coordinator and conductor tests for `escalate`, `defer`, `reject` and `refute` bindings to a carry-eligible case, including the 2026-10-17 `conflicting-case-id` shape.
2. Verify RED.
3. Implement in `coordinateBuildReviewAdjudication`: a `carry` classification removes the proposal from `escalationCases`, `blockedConsistency`, the deferral effect path and the refutation path before `persistBuildReviewDecisionStop` is reached. Unbound or ineligible escalations keep the #3292 path unchanged.
4. Verify GREEN and commit: "feat(build-review): carry escalations and deferrals bound to accepted cases".

**Done when:**
- [test] Replaying the 2026-10-17 shape, an escalation bound to carry-eligible C with differing source ids settles F2 as `carried`, persists no open decision stop, and the conductor build_review step writes no HALT containing `decision stop` or `conflicting-case-id`.
- [test] `defer`, `reject` and `refute` bindings to carry-eligible C each settle F2 as `carried`, reserve no deferral effect, file no intake issue, and record zero `chargeEffect` calls.
- [test] An escalation bound to resolved R with no origin and no operator resolution persists a new open decision stop and halts, an escalation bound to open stop D with a different source set or owner returns `conflicting-case-id` and writes nothing, and an unbound escalation of the same substance beside carry-eligible C persists a decision stop and halts.
- [test] In one lap where F2 is bound to C as `escalate` and unbound escalation G is raised, F2 is carried and G's decision stop is persisted.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 11: Link a halting binding's sources to its bound case
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 5, Task 8

**Steps:**
1. Write failing coordinator tests for the halt, accept and re-raise flow.
2. Verify RED.
3. Implement in the coordinator's pre- and post-reconcile reuse-halt branches. Before returning `halt-regression` or `halt-repeat` for an explicit binding, link the proposal's live sources to the bound case with outcome `acted`, through the reconciler's existing source-append path, changing nothing else on the case. This is source-trace bookkeeping: it decides no carry and writes no origin.
4. Verify GREEN and commit: "feat(build-review): link halting bindings to their bound case".

**Done when:**
- [test] A lap that halts `semantic remediation case regression C` because F2 is bound to resolved C leaves C with one new link `{ sourceId: F2, outcome: "acted" }` and every other field of C deep-equal to before.
- [test] After the operator accepts F2 and the next lap finalizes, C holds origin F2 on that lap, and a later lap binding re-raised F3 to C settles F3 as `carried` with no halt.
- [test] The F2 link with outcome `acted` on a resolved action case with an `applied` effect does not put F2 in `finalizedBuildReviewSourceIds`.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 12: Carry never widens past the binding or a withdrawn origin
**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 8

**Steps:**
1. Write failing coordinator tests for unbound look-alikes, an invalidated origin disposition, and unreadable stores.
2. Verify RED.
3. Fix only what those tests expose, in the coordinator's carry-input construction. An origin disposition stops being effective when its exact identity no longer matches: a contract-version invalidation, or a retired rubric filtered by `BuildReviewDispositionStore.list`. Carried links are never revoked.
4. Verify GREEN and commit: "test(build-review): carry stays inside the binding and the origin's authority".

**Done when:**
- [test] Beside carry-eligible C, an unbound proposal for a finding with C's rubric, path and summary persists a new case with a reserved action effect and one `chargeEffect` call, and no `carried` link.
- [test] After C's origin disposition is withdrawn (a fixture whose disposition is absent from `BuildReviewDispositionStore.list` because its rubric is retired) and after it is invalidated (a contract-version invalidation fixture), a binding of F3 to C is not carried and takes the pre-change reuse result in each, while F2, carried on an earlier lap, stays in `finalizedBuildReviewSourceIds`.
- [test] A binding to a case with no origin and no operator resolution, for each of `act`, `escalate`, `defer`, `reject` and `refute`, produces the pre-change route, and an unbound, unmatched current finding resembling an accepted one by rubric, path or summary is not suppressed.
- [test] With an unreadable disposition store and with a malformed disposition store (which `BuildReviewDispositionStore` reports as `kind: 'unreadable'`), a binding of F2 to C carries nothing and each lap result equals the pre-change result for an unreadable disposition store, and with an unreadable case store and with a malformed case store the lap fails closed with the pre-change case-store failure and nothing carried.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 13: Carry stays inside its feature and child
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Task 8

**Steps:**
1. Write failing tests in `remediation-case-child.test.ts` and the coordinator tests.
2. Verify RED.
3. Fix only what those tests expose. The coordinator resolves `existingCaseId` only against the child-scoped store from `remediationCaseStorePath(projectRoot, child)`, and the effective accepted set uses only dispositions matching the current feature identity.
4. Verify GREEN and commit: "test(build-review): carry is feature- and child-scoped".

**Done when:**
- [test] A carry-eligible case on feature A does not carry feature B's same-substance finding: B's lap takes the pre-change route.
- [test] A stacked child binding a re-raised finding to its own carry-eligible case appends the `carried` link in `.pipeline/children/<child>/remediation-cases.json`, the carry's effective accepted set is read from the feature's `.pipeline/build-review-dispositions.json`, and the flat case store is byte-identical.
- [test] A child binding a finding to a case id that exists only in a sibling child's store is not resolved against the sibling's store and carries nothing, and a disposition with a different feature identity enables no carry.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/remediation-case-child.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 14: Mark operator-accepted prior cases in the judge context and skill
**Story:** Story 6
**Type:** happy-path
**Dependencies:** Task 6

**Steps:**
1. Write failing tests in `build-review-adjudication-context.test.ts` and `remediate-skill-contract.test.ts`.
2. Verify RED.
3. Implement in `assembleBuildReviewAdjudicationContext`: each prior case for which `isCarryEligibleRemediationCase` (the reconciler's exported owner) returns true gains `operatorAccepted: { originSourceIds, originLapIds }`. Do not compare origin laps in the context module. In `skills/remediate/SKILL.md`'s "Authority boundaries" section, keep "Never assert or create operator acceptance". Add that a same-substance finding may be bound by `existingCaseId` to a prior case marked `operatorAccepted`.
4. Verify GREEN and commit: "feat(build-review): show the judge which prior cases an operator accepted".

**Done when:**
- [test] `assembleBuildReviewAdjudicationContext` projects `operatorAccepted` with exact origin source ids and lap ids on a carry-eligible case, and no `operatorAccepted` on an ineligible case, including one whose origin disposition was withdrawn (absent from `BuildReviewDispositionStore.list`) and one whose origin disposition no longer matches.
- [test] The serialized context of a carry-eligible case contains neither the disposition's operator name nor its rationale, and a context at the byte ceiling with marked cases applies the existing overflow rule with the same result as the unmarked fixture.
- [test] The remediate skill contract test asserts the text still matches `/never assert or create operator\s+acceptance/i` and states that a same-substance finding may be bound to a case marked `operatorAccepted`.

**Files:** src/conductor/src/engine/build-review-adjudication-context.ts; skills/remediate/SKILL.md; src/conductor/test/engine/build-review-adjudication-context.test.ts; src/conductor/test/engine/remediate-skill-contract.test.ts

### Task 15: Every effective-verdict caller passes its child and adjudication flag
**Story:** Story 12
**Type:** refactor
**Dependencies:** Task 9

**Steps:**
1. Write failing tests in `build-review-effective.test.ts` and `remediation-case-child.test.ts`.
2. Verify RED.
3. Implement in `build-review-effective.ts`: make `child` and `adjudicationEnabled` required in `BuildReviewEffectiveResolverDeps`. `readSettledBuildReviewSourceIds` reads `remediationCaseStorePath(projectRoot, child)`, and reads no case store when `adjudicationEnabled` is false. Pass both at all seven call sites listed in Technical Approach.
4. Verify GREEN and commit: "fix(build-review): scope effective-verdict case reads to the child and adjudication flag".

**Done when:**
- [test] `resolveEffectiveBuildReviewVerdict` with a child reads only `.pipeline/children/<child>/remediation-cases.json` (an injected `createCaseStore` records only that path) and never the flat store.
- [test] With `adjudicationEnabled: false` it constructs no case store and treats no finding as carried.
- [test] A type-level test (`@ts-expect-error` on a call omitting `child` and on one omitting `adjudicationEnabled`) proves both parameters are required, and the engine typecheck passes with all seven production call sites updated.
- [test] Conductor, step-runner and artifacts exit tests for a child review each pass the child, so the injected `createCaseStore` records only `.pipeline/children/<child>/remediation-cases.json` and never the flat store at any of the seven call sites.
- [test] For one fixture with carried F2, the settled set used by the coordinator's live source set, by `resolveEffectiveBuildReviewVerdict` at the conductor, step-runner and artifacts exits, by `build-review findings`, and by clean-PASS settlement all contain F2.

**Files:** src/conductor/src/engine/build-review-effective.ts; src/conductor/src/engine/conductor.ts; src/conductor/src/engine/step-runners.ts; src/conductor/src/engine/artifacts.ts; src/conductor/test/engine/build-review-effective.test.ts; src/conductor/test/engine/remediation-case-child.test.ts

### Task 16: One shared predicate retires accepted, absent and failed cases
**Story:** Story 9
**Type:** happy-path
**Dependencies:** Task 3, Task 5

**Steps:**
1. Write failing reconciler tests for `retiresOpenBuildReviewCase`, and coordinator tests for `finalize` retirement through it.
2. Verify RED.
3. Implement and export `retiresOpenBuildReviewCase(record, { coveredSourceIds, raisedSourceIds, mechanicallyHealthy })` in `remediation-case-reconciler.ts`, the only open-case retirement owner. A source counts as covered when it is accepted this lap, carries an origin, or is `carried`. An action case whose effect is `applied`, `failed` or `reserved` retires when every source is covered or, on a mechanically healthy lap, not raised. On retirement:
   - set `resolution: resolved`;
   - turn a `reserved` effect into `failed` with diagnostic `retired: every source operator-accepted or no longer raised`;
   - keep every link and earlier effect state;
   - append one `remediation_case_reconciled` outbox entry with a fresh `eventId`.

   Call the predicate from reconciler absence resolution, from `finalize`, and from `resolveAbsentFailedBuildReviewCases` (`remediation-case-effects.ts`), deleting their private conditions. Open deferrals and decision stops never satisfy it.
4. Verify GREEN and commit: "feat(remediation): one retirement predicate for accepted and absent cases".

**Done when:**
- [test] `retiresOpenBuildReviewCase` returns true for an open action case with a `failed` effect whose only source carries an origin, true for one with a `reserved` effect whose every source is accepted this lap, true for a `failed` case whose source is not raised on a mechanically healthy lap, and false for that last case on a lap that is not mechanically healthy.
- [test] It returns false for a `failed` action case whose source is still raised and unaccepted, for an open deferral with a `failed` effect, and for an open decision stop.
- [test] Retirement through `finalize` leaves the case `resolved` with every link and earlier effect state kept, turns a `reserved` effect into `failed` with the retirement diagnostic, and appends exactly one `remediation_case_reconciled` outbox entry with an `eventId`.
- [test] Reconciler absence resolution, `finalize` and `resolveAbsentFailedBuildReviewCases` reach the same retirement result as the predicate for every fixture above.

**Files:** src/conductor/src/engine/remediation-case-reconciler.ts; src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/src/engine/remediation-case-effects.ts; src/conductor/test/engine/remediation-case-reconciler.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/engine/remediation-case-effects.test.ts

### Task 17: Settle accepted and absent failed cases at a clean PASS
**Story:** Story 9
**Type:** happy-path
**Dependencies:** Task 16

**Steps:**
1. Write failing conductor tests in `conductor-build-review-adjudication.test.ts` replaying the #3303 store shape, plus the blocking variants.
2. Verify RED.
3. Implement in `settleRemediationCasesOnCleanBuildReview` (`conductor.ts`): decide retirement only through `retiresOpenBuildReviewCase`. When an action obligation case survives, the halt reason names `ai-conductor build-review resolve-case --feature <slug> --case <id>`, with ` --child <child>` when the case store is child-scoped. Deferral and decision-stop obligations keep their pre-change reasons unless an operator resolution closed them.
4. Verify GREEN and commit: "fix(build-review): clean PASS settles accepted and absent failed cases".

**Done when:**
- [test] Through the conductor build_review step, the #3303 shape (open action case O, `failed` effect, source F1 accepted on an earlier lap and not raised now) settles at a clean PASS: O is `resolved` with every link and earlier effect state kept, exactly one `remediation_case_reconciled` event is persisted for O, and PASS publishes with no hand edit of `remediation-cases.json`.
- [test] An open action case O with a `failed` effect whose source is still raised and unaccepted halts with text containing `ai-conductor build-review resolve-case --feature <slug> --case <O>`, and the same fixture in a child-scoped store halts with text also containing `--child <child>`.
- [test] An open action case whose source is not raised on a lap with an infrastructure failure or reduced coverage is not retired, and a failed deferral or open decision stop with no operator resolution still halts with its pre-change settlement reason.
- [test] Settlement re-run after a crash between the retirement write and the drain leaves O `resolved` once and exactly one `remediation_case_reconciled` line with O's `eventId` in `.pipeline/events.jsonl`.
- [test] After the drain, exactly one `remediation_case_reconciled` event carrying the retired case's `eventId` is persisted for a case retired by absence alone and for a case retired by acceptance alone (a `reserved` effect with every source accepted).

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 18: Drain the outbox at every coordinator and settlement exit
**Story:** Story 8
**Type:** happy-path
**Dependencies:** Task 3, Task 7, Task 16, Task 19

**Steps:**
1. Write failing coordinator, conductor and integration crash tests.
2. Verify RED.
3. Implement:
   - Add `emitOrThrow` to `BuildReviewAdjudicationCoordinatorInput`; `conductor.ts` passes `this.events.emitOrThrow`.
   - Call `drainRemediationCaseOutbox` at coordinator entry before any return, after each `mutate()` that adds outbox entries, and at `settleRemediationCasesOnCleanBuildReview` entry and exit.
   - The drain is the only emitter of the three outbox event types: delete any direct `emit` of `remediation_case_reconciled` for a retirement written to the outbox.
4. Verify GREEN and commit: "feat(build-review): deliver case-store occurrences at every exit".

**Done when:**
- [test] For each of carry, operator resolution and settlement retirement, crash tests at four points (before the transition, after the state `mutate()` and before any emit, after the persist and before the outbox removal, and after the full drain) each end with exactly one `.pipeline/events.jsonl` line per `eventId` and a final store deep-equal across the four.
- [test] With a pending outbox entry, every coordinator early-exit path (halt, decision stop, mechanical retry and PASS) drains the entry before returning.
- [test] A lap with no carry, no operator resolution and no retirement persists no `build_review_acceptance_carried`, `remediation_case_operator_resolved` or `eventId`-bearing `remediation_case_reconciled` event.
- [test] The persisted `remediation_case_operator_resolved` event carries the `occurredAt` that `resolve-case` stamped, not the drain time.
- [test] The persisted `build_review_acceptance_carried` event for carried F2 names the feature, the lap id, F2's source id, case C, and C's origin source ids and origin laps.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/src/engine/build-review-outcome.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/engine/conductor-build-review-adjudication.test.ts; src/conductor/test/integration/remediation-case-recovery.integration.test.ts

### Task 19: The build-review resolve-case command
**Story:** Story 10
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `build-review-cli.test.ts` and the CLI catalog tests.
2. Verify RED.
3. Implement:
   - `RemediationCaseStore.resolveByOperator({ caseId, operator, rationale, resolvedAt })` in `remediation-case-store.ts`, the only operator writer of case state. Under the store lease it resolves an open case, records `operatorResolution`, turns a `reserved` effect into `failed`, keeps every link and earlier effect state, and appends one `remediation_case_operator_resolved` outbox entry stamped with `resolvedAt`.
   - `dispatchBuildReviewResolveCase` in `build-review-cli.ts`. It reuses `accept`'s inline interactive-TTY and `resolveOperator` gate, supports `--child`, prints the resolution, and appends nothing to `.pipeline/events.jsonl`.
   - Wire `detectBuildReviewResolveCaseCommand` (`cli.ts`), `PRE_DISPATCH_COMMANDS` (`cli-pre-dispatch.ts`), `createProgram()`, and `dispatchCliCommand()` (`index.ts`).
4. Verify GREEN and commit: "feat(build-review): resolve-case operator command".

**Done when:**
- [test] On an interactive TTY with a resolved operator, `ai-conductor build-review resolve-case --feature F --case O --rationale "r"` leaves O `resolved` with `operatorResolution` `{ operator, rationale: "r", resolvedAt }`, turns a `reserved` effect into `failed`, keeps every link and earlier effect state, writes exactly one outbox entry, prints the resolution, and leaves `.pipeline/events.jsonl` byte-identical.
- [test] With `--child c`, only `.pipeline/children/c/remediation-cases.json` changes, and the flat store is byte-identical.
- [test] An unknown case id, an already resolved case, an empty rationale, a non-interactive session, an unresolved operator identity and a feature mismatch each exit non-zero with a message naming that reason, and the store file is byte-identical.
- [test] While another holder keeps the case-store lease, the command writes only after acquiring it, and on lease timeout it exits with `lock-timeout` and the store file is byte-identical.
- [test] The CLI catalog tests find `resolve-case` declared under `build-review` in `createProgram()`, its detector in `PRE_DISPATCH_COMMANDS`, and dispatch through `dispatchCliCommand()` beside `accept`.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/src/engine/build-review-cli.ts; src/conductor/src/cli.ts; src/conductor/src/cli-pre-dispatch.ts; src/conductor/src/index.ts; src/conductor/test/engine/build-review-cli.test.ts; src/conductor/test/cli/pre-dispatch-registry.test.ts

### Task 20: A later binding to an operator-resolved case carries
**Story:** Story 10
**Type:** happy-path
**Dependencies:** Task 8, Task 18, Task 19

**Steps:**
1. Write a failing conductor test: resolve case O with `dispatchBuildReviewResolveCase`, then run the next build_review lap with a judgement binding a re-raised finding to O.
2. Verify RED.
3. Fix any wiring the test exposes. Eligibility stays in `isCarryEligibleRemediationCase`.
4. Verify GREEN and commit: "test(build-review): operator-resolved cases carry later bindings".

**Done when:**
- [test] After `resolve-case` resolves O, the next conductor build_review lap binding re-raised finding F to O settles F as `carried`, with no halt, no work order and zero `chargeEffect` calls.
- [test] That lap's drain persists exactly one `remediation_case_operator_resolved` event for O before the lap's `build_review_acceptance_carried` event.

**Files:** src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 21: Legacy stores survive a lap unchanged
**Story:** Story 11
**Type:** negative-path
**Dependencies:** Task 1, Task 18

**Steps:**
1. Write a failing conductor test that runs one build_review lap over a v2 fixture store and neither carries nor retires anything.
2. Verify RED.
3. Fix only what it exposes.
4. Verify GREEN and commit: "test(remediation): a legacy store survives a lap unchanged".

**Done when:**
- [test] After a conductor build_review lap over a v2 fixture that neither carries nor retires, the written store is `version: "v3"` and every case, link, effect and suppression is deep-equal to the input, with an empty outbox.
- [test] The same lap over a v1 fixture produces the same result.

**Files:** src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 22: Guard the single owner of each rule
**Story:** Story 12
**Type:** infrastructure
**Dependencies:** Task 5, Task 7, Task 16, Task 19

**Steps:**
1. Write a test, `remediation-case-ownership-guard.test.ts`, that parses every production file under `src/conductor/src/` with the TypeScript compiler API.
2. Implement it to fail, naming the file, when any of these appears outside its owner:
   - an object literal with `outcome: 'carried'` outside the reconciler carry lane;
   - a write to `operatorAcceptance` outside `finalize`;
   - a write to `operatorResolution` outside `RemediationCaseStore.resolveByOperator`;
   - a read of an origin's `lapId` outside `isCarryEligibleRemediationCase`;
   - a `resolution: 'resolved'` write for a build_review case outside `retiresOpenBuildReviewCase`, `resolveByOperator`, and the existing reconciler refutation and deferral lanes.
3. Verify it passes on the tree and fails on a planted violation fixture for each rule.
4. Commit: "test(remediation): guard single owners of carry and retirement rules".

**Done when:**
- [test] The guard passes on the production tree.
- [test] For each of the five rules, a planted fixture source file that violates it makes the guard fail with a message naming that file and that rule.

**Files:** src/conductor/test/engine/remediation-case-ownership-guard.test.ts

### Task 23: build-review findings lists carried and operator-resolved state
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 9, Task 19

**Steps:**
1. Write failing tests in `build-review-cli.test.ts`.
2. Verify RED.
3. Implement in `dispatchBuildReviewFindings` (`build-review-cli.ts`): add `--child`, read the child-scoped store, and list:
   - each `carried` source, with case id, origin source ids, origin laps, and the origin dispositions' operators and rationales;
   - each operator-resolved case, with operator, rationale and `resolvedAt`;
   - each pending outbox entry.

   Mirror each in `--json`, and extend the detector in `cli.ts` and the `createProgram()` declaration for `--child`.
4. Verify GREEN and commit: "feat(build-review): findings shows carried and operator-resolved state".

**Done when:**
- [test] `build-review findings --feature <slug>` prints, for carried F2, its case id, origin source ids, origin laps, and each origin disposition's operator and rationale, and `--json` carries the same fields.
- [test] It prints each operator-resolved case with its operator, rationale and resolution time, and `--child <child>` lists only that child's carried and operator-resolved state.
- [test] With no carried source and no operator-resolved case it prints no carried or operator-resolved row, and with an undrained outbox entry it prints that pending entry.

**Files:** src/conductor/src/engine/build-review-cli.ts; src/conductor/src/cli.ts; src/conductor/src/index.ts; src/conductor/test/engine/build-review-cli.test.ts

### Task 24: Accepted-risk section lists carried and operator-resolved rows
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 9, Task 19

**Steps:**
1. Write failing tests in `build-review-dispositions.test.ts`, `shipped-record.test.ts` and `finish-publication-production.test.ts`.
2. Verify RED.
3. Implement in `renderBuildReviewAcceptedRisk` (`build-review-accepted-risk.ts`). It takes the case-store read result as well:
   - each carried row shows finding id, rubric, carried-from origin id and lap;
   - each operator-resolved row shows case id and source ids;
   - no row shows an operator, rationale, summary or time (#1614).

   On an unreadable case store it renders every direct row, fabricates no carried row, and adds a line reporting the unreadable case store. Pass the case store from `publishAcceptedBuildReviewRiskToRetainedPr` (`finish-publication-production.ts`) and `appendBuildReviewAcceptedRisk` (`shipped-record.ts`).
4. Verify GREEN and commit: "feat(build-review): publish carried and operator-resolved accepted risk".

**Done when:**
- [test] Finish publication and the shipped record each render, for carried F2, a row with F2's finding id, rubric, carried-from origin id and lap, and for operator-resolved O a row with O's id and source ids.
- [test] The rendered section contains no operator name, rationale, summary or time for any direct, carried or operator-resolved row.
- [test] With an unreadable case store, every direct accepted row is rendered, no carried row appears, and the section contains the unreadable-case-store line, and with no carried or operator-resolved state the section has no such rows.

**Files:** src/conductor/src/engine/build-review-accepted-risk.ts; src/conductor/src/engine/finish-publication-production.ts; src/conductor/src/engine/shipped-record.ts; src/conductor/test/engine/build-review-dispositions.test.ts; src/conductor/test/engine/shipped-record.test.ts; src/conductor/test/engine/finish-publication-production.test.ts

## Task Dependency Graph

```text
Task 1 ─┬─▶ Task 4
        ├─▶ Task 5 ─────────────┬─▶ Task 8 ─┬─▶ Task 10
        ├─▶ Task 6 ─▶ Task 7 ───┘           ├─▶ Task 11 (also Task 5)
        │        └─▶ Task 14                ├─▶ Task 12
        ├─▶ Task 9 ─┬─▶ Task 8              └─▶ Task 13
        │           └─▶ Task 15
        └─▶ Task 19
Task 2 ─▶ Task 3 (also Task 1)
Task 3, Task 5 ─▶ Task 16 ─▶ Task 17
Task 3, Task 7, Task 16, Task 19 ─▶ Task 18 ─▶ Task 20 (also Task 8, Task 19)
Task 1, Task 18 ─▶ Task 21
Task 5, Task 7, Task 16, Task 19 ─▶ Task 22
Task 9, Task 19 ─▶ Task 23, Task 24 (slice 2)
```

## Integration Points

- After Task 8: the conductor build_review step carries an action re-raise bound to an accepted case and publishes PASS (#3211 replay).
- After Task 10: escalations bound to accepted cases no longer open decision stops.
- After Task 17: a clean PASS settles the #3303 store shape.
- After Task 18: every new occurrence reaches `.pipeline/events.jsonl` exactly once across crashes.
- After Task 19: `ai-conductor build-review resolve-case` is dispatchable.
- After Tasks 23–24 (slice 2): carried and operator-resolved state is visible in `findings` and in the PR and shipped record.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given resolved action case C with an `applied` effect whose source F1 the operator accepted on lap L1, when lap L2 raises the same substance as finding F2 and the judgement binds F2 to C by `existingCaseId` with disposition `act`, then F2 settles as carried: no `semantic remediation case regression` or `semantic remediation case repeat` halt occurs, no BUILD work order is published, no kickback is charged, and C gains exactly one new source link for F2 with outcome `carried` while its disposition, resolution, effect and earlier links are unchanged. | 8 | "A coordinator lap binding F2 by `existingCaseId` with `act` to resolved case C (applied effect, F1 accepted on L1) returns no `semantic remediation case regression` or `semantic remediation case repeat` detail, publishes no BUILD work order, records zero `chargeEffect` calls, and leaves C with one new `carried` link for F2 and every other field unchanged." | diff-local |
| Story 1 happy: Given F2 is the only unresolved content finding of mechanically healthy lap L2, when the effective verdict is derived, then it is PASS and no second `build-review accept` is needed. | 8 | "Through the conductor build_review step, the #3211 two-lap sequence on a custom eventSpine finding and on a built-in finding publishes effective PASS on lap 2 with zero kickback ledger increments and no second `build-review accept`." | diff-local |
| Story 1 happy: Given F2 was carried on L2, when lap L3 raises the same substance as F3 and the judgement binds F3 to C, then F3 also settles as carried from C's original L1 acceptance. | 8 | "A three-lap test binding F3 to C on L3 carries F3 from C's L1 origin, and a lap binding F2 to an unaccepted resolved action case still halts `semantic remediation case regression C` with no carried link." | diff-local |
| Story 1 happy: Given the #3211 sequence replayed with a custom eventSpine rubric finding whose finding id differs on every lap, when the second lap binds the re-raised finding to the accepted case, then that lap settles with no halt. | 8 | "Through the conductor build_review step, the #3211 two-lap sequence on a custom eventSpine finding and on a built-in finding publishes effective PASS on lap 2 with zero kickback ledger increments and no second `build-review accept`." | diff-local |
| Story 1 negative: Given resolved action case C with an `applied` or `failed` effect that holds no acceptance origin and no operator resolution, when lap L2 binds F2 to C by `existingCaseId` with disposition `act`, then the lap halts `semantic remediation case regression C` exactly as today and persists no carried link. | 6, 8 | "A three-lap test binding F3 to C on L3 carries F3 from C's L1 origin, and a lap binding F2 to an unaccepted resolved action case still halts `semantic remediation case regression C` with no carried link." | diff-local |
| Story 1 negative: Given C's only acceptance origin was recorded on the current lap, when the same lap's judgement binds another finding to C, then that finding is not carried and today's reuse rule applies to it. | 6, 8 | "When C's only origin was written on the current lap, a same-lap rebinding of another finding to C is not carried and takes the pre-change reuse result." | diff-local |
| Story 1 negative: Given lap L2 binds F2 to carry-eligible C and also raises an unbound content finding G, when the lap settles, then only F2 is carried and G routes exactly as it would without F2. | 8 | "In a lap that carries F2 and also raises unbound content finding G, G's route, case and charge are identical to the same lap without F2, and a lap that also has an infrastructure failure does not publish PASS." | diff-local |
| Story 1 negative: Given lap L2 has an infrastructure failure beside carried F2, when the effective verdict is derived, then the infrastructure result still blocks until it heals or has an exact reduced-coverage decision. | 8 | "In a lap that carries F2 and also raises unbound content finding G, G's route, case and charge are identical to the same lap without F2, and a lap that also has an infrastructure failure does not publish PASS." | diff-local |
| Story 2 happy: Given carry-eligible case C, when a later lap's judgement binds re-raised finding F2 to C by `existingCaseId` with disposition `escalate` and source ids that differ from C's, then F2 settles as carried, no open decision stop is persisted, and the lap does not halt with `decision stop` or `conflicting-case-id`. | 10 | "Replaying the 2026-10-17 shape, an escalation bound to carry-eligible C with differing source ids settles F2 as `carried`, persists no open decision stop, and the conductor build_review step writes no HALT containing `decision stop` or `conflicting-case-id`." | diff-local |
| Story 2 happy: Given carry-eligible case C, when a later lap binds F2 to C with disposition `defer`, `reject` or `refute`, then F2 settles as carried, no deferral effect is reserved, no intake issue is filed, and no kickback is charged. | 10 | "`defer`, `reject` and `refute` bindings to carry-eligible C each settle F2 as `carried`, reserve no deferral effect, file no intake issue, and record zero `chargeEffect` calls." | diff-local |
| Story 2 negative: Given resolved case R with no acceptance origin and no operator resolution, when a later lap binds an escalation to R with source ids that differ from R's, then a new open decision stop is persisted and the lap halts exactly as today. | 10 | "An escalation bound to resolved R with no origin and no operator resolution persists a new open decision stop and halts, an escalation bound to open stop D with a different source set or owner returns `conflicting-case-id` and writes nothing, and an unbound escalation of the same substance beside carry-eligible C persists a decision stop and halts." | diff-local |
| Story 2 negative: Given open decision stop D with no operator resolution, when a later lap binds an escalation to D's id with a different source set or owner, then persistence fails `conflicting-case-id` and writes nothing, exactly as today. | 10 | "An escalation bound to resolved R with no origin and no operator resolution persists a new open decision stop and halts, an escalation bound to open stop D with a different source set or owner returns `conflicting-case-id` and writes nothing, and an unbound escalation of the same substance beside carry-eligible C persists a decision stop and halts." | diff-local |
| Story 2 negative: Given carry-eligible case C, when a later lap escalates the same substance as an unbound case, then a decision stop is persisted and the lap halts exactly as today. | 10 | "An escalation bound to resolved R with no origin and no operator resolution persists a new open decision stop and halts, an escalation bound to open stop D with a different source set or owner returns `conflicting-case-id` and writes nothing, and an unbound escalation of the same substance beside carry-eligible C persists a decision stop and halts." | diff-local |
| Story 2 negative: Given one lap in which F2 is bound to carry-eligible C as `escalate` and an unbound escalation G is raised, when the lap settles, then F2 is carried and G still produces its decision stop. | 10 | "In one lap where F2 is bound to C as `escalate` and unbound escalation G is raised, F2 is carried and G's decision stop is persisted." | diff-local |
| Story 3 happy: Given open action case O whose only source is F1 and the operator accepts F1 during lap L1, when L1 finalizes, then O is resolved and records the acceptance origin F1 on lap L1. | 5 | "After a lap in which the operator accepts F1, the only source of open action case O, finalize leaves O `resolved` with `operatorAcceptance.origins` exactly `[{ sourceId: F1, lapId: L1 }]`, for a built-in finding and for a custom-rubric finding." | diff-local |
| Story 3 happy: Given a lap halted `semantic remediation case regression C` because finding F2 was bound to resolved C, when the halt is recorded, then F2 is linked to C with outcome `acted` and nothing else on C changes, and after the operator accepts F2 and the next lap finalizes, C records the acceptance origin F2 on that lap. | 11 | "A lap that halts `semantic remediation case regression C` because F2 is bound to resolved C leaves C with one new link `{ sourceId: F2, outcome: "acted" }` and every other field of C deep-equal to before." | diff-local |
| Story 3 happy: Given C recorded an origin for F2 after a regression halt, when a later lap binds re-raised F3 to C, then F3 settles as carried with no halt. | 11 | "After the operator accepts F2 and the next lap finalizes, C holds origin F2 on that lap, and a later lap binding re-raised F3 to C settles F3 as `carried` with no halt." | diff-local |
| Story 3 negative: Given open case O with sources F1 and F2, when the operator accepts only F1 and F2 is still raised as L1 finalizes, then O stays open with origin F1 recorded, and a later lap binding a finding to O is not carried. | 5 | "For open O with sources F1 and F2 where only F1 is accepted and F2 is still raised, finalize leaves O `open` with origins exactly `[F1 on L1]`, and a later lap binding a finding to O by `existingCaseId` is not carried and takes the pre-change reuse result." | diff-local |
| Story 3 negative: Given finding F1 is hidden by the confidence floor rather than accepted by an exact disposition, when the lap finalizes, then no acceptance origin is written for F1. | 5 | "A finding below the confidence floor and not accepted by an exact disposition gains no origin, and a finalize replayed after a simulated crash leaves exactly one origin for F1 on L1." | diff-local |
| Story 3 negative: Given the lap finalizes again after a crash, when origins are written, then C holds the origin for F1 on L1 exactly once. | 5 | "A finding below the confidence floor and not accepted by an exact disposition gains no origin, and a finalize replayed after a simulated crash leaves exactly one origin for F1 on L1." | diff-local |
| Story 3 negative: Given a judgement or provider output that sets `operatorAcceptance`, `operatorResolution` or a `carried` source outcome, when it is validated, then it is rejected fail-closed and the case store is byte-identical. | 4 | "`coordinateBuildReviewAdjudication` given each of those judgements fails closed with no `mutate()` write, and the case store file is byte-identical." | diff-local |
| Story 4 happy: Given carry-eligible case C, when a later lap raises a finding with C's rubric, path and summary that the judgement proposes as an unbound case, then the finding is not carried and is admitted as a new case, with a new action charged against the kickback budget, as #3292's D5.6 prescribes. | 12 | "Beside carry-eligible C, an unbound proposal for a finding with C's rubric, path and summary persists a new case with a reserved action effect and one `chargeEffect` call, and no `carried` link." | diff-local |
| Story 4 happy: Given the origin disposition for C was withdrawn or invalidated before lap L3, when L3 binds re-raised F3 to C, then F3 is not carried and today's reuse rule applies, while F2 carried on an earlier lap stays settled. | 12 | "After C's origin disposition is withdrawn (a fixture whose disposition is absent from `BuildReviewDispositionStore.list` because its rubric is retired) and after it is invalidated (a contract-version invalidation fixture), a binding of F3 to C is not carried and takes the pre-change reuse result in each, while F2, carried on an earlier lap, stays in `finalizedBuildReviewSourceIds`." | diff-local |
| Story 4 negative: Given a case holding no acceptance origin and no operator resolution, when a later lap binds a finding to it with any disposition, then the finding is not carried and today's repeat, regression, deferral and decision-stop rules apply. | 12 | "A binding to a case with no origin and no operator resolution, for each of `act`, `escalate`, `defer`, `reject` and `refute`, produces the pre-change route, and an unbound, unmatched current finding resembling an accepted one by rubric, path or summary is not suppressed." | diff-local |
| Story 4 negative: Given a current finding whose exact id matches no disposition and which the judgement does not bind, when it resembles an accepted finding by rubric, path or summary, then it is not suppressed. | 12 | "A binding to a case with no origin and no operator resolution, for each of `act`, `escalate`, `defer`, `reject` and `refute`, produces the pre-change route, and an unbound, unmatched current finding resembling an accepted one by rubric, path or summary is not suppressed." | diff-local |
| Story 4 negative: Given the disposition store is unreadable or malformed, when a later lap binds F2 to C, then F2 is not carried and the gate takes exactly the path it takes today for an unreadable disposition store. | 12 | "With an unreadable disposition store and with a malformed disposition store (which `BuildReviewDispositionStore` reports as `kind: 'unreadable'`), a binding of F2 to C carries nothing and each lap result equals the pre-change result for an unreadable disposition store, and with an unreadable case store and with a malformed case store the lap fails closed with the pre-change case-store failure and nothing carried." | diff-local |
| Story 4 negative: Given the case store is unreadable or malformed, when the lap runs, then nothing is carried and the gate fails closed exactly as today. | 12 | "With an unreadable disposition store and with a malformed disposition store (which `BuildReviewDispositionStore` reports as `kind: 'unreadable'`), a binding of F2 to C carries nothing and each lap result equals the pre-change result for an unreadable disposition store, and with an unreadable case store and with a malformed case store the lap fails closed with the pre-change case-store failure and nothing carried." | diff-local |
| Story 5 happy: Given a carry-eligible case on feature A, when feature B's lap raises a finding with the same substance, then feature B's finding is not carried. | 13 | "A carry-eligible case on feature A does not carry feature B's same-substance finding: B's lap takes the pre-change route." | diff-local |
| Story 5 happy: Given a stacked child with its own carry-eligible case, when the child's lap binds a re-raised finding to it, then the finding is carried using the child's case store and the feature's disposition store. | 13 | "A stacked child binding a re-raised finding to its own carry-eligible case appends the `carried` link in `.pipeline/children/<child>/remediation-cases.json`, the carry's effective accepted set is read from the feature's `.pipeline/build-review-dispositions.json`, and the flat case store is byte-identical." | diff-local |
| Story 5 negative: Given a disposition record whose feature identity differs from the current feature, when origins are written or carry is decided, then it neither records an origin nor carries a finding. | 5, 13 | "A child binding a finding to a case id that exists only in a sibling child's store is not resolved against the sibling's store and carries nothing, and a disposition with a different feature identity enables no carry." | diff-local |
| Story 5 negative: Given a stacked child whose sibling holds carry-eligible case C, when the child's judgement binds a finding to C's id, then the binding is not resolved against the sibling's store and nothing is carried. | 13 | "A child binding a finding to a case id that exists only in a sibling child's store is not resolved against the sibling's store and carries nothing, and a disposition with a different feature identity enables no carry." | diff-local |
| Story 5 negative: Given a child's build_review verdict is derived, when its settled sources are read, then only that child's case store is read. | 15 | "`resolveEffectiveBuildReviewVerdict` with a child reads only `.pipeline/children/<child>/remediation-cases.json` (an injected `createCaseStore` records only that path) and never the flat store." | diff-local |
| Story 6 happy: Given a carry-eligible prior case, when the adjudication context is assembled, then that case carries an `operatorAccepted` marker naming its origin source ids and origin lap ids. | 14 | "`assembleBuildReviewAdjudicationContext` projects `operatorAccepted` with exact origin source ids and lap ids on a carry-eligible case, and no `operatorAccepted` on an ineligible case, including one whose origin disposition was withdrawn (absent from `BuildReviewDispositionStore.list`) and one whose origin disposition no longer matches." | diff-local |
| Story 6 happy: Given the `remediate` skill contract, when it describes prior cases, then it states that a same-substance finding may be bound to a case marked `operatorAccepted` and that the adjudicator never asserts or creates acceptance. | 14 | "The remediate skill contract test asserts the text still matches `/never assert or create operator\s+acceptance/i` and states that a same-substance finding may be bound to a case marked `operatorAccepted`." | diff-local |
| Story 6 negative: Given a prior case that is not carry-eligible, including one whose origin disposition was withdrawn, when the context is assembled, then it carries no `operatorAccepted` marker. | 14 | "`assembleBuildReviewAdjudicationContext` projects `operatorAccepted` with exact origin source ids and lap ids on a carry-eligible case, and no `operatorAccepted` on an ineligible case, including one whose origin disposition was withdrawn (absent from `BuildReviewDispositionStore.list`) and one whose origin disposition no longer matches." | diff-local |
| Story 6 negative: Given a carry-eligible case, when the context is assembled, then no operator name and no rationale appear anywhere in the context. | 14 | "The serialized context of a carry-eligible case contains neither the disposition's operator name nor its rationale, and a context at the byte ceiling with marked cases applies the existing overflow rule with the same result as the unmarked fixture." | diff-local |
| Story 6 negative: Given marked cases push the context to its byte ceiling, when it is assembled, then the existing overflow rule applies unchanged. | 14 | "The serialized context of a carry-eligible case contains neither the disposition's operator name nor its rationale, and a context at the byte ceiling with marked cases applies the existing overflow rule with the same result as the unmarked fixture." | diff-local |
| Story 7 happy: Given a carried finding, when `ai-conductor build-review findings --feature <slug>` runs, then it lists the finding as carried with its case id, origin source ids, origin laps, and the origin dispositions' operators and rationales, and `--json` carries the same fields. | 23 | "`build-review findings --feature <slug>` prints, for carried F2, its case id, origin source ids, origin laps, and each origin disposition's operator and rationale, and `--json` carries the same fields." | diff-local |
| Story 7 happy: Given an operator-resolved case, when `build-review findings` runs, then it lists the case with its operator, rationale and resolution time. | 23 | "It prints each operator-resolved case with its operator, rationale and resolution time, and `--child <child>` lists only that child's carried and operator-resolved state." | diff-local |
| Story 7 happy: Given a feature with carried findings and operator-resolved cases, when finish publication or the shipped record renders the accepted-risk section, then each carried finding is listed with its finding id, rubric, carried-from origin id and lap, and each operator-resolved case with its case id and source ids. | 24 | "Finish publication and the shipped record each render, for carried F2, a row with F2's finding id, rubric, carried-from origin id and lap, and for operator-resolved O a row with O's id and source ids." | diff-local |
| Story 7 happy: Given a stacked child, when `build-review findings --feature <slug> --child <child>` runs, then it lists that child's carried and operator-resolved state. | 23 | "It prints each operator-resolved case with its operator, rationale and resolution time, and `--child <child>` lists only that child's carried and operator-resolved state." | diff-local |
| Story 7 negative: Given carried findings and operator-resolved cases, when the PR accepted-risk section is rendered, then no operator name, rationale, summary or time appears in it. | 24 | "The rendered section contains no operator name, rationale, summary or time for any direct, carried or operator-resolved row." | diff-local |
| Story 7 negative: Given the case store is unreadable when the accepted-risk section is rendered, when publication runs, then every directly accepted finding is still rendered, no carried row is fabricated, and the unreadable state is reported. | 24 | "With an unreadable case store, every direct accepted row is rendered, no carried row appears, and the section contains the unreadable-case-store line, and with no carried or operator-resolved state the section has no such rows." | diff-local |
| Story 7 negative: Given a feature with no carried finding and no operator-resolved case, when findings or the accepted-risk section renders, then no carried or operator-resolved row appears. | 23, 24 | "With no carried source and no operator-resolved case it prints no carried or operator-resolved row, and with an undrained outbox entry it prints that pending entry." | diff-local |
| Story 7 negative: Given an outbox entry not yet drained, when `build-review findings` runs, then it shows the pending entry. | 23 | "With no carried source and no operator-resolved case it prints no carried or operator-resolved row, and with an undrained outbox entry it prints that pending entry." | diff-local |
| Story 8 happy: Given a finding carried on a lap, when the lap's entries are drained, then exactly one `build_review_acceptance_carried` event is persisted naming the feature, lap, source, case, origin source ids and origin laps. | 7, 18 | "The persisted `build_review_acceptance_carried` event for carried F2 names the feature, the lap id, F2's source id, case C, and C's origin source ids and origin laps." | diff-local |
| Story 8 happy: Given a case resolved by `build-review resolve-case`, when the next engine pass drains, then exactly one `remediation_case_operator_resolved` event is persisted carrying the occurrence time the command stamped. | 18, 20 | "The persisted `remediation_case_operator_resolved` event carries the `occurredAt` that `resolve-case` stamped, not the drain time." | diff-local |
| Story 8 happy: Given a case retired by acceptance or absence, when the entries are drained, then exactly one `remediation_case_reconciled` event with an `eventId` is persisted. | 16, 17 | "After the drain, exactly one `remediation_case_reconciled` event carrying the retired case's `eventId` is persisted for a case retired by absence alone and for a case retired by acceptance alone (a `reserved` effect with every source accepted)." | diff-local |
| Story 8 happy: Given the event union, when sink registration is checked, then both new event types are declared in every sink and in the persister's eventId dedup set. | 2 | "The `EVENT_SINKS` registry test asserts declarations for `build_review_acceptance_carried` and `remediation_case_operator_resolved`, and the event-sink registry exhaustiveness test passes." | diff-local |
| Story 8 negative: Given a crash after the state change is written and before any emit, when the next drain runs, then the event is persisted exactly once and the final state is identical. | 3, 18 | "For each of carry, operator resolution and settlement retirement, crash tests at four points (before the transition, after the state `mutate()` and before any emit, after the persist and before the outbox removal, and after the full drain) each end with exactly one `.pipeline/events.jsonl` line per `eventId` and a final store deep-equal across the four." | diff-local |
| Story 8 negative: Given a crash after the event is persisted and before its outbox entry is removed, when the next drain runs, then the repeat is dropped as a duplicate and exactly one line exists for that `eventId`. | 3 | "A drain interrupted after `emitOrThrow` resolves and before the removal `mutate()`, followed by a second drain, leaves exactly one line for that `eventId` (the repeat reported `duplicate`) and an empty outbox." | diff-local |
| Story 8 negative: Given a pending outbox entry, when the coordinator returns through any early-exit path, then the entry is drained first. | 18 | "With a pending outbox entry, every coordinator early-exit path (halt, decision stop, mechanical retry and PASS) drains the entry before returning." | diff-local |
| Story 8 negative: Given a lap with no carry, no operator resolution and no retirement, when it settles, then none of these events is emitted. | 18 | "A lap with no carry, no operator resolution and no retirement persists no `build_review_acceptance_carried`, `remediation_case_operator_resolved` or `eventId`-bearing `remediation_case_reconciled` event." | diff-local |
| Story 8 negative: Given the persister fails to write an event, when the drain runs, then the outbox entry stays in place and is delivered by a later drain. | 3 | "When `emitOrThrow` rejects, the drain returns without removing the entry, the outbox is byte-identical, and a later drain with a working persister delivers the entry exactly once." | diff-local |
| Story 9 happy: Given open action case O with a `failed` effect whose source F1 the operator accepted on an earlier lap, when a clean PASS lap settles, then O is resolved with every link and earlier effect state kept, one `remediation_case_reconciled` event is persisted, and PASS publishes. | 17 | "Through the conductor build_review step, the #3303 shape (open action case O, `failed` effect, source F1 accepted on an earlier lap and not raised now) settles at a clean PASS: O is `resolved` with every link and earlier effect state kept, exactly one `remediation_case_reconciled` event is persisted for O, and PASS publishes with no hand edit of `remediation-cases.json`." | diff-local |
| Story 9 happy: Given open action case O with a `reserved` effect whose every source is accepted, when the lap settles, then O is resolved and its effect becomes `failed` with a diagnostic naming the retirement reason. | 16 | "Retirement through `finalize` leaves the case `resolved` with every link and earlier effect state kept, turns a `reserved` effect into `failed` with the retirement diagnostic, and appends exactly one `remediation_case_reconciled` outbox entry with an `eventId`." | diff-local |
| Story 9 happy: Given open action case O with a `failed` effect whose source is not raised on a mechanically healthy lap, when the lap settles, then O is resolved by absence. | 16 | "`retiresOpenBuildReviewCase` returns true for an open action case with a `failed` effect whose only source carries an origin, true for one with a `reserved` effect whose every source is accepted this lap, true for a `failed` case whose source is not raised on a mechanically healthy lap, and false for that last case on a lap that is not mechanically healthy." | diff-local |
| Story 9 negative: Given open action case O with a `failed` effect whose source is still raised and unaccepted, when a PASS is attempted, then settlement halts naming O and the exact command `ai-conductor build-review resolve-case --feature <slug> --case <O>`, with `--child <child>` when the case store is child-scoped. | 17 | "An open action case O with a `failed` effect whose source is still raised and unaccepted halts with text containing `ai-conductor build-review resolve-case --feature <slug> --case <O>`, and the same fixture in a child-scoped store halts with text also containing `--child <child>`." | diff-local |
| Story 9 negative: Given open action case O whose source is not raised on a lap with an infrastructure failure or reduced coverage, when the lap settles, then O is not retired by absence. | 16, 17 | "An open action case whose source is not raised on a lap with an infrastructure failure or reduced coverage is not retired, and a failed deferral or open decision stop with no operator resolution still halts with its pre-change settlement reason." | diff-local |
| Story 9 negative: Given a failed deferral or an open decision stop that no operator resolved with `build-review resolve-case`, when a clean PASS is attempted, then settlement still blocks exactly as today. | 17 | "An open action case whose source is not raised on a lap with an infrastructure failure or reduced coverage is not retired, and a failed deferral or open decision stop with no operator resolution still halts with its pre-change settlement reason." | diff-local |
| Story 9 negative: Given settlement runs again after a crash, when O is retired, then O is resolved once and exactly one `remediation_case_reconciled` event exists for it. | 17 | "Settlement re-run after a crash between the retirement write and the drain leaves O `resolved` once and exactly one `remediation_case_reconciled` line with O's `eventId` in `.pipeline/events.jsonl`." | diff-local |
| Story 10 happy: Given an interactive terminal, a resolved machine identity and open case O on feature F, when `ai-conductor build-review resolve-case --feature F --case O --rationale "<text>"` runs, then O is resolved with an operator resolution naming the operator, rationale and time, a `reserved` effect becomes `failed`, every link and earlier effect state is kept, one outbox entry is written, and the command prints the resolution. | 19 | "On an interactive TTY with a resolved operator, `ai-conductor build-review resolve-case --feature F --case O --rationale "r"` leaves O `resolved` with `operatorResolution` `{ operator, rationale: "r", resolvedAt }`, turns a `reserved` effect into `failed`, keeps every link and earlier effect state, writes exactly one outbox entry, prints the resolution, and leaves `.pipeline/events.jsonl` byte-identical." | diff-local |
| Story 10 happy: Given a stacked child, when the command runs with `--child <child>`, then only that child's case store changes. | 19 | "With `--child c`, only `.pipeline/children/c/remediation-cases.json` changes, and the flat store is byte-identical." | diff-local |
| Story 10 happy: Given O was resolved by the command, when a later lap binds a re-raised finding to O, then it settles as carried. | 20 | "After `resolve-case` resolves O, the next conductor build_review lap binding re-raised finding F to O settles F as `carried`, with no halt, no work order and zero `chargeEffect` calls." | diff-local |
| Story 10 negative: Given an unknown case id, an already resolved case, an empty rationale, a non-interactive session, an unresolved machine identity or a feature mismatch, when the command runs, then it refuses naming that reason and the case store is byte-identical. | 19 | "An unknown case id, an already resolved case, an empty rationale, a non-interactive session, an unresolved operator identity and a feature mismatch each exit non-zero with a message naming that reason, and the store file is byte-identical." | diff-local |
| Story 10 negative: Given a running lap holds the case-store lease, when the command runs, then it writes only after acquiring the lease, and on lease timeout it refuses with `lock-timeout` and leaves the store byte-identical. | 19 | "While another holder keeps the case-store lease, the command writes only after acquiring it, and on lease timeout it exits with `lock-timeout` and the store file is byte-identical." | diff-local |
| Story 10 negative: Given the command succeeded, when it exits, then it has appended nothing to `.pipeline/events.jsonl` and the event appears only after the next engine drain. | 19, 20 | "On an interactive TTY with a resolved operator, `ai-conductor build-review resolve-case --feature F --case O --rationale "r"` leaves O `resolved` with `operatorResolution` `{ operator, rationale: "r", resolvedAt }`, turns a `reserved` effect into `failed`, keeps every link and earlier effect state, writes exactly one outbox entry, prints the resolution, and leaves `.pipeline/events.jsonl` byte-identical." | diff-local |
| Story 11 happy: Given a valid v2 case store, when it is read, then every case, link, effect and suppression reads exactly as before. | 1 | "`RemediationCaseStore.read()` over a valid v2 fixture returns every case, link, effect and suppression deep-equal to the pre-change parse of the same fixture." | diff-local |
| Story 11 happy: Given a valid v2 or v1 case store, when the next mutation writes, then the file is written as v3 with every prior case, link, effect and suppression preserved and no acceptance origin, operator resolution or outbox entry invented. | 1 | "The first `mutate()` over a valid v1 fixture and over a valid v2 fixture writes `version: "v3"` with every prior case, link, effect and suppression field-for-field identical, and no `operatorAcceptance`, `operatorResolution` or `outbox` entry present." | diff-local |
| Story 11 negative: Given a v3 store with an unknown key, an unknown source outcome or an outbox entry that is not a valid conductor event, when it is read or mutated, then it fails `malformed-state` and nothing is written. | 1 | "`read()` and `mutate()` over v3 fixtures with an unknown key at the envelope, case, source-link or effect level, an unknown source outcome, an outbox entry whose `event` type is not one of the three outbox event types, or an outbox entry of one of those types whose event body fails that event's shape each return `malformed-state`, and no `writeFile` or `rename` is recorded." | diff-local |
| Story 11 negative: Given a v2 store whose cases use only the pre-change fields, when the coordinator runs a lap that neither carries nor retires, then every case, link, effect and suppression in the written file is identical to the input. | 21 | "After a conductor build_review lap over a v2 fixture that neither carries nor retires, the written store is `version: "v3"` and every case, link, effect and suppression is deep-equal to the input, with an empty outbox." | diff-local |
| Story 12 happy: Given a carried finding, when the coordinator's live source set, the effective verdict at every production exit, the `build-review findings` command and clean-PASS settlement each evaluate it, then all report it as settled. | 15 | "For one fixture with carried F2, the settled set used by the coordinator's live source set, by `resolveEffectiveBuildReviewVerdict` at the conductor, step-runner and artifacts exits, by `build-review findings`, and by clean-PASS settlement all contain F2." | diff-local |
| Story 12 happy: Given adjudication is disabled for the feature, when the effective verdict is derived, then the case store is not read and no finding is treated as carried. | 15 | "With `adjudicationEnabled: false` it constructs no case store and treats no finding as carried." | diff-local |
| Story 12 negative: Given a production caller of the effective-verdict resolver that omits its child scope or adjudication flag, when the engine is compiled, then compilation fails. | 15 | "A type-level test (`@ts-expect-error` on a call omitting `child` and on one omitting `adjudicationEnabled`) proves both parameters are required, and the engine typecheck passes with all seven production call sites updated." | diff-local |
| Story 12 negative: Given a carried link on a source that an open case also links, when settled sources are derived, then the open case's link decides and the source is not settled by carry. | 9 | "When an open case also links F2, the open case's link decides and F2 is not in the settled set." | diff-local |
| Story 12 negative: Given a child review, when its effective verdict is derived at any exit, then it never reads the flat feature store. | 15 | "Conductor, step-runner and artifacts exit tests for a child review each pass the child, so the injected `createCaseStore` records only `.pipeline/children/<child>/remediation-cases.json` and never the flat store at any of the seven call sites." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D1 | task | task-1 | writes `version: "v3"` with every prior case, link, effect and suppression field-for-field identical |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D2 | task | task-5 | `operatorAcceptance.origins` exactly `[{ sourceId: F1, lapId: L1 }]` |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D3 | task | task-6, task-7, task-8, task-10, task-11 | `classifyRemediationCaseReuse` returns `carry` |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D4 | task | task-9, task-14, task-15 | includes F2 when F2's only link is `carried` on resolved case C |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D5 | task | task-16, task-17 | reach the same retirement result as the predicate for every fixture above |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D6 | task | task-2, task-3, task-18 | each end with exactly one `.pipeline/events.jsonl` line per `eventId` |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D7 | task | task-19, task-17 | leaves O `resolved` with `operatorResolution` |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D8 | task | task-23, task-24, task-14 | The rendered section contains no operator name, rationale, summary or time |
| adr-2026-10-20-operator-acceptance-is-durable-case-state#D9 | task | task-12, task-13 | is not resolved against the sibling's store and carries nothing |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | no-change | none | Independent rubric judgement and the mechanical raw join are untouched; no task changes how rubrics run or how raw results join. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | task | task-4, task-5 | rejects a judgement carrying `operatorAcceptance` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | task | task-14 | projects `operatorAccepted` with exact origin source ids and lap ids |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | task | task-4, task-1 | one whose source outcome is `carried` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-1, task-16, task-11 | Reconciler absence resolution, `finalize` and `resolveAbsentFailedBuildReviewCases` reach the same retirement result |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | task | task-16 | for an open deferral with a `failed` effect |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-6, task-8, task-16 | still halts `semantic remediation case regression C` with no carried link |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | task | task-9, task-17 | still halts with its pre-change settlement reason |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-2, task-18 | the event-sink registry exhaustiveness test passes |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | task | task-15 | With `adjudicationEnabled: false` it constructs no case store and treats no finding as carried |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Infrastructure-only versus mixed-lap classification is untouched; a lap with an infrastructure failure still blocks beside a carried finding (Task 8) through the existing mechanical lane. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | task | task-14 | applies the existing overflow rule with the same result as the unmarked fixture |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-8 | still halts `semantic remediation case regression C` with no carried link |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | task | task-5 | A finding below the confidence floor and not accepted by an exact disposition gains no origin |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-9, task-16, task-12 | the open case's link decides and F2 is not in the settled set |
| adr-2026-08-13-stable-build-review-finding-dispositions#D1 | no-change | none | Semantic finding identity is unchanged; carry never alters a canonical identity, and exact-identity matching stays the only disposition match. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D2 | task | task-5, task-12 | stays in `finalizedBuildReviewSourceIds` |
| adr-2026-08-13-stable-build-review-finding-dispositions#D3 | no-change | none | The coordinator and CLI keep serializing through the existing state transactions; `resolve-case` takes the existing case-store lease (Task 19) and no new transaction kind is added. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D4 | task | task-19, task-23 | find `resolve-case` declared under `build-review` in `createProgram()` |
| adr-2026-08-13-stable-build-review-finding-dispositions#D5 | no-change | none | The external-process event ledger is not used by `resolve-case`: its occurrence drains from the case-store outbox (adr-2026-10-20-operator-acceptance-is-durable-case-state D6, D7); `accept` and `record-reduced-coverage` keep the ledger unchanged. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D6 | task | task-24 | a row with F2's finding id, rubric, carried-from origin id and lap |
| adr-2026-09-10-portable-build-review-policy#D1 | no-change | none | The single public gate and the declaration versus execution-policy split are untouched. |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | Installed-catalog identity adapters are unchanged; carry keys sources through the existing `buildReviewAdjudicationSourceId`. |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | Policy bundle binding to execution is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D4 | no-change | none | The installed-policy contract is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D5 | no-change | none | Immutable review access for custom policies is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D6 | no-change | none | Policy-dependent cache operations are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D7 | task | task-8 | on a custom eventSpine finding and on a built-in finding publishes effective PASS on lap 2 |
| adr-2026-09-10-portable-build-review-policy#D8 | no-change | none | The adjudicator's policy and scope evidence are unchanged; the only context addition is the `operatorAccepted` marker governed by adr-2026-10-20-operator-acceptance-is-durable-case-state D4. |
| adr-2026-09-10-portable-build-review-policy#D9 | task | task-10 | persists no open decision stop |
| adr-2026-09-10-portable-build-review-policy#D10 | no-change | none | One authority across attended and daemon execution is preserved: `resolve-case` uses the same interactive-TTY and machine-identity gate as `accept`, which daemon sessions already block. |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-8, task-10 | record zero `chargeEffect` calls |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-2 | asserts declarations for `build_review_acceptance_carried` and `remediation_case_operator_resolved` |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-R11a: Scope recordHaltingBinding (build-review-adjudication-coordinator.ts) to a link-only reconcile: no absence resolution of unreferenced attempted cases. Example: pass an empty attemptedCaseIds, or use a source-append-only reconciler option. Add a coordinator test that a reuse-halt lap leaves every other open attempted applied action case deep-equal and writes no outbox entry.
**Gate:** prd-audit
**Rationale:** Verified 99%. recordHaltingBinding (build-review-adjudication-coordinator.ts:744-757) calls reconcileRemediationCases with a one-case graph and the full attemptedCaseIds. The reconciler's absence branch (remediation-case-reconciler.ts:398-418) therefore resolves every other open, attempted, applied action case, and writes no outbox entry because no lapId is passed. Task 11 Step 3 requires the halting link to change nothing else. This is clear implementation drift inside approved Task 11.
**Criterion:** S1.5
**Parent task:** 11
**Done when:**
- [test] S1.5 is satisfied by this task.
- The repair for task rem-prd-audit-R11a is committed and its targeted tests pass.

### Task rem-as-built-R10a: In build-review-adjudication-coordinator.ts, call authorizeBuildReviewRemediationActionEffects with a judgement or graph that excludes carriedCaseRefs, so a carried escalation cannot suppress independent sibling act cases. Add a coordinator test in which carried escalation F2 sits beside an unrelated act case A in the same lap, and A is still authorized and reserved.
**Gate:** as-built
**Rationale:** Verified 99%. Coordinator :726 passes the unfiltered judgement to authorizeBuildReviewRemediationActionEffects. Any escalation therefore rejects all actions (build-review-adjudication.ts:34), even an escalation already classified as carried. ADR D3 and Task 10 require carry to remove the proposal before the escalation split. This conforming implementation fix fits inside Task 10.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3 is satisfied by this task.
- The repair for task rem-as-built-R10a is committed and its targeted tests pass.

### Task rem-as-built-R10b: Skip carriedCaseRefs in the remediation_case_refuted emission loop in build-review-adjudication-coordinator.ts. Add a test that a refute binding to a carry-eligible case settles as carried and emits no remediation_case_refuted event.
**Gate:** as-built
**Rationale:** Verified 99%. The refute loop at coordinator :897-905 iterates every admitted refute proposal without skipping carriedCaseRefs, so it emits remediation_case_refuted for carried bindings. Task 10 requires carry to remove the proposal from the refutation path. This is implementation drift inside Task 10.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3 is satisfied by this task.
- The repair for task rem-as-built-R10b is committed and its targeted tests pass.

### Task rem-as-built-R16a: Make retiresOpenBuildReviewCase the only retirement decision in remediation-case-reconciler.ts absence resolution (:398/:420) and remediation-case-effects.ts (:212), removing the private conditions. Have the coordinator's finalize supply the coverage and mechanically-healthy inputs. Add parity tests across all three sites for failed and reserved fixtures.
**Gate:** as-built
**Rationale:** Verified 99%. Reconciler absence resolution (:398) still uses its own condition, excluding reserved/failed effects through hasReservedOrFailedRemediationEffect, instead of retiresOpenBuildReviewCase. The finalize call does not supply the reserved-absence option. conductor.ts:5381-5385 returns the missing-work-order invalid result before the shared retirement predicate runs. Tasks 16 and 17 require one shared predicate at every site. This is conforming implementation work.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5 is satisfied by this task.
- The repair for task rem-as-built-R16a is committed and its targeted tests pass.

### Task rem-as-built-R17a: In settleRemediationCasesOnCleanBuildReview (conductor.ts), apply retiresOpenBuildReviewCase before the missing-work-order obligation check, so eligible failed/reserved action cases retire instead of blocking. Add a conductor test for the missing-work-order + accepted-source shape.
**Gate:** as-built
**Rationale:** Verified 99%. Reconciler absence resolution (:398) still uses its own condition, excluding reserved/failed effects through hasReservedOrFailedRemediationEffect, instead of retiresOpenBuildReviewCase. The finalize call does not supply the reserved-absence option. conductor.ts:5381-5385 returns the missing-work-order invalid result before the shared retirement predicate runs. Tasks 16 and 17 require one shared predicate at every site. This is conforming implementation work.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5 is satisfied by this task.
- The repair for task rem-as-built-R17a is committed and its targeted tests pass.

### Task rem-as-built-R16b: In remediation-case-effects.ts retirement, apply the shared retirement transformation: resolved, with a reserved effect turned to failed and given the retirement diagnostic, and links and earlier effect state kept. Add a test that an accepted reserved action retired there ends with a failed effect and the diagnostic.
**Gate:** as-built
**Rationale:** Verified 98%. remediation-case-effects.ts:288 retires cases by changing only resolution, so a reserved action effect stays reserved. Task 16 Step 3 and ADR D5 require a reserved effect to become failed with diagnostic 'retired: every source operator-accepted or no longer raised'. This is a regression inside Task 16.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5 is satisfied by this task.
- The repair for task rem-as-built-R16b is committed and its targeted tests pass.

### Task rem-as-built-R17b: Include 'ai-conductor build-review resolve-case --feature <slug> --case <id>' in the clean-PASS missing-work-order halt reason in conductor.ts, plus ' --child <child>' when the store is child-scoped. Add flat and child-scoped conductor tests asserting the text.
**Gate:** as-built
**Rationale:** Verified 99%. The missing-work-order halt reason at conductor.ts:5385 lacks the 'ai-conductor build-review resolve-case --feature <slug> --case <id>' command and the '--child <child>' scope that Task 17 Step 3 requires for any surviving action obligation case. This is implementation drift inside Task 17.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 7
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 7 is satisfied by this task.
- The repair for task rem-as-built-R17b is committed and its targeted tests pass.

### Task rem-prd-audit-R10c: In build-review-adjudication-coordinator.ts, compute one effective consistency once, after carry classification: the blocked sourceIds/caseRefs minus carriedSourceIds/carriedCaseRefs. Use that single value both for authorizeBuildReviewRemediationActionEffects and for blockedConsistency/the consistency-stop. If no live non-carried source remains, the lap is consistent: no stop, siblings authorized. Otherwise it is blocked: the stop persists over the non-carried sources only, and no action effect is authorized, reserved, published or charged. Add coordinator tests for three shapes. (a) Blocked consistency over only carried F2 settles F2 carried, persists no open decision stop and writes no HALT. (b) Blocked consistency over carried F2 plus live non-carried G persists a stop naming G only and leaves sibling act case A unreserved and uncharged. (c) A consistent verdict with carried F2 beside A still reserves A.
**Gate:** prd-audit
**Rationale:** Verified 99% by reading build-review-adjudication-coordinator.ts. actionEffectJudgement (~:724) downgrades a blocked consistency to consistent when every implicated source is carried. blockedConsistency (~:775) still reads the unfiltered judgement.consistency and filters only by liveSourceIds. A blocked consistency over only carried F2 therefore persists a consistency-stop and halts. Task 10 requires a carried binding to persist no open decision stop. This is implementation drift inside Task 10, and the same defect as as-built finding :3.
**Criterion:** S2.1
**Parent task:** 10
**Done when:**
- [test] S2.1 is satisfied by this task.
- The repair for task rem-prd-audit-R10c is committed and its targeted tests pass.

### Task rem-prd-audit-R16c: In remediation-case-reconciler.ts retiresOpenBuildReviewCase, check disposition==='act' && effect.kind==='action' before the coverage branch. Count an origin source only when it is in effectiveAcceptedSourceIds, so stored origins of withdrawn or invalidated dispositions never retire a case. Add predicate unit tests for four shapes. True: a failed action with an effective origin. True: a reserved action with every source accepted this lap. False: an open deferral (failed or reserved) whose sources are all accepted. False: an open decision stop whose sources are all accepted. Also false: a failed action whose only origin's disposition was withdrawn and whose source is still raised. Restore the coordinator test assertions that an accepted failed deferral stays failed and emits remediation_effect_failed. Add a conductor clean-PASS test showing an accepted-source failed deferral and an open decision stop still block (missing-order / decision-stop-pending).
**Gate:** prd-audit
**Rationale:** Verified 99% by reading remediation-case-reconciler.ts:105-140. The 'covered' branch returns true before the act/action check, so it retires open deferrals and decision stops. It also counts stored operatorAcceptance.origins without requiring them to be in effectiveAcceptedSourceIds, so a withdrawn or invalidated acceptance still retires a case. Task 16 doneWhen requires false for an open deferral with a failed effect and for an open decision stop. The regressed coordinator test assertions ('deferral status reserved', no remediation_effect_failed) contradict Task 16 and the earlier behavior. This is implementation drift inside Task 16. The fix restores the Task 16 coverage rather than relaxing it.
**Criterion:** S9.6
**Parent task:** 16
**Done when:**
- [test] S9.6 is satisfied by this task.
- The repair for task rem-prd-audit-R16c is committed and its targeted tests pass.

### Task rem-as-built-R16d: Route both remaining retirement decisions through retiresOpenBuildReviewCase. (1) In remediation-case-effects.ts settleStrandedActionReservations, select candidates with the predicate, using liveSourceIds, mechanicallyHealthy and accepted sources. Keep the published-order exclusion as a caller-side filter only. (2) Move the non-action absence rule in remediation-case-reconciler.ts (~:439) into the predicate as an explicit option-gated branch: resolveAbsentOpenNonActionCases, non-act, effect none or applied, not referenced. It must still never retire an open escalate decision stop. Delete the private conditions. Extend the parity tests so reconciler absence resolution, finalize, settleStrandedActionReservations and resolveAbsentFailedBuildReviewCases each reach the predicate's result for every Task 16 fixture.
**Gate:** as-built
**Rationale:** Verified 99%. Two sites still make their own retirement decision. remediation-case-effects.ts:212 (settleStrandedActionReservations) selects reserved actions absent from live sources by a private filter. remediation-case-reconciler.ts:439 retires open non-action cases by a private absence rule. ADR-2026-10-20 D5 and Task 16 ('One shared predicate retires accepted, absent and failed cases') require one predicate to own every retirement decision. Callers may keep only their writes and side conditions (published-order check, referencedExisting). This is conforming implementation work inside Task 16; no architectural decision is needed.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5 is satisfied by this task.
- The repair for task rem-as-built-R16d is committed and its targeted tests pass.

### Task rem-as-built-R16e: In remediation-case-reconciler.ts retireOpenBuildReviewCase, turn any reserved effect, action or deferral, into failed with the retirement diagnostic, keeping links and earlier effect state. Add a unit test that the transformation never returns a resolved record with a reserved effect for action and deferral inputs. Add finalize and clean-PASS settlement tests asserting that no retired case ends resolved with a reserved effect, and that each retirement appends exactly one remediation_case_reconciled outbox entry with an eventId.
**Gate:** as-built
**Rationale:** Verified 99% by reading remediation-case-reconciler.ts:128-140. retireOpenBuildReviewCase turns only reserved action effects into failed. Meanwhile the predicate's coverage branch admits deferrals, so finalize (coordinator ~:413) and clean-PASS settlement (conductor.ts ~:5405) can resolve a case and leave its effect reserved. D5 requires every retired reserved effect to become failed with the retirement diagnostic. R16c restricts the predicate to action cases, which closes the reachable path. The transformation must still be total over reserved effects so no retirement can strand one. This is conforming implementation inside Task 16.
**Governing clause:** adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5
**Done when:**
- adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5 is satisfied by this task.
- The repair for task rem-as-built-R16e is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-R17c: In build-review-adjudication.ts reduceBuildReviewAdjudication (and its coordinator caller in build-review-adjudication-coordinator.ts), name the blocking case when an open act case with a failed effect still has a raised, unaccepted current source. The halt reason must contain `ai-conductor build-review resolve-case --feature <slug> --case <id>`, plus ` --child <child>` when the store is child-scoped; thread feature/child scope into the reducer input as required fields. Keep the generic 'remediation effect is not finalized' reason for reserved/in-flight effects. Add conductor build_review step tests for the flat and child-scoped shapes of Task 17 doneWhen #2: open action O, failed effect, source F1 still raised and unaccepted. Assert both halt texts, and assert that a failed deferral or open decision stop keeps its pre-change reason.
**Gate:** prd-audit
**Rationale:** Verified, 95%: the only halt naming `ai-conductor build-review resolve-case` is the clean-PASS surviving-obligation halt at conductor.ts:5441. A failed action whose source is still raised and unaccepted never reaches it, because at clean PASS it is retired by absence. In the coordinator it is stopped by reduceBuildReviewAdjudication's generic 'remediation effect is not finalized' (build-review-adjudication.ts:77), which names neither the case nor the command. This is clear implementation drift against Task 17 doneWhen #2 and ADR D7. No architectural decision is needed, so it routes to BUILD bound to Task 17.
**Criterion:** S9.4
**Parent task:** 17
**Done when:**
- [test] S9.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-R17c is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-R20a: In remediation-case-reconciler.ts reconcileState, when admitsCarry and the source already has a historical link on the case, append a 'carried' link (or upgrade the current link to carried) instead of `continue`. Emit the carried outbox/event exactly as for a new source. In remediation-case-store.ts finalizedBuildReviewSourceIds, treat a current link on a case with operatorResolution as finalized. Add conductor build_review tests for Task 20. (a) After resolve-case resolves O (act, failed effect), the next lap re-raises F with the same source id bound to O. F settles as carried with no halt, no work order and zero chargeEffect calls. (b) That lap's drain persists exactly one remediation_case_operator_resolved event for O before the lap's build_review_acceptance_carried event. (c) A new source id bound to O also carries (regression).
**Gate:** prd-audit
**Rationale:** Verified, 95%: in remediation-case-reconciler.ts:336-338, a carry binding whose source id already exists in the case's links hits `if (historical) { if (admitsCarry) continue; }`, so no carried link and no carry event are recorded. In remediation-case-store.ts:160-172, finalizedBuildReviewSourceIds settles only 'carried' links and never consults operatorResolution. So the normal re-raise of finding F onto operator-resolved case O, whose link stays 'acted' with a failed effect, stays unresolved, and Task 20 has no test. ADR D3 already decides the behavior, so this is BUILD work bound to Task 20.
**Criterion:** S10.3
**Parent task:** 20
**Done when:**
- [test] S10.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-R20a is committed and its targeted tests pass.
