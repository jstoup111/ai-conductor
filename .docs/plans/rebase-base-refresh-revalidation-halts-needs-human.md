# Implementation Plan: Queued revalidation is admitted at child BUILD entry

**Date:** 2026-10-31
**Design:** [adr-2026-10-12-routed-whole-feature-repair](../decisions/adr-2026-10-12-routed-whole-feature-repair.md) decisions 7, 8 and 14 as amended 2026-10-31, and [architecture review](../decisions/architecture-review-rebase-base-refresh-revalidation-halts-needs-human.md) (technical track; no PRD)
**Stories:** .docs/stories/rebase-base-refresh-revalidation-halts-needs-human.md
**Conflict check:** Clean as of 2026-10-31. One blocking contradiction was resolved by an in-place amendment to #3212 Story 8; see `.docs/conflicts/rebase-base-refresh-revalidation-halts-needs-human.md`.

## Summary

The plan adds one shared queue-admission helper. Resume preflight and the routed-exit continuation
adopt it, and BUILD-region entry calls it, so a queued closed-child revalidation is admitted in the
same run instead of halting `needs-human`. It has 10 tasks and ships as a single PR.

## Technical Approach

- **Shared helper, new file.** `admitQueuedRevalidation` lives in
  `src/conductor/src/engine/routing/queue-admission.ts` and encodes the existing preflight sequence:
  drain the routing outbox (only when the caller has not already reconciled), reconcile with
  `reconcileRounds`, consume with `consumeLowestQueued` only after a non-continuing result, and
  re-reconcile on `stalled`. It imports `consumeLowestQueued` (`routing/revalidation-queue.ts`) and
  `reconcileRounds` (`routing/round-admission.ts`) across module boundaries. That is why it is not
  placed inside `revalidation-queue.ts`: the existing `conductor-routing-resume.test.ts` and
  `stack-preflight-routing.test.ts` mock those modules with `vi.mock`, and an intra-module call
  would bypass the mock.
- **Result union.** The helper returns `continue` (a reconciled `navigate-host`,
  `navigate-leaf-to-build` or `resume-exit`, passed through), `admitted` (round id and host),
  `none`, `busy` (with the fence detail when present), `stalled` (a `ReconcileRoundsResult` stall
  for `recordRoundStall`, or a mechanical stall detail) and `unavailable`. Every caller keeps its
  own outcome mapping and matches all kinds with `assertNever`.
- **Callers.** `runStackPreflightInner` (`restack/stack-preflight.ts`) and `continueRoutedHostExit`
  (`conductor.ts`) replace their inline consume blocks without changing their results.
  `enterRoutedHostRegion` (`conductor.ts`) replaces its terminal "has no matching repair marker"
  refusal: when the execution child is `revalidating` with no marker it runs the helper, re-resolves,
  and enters the admitted child as routed host. It acts only on `navigate-host` and admission. Every
  other continuing result is a `mechanical` HALT, so the next dispatch's preflight handles it.
- **Halts.** A refusal reason begins `child BUILD region refused:` and names the queued child, the
  queue generation, every non-closed round with its unsettled hosts (from
  `diagnoseAffectedRounds`), and the marker owner or `none`. Fence and stall stops go through
  `recordRoundStall`, so they are `mechanical` twice and then `needs-human`. Unreadable refs and
  routing ineligibility halt `needs-human`.
- **Local pattern.** Follow the preflight's reconcile→consume block in `runStackPreflightInner`:
  - consume only after `none`, `aborted`, `deferred`, `leaf-returned` or `quiescent`;
  - on `stalled`, re-reconcile before recording;
  - `unavailable` never admits.

  Allowed variation is each caller's own return type. Search hints: `consumeLowestQueued`,
  `recordRoundStall`, `diagnoseAffectedRounds`, `haltChildRegionRefusal`.
- **Sequencing.** Task 1 builds the helper, Tasks 2–3 migrate the two existing callers, and Task 4
  wires region entry and proves single ownership. The remaining tasks add the region-entry negative
  paths, the halt rendering, and the real-git integration proofs of each trigger path.

## Prerequisites

- None. Blockers #3445 (PR #3521: the admission fence, plus `busy` and `stalled` results) and #3455 (PR #3543: queue parking) are on main.

## Tasks

### Task 1: Shared queue-admission helper
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/queue-admission.test.ts`, mocking `routing/revalidation-queue.js`, `routing/round-admission.js` and `routing/route-record-store.js`. They cover consumption after each non-continuing reconciled kind, pass-through of `navigate-host`, `navigate-leaf-to-build` and `resume-exit` without a consume call, the `stalled` re-reconcile, and the drain-first order with a failed drain.
2. Verify the tests fail (RED).
3. Implement `admitQueuedRevalidation` in `src/conductor/src/engine/routing/queue-admission.ts`. Copy the preflight's sequence: consume only after `none`, `aborted`, `deferred`, `leaf-returned` or `quiescent`; on `stalled`, re-reconcile before returning a stall; `unavailable` never admits. Accept an optional already-reconciled result. Without one, drain `drainRoutingOutboxes` and then call `reconcileRounds`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(routing): add shared revalidation queue admission helper".

**Done when:**
- [test] `admitQueuedRevalidation` in `src/conductor/src/engine/routing/queue-admission.ts` calls `consumeLowestQueued` only after a reconciled result of kind `none`, `aborted`, `deferred`, `leaf-returned` or `quiescent`, and returns `navigate-host`, `navigate-leaf-to-build` and `resume-exit` results as `continue` without calling `consumeLowestQueued`, as asserted in `queue-admission.test.ts`.
- [test] When `consumeLowestQueued` reports `stalled`, the helper calls `reconcileRounds` again and returns that reconciliation's `stalled` result for `recordRoundStall`, or a `mechanical` stall carrying the consumption detail when re-reconciliation is not `stalled`, as asserted in `queue-admission.test.ts`.
- [test] Called with no reconciled result, the helper calls `drainRoutingOutboxes` before `reconcileRounds`, and a failed drain returns `unavailable` without calling `reconcileRounds` or `consumeLowestQueued`, as asserted in `queue-admission.test.ts`.
- The helper's exported result type is a discriminated union of exactly `continue`, `admitted`, `none`, `busy`, `stalled` and `unavailable`, and the file imports `consumeLowestQueued` from `./revalidation-queue.js` and `reconcileRounds` from `./round-admission.js`.

**Files likely touched:**
- `src/conductor/src/engine/routing/queue-admission.ts` — new helper
- `src/conductor/test/engine/routing/queue-admission.test.ts` — new unit tests

**Dependencies:** none

### Task 2: Resume preflight admits through the shared helper
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Run the existing `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` and `stack-preflight-stop-reason.test.ts` to record the baseline. Change no expected value.
2. Replace the inline `consumeLowestQueued` block in `runStackPreflightInner` with a call to `admitQueuedRevalidation`, passing the result it already reconciled. Map `admitted` to `navigate-host`, `unavailable` to `{ kind: 'unavailable', detail: 'cannot consume revalidation queue' }`, and `stalled` to the existing `recordRoundStall` path. Keep the existing `busy` and leaf-return handling, and match every helper kind with `assertNever`.
3. Verify the same tests pass with expected values unedited.
4. Commit: "refactor(restack): route preflight queue admission through the shared helper".

**Done when:**
- [test] `runStackPreflightInner` in `src/conductor/src/engine/restack/stack-preflight.ts` obtains queue admission only through `admitQueuedRevalidation`, and for a queued child with no marker and no open round it returns `navigate-host` with the admitted round id and host, as asserted by the existing `stack-preflight-routing.test.ts` with expected values unedited.
- [test] For a `stalled` consumption the preflight re-reconciles and returns the bounded routing stall recorded by `recordRoundStall`, and for an `unavailable` consumption it returns `unavailable` with the detail `cannot consume revalidation queue`, as asserted by the existing `stack-preflight-routing.test.ts` expectations unedited.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — call the helper

**Dependencies:** Task 1

### Task 3: Routed-exit continuation admits through the shared helper
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Add a failing test to `src/conductor/test/engine/routing/conductor-routing-resume.test.ts`: an `unavailable` consumption after a routed exit writes the HALT reason `child BUILD region refused: cannot consume routed revalidation queue`.
2. Replace the inline consume block in `continueRoutedHostExit` with `admitQueuedRevalidation`, passing `continued.next`. Keep the existing `admitted`, `leaf-returned` → `manual_test` and fall-through mappings, and match every helper kind with `assertNever`.
3. Verify the existing tests in that file pass with expectations unedited, and the new test passes.
4. Commit: "refactor(conductor): route routed-exit queue admission through the shared helper".

**Done when:**
- [test] `continueRoutedHostExit` in `src/conductor/src/engine/conductor.ts` obtains queue admission only through `admitQueuedRevalidation`, and a `leaf-returned` reconciliation with an empty queue and no open round restores whole-feature state and returns the `manual_test` index, as asserted by the existing `conductor-routing-resume.test.ts` expectations unedited.
- [test] An `unavailable` consumption in the routed-exit continuation writes a HALT whose reason is `child BUILD region refused: cannot consume routed revalidation queue`, as asserted in `conductor-routing-resume.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `continueRoutedHostExit` calls the helper
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — unavailable-halt test

**Dependencies:** Task 1

### Task 4: BUILD-region entry admits a queued child before refusing
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing conductor unit tests in `src/conductor/test/engine/routing/region-entry-admission.test.ts`, using the `childRegionLifecycle.resolveActiveChild` injection and the module mocks pattern of `conductor-routing-resume.test.ts`. Cover two cases. First, a `revalidating` execution child with no marker is admitted, re-resolved as routed host and entered. Second, a `navigate-host` reconciliation enters that host without consuming.
2. Verify the tests fail (RED).
3. In `enterRoutedHostRegion`, replace the "has no matching repair marker" refusal. When `readRepairMarker` reports no marker for a `revalidating` execution, call `admitQueuedRevalidation`. On `admitted`, or on `continue` with `navigate-host`, re-resolve with `resolveExecutionChild` and continue with the re-resolved routed-host execution, before `enterHostRegion` or any dispatch.
4. Verify the tests pass (GREEN).
5. Commit: "fix(conductor): admit queued revalidation at BUILD-region entry".

**Done when:**
- [test] When `resolveExecutionChild` returns source `revalidating` and `readRepairMarker` reports no marker, `enterRoutedHostRegion` calls `admitQueuedRevalidation` and, on `admitted`, re-resolves the execution child and enters the child's region as the routed host of the admitted round before `enterHostRegion` or any dispatch, as asserted in `region-entry-admission.test.ts`.
- [test] On that admission the dispatched step is the first gate the queue entry invalidated for the admitted child, run with the admitted child's branch checked out rather than the leaf's, and no HALT file and no `loop_halt` event are written, as asserted in `region-entry-admission.test.ts`.
- [test] When reconciliation returns `navigate-host` for an admitted host of an open round, region entry re-resolves and enters that host's region, `consumeLowestQueued` is not called, and the queued child's queue entry is unchanged, as asserted in `region-entry-admission.test.ts`.
- A grep of `src/conductor/src/engine` finds `consumeLowestQueued` called only from `routing/queue-admission.ts`, and `admitQueuedRevalidation` called from `runStackPreflightInner`, `continueRoutedHostExit` and `enterRoutedHostRegion`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `enterRoutedHostRegion` admission
- `src/conductor/test/engine/routing/region-entry-admission.test.ts` — new unit tests

**Dependencies:** Tasks 1, 2, 3

### Task 5: Region-entry busy, fence and preflight-only results stop without admitting
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `region-entry-admission.test.ts` for three cases. A fence `busy` with a still-`revalidating` re-resolution gives a `mechanical` HALT naming the blocking round. A marker-race `busy` re-resolves exactly once and either enters the marker's host or halts `mechanical` naming the marker owner. `resume-exit` and `navigate-leaf-to-build` give a `mechanical` HALT naming the result kind, with no call to `exitRoutedHostAndReconcile`.
2. Verify the tests fail (RED).
3. Implement the mappings in `enterRoutedHostRegion` using `haltChildRegionRefusal(..., 'mechanical')`.
4. Verify the tests pass (GREEN).
5. Commit: "fix(conductor): bound region-entry admission refusals".

**Done when:**
- [test] When `admitQueuedRevalidation` returns `busy` with a fence detail and the re-resolved child is still `revalidating`, region entry calls no route-record or marker writer and ends the run with a `mechanical` HALT whose reason names the blocking round, as asserted in `region-entry-admission.test.ts`.
- [test] When admission returns `busy` because a marker appeared, region entry re-resolves the execution child exactly once: a routed-host result for the marker's host is entered, a still-`revalidating` result ends with a `mechanical` HALT naming the marker owner, and in both cases no second route record is created, as asserted in `region-entry-admission.test.ts`.
- [test] When reconciliation at region entry returns `resume-exit` or `navigate-leaf-to-build`, region entry calls neither `exitRoutedHostAndReconcile` nor any restack journal recovery and ends with a `mechanical` HALT naming that result kind, as asserted in `region-entry-admission.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — refusal mappings
- `src/conductor/test/engine/routing/region-entry-admission.test.ts` — negative-path tests

**Dependencies:** Task 4

### Task 6: Refused admission names the blocking state and halts only on genuine unavailability
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `region-entry-admission.test.ts` for the reason's first line and for the `recordRoundStall` class progression. Write failing tests in `src/conductor/test/engine/routing/region-entry-admission.realgit.test.ts` for unreadable queue, marker and route refs, and for routing ineligibility, using a recording git runner.
2. Verify the tests fail (RED).
3. Render the refusal reason from the cursor's queue head and generation, `diagnoseAffectedRounds` (non-closed rounds with unsettled hosts), and the marker owner or `none`. Route fence and stall stops through `recordRoundStall`. Map `unavailable` and unreadable refs to `needs-human`. When `routingEligible` is false, halt `needs-human` before calling the helper.
4. Verify the tests pass (GREEN).
5. Commit: "fix(conductor): name queue and round state in region-entry refusals".

**Done when:**
- [test] A refused admission at BUILD-region entry writes a HALT whose first line begins `child BUILD region refused:` and names the queued child, the queue generation, every non-closed round with its unsettled hosts, and the marker owner or `none`, and does not contain `has no matching repair marker`, as asserted in `region-entry-admission.test.ts`.
- [test] Fence refusals and routing stalls at region entry go through `recordRoundStall`, so the first two identical consecutive stops write `.pipeline/HALT.class` `mechanical` and the third identical stop with no intervening routing progress writes `needs-human`, as asserted in `region-entry-admission.test.ts`.
- [test] With an unreadable `refs/conductor/<slug>/revalidate` ref, or an unreadable repair marker or route record ref, region entry consumes no queue entry, writes no route record or marker, and ends with a `needs-human` HALT whose reason names the unreadable ref, as asserted in `region-entry-admission.realgit.test.ts`.
- [test] With `routingEligible` false while the cursor resolves `revalidating`, region entry does not call `admitQueuedRevalidation`, a recording git runner shows region entry issued no git command naming `refs/conductor/<slug>/routes`, `repairing` or `revalidate` after cursor resolution and no ref under `refs/conductor/<slug>/` changed, and the run ends with a `needs-human` HALT naming the queued child, the queue generation and routing ineligibility, as asserted in `region-entry-admission.realgit.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — reason rendering and halt classes
- `src/conductor/test/engine/routing/region-entry-admission.test.ts` — reason and class tests
- `src/conductor/test/engine/routing/region-entry-admission.realgit.test.ts` — unreadable-ref and ineligibility tests

**Dependencies:** Task 5

### Task 7: In-loop restack admission through the gate loop (#3477 path)
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write a failing real-git conductor test in `region-entry-admission.realgit.test.ts` that reproduces the #3477 ref state left by an applied in-loop `base-refresh` restack: a queue holding child 1, every route record closed, and no marker. Drive the gate loop from the step after `rebase`. Add a two-child queue variant and a fence-refusal variant.
2. Verify the test fails against the pre-change region entry (RED). It halts "has no matching repair marker".
3. Fix any integration gap the test exposes in `enterRoutedHostRegion`.
4. Verify the test passes (GREEN).
5. Commit: "test(conductor): prove in-loop restack revalidation admission".

**Done when:**
- [test] A real-git conductor fixture in `region-entry-admission.realgit.test.ts` reproducing the #3477 ref state left by an applied in-loop `base-refresh` restack (queue holding child 1, every route record closed, no marker) drives the gate loop from the step after `rebase` to child 1's `acceptance_specs` dispatch with no `.pipeline/HALT` file and no `loop_halt` event.
- [test] After that run a new `revalidate` route record exists under `refs/conductor/<slug>/routes/` with phase `open`, `refs/conductor/<slug>/repairing` names host 1 and that round id, and child 1's region was entered as the routed host with the dispatched step run on child 1's branch, as asserted in `region-entry-admission.realgit.test.ts`.
- [test] In the same fixture with children 1 and 2 queued, after child 1's revalidation exits through the routed exit, child 2 is admitted into its own `revalidate` round and its first BUILD-region step is dispatched in the same run with no HALT file, as asserted in `region-entry-admission.realgit.test.ts`.
- [test] A fence-refusal variant of the fixture leaves every ref under `refs/conductor/<slug>/` byte-identical to its pre-dispatch value and writes `.pipeline/HALT.class` `mechanical`, as asserted in `region-entry-admission.realgit.test.ts`.

**Files likely touched:**
- `src/conductor/test/engine/routing/region-entry-admission.realgit.test.ts` — in-loop integration fixture
- `src/conductor/src/engine/conductor.ts` — integration fixes, if exposed

**Dependencies:** Task 4

### Task 8: Routed-exit fall-through admission (#3473 path)
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/routing/routed-exit-admission.realgit.test.ts` with the #3473 ref shape: r4 `revalidate` open with hosts `{1: restacked}`, a queue holding child 2, and no marker. Drive one run through `continueRoutedHostExit` into region entry and one through `runStackPreflight` on resume. Add an active-host variant. Add a unit test in `conductor-routing-resume.test.ts` for a restack-halted exit.
2. Verify the tests fail (RED).
3. Fix any gap in the fall-through path of `continueRoutedHostExit` or in region entry.
4. Verify the tests pass (GREEN).
5. Commit: "test(conductor): prove routed-exit fall-through admission".

**Done when:**
- [test] A real-git fixture with `revalidate` round r4 in phase `open` with hosts `{1: restacked}`, no repair marker and a queue generation holding child 2, driven through `continueRoutedHostExit` into BUILD-region entry, admits child 2 into a new `revalidate` round whose marker names host 2 and that round, and dispatches child 2's first BUILD-region step in the same run with no HALT file, as asserted in `routed-exit-admission.realgit.test.ts`.
- [test] The same ref state driven through `runStackPreflight` on resume yields the same round kind, the same `refs/conductor/<slug>/repairing` host and the same entered child as the in-loop path, as asserted in `routed-exit-admission.realgit.test.ts`.
- [test] When r4 still holds a host in `admitted`, `repairing` or `built` state, region entry does not admit child 2 and either enters that host through `navigate-host` or ends with the fence's `mechanical` HALT naming r4, as asserted in `routed-exit-admission.realgit.test.ts`.
- [test] When the routed exit's restack reports a halt, `continueRoutedHostExit` keeps its existing HALT reason and region entry does not call `admitQueuedRevalidation`, as asserted in `conductor-routing-resume.test.ts`.

**Files likely touched:**
- `src/conductor/test/engine/routing/routed-exit-admission.realgit.test.ts` — #3473 fixtures
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — restack-halted exit test
- `src/conductor/src/engine/conductor.ts` — fall-through fixes, if exposed

**Dependencies:** Task 4

### Task 9: A queue head is admitted exactly once across stops and races
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests. In `region-entry-admission.realgit.test.ts`, cover a stop after admission followed by resume, a region-entry fence stop followed by preflight after the blocking round closes, and a concurrent marker write between the marker read and consumption. In `region-entry-admission.test.ts`, cover a lost route-record compare-and-swap and a re-resolution mismatch after admission.
2. Verify the tests fail (RED).
3. Implement the mismatch guard in `enterRoutedHostRegion`: after `admitted`, require the re-resolved source `routed-host` for the admitted child and round. Otherwise halt `needs-human` naming the round and the resolved source.
4. Verify the tests pass (GREEN).
5. Commit: "fix(conductor): admit each queued revalidation exactly once".

**Done when:**
- [test] A real-git fixture that stops after region entry admitted child 1 into round r5 and before the first gate dispatch, then runs `runStackPreflight`, continues r5 for child 1 and leaves exactly one `revalidate` route record covering child 1 under `refs/conductor/<slug>/routes/`, as asserted in `region-entry-admission.realgit.test.ts`.
- [test] After a region-entry fence stop for a queued child, once the blocking round closes the next `runStackPreflight` admits the queued child exactly once and the child's region is entered, as asserted in `region-entry-admission.realgit.test.ts`.
- [test] When a second writer creates a repair marker between region entry's marker read and its queue consumption, `consumeLowestQueued` returns `busy`, the route-record count is unchanged across the call, and the run either enters the marker's host or ends with a `mechanical` HALT naming the marker owner, as asserted in `region-entry-admission.realgit.test.ts`.
- [test] When the route-record compare-and-swap is lost during admission, no repair marker is written for the losing round and the queue entry stays queued for the next admission, as asserted in `region-entry-admission.test.ts`.
- [test] When admission succeeded but the re-resolved execution child is not the admitted child as routed host, region entry dispatches no region step and ends with a `needs-human` HALT naming the admitted round and the resolved source, as asserted in `region-entry-admission.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — re-resolution guard
- `src/conductor/test/engine/routing/region-entry-admission.realgit.test.ts` — stop, resume and race fixtures
- `src/conductor/test/engine/routing/region-entry-admission.test.ts` — CAS-loss and mismatch tests

**Dependencies:** Task 5

### Task 10: A restack that queues nothing leaves the loop unchanged
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests. In `region-entry-admission.realgit.test.ts`, cover a stacked fixture whose in-loop restack invalidated no closed child. In `conductor-routing-resume.test.ts`, cover routed exits with only closed rounds and an empty queue generation, and with the queue ref absent. Re-run the existing `n1-golden-routing-guard.test.ts` unchanged.
2. Verify the new tests fail where they assert the helper is not reached (RED).
3. Ensure region entry runs admission only for a `revalidating` source and never for `cursor` or flat features.
4. Verify the tests pass (GREEN).
5. Commit: "test(conductor): keep empty-queue restacks unchanged".

**Done when:**
- [test] A stacked real-git fixture whose in-loop `base-refresh` restack invalidated no closed child reaches its first whole-feature gate with the cursor never resolving `revalidating`, `admitQueuedRevalidation` never called from region entry, and `refs/conductor/<slug>/routes/` and `refs/conductor/<slug>/repairing` unchanged, as asserted in `region-entry-admission.realgit.test.ts`.
- [test] For a flat feature with no durable child state, entering a BUILD-region step issues no git command naming a ref under `refs/conductor/<slug>/` from admission, as asserted by the existing `n1-golden-routing-guard.test.ts` passing unchanged.
- [test] With only closed route records and an empty queue generation, `admitQueuedRevalidation` returns `none` and creates no route record, BUILD-region entry enters the cursor child without creating a route record, and `continueRoutedHostExit` returns the `manual_test` index, as asserted in `conductor-routing-resume.test.ts`.
- [test] With the queue ref absent, a routed-exit leaf return creates no route record or marker and restores whole-feature state, as asserted in `conductor-routing-resume.test.ts`.

**Files likely touched:**
- `src/conductor/test/engine/routing/region-entry-admission.realgit.test.ts` — empty-invalidation fixture
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — empty and absent queue exits

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ─┐
        └─ Task 3 ─┴─ Task 4 ─┬─ Task 5 ─┬─ Task 6
                              │          └─ Task 9
                              ├─ Task 7
                              ├─ Task 8
                              └─ Task 10
```

## Integration Points

- After Task 4, all three callers reach `admitQueuedRevalidation`, so region-entry admission can be exercised end to end.
- Task 7 owns the gate-loop integration proof for the in-loop restack path (#3477), and Task 8 owns it for the routed-exit path (#3473).

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | no-change | none | Eligibility is unchanged; region-entry admission runs only for a stacked feature whose cursor already resolves `revalidating` from durable child state. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Owner derivation for routed task-bound work is not touched; this change only admits queued revalidation, which carries no derived owner. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | No residue judgement is added or changed; queue admission is purely mechanical bookkeeping. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | no-change | none | Owner and host separation and upward host moves are unchanged; an admitted revalidate round's host is the queued child itself. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | Prerequisite claims and their verification are not touched. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | no-change | none | Route records stay the round authority; admission creates them only through the existing `createRouteRecord` and `admitRound` writers. |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-1, task-5 | calls `drainRoutingOutboxes` before `reconcileRounds` |
| adr-2026-10-12-routed-whole-feature-repair#D8 | task | task-4, task-6 | re-resolves the execution child and enters the child's region as the routed host of the admitted round |
| adr-2026-10-12-routed-whole-feature-repair#D9 | no-change | none | Routed task appends on the host branch are unchanged; a revalidate round appends no routed tasks. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | no-change | none | Receipts and budgets are unchanged; a revalidate round still has no gate lap or growth charge. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Repair obligation keying by round is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The revalidation `build_review` base still comes from the queue entry's replay parent; this change does not alter grading. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | existing | none | The routed exit restack is unchanged; `continueRoutedHostExit` still calls `exitRoutedHostAndReconcile` before any admission. |
| adr-2026-10-12-routed-whole-feature-repair#D14 | task | task-4, task-9 | finds `consumeLowestQueued` called only from `routing/queue-admission.ts` |
| adr-2026-10-12-routed-whole-feature-repair#D15 | no-change | none | Leaf gates are still re-pended only when no marker and no queue entry remain; admission only drains the queue sooner. |
| adr-2026-10-12-routed-whole-feature-repair#D16 | existing | none | Admission events still drain through `drainRoutingOutboxes` and `admitRound`; no new event type or channel is added. |
| adr-2026-10-12-routed-whole-feature-repair#D17 | no-change | none | Flat features never resolve `revalidating`, so the N=1 path is untouched; the golden routing guard stays unchanged (Task 10 re-runs it). |
| adr-2026-10-12-routed-whole-feature-repair#D18 | no-change | none | The routing flag and the four-spec delivery split are unchanged; routing-ineligible features admit nothing. |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a stacked feature whose `rebase` step applied a `base-refresh` restack that queued child 1 for revalidation, with every route record closed and no repair marker, when the gate loop reaches the next BUILD-region step, then a new `revalidate` route record is created, the repair marker names host 1 and that round, child 1's region is entered as the routed host of that round, and no HALT is written. | 7 | "a new `revalidate` route record exists under `refs/conductor/<slug>/routes/` with phase `open`" | diff-local |
| Story 1 happy: Given that admission, when the region step is dispatched, then the dispatched step is the first gate the queue entry invalidated for child 1 and runs on child 1's checked-out branch, not the leaf's. | 4 | "the dispatched step is the first gate the queue entry invalidated for the admitted child" | diff-local |
| Story 1 happy: Given the revalidation queue holds children 1 and 2 after an in-loop restack, when child 1's revalidation exits through the routed exit, then child 2 is admitted into its own `revalidate` round and its BUILD region is entered in the same run without a HALT. | 7 | "child 2 is admitted into its own `revalidate` round and its first BUILD-region step is dispatched in the same run with no HALT file" | diff-local |
| Story 1 negative: Given the queued child's admission is refused by the round-admission fence because another non-closed round blocks it, when BUILD-region entry runs admission, then no route record or repair marker is created and the run ends with a `mechanical` HALT whose reason names the blocking round. | 5 | "region entry calls no route-record or marker writer and ends the run with a `mechanical` HALT whose reason names the blocking round" | diff-local |
| Story 1 negative: Given admission returns `busy` because a repair marker appeared after the cursor was resolved, when region entry re-resolves the execution child once, then a cursor that now resolves the marker's host as routed host is entered, and a cursor still resolving `revalidating` ends with a `mechanical` HALT naming the marker owner; no second route record is created in either case. | 5 | "region entry re-resolves the execution child exactly once" | diff-local |
| Story 1 negative: Given reconciliation at region entry returns `resume-exit` or `navigate-leaf-to-build`, when region entry handles the result, then it runs no routed exit and no journal recovery itself and ends with a `mechanical` HALT naming that result, so the next dispatch's stack preflight acts on it. | 5 | "region entry calls neither `exitRoutedHostAndReconcile` nor any restack journal recovery" | diff-local |
| Story 1 negative: Given reconciliation at region entry returns `navigate-host` for an admitted host of an open round, when region entry handles the result, then it re-resolves and enters that host's region instead of consuming the queue, and the queued child stays queued. | 4 | "region entry re-resolves and enters that host's region, `consumeLowestQueued` is not called" | diff-local |
| Story 2 happy: Given a `revalidate` round r4 in phase `open` with hosts `{1: restacked}`, no repair marker, and a queue generation holding child 2, when the routed-exit continuation hands control to BUILD-region entry, then child 2 is admitted into a new `revalidate` round with a repair marker naming host 2 and that round, and child 2 enters BUILD in the same run. | 8 | "admits child 2 into a new `revalidate` round whose marker names host 2 and that round" | diff-local |
| Story 2 happy: Given that same starting ref state, when it is instead reached by a daemon resume, then the round kind, marker host and entered child are the same as on the in-loop path. | 8 | "yields the same round kind, the same `refs/conductor/<slug>/repairing` host and the same entered child as the in-loop path" | diff-local |
| Story 2 negative: Given the open round still holds a host in `admitted`, `repairing` or `built` state, when region entry runs admission, then it does not admit child 2 and either enters that host through `navigate-host` or ends with the fence's `mechanical` HALT naming that round. | 8 | "region entry does not admit child 2 and either enters that host through `navigate-host` or ends with the fence's `mechanical` HALT naming r4" | diff-local |
| Story 2 negative: Given the routed exit's restack reported a halt, when the continuation stops, then it keeps its existing HALT reason and region-entry admission does not run. | 8 | "`continueRoutedHostExit` keeps its existing HALT reason and region entry does not call `admitQueuedRevalidation`" | diff-local |
| Story 3 happy: Given a refused admission at BUILD-region entry, when the HALT is written, then its first line begins `child BUILD region refused:` and names the queued child, the queue generation, every non-closed round with its unsettled hosts, and the marker owner or `none`. | 6 | "names the queued child, the queue generation, every non-closed round with its unsettled hosts, and the marker owner or `none`" | diff-local |
| Story 3 happy: Given a fence refusal or a routing stall at region entry, when it is the third consecutive identical stop with no intervening routing progress, then the HALT class is `needs-human`, and the first two identical stops are `mechanical`. | 6 | "the third identical stop with no intervening routing progress writes `needs-human`" | diff-local |
| Story 3 negative: Given the `refs/conductor/<slug>/revalidate` ref is unreadable, when region entry runs admission, then no route record or marker is written and the run ends with a `needs-human` HALT whose reason names the unreadable queue ref. | 6 | "With an unreadable `refs/conductor/<slug>/revalidate` ref" | diff-local |
| Story 3 negative: Given the repair marker ref or a route record ref is unreadable, when region entry runs admission, then no queue entry is consumed and the run ends with a `needs-human` HALT whose reason names the unreadable ref. | 6 | "or an unreadable repair marker or route record ref, region entry consumes no queue entry, writes no route record or marker" | diff-local |
| Story 3 negative: Given routing is not eligible for the feature (the stacked routing flag is off) while the cursor resolves `revalidating`, when BUILD-region entry is reached, then it reads or writes no route record, marker or queue generation and ends with a `needs-human` HALT naming the queued child, the queue generation and routing ineligibility. | 6 | "With `routingEligible` false while the cursor resolves `revalidating`, region entry does not call `admitQueuedRevalidation`" | diff-local |
| Story 3 negative: Given any refused admission, when the HALT reason is rendered, then it does not contain the text `has no matching repair marker`. | 6 | "does not contain `has no matching repair marker`" | diff-local |
| Story 4 happy: Given region entry admitted child 1 into round r5 and the process stopped before child 1's first gate was dispatched, when the daemon resumes the feature, then the stack preflight continues r5 for child 1 and `refs/conductor/<slug>/routes/` gains no further `revalidate` round for child 1. | 9 | "leaves exactly one `revalidate` route record covering child 1 under `refs/conductor/<slug>/routes/`" | diff-local |
| Story 4 happy: Given a region-entry stop for a queued child (such as a fence refusal), when the next dispatch's preflight runs after the blocking round closes, then it admits the queued child exactly once and that child enters BUILD. | 9 | "the next `runStackPreflight` admits the queued child exactly once and the child's region is entered" | diff-local |
| Story 4 negative: Given a second writer created a repair marker between region entry's marker read and its queue consumption, when consumption runs, then it creates no route record, and the run either enters the marker's host or ends with a `mechanical` HALT naming the marker owner. | 9 | "the route-record count is unchanged across the call" | diff-local |
| Story 4 negative: Given a route-record compare-and-swap is lost while admission creates the round, when admission reports the loss, then no repair marker is written for the losing round, and the queue entry stays queued for the next admission. | 9 | "no repair marker is written for the losing round and the queue entry stays queued for the next admission" | diff-local |
| Story 4 negative: Given admission succeeded and re-resolving the execution child does not yield the admitted child as routed host, when region entry checks the re-resolved child, then it does not dispatch any region step and ends with a `needs-human` HALT naming the admitted round and the resolved source. | 9 | "region entry dispatches no region step and ends with a `needs-human` HALT naming the admitted round and the resolved source" | diff-local |
| Story 5 happy: Given a stacked feature whose in-loop `base-refresh` restack invalidated no closed child, when the loop continues, then the cursor never resolves `revalidating`, no route record or repair marker is created, and the run proceeds to the whole-feature gates. | 10 | "reaches its first whole-feature gate with the cursor never resolving `revalidating`" | diff-local |
| Story 5 happy: Given a flat feature with no durable child state, when any BUILD-region step is entered, then no routing ref under `refs/conductor/<slug>/` is read or written by admission. | 10 | "issues no git command naming a ref under `refs/conductor/<slug>/` from admission" | diff-local |
| Story 5 negative: Given only closed route records remain and the queue generation has no entries, when region entry or the routed exit runs, then admission reports nothing to admit, no route record is created, and the routed exit returns to `manual_test` as today. | 10 | "`admitQueuedRevalidation` returns `none` and creates no route record, BUILD-region entry enters the cursor child without creating a route record" | diff-local |
| Story 5 negative: Given the queue ref is absent entirely, when the routed exit completes a leaf return, then no route record or marker is created and whole-feature state is restored as today. | 10 | "a routed-exit leaf return creates no route record or marker and restores whole-feature state" | diff-local |
| Story 6 happy: Given a resume with a queued child, no marker and no open round, when the stack preflight runs, then it returns `navigate-host` with the admitted round id and host, exactly as before the change. | 2 | "it returns `navigate-host` with the admitted round id and host" | diff-local |
| Story 6 happy: Given a routed exit whose reconciliation reports `leaf-returned` with an empty queue and no open round, when the continuation runs, then it restores whole-feature state and returns to `manual_test`, exactly as before the change. | 3 | "returns the `manual_test` index, as asserted by the existing `conductor-routing-resume.test.ts` expectations unedited" | diff-local |
| Story 6 negative: Given queue consumption reports `stalled` in the preflight, when the preflight handles it, then it re-reconciles and records the bounded routing stall exactly as before the change. | 2 | "the preflight re-reconciles and returns the bounded routing stall recorded by `recordRoundStall`" | diff-local |
| Story 6 negative: Given queue consumption reports `unavailable` in the preflight, when the preflight returns, then its result is `unavailable` with the detail `cannot consume revalidation queue`, unchanged. | 2 | "it returns `unavailable` with the detail `cannot consume revalidation queue`" | diff-local |
| Story 6 negative: Given queue consumption reports `unavailable` in the routed-exit continuation, when it halts, then the HALT reason is `child BUILD region refused: cannot consume routed revalidation queue`, unchanged. | 3 | "writes a HALT whose reason is `child BUILD region refused: cannot consume routed revalidation queue`" | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-refusal-2e08dfd9-0dd3-4346-9bcc-f24e113a889b: Rework `continueRoutedHostExit` in `src/conductor/src/engine/conductor.ts`: restore the removed branch that halts a `continued.next.kind === 'unavailable'` reconciliation with `child N routed round reconciliation refused: <detail>` before calling `admitQueuedRevalidation`, keep `cannot consume routed revalidation queue` for unavailable consumption only, and assert both reasons in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts`
**Gate:** prd-audit
**Rationale:** Rework only, per the recorded decision. Verified: the base commit halted `continued.next.kind === 'unavailable'` with `child N routed round reconciliation refused: <detail>`, and the diff removed that branch, so the helper's pass-through renders the fixed text. Restoring the branch ahead of the `admitQueuedRevalidation` call brings back the diagnostic and adds no behavior. The fixed text stays for an unavailable queue consumption only, as Story 6 requires, so S6.5 and its test survive. Confidence 95%.
**Criterion:** NC-1
**Governing clause:** Refused NC-1 (decision 2e08dfd9-0dd3-4346-9bcc-f24e113a889b r1)
**Done when:**
- [test] NC-1 is satisfied by this task.
- Refused NC-1 (decision 2e08dfd9-0dd3-4346-9bcc-f24e113a889b r1) is satisfied by this task.
- The repair for task rem-prd-audit-refusal-2e08dfd9-0dd3-4346-9bcc-f24e113a889b is committed and its targeted tests pass.
