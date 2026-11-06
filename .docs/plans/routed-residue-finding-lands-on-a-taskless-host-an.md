# Implementation Plan: A routed finding lands on the host that owns its task, and a no-op host does not stop the round (#3590)

**Date:** 2026-11-05
**Design:** [architecture review](../decisions/architecture-review-2026-11-05-routed-residue-finding-lands-on-a-taskless-host-an.md)
**Stories:** .docs/stories/routed-residue-finding-lands-on-a-taskless-host-an.md
**Conflict check:** Clean as of 2026-11-05

## Summary

Five tasks. The router stops sending task-bound ADR-citing findings to the residue judge. A routed
audit host that region entry finds already evidence-complete settles through the existing routed
exit instead of halting the feature, unless no host in the round did work. `halt clear` on a round
already stuck this way resumes it.

## Technical Approach

- **Owner classification (`src/conductor/src/engine/routing/round-router.ts`).** In
  `routeAdmittedRound`, an item with `existingTask` and a non-empty `ownerTaskIds` is task-bound
  before `isResidue` is consulted. It takes the existing `deriveTaskBoundOwner` branch. Residue
  without an existing-task binding, including items whose `ownerTaskIds` come from `parentTask`,
  keeps the judge path, and `resolveResidueOwner` is untouched. The existing "Existing-task work …
  has no admitted owner-task binding" halt still fires first.
- **Event field (`src/conductor/src/types/events.ts`,
  `src/conductor/src/engine/routing/routing-events.ts`,
  `src/conductor/src/engine/routing/route-record-store.ts`).** `routed_repair_phase` gains an
  optional `reason?: 'derived-already-complete'`. `routedRepairPhaseEvent` takes an optional reason,
  and `transitionHost`'s options take an optional `reason` and pass it through. Event literals stay
  inside `routing-events.ts`, as the routing structural check requires.
- **Settle decision (`src/conductor/src/engine/routing/routed-exit.ts`).** A new exported
  `settleDerivedNoOpHost({ worktree, slug, roundId, host, git })` reads the route record. It returns
  `halt` and writes nothing when no other host is `pending`, `restacked` or `rerouted`. Otherwise it
  compare-and-swaps the host `admitted → repairing` with `{ credit: false, reason:
  'derived-already-complete' }` and returns `settled`. It never calls `grantRoutedRepairCredit`.
- **Conductor wiring (`src/conductor/src/engine/conductor.ts`).** In `enterRoutedHostRegion`, the
  `derived-already-complete` arm calls `settleDerivedNoOpHost`.
  - On `halt` it keeps today's needs-human HALT body unchanged.
  - On `settled` it calls the existing `exitRoutedHostAndReconcile` with the same resolver,
    `persist` and `exit` arguments that `continueRoutedHostExit` passes. `requestRoutedExit` then
    picks the no-commit `done` exit, the leaf `done` exit, or `built → restacked` when region entry
    committed.
  - It handles the reconciled result as region entry already does after #3477. `navigate-host`
    re-resolves the execution child and enters the navigated host in the same dispatch.
    `leaf-returned` returns to the leaf's re-pended gates. Every other result follows the existing
    region-entry handling.
  - Local pattern: copy `continueRoutedHostExit`'s exit-halted and unavailable handling, which
    surfaces an existing HALT body or calls `haltChildRegionRefusal`. Do not create a second exit
    continuation.
- **Recovery** needs no new production code. A cleared HALT re-runs reconciliation, which navigates
  to the `admitted` host. `enterHostRegion` re-runs the completion check from `admitted`, so the
  settle path applies.

## Prerequisites

- None.

## Tasks

### Task 1: Route an existing-task-bound ADR-citing finding by its task, not the residue judge
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-router.test.ts`. Use a three-position slice membership with `T25` in slice 3 and `T4` in slice 1, and an injected residue judge that records its prompt. Cover:
   - an as-built `adr-decision` finding with `existingTask: true` and `ownerTaskIds: ['T25']`;
   - that finding plus one unbound residue item;
   - unbound residue answered `{child: 3, candidates: [3]}` and `{child: 3, candidates: [1, 3]}`;
   - an existing-task finding with empty `ownerTaskIds`;
   - the `T25`-bound finding with `consolidatedManualTestFail` rows.
2. Verify the tests fail (RED). The bound finding currently routes to owner `1` with `residue-default`.
3. Implement: in `routeAdmittedRound`, after the existing missing-binding halt, treat `source.existingTask && source.ownerTaskIds.length > 0` as task-bound before the `isResidue` test, so the item flows through `deriveTaskBoundOwner` and `selectHost`. Leave `isResidue`'s use in the mixed-round task-bound host selection consistent with the new classification.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] `routeAdmittedRound` places the `T25`-bound as-built finding citing only `adr-x D2` at owner `3` and host `3` with a reason that is neither `residue-default` nor `residue-judged`, and its routed item carries `existingTask: true` and `taskIds: ["T25"]`
- [test] for a round holding that `T25`-bound finding and one unbound residue item, the injected residue judge is called exactly once and its prompt's item list holds only the unbound item's id
- [test] for unbound residue, `routeAdmittedRound` returns owner `3` with reason `residue-judged` for the answer `{child: 3, candidates: [3], rationale: "owns D2"}` and owner `1` with reason `residue-default` for `{child: 3, candidates: [1, 3], rationale: "alternate"}`
- [test] an as-built finding citing only `adr-x D2` with existing-task disposition and empty `ownerTaskIds` makes `routeAdmittedRound` return a `needs-human` halt whose detail names the finding id, with no residue judge call and no route record created for the round
- [test] with `consolidatedManualTestFail` rows in the round, the `T25`-bound finding produces no residue judge call and the `manual-test-fail` item has owner `3`, host `3` and reason `mixed-round`

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — existing-task precedence before residue classification
- `src/conductor/test/engine/routing/round-router.test.ts` — routing tests

**Dependencies:** none

### Task 2: Carry a no-op settle reason on the routed repair phase event
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests:
   - in `src/conductor/test/engine/routing/routing-events.test.ts`, for `routedRepairPhaseEvent` with and without a reason;
   - in `src/conductor/test/engine/routing/route-record-store.test.ts`, for `transitionHost` passing a reason into the outbox event.
2. Verify the tests fail (RED).
3. Implement:
   - add `reason?: 'derived-already-complete'` to the `routed_repair_phase` member of `ConductorEvent`;
   - add an optional `reason` parameter to `routedRepairPhaseEvent` that sets the key only when given;
   - add `reason?: 'derived-already-complete'` to `transitionHost`'s options and forward it.

   Keep event construction inside `routing-events.ts`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] `routedRepairPhaseEvent(r2, 1, 'repairing', false, 'derived-already-complete')` returns a `routed_repair_phase` event with `reason: 'derived-already-complete'`, and the call without a reason returns an event that has no `reason` key
- [test] `transitionHost` from `admitted` to `repairing` with options `{ credit: false, reason: 'derived-already-complete' }` returns a record whose outbox holds one `routed_repair_phase` event for host 1 with phase `repairing`, `credit: false` and that reason
- The `routed_repair_phase` member of `ConductorEvent` in `src/conductor/src/types/events.ts` declares `reason?: 'derived-already-complete'` as its only new field

**Files likely touched:**
- `src/conductor/src/types/events.ts` — optional `reason` on `routed_repair_phase`
- `src/conductor/src/engine/routing/routing-events.ts` — `routedRepairPhaseEvent` reason parameter
- `src/conductor/src/engine/routing/route-record-store.ts` — `transitionHost` reason option
- `src/conductor/test/engine/routing/routing-events.test.ts` — event tests
- `src/conductor/test/engine/routing/route-record-store.test.ts` — transition tests

**Dependencies:** none

### Task 3: Decide whether a derived no-op routed host settles or halts
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` for `settleDerivedNoOpHost`. Use persisted audit route records:
   - host 1 `admitted`, hosts 2 and 3 `pending`;
   - last host `admitted` with another host `restacked`, and again with another host `rerouted`;
   - a single-host round;
   - a last host whose other hosts are all `done`.
2. Verify the tests fail (RED).
3. Implement `settleDerivedNoOpHost` in `routed-exit.ts`:
   - read the record, and refuse unless the host is `admitted` in an `audit` round;
   - return `{ kind: 'halt' }` with no write when no other host is `pending`, `restacked` or `rerouted`;
   - otherwise write `transitionHost(stored, host, 'repairing', { credit: false, reason: 'derived-already-complete' })` through `writeRoutingTransaction` and return `{ kind: 'settled' }`;
   - never call `grantRoutedRepairCredit`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] for an audit record with host 1 `admitted` and hosts 2 and 3 `pending`, `settleDerivedNoOpHost` returns `settled` and the re-read record has host 1 `repairing` with an outbox `routed_repair_phase` event carrying `credit: false` and `reason: 'derived-already-complete'`
- [test] it returns `settled` for an `admitted` last host when another host is `restacked`, and likewise when another host is `rerouted`
- [test] it returns `halt` and leaves the route record ref's object id unchanged for a single-host round and for a last host whose other hosts are all `done`
- [test] after `settled`, the kickback ledger's `routedRepairCredit` holds no entry for the round, because `settleDerivedNoOpHost` never grants routed repair credit
- [test] it returns `refused` and writes nothing when the round's kind is `revalidate` or `operator`

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — `settleDerivedNoOpHost`
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — settle decision tests

**Dependencies:** Task 2

### Task 4: Settle a derived no-op routed host through the routed exit instead of halting the feature
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/routing/no-op-guard-placement.test.ts`. Use real-git three-child stacks with a stubbed host entry that returns `derived-already-complete` and a step runner that records dispatches. Cover:
   - host 1 with hosts 2 and 3 `pending`;
   - host 1 whose entry committed a frozen block on `feat/c1/demo`;
   - leaf host 3 last with host 1 `restacked`;
   - the `halt` decision.
2. Verify the tests fail (RED). Today every case writes a needs-human HALT.
3. Implement in `enterRoutedHostRegion`'s `derived-already-complete` arm:
   - call `settleDerivedNoOpHost`;
   - on `halt`, keep today's HALT body, `writeHaltMarker` class and `surfaceRemediationPr` call;
   - on `settled`, call `exitRoutedHostAndReconcile` with the arguments `continueRoutedHostExit` uses (resolver, resolver cap, `persist`, `exit: this.requestRoutedExit`, `reconcile: reconcileRounds`);
   - copy `continueRoutedHostExit`'s handling of `exit-halted` and `unavailable`;
   - for `navigate-host`, re-resolve the execution child and enter the navigated host in this dispatch;
   - for `leaf-returned` and queue admission, continue as the post-#3477 region-entry path does.

   Do not add a second exit continuation.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] when host 1 of a three-host audit round with hosts 2 and 3 `pending` enters as `derived-already-complete`, the Conductor dispatches no provider step for host 1, writes no `.pipeline/HALT`, and the route record ends with host 1 `done` and host 2 `admitted`
- [test] after that settle, `.pipeline/events.jsonl` holds a host-1 `routed_repair_phase` event with phase `repairing`, `credit: false` and `reason: "derived-already-complete"` before a host-1 `routed_repair_phase` event with phase `done`
- [test] when region entry committed a frozen block so host 1's tip differs from `closed/c1`, the settle exits host 1 through `built` then `restacked` and that block commit is an ancestor of `feat/c2/demo` and `feat/daemon-demo`
- [test] when leaf host 3 is the last host, host 1 is `restacked` and host 3 enters as `derived-already-complete`, host 3 ends `done`, the round is `closed`, the worktree is on `feat/daemon-demo`, and the leaf's region gates are pending
- [test] when `settleDerivedNoOpHost` returns `halt` for a last host whose other hosts are `done`, the Conductor writes a `needs-human` HALT whose body ends `Outcome: derived-already-complete`, dispatches no build, and that host stays `admitted`

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `derived-already-complete` arm settles through the routed exit
- `src/conductor/test/engine/routing/no-op-guard-placement.test.ts` — conductor settle and halt tests

**Dependencies:** Task 3

### Task 5: Recover a round stuck on a no-op host, and survive a crash mid-settle
**Story:** Story 2, Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/no-op-guard-placement.test.ts`. Start each from persisted refs:
   - a stuck round: `r2` with host 1 `admitted` holding the repair marker, hosts 2 and 3 `pending`, and a cleared HALT;
   - the same stuck round with its needs-human HALT still present;
   - an all-no-op last host;
   - a crash state with host 1 already `repairing` from a settle and its exit not yet run;
   - a single-host round, and revalidate and operator rounds.
2. Verify the tests fail (RED) where behavior is new.
3. Implement only what the tests show missing in `conductor.ts`'s settle path. Recovery reuses reconciliation and Task 4's settle, and the crash path reuses `enterHostRegion`'s `repairing` resume and `requestRoutedExit`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] from the stuck round with the HALT cleared, one Conductor dispatch ends with host 1 `done` and host 2 `admitted`, and `dispatchStackRoundsCommand` for `stack rounds --slug demo` then prints an `r2` line containing `hosts 1:done, 2:admitted, 3:pending` and the line `repair marker: host 2 round r2`
- [test] with that round's needs-human HALT still present, `resolveHaltRetention` over its HALT class returns `retained: true` with class `needs-human`, and no routing ref under `refs/conductor/demo/` changes
- [test] from a cleared HALT on a last host where no host did work, the dispatch halts `needs-human` again with `Outcome: derived-already-complete` and every host state in the record is unchanged
- [test] from the crash state with host 1 `repairing`, the dispatch does not re-admit host 1 (no `admitted` transition event), and the round reaches host 2 `admitted` with host 1 ended `done` or `restacked`
- [test] a single-host audit round whose host is derived-already-complete still halts `needs-human` with `Outcome: derived-already-complete`, and for revalidate and operator round hosts entering their region `settleDerivedNoOpHost` is never called and no `derived-already-complete` HALT is written

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — settle-path fixes surfaced by the recovery and crash tests
- `src/conductor/test/engine/routing/no-op-guard-placement.test.ts` — recovery, crash and halt-preservation tests

**Dependencies:** Task 4

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an as-built REMEDIABLE finding citing only `adr-x D2` whose admitted disposition is existing-task bound to `T25`, when the round is routed, then its owner and host are `3`, its reason is not `residue-default` or `residue-judged`, and its route item carries `existingTask: true` and `taskIds: ["T25"]`. | 1 | "at owner `3` and host `3` with a reason that is neither `residue-default` nor `residue-judged`" | diff-local |
| Story 1 happy: Given that `T25`-bound finding and one other residue item with no task binding in the same round, when the round is routed, then exactly one residue routing call is made and its item list holds only the unbound item. | 1 | "the injected residue judge is called exactly once and its prompt" | diff-local |
| Story 1 happy: Given a residue item with no task binding for which the routing call returns `{child: 3, candidates: [3], rationale: "owns D2"}`, when the round is routed, then its owner is `3` with reason `residue-judged`. | 1 | "owner `3` with reason `residue-judged`" | diff-local |
| Story 1 negative: Given a residue item with no existing-task binding for which the routing call returns `{child: 3, candidates: [1, 3], rationale: "alternate"}`, when the round is routed, then its owner is still `1` with reason `residue-default`. | 1 | "owner `1` with reason `residue-default`" | diff-local |
| Story 1 negative: Given an as-built finding citing only `adr-x D2` whose existing-task disposition has no resolved owner-task binding, when the round is routed, then the feature halts needs-human naming the finding, and no route record is created. | 1 | "return a `needs-human` halt whose detail names the finding id" | diff-local |
| Story 1 negative: Given the `T25`-bound finding in a round that also carries `manual_test` FAIL rows, when the round is routed, then no routing call is made for it and the FAIL obligation is placed with host `3`, the lowest task-bound host. | 1 | "the `manual-test-fail` item has owner `3`, host `3` and reason `mixed-round`" | diff-local |
| Story 2 happy: Given audit round `r2` with hosts 1, 2 and 3 where host 1 is `admitted`, hosts 2 and 3 are `pending`, and every routed task for host 1 is already evidence-complete after region entry, when the conductor enters host 1, then no provider is dispatched for host 1, host 1 ends `done`, host 2 becomes `admitted`, and no HALT marker is written. | 4 | "dispatches no provider step for host 1, writes no `.pipeline/HALT`, and the route record ends with host 1 `done` and host 2 `admitted`" | diff-local |
| Story 2 happy: Given that settle of host 1, when the events are read, then a `routed_repair_phase` event for host 1 with phase `repairing`, `credit: false` and `reason: "derived-already-complete"` precedes a `routed_repair_phase` event for host 1 with phase `done`. | 4 | "holds a host-1 `routed_repair_phase` event with phase `repairing`" | diff-local |
| Story 2 happy: Given that settle of host 1, when the round receipt is read, then no routed repair credit was granted for host 1 in `r2`. | 3 | "holds no entry for the round" | diff-local |
| Story 2 happy: Given audit round `r2` where host 1 ended `restacked` and the leaf host 3 is the last host and is already evidence-complete after region entry, when the conductor enters host 3, then host 3 ends `done`, the round closes, the worktree returns to the leaf branch, and the leaf's gates are pending again. | 4 | "the round is `closed`, the worktree is on `feat/daemon-demo`, and the leaf" | diff-local |
| Story 2 negative: Given audit round `r2` whose only host is host 1 and host 1 is already evidence-complete after region entry, when the conductor enters host 1, then the feature halts needs-human with `Outcome: derived-already-complete` exactly as before. | 5 | "still halts `needs-human` with `Outcome: derived-already-complete`" | diff-local |
| Story 2 negative: Given audit round `r2` where host 1 settled as a no-op (`done`), host 2 is the last host, and host 2 is already evidence-complete after region entry, when the conductor enters host 2, then the feature halts needs-human with `Outcome: derived-already-complete` and host 2 stays `admitted`. | 4 | "dispatches no build, and that host stays `admitted`" | diff-local |
| Story 2 negative: Given host 1 already evidence-complete but region entry committed a frozen block on child 1's branch, when host 1 settles, then host 1 leaves through `built` and `restacked`, so the committed block reaches every child above it. | 4 | "the settle exits host 1 through `built` then `restacked`" | diff-local |
| Story 2 negative: Given a crash after host 1 became `repairing` for the settle and before its exit, when the feature resumes, then host 1 is not entered as a new admission, and the round reaches host 2 with host 1 ended `done` or `restacked`. | 5 | "the dispatch does not re-admit host 1" | diff-local |
| Story 2 negative: Given a revalidate or operator round whose host is entered, when region entry runs, then no no-op settle or no-op halt is applied, as before. | 5 | "`settleDerivedNoOpHost` is never called and no `derived-already-complete` HALT is written" | diff-local |
| Story 3 happy: Given a feature halted needs-human with `Outcome: derived-already-complete` while round `r2` has host 1 `admitted` with the repair marker and hosts 2 and 3 `pending`, when the HALT is cleared and the feature is dispatched again, then host 1 settles `done` and host 2 is admitted. | 5 | "ends with host 1 `done` and host 2 `admitted`" | diff-local |
| Story 3 happy: Given that recovery, when `ai-conductor stack rounds --slug demo` runs, then it reports `r2` with host 1 `done` and the repair marker on host 2. | 5 | "prints an `r2` line containing `hosts 1:done, 2:admitted, 3:pending` and the line `repair marker: host 2 round r2`" | diff-local |
| Story 3 negative: Given a feature halted needs-human with `Outcome: derived-already-complete` on the last host of a round where no host did work, when the HALT is cleared and the feature is dispatched again, then it halts needs-human again with the same outcome and no host state changes. | 5 | "halts `needs-human` again with `Outcome: derived-already-complete` and every host state in the record is unchanged" | diff-local |
| Story 3 negative: Given that halted feature, when the HALT is not cleared, then the daemon's re-kick retains it as needs-human and no routing ref changes. | 5 | "returns `retained: true` with class `needs-human`" | diff-local |

## Task Dependency Graph

```
Task 1 (router)            — independent
Task 2 (event reason) → Task 3 (settle decision) → Task 4 (conductor settle) → Task 5 (recovery, crash, halts)
```

## Integration Points

- After Task 1: a remediation round with an existing-task-bound ADR-citing finding routes to the bound task's child.
- After Task 4: a stacked feature whose routed host has nothing to do continues to its next host in the same dispatch.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | existing | none | Routing entry and classification are `routeAdmittedRound` in `src/conductor/src/engine/routing/round-router.ts`, reached only when `routingEligible` in `src/conductor/src/engine/routing/route-types.ts` holds. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | task | task-1 | `routeAdmittedRound` places the `T25`-bound as-built finding citing only `adr-x D2` at owner `3` and host `3` |
| adr-2026-10-12-routed-whole-feature-repair#D3 | task | task-1 | the injected residue judge is called exactly once and its prompt's item list holds only the unbound item's id |
| adr-2026-10-12-routed-whole-feature-repair#D4 | existing | none | `selectHost` in `src/conductor/src/engine/routing/cannot-host.ts` keeps owner and host separate; this spec feeds it the task-bound owner unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | This spec changes no builder `blocked-by-prerequisite` claim or reroute. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-4 | the settle exits host 1 through `built` then `restacked` |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-4, task-5 | dispatches no provider step for host 1, writes no `.pipeline/HALT`, and the route record ends with host 1 `done` and host 2 `admitted` |
| adr-2026-10-12-routed-whole-feature-repair#D8 | existing | none | `resolveExecutionChild` in `src/conductor/src/engine/routing/execution-child.ts` remains the one execution-child resolver the settle path re-resolves through. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | existing | none | Region-entry appends are `enterHostRegion` in `src/conductor/src/engine/routing/host-region-entry.ts`; unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | task | task-3 | the kickback ledger's `routedRepairCredit` holds no entry for the round |
| adr-2026-10-12-routed-whole-feature-repair#D11 | existing | none | Round-keyed repair obligations are admitted by `admitRoutedObligation` in `src/conductor/src/engine/repair-restage.ts`; unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | A settled no-op host runs no `build_review`; the routed review base is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-4 | that block commit is an ancestor of `feat/c2/demo` and `feat/daemon-demo` |
| adr-2026-10-12-routed-whole-feature-repair#D14 | existing | none | The re-validation queue is `readRevalidationQueue` and `acknowledgeQueueEntry` in `src/conductor/src/engine/routing/`; the settle path reaches it through `exitRoutedHostAndReconcile` unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-4 | the worktree is on `feat/daemon-demo`, and the leaf's region gates are pending |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-2 | returns a record whose outbox holds one `routed_repair_phase` event for host 1 with phase `repairing`, `credit: false` and that reason |
| adr-2026-10-12-routed-whole-feature-repair#D17 | existing | none | `routingEligible` in `src/conductor/src/engine/routing/route-types.ts` is false for a flat cursor, so N=1 never reaches the router or the routed host entry. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | existing | none | `routingSettingOn` in `src/conductor/src/engine/routing/route-types.ts` reads `stacked_prs.route_whole_feature_fixes`; unchanged. |
| adr-2026-07-13-kickback-build-no-op-escalation#D1 | task | task-4, task-5 | the Conductor writes a `needs-human` HALT whose body ends `Outcome: derived-already-complete`, dispatches no build, and that host stays `admitted` |
| adr-2026-07-13-kickback-build-no-op-escalation#D2 | existing | none | Zero-progress plus unchanged-verdict escalation is `classifyBuildProgress` and `shouldEscalateKickback` in `src/conductor/src/engine/kickback-escalation.ts`. |
| adr-2026-07-13-kickback-build-no-op-escalation#D3 | existing | none | The did-work versus no-work distinction is `classifyBuildProgress` in `src/conductor/src/engine/kickback-escalation.ts`, recorded on the existing `kickback` event. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-as-built-5.r1: Remove dead isDerivedAlreadyCompleteRepairPhase from src/conductor/src/engine/routing/routing-events.ts, plus its import and its assertions (lines 55-57) in src/conductor/test/engine/routing/routing-events.test.ts. Keep the routedRepairPhaseEvent coverage and task 5's crash-recovery tests, which use isDerivedAlreadyCompleteHost
**Gate:** as-built
**Rationale:** Verified (100%, grep): isDerivedAlreadyCompleteRepairPhase at src/conductor/src/engine/routing/routing-events.ts:36 has no production caller. Crash recovery in conductor.ts:1029-1051 and host-region-entry.ts:465 uses isDerivedAlreadyCompleteHost (route-types.ts:771). Its only callers are its own unit assertions at test/engine/routing/routing-events.test.ts:55-57. Approved architecture still governs, so this is clear implementation drift inside plan task 5, which introduced the helper. The repair needs no architectural or product decision. Removing the helper and those assertions keeps task 5's done-when coverage, because the crash-state test (no re-admit of a repairing host) exercises the production isDerivedAlreadyCompleteHost path. Leave routedRepairPhaseEvent and its reason field alone: the derived-already-complete repair transition still emits them.
**Parent task:** 5
**Governing clause:** Task 5
**Done when:**
- Task 5 is satisfied by this task.
- The repair for task rem-as-built-5.r1 is committed and its targeted tests pass.
