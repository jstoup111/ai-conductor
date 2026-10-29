# Implementation Plan: Routed repair opens a new round while an earlier round is still open

**Date:** 2026-10-26
**Design:** `.docs/decisions/architecture-review-2026-10-26-routed-repair-opens-a-new-round-while-an-earlier-r.md`; `adr-2026-10-12-routed-whole-feature-repair` decisions 6, 7 and 13 (amended by #3445); diagram `.docs/architecture/routed-repair-opens-a-new-round-while-an-earlier-r.md`
**Stories:** .docs/stories/routed-repair-opens-a-new-round-while-an-earlier-r.md
**Conflict check:** Clean as of 2026-10-26 (`.docs/conflicts/2026-10-26-routed-repair-opens-a-new-round-while-an-earlier-r.md`)

## Summary

Make every routed host exit continue its own round, fence round admission so a second audit round
cannot open while an earlier round still has work, let reconciliation drain a feature that already
holds two open rounds, and turn a reconciliation that cannot advance into a bounded `mechanical` stop.
12 tasks, single PR.

## Technical Approach

- **Prerequisite shape (#3446, spec PR #3458).**
  - `runStackPreflight` becomes a wrapper that writes the HALT for a stopping result.
  - `StackPreflightResult`'s stopping arm is `{ kind: 'halted'; detail: string; haltClass?: 'mechanical' }`.
  - The wrapper writes `.pipeline/HALT` with `haltClass ?? 'needs-human'` and emits `loop_halt`, and never
    rewrites a live HALT.
  - This plan only returns those arms. It writes no HALT inside the preflight's inner function.
  - BUILD starts after #3446 merges, so verify the landed shape first. If it differs, map onto what landed
    without widening scope.
- **One exit path (adr-2026-10-12 D13 as amended).**
  - A new exported `exitRoutedHostAndReconcile(input)` in `src/conductor/src/engine/routing/round-admission.ts`
    calls `requestRoutedExit` (injectable as `input.exit`).
  - On `restacked`, `no-commit-done` or `noop`, it drains the routing outboxes through the injected
    `persist`, then calls `reconcileRounds`.
  - It returns `{ kind: 'exit-halted'; detail }` or `{ kind: 'continued'; next: ReconcileRoundsResult }`.
  - It lives in `round-admission.ts` because that module already imports `routed-exit.ts`. The import-graph
    ratchet (`test/structural/layer-ratchet.ts`) rejects the reverse edge as a cycle.
  - Both callers use it: the conductor's in-loop BUILD-region exit and `runStackPreflight`'s `resume-exit` arm.
- **Reconciliation order (D7 as amended).**
  - `reconcileRounds` reads the marker first and visits the marker's round before the other refs in ref
    order.
  - When `advanceRound` returns `closed`, the walk continues to the next ref instead of returning `deferred`.
  - It returns `deferred` only for `queue`, or after `completeRerouteSync`.
  - A refusal that names a round becomes a new arm, `{ kind: 'stalled'; detail; rounds: RoundStallEntry[] }`.
    That covers an unreadable record, a refused compare-and-swap on advance, close or leaf return, and a
    marker naming an unreadable round.
  - Each `RoundStallEntry` is `{ roundId, unsettledHosts }`, where `unsettledHosts` maps each host to its state.
  - Enumeration failure and an invalid ref name stay `unavailable`; #3446 makes those needs-human.
- **Admission fence (D7 as amended).**
  - `admitRound` first runs `checkRoundAdmissionFence(worktree, slug, record, deps)`. It considers every
    other route record in phase `open`, plus a `prepared` record only when the marker names it.
  - An `audit` record is refused when any such round exists.
  - A `revalidate` record is refused unless each such round has no `admitted`, `repairing` or `built` host,
    and `selectNextHost` returns `queue` for it under the current queue.
  - An unreadable other record refuses and names that round.
  - A fence refusal is `{ kind: 'refused'; detail; fence: true }`. The existing marker-race and
    round-limit refusals keep `fence` absent.
  - The conductor's audit routing and `consumeLowestQueued` run the same fence before `createRouteRecord`,
    so a refused round never allocates a record.
- **Bounded stall (D7 as amended; Story 4).**
  - `recordRoundStall(worktree, slug, stall, events)` in `round-admission.ts` reads
    `.pipeline/events.jsonl` (`FEATURE_EVENT_LOG_PATH`) backwards.
  - It counts trailing `routing_rounds_stalled` events whose `rounds` deep-equal the current stall's
    `rounds`. It stops at the first `routed_repair_phase` or `remediation_routed` event, which is routing
    progress, or at a different stall.
  - It emits a new `routing_rounds_stalled` event `{ rounds, detail, attempt }` through the existing
    emitter (D16: one spine).
  - It returns `{ detail, haltClass }`: `'mechanical'` for attempts 1 and 2, `undefined` (so needs-human)
    for attempt 3 and later.
  - The detail's first line is `routing rounds stalled: <roundId> (<host>: <state>, …); …: <cause>`.
  - No ref and no sidecar file are added.
- **Base-refresh deferral (Story 5).** The `baseRefreshDue` branch of `runStackPreflight` still emits
  `deferredBaseRefresh`, then falls through to reconciliation instead of returning `clear`.

## Prerequisites

- #3446 (spec PR #3458) merged and built: `StackPreflightResult.halted` carries `detail` and optional
  `haltClass: 'mechanical'`, and `runStackPreflight` writes that HALT.

## Tasks

### Task 1: Kind-aware admission fence in `admitRound`
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-admission.realgit.test.ts` for every Done-when check below (RED).
2. Implement `checkRoundAdmissionFence` and call it at the top of `admitRound`, returning `{ kind: 'refused', detail, fence: true }` on refusal; derive the revalidate rule from `selectNextHost` (imported from `routed-exit.ts`), not a parallel predicate (GREEN).
3. Commit.

**Done when:**
- [test] With an open audit round whose child hosts are settled, whose leaf host is `pending`, with no marker and a queued child, `admitRound` for a `revalidate` record returns `admitted`, writes the marker naming that revalidate round, and leaves the audit record's phase `open`.
- [test] With an open audit round holding a `pending` host and no marker, `admitRound` for a second `audit` record returns `refused` with `fence: true`, a `detail` naming the open round id, no marker ref created, and the second record left in phase `prepared`.
- [test] With an open audit round holding an `admitted`, a `repairing`, or a `built` host (three fixtures), and with an open audit round whose next selection is a pending child host, `admitRound` for a `revalidate` record returns `refused` with `fence: true` and creates no marker.
- [test] With another `open` record whose blob is unreadable, `admitRound` returns `refused` with `fence: true` and a `detail` naming that round id; with an orphan `prepared` record that no marker names, `reconcileRounds` deletes that record before any admission and a subsequent `admitRound` for a new audit record returns `admitted`.
- [test] When the fence passes but the marker already names another round, `admitRound` returns `refused` without `fence` and with the existing detail `routing round <id> is already open; cannot admit <id>`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — fence and `admitRound` result
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — fence tests

**Dependencies:** none

### Task 2: Fence audit routing and queue consumption before a record is allocated
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` for every Done-when check below (RED).
2. In `conductor.ts` audit routing, run `checkRoundAdmissionFence` before `createRouteRecord`; on refusal pass the stall to `recordRoundStall` and return `{ kind: 'halt', haltClass: stall.haltClass ?? 'needs-human', detail: stall.detail }`; map an `admitRound` result with `fence: true` the same way at all three conductor admission sites, and keep `needs-human` for refusals without `fence` (GREEN).
3. Commit.

**Done when:**
- [test] With every route record `closed`, no marker and an empty queue, the conductor's whole-feature audit routing creates one `audit` route record, admits its first host with the marker, and emits one `remediation_routed` event, as before.
- [test] With an open audit round holding a `pending` host and no marker, the conductor's audit routing creates no `refs/conductor/«slug»/routes/«roundId»` ref, writes no marker, emits no `remediation_routed` event, and halts with `.pipeline/HALT.class` `mechanical` whose first line names the open round id.
- [test] With another non-closed record unreadable, the conductor's audit routing creates no `refs/conductor/«slug»/routes/«roundId»` ref, writes no marker, emits no `remediation_routed` event, and halts with a first line naming the unreadable round id.
- [test] When the fence passes but the marker transaction loses to another writer's marker, the conductor halts with `.pipeline/HALT.class` `needs-human` and a first line naming both round ids.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — audit routing fence and admission halt class
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — audit routing fence tests

**Dependencies:** Task 1, Task 5

### Task 3: Reconcile the marker's round first, continue after a close, and report a stall
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-admission.realgit.test.ts` for every Done-when check below (RED).
2. Reorder `reconcileRounds` to visit the marker's round first, continue the walk when `advanceRound` returns `closed`, and return the new `stalled` arm for round-naming refusals (GREEN). Add the arm to every exhaustive switch over `ReconcileRoundsResult`.
3. Commit.

**Done when:**
- [test] With round r3 (host 1 `restacked`, host 2 `pending`) and r4 (host 1 `built`, marker on r4), `reconcileRounds` returns `resume-exit` for r4 host 1 and leaves the r3 record blob unchanged.
- [test] With r3 whose only unsettled host settles so `advanceRound` closes it while r4 is open with a `pending` host and no marker, one `reconcileRounds` call closes r3, admits r4's next host with the marker naming r4, and returns `navigate-host` for r4.
- [test] With a revalidate round closed inside an open audit round whose leaf host is `pending`, `reconcileRounds` admits the audit round's leaf host and returns its navigation.
- [test] With the marker naming a round whose record is unreadable, `reconcileRounds` returns `stalled` whose `rounds` list every non-closed round id, and the `for-each-ref refs/conductor/«slug»/` snapshot is unchanged.
- [test] With a contested compare-and-swap on the next-host admission (injected git runner refusing `update-ref`), `reconcileRounds` returns `stalled` naming the round and the host it could not admit.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — walk order, continuation, `stalled` arm
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — reconciliation tests

**Dependencies:** none

### Task 4: One exit continuation for every routed host exit
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` for every Done-when check below (RED).
2. Implement `exitRoutedHostAndReconcile` in `round-admission.ts` (exit, drain outboxes through the injected persist, reconcile) with an injectable `exit` defaulting to `requestRoutedExit` (GREEN).
3. Commit.

**Done when:**
- [test] When the injected exit returns `restacked`, `exitRoutedHostAndReconcile` drains the routing outboxes and then returns `continued` whose `next` is the `reconcileRounds` result for the same refs, asserted by call order on spies.
- [test] When the exit restack is refused or rolled back, `exitRoutedHostAndReconcile` returns `exit-halted` with the exit's detail, the host stays `built`, the marker blob is unchanged, no other host is admitted, and no route record is created (ref snapshot equality).
- [test] When the exit returns `no-commit-done` or `noop`, `exitRoutedHostAndReconcile` still reconciles and returns `continued`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — `exitRoutedHostAndReconcile`
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — continuation tests

**Dependencies:** Task 3

### Task 5: Bounded stall: `routing_rounds_stalled` event and escalation
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` for every Done-when check below (RED).
2. Add `routing_rounds_stalled` to the `ConductorEvent` union, implement `recordRoundStall` in `round-admission.ts`, and map a `stalled` reconciliation in `runStackPreflight` to `{ kind: 'halted', detail, haltClass }` from it (GREEN).
3. Commit.

**Done when:**
- [test] With `reconcileRounds` injected to return `stalled` and no prior stall events, `runStackPreflight` writes `.pipeline/HALT.class` `mechanical`, a HALT first line naming every stalled round id with its unsettled hosts, a `loop_halt` event carrying the same text, and one persisted `routing_rounds_stalled` event with `attempt` 1.
- [test] `resolveHaltRetention` over that HALT's class returns `retained: false`, and a daemon dispatch test of that stalled feature reports an outcome reason containing the stall text and not `loop ended without DONE or HALT marker`.
- [test] After two identical stalls with no intervening `routed_repair_phase` or `remediation_routed` event, the third `runStackPreflight` writes `.pipeline/HALT.class` `needs-human` with a first line naming every stalled round and a `loop_halt` carrying the same text; with a `routed_repair_phase` event after the second stall, the next stall is `attempt` 1 and `mechanical`.
- [test] Consecutive stalls whose `rounds` differ each record `attempt` 1, and after two identical stalls the third identical (escalating) stall raised while a live `.pipeline/HALT` exists leaves that HALT byte-identical.
- [test] Across the stall tests the full unfiltered `git for-each-ref --format=%(refname)` set is unchanged and `.pipeline/` gains no file other than `HALT`, `HALT.class` and `events.jsonl`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — `routing_rounds_stalled` event
- `src/conductor/src/engine/routing/round-admission.ts` — `recordRoundStall`
- `src/conductor/src/engine/restack/stack-preflight.ts` — `stalled` mapping
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — stall tests

**Dependencies:** Task 3

### Task 6: The resume preflight's routed exit continues its round
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` for every Done-when check below (RED).
2. Replace the `resume-exit` arm's direct `requestRoutedExit` call with `exitRoutedHostAndReconcile`, and route its `next` through the same post-reconciliation handling as the preflight's own reconciliation: queue consumption, the navigate arms, and the `stalled` mapping from Task 5. Return `repaired` only when `next` is terminal and the queue is empty (GREEN).
3. Commit.

**Done when:**
- [test] With an audit round whose host 1 is `built` holding the marker and host 2 `pending`, `runStackPreflight` completes host 1's exit restack and returns `navigate-host` for host 2, with host 2 `admitted` and the marker naming host 2 of that round in the same call.
- [test] With host 1 `built` and only the pending leaf host left and an empty queue, `runStackPreflight` returns `navigate-leaf-to-build` (or `navigate-host` for the leaf) with the marker naming the leaf host.
- [test] With every other host settled, an empty queue and no other non-closed round, `runStackPreflight` returns `repaired` after the round records `leafReturn`, reaches phase `closed`, and `conduct-state.json` shows `manual_test` and every later whole-feature gate `pending`.
- [test] With the child hosts settled after host 1's exit and a queued child, `runStackPreflight` returns `navigate-host` for that child's admitted `revalidate` round, before the leaf host.
- [test] With two open rounds where the marker-owning round's resumed exit is refused, `runStackPreflight` stops without changing the older round's record blob or the marker; and across every fixture in this file `runStackPreflight` never returns `repaired` while a round holds a `pending` host and no marker exists.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — `resume-exit` arm
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — resume continuation tests

**Dependencies:** Task 4, Task 5

### Task 7: The conductor's in-loop routed exit uses the same continuation
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` for every Done-when check below (RED).
2. Replace the in-loop `requestRoutedExit` + `drainRoutingOutboxes` + `reconcileRounds` sequence in `conductor.ts` with `exitRoutedHostAndReconcile`, forwarding `childRegionLifecycle.requestRoutedExit` as its `exit` when provided. Map `stalled` through `recordRoundStall` to a child-region halt carrying the returned class (`haltChildRegionRefusal` gains an optional class, defaulting to `needs-human`). Keep queue-wins-over-leaf-return and the existing branches on `next.kind` (GREEN).
3. Commit.

**Done when:**
- [test] The same fixture refs (host 1 `built`, child hosts settled, a queued child, leaf host pending) driven once through the conductor's in-loop BUILD-region exit and once through `runStackPreflight` leave byte-identical route record blobs, marker blob and queue blob, and both select the queued child's `revalidate` round next.
- [test] An injected `childRegionLifecycle.requestRoutedExit` is invoked by the in-loop exit exactly once and its `halted` result still halts with the exit's own HALT content.
- [test] When the in-loop continuation returns `stalled`, the conductor writes `.pipeline/HALT.class` `mechanical` naming the stalled rounds and emits a `routing_rounds_stalled` event.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — in-loop exit continuation
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — in-loop parity tests

**Dependencies:** Task 4, Task 5

### Task 8: Stalled routing states stop mechanically on resume
**Story:** Story 1, Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` for every Done-when check below (RED).
2. Fix any round-naming refusal path that still surfaces as `unavailable` instead of `stalled` (GREEN).
3. Commit.

**Done when:**
- [test] With a resumed exit whose restack applied and whose next-host admission compare-and-swap is contested (injected git runner), `runStackPreflight` stops with `.pipeline/HALT.class` `mechanical` whose first line names the round and the host it could not admit; with the refusal removed, the next `runStackPreflight` returns `navigate-host` for that host.
- [test] With a resumed exit whose route record cannot be reread after the restack applied, `runStackPreflight` admits no host, creates no route record, and stops with `.pipeline/HALT.class` `mechanical` whose first line names the unreadable round.
- [test] With two open rounds and a marker naming a round whose record is unreadable, `runStackPreflight` leaves the `refs/conductor/«slug»/` snapshot unchanged and stops with `.pipeline/HALT.class` `mechanical` whose first line names both round ids.
- [test] With a resumed exit of a `built` host whose exit restack is refused, and again with one rolled back, `runStackPreflight` stops, the host stays `built`, the marker blob is unchanged, no other host is admitted, and the `refs/conductor/«slug»/routes/` snapshot is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — residual refusal mapping
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — stalled resume tests

**Dependencies:** Task 6

### Task 9: A deferred base refresh still reconciles
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` for every Done-when check below (RED).
2. Change the `baseRefreshDue` branch of `runStackPreflight` to emit the deferral and then continue into reconciliation (GREEN).
3. Commit.

**Done when:**
- [test] With a due base refresh and an open round whose host 1 is `restacked`, host 2 `pending` and no marker, one `runStackPreflight` call emits one `restack_refused` with reason `deferred-base-refresh`, leaves the `refs/heads/` and closure-ref snapshot unchanged, and returns `navigate-host` for host 2 with the marker naming it.
- [test] With a due base refresh and an admitted host holding the marker, `runStackPreflight` emits the `deferred-base-refresh` refusal and returns the navigate result for that host.
- [test] With a due base refresh, every route record `closed` and an empty queue, `runStackPreflight` runs the base-refresh restack and creates no route record; with an open round whose reconciliation is `stalled`, no closure ref moves and the stop is the Task 5 `mechanical` HALT.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — base-refresh deferral branch
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — deferral tests

**Dependencies:** Task 6

### Task 10: A feature holding two open rounds drains them on resume
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing real-git test in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` that reconstructs the observed r3/r4 refs and drives successive `runStackPreflight` calls, settling each navigated host with the routed exit between calls (RED).
2. Fix any ordering defect it exposes (GREEN).
3. Commit.

**Done when:**
- [test] Starting from r3 (host 1 `restacked`, host 2 `pending`) and r4 (host 1 `built`, marker on r4, host 2 `pending`), successive `runStackPreflight` calls admit hosts in the order r4 host 1 exit, r3 host 2, r4 host 2, then record the leaf return, and every route record ends in phase `closed`.
- [test] No call in that drain returns `unavailable`, carries `round advance cas-failed`, or writes a HALT; every call returns a navigate result or `repaired`, never a result that stops the run without a HALT.
- [test] While r3 host 2 is admitted, including after an injected gate failure inside its region leaves it `repairing`, each `runStackPreflight` call returns `navigate-host` for r3 host 2 with the marker still naming r3 host 2, and r4 host 2 stays `pending` until r3 host 2's exit settles it.
- [test] Driving r3 host 2's region through the conductor with a failing `build_review` stub charges the failure to child 2's existing `build_review` cap and the round's `routedRepairCredit`, leaves r4's record blob unchanged, creates no route record and no `routing_rounds_stalled` event, and on cap exhaustion halts with HALT.class `kickback-cap` naming child 2.

**Files likely touched:**
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — two-open-round drain test
- `src/conductor/test/engine/routing/routed-repair-credit.test.ts` — drained host cap test
- `src/conductor/src/engine/routing/round-admission.ts` — ordering fixes if exposed

**Dependencies:** Task 6, Task 8

### Task 11: Only the exit continuation calls the routed exit
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write a failing structural test in `src/conductor/test/structural/routed-exit-single-caller.test.ts` that scans `src/conductor/src/**/*.ts` for value imports of `requestRoutedExit` (RED until Tasks 6 and 7 removed the direct callers).
2. Remove any remaining value import outside `round-admission.ts`; `import type` stays allowed (GREEN).
3. Commit.

**Done when:**
- [test] The structural test fails when a production module other than `src/conductor/src/engine/routing/round-admission.ts` and `routed-exit.ts` itself has a value import of `requestRoutedExit`, proven by an inline fixture source string it rejects.
- [test] Against the current tree the structural test passes, with `conductor.ts` and `restack/stack-preflight.ts` holding no value import of `requestRoutedExit`.

**Files likely touched:**
- `src/conductor/test/structural/routed-exit-single-caller.test.ts` — new structural test
- `src/conductor/src/engine/conductor.ts` — remaining import cleanup

**Dependencies:** Task 6, Task 7

### Task 12: Queue consumption runs the admission fence
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` for every Done-when check below (RED).
2. In `consumeLowestQueued` (`revalidation-queue.ts`), run `checkRoundAdmissionFence` before `createRouteRecord`: return `{ kind: 'busy' }` when another round holds an `admitted`, `repairing` or `built` host or selects a child host next, and `{ kind: 'stalled', detail, rounds }` when another non-closed record is unreadable. Map `stalled` through `recordRoundStall` in `runStackPreflight` and in the conductor's in-loop queue consumption (GREEN).
3. Commit.

**Done when:**
- [test] With an open audit round whose child hosts are settled, whose leaf host is `pending`, with no marker and one queued child, `runStackPreflight` consumes the queue so `consumeLowestQueued` admits a `revalidate` round, the marker names that round, and the audit record's phase stays `open`.
- [test] With an open audit round holding an `admitted`, `repairing` or `built` host, or whose next selection is a pending child host, `consumeLowestQueued` returns `busy`, creates no route record, and leaves the `refs/conductor/«slug»/revalidate` blob byte-identical.
- [test] With another non-closed record unreadable and a queued child, `runStackPreflight`'s queue consumption creates no `revalidate` record and stops with a HALT whose first line names the unreadable round id.

**Files likely touched:**
- `src/conductor/src/engine/routing/revalidation-queue.ts` — fence before record creation
- `src/conductor/src/engine/restack/stack-preflight.ts` — queue `stalled` mapping
- `src/conductor/src/engine/conductor.ts` — in-loop queue `stalled` mapping
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — queue fence tests

**Dependencies:** Task 1, Task 5, Task 6

## Task Dependency Graph

```
Task 1 ──► Task 2 ◄── Task 5
Task 3 ──► Task 4 ──► Task 6 ──► Task 8 ──► Task 10
Task 3 ──► Task 5 ──► Task 6 ──► Task 9
           Task 4,5 ──► Task 7
           Task 6,7 ──► Task 11
           Task 6 ──► Task 10
           Task 1,5,6 ──► Task 12
```

## Integration Points

- After Task 6: a halted routed exit resumed through `runStackPreflight` admits its round's next host,
  which closes the r1→r2 leak.
- After Task 7: both exit callers share one continuation.
- After Task 10: the observed two-open-round wedge drains on resume.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | no-change | none | Routing entry and classification are untouched; this feature changes only round admission, reconciliation and exit continuation. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Owner derivation is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | Residue routing judgement is not changed; the fence runs before record allocation. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | no-change | none | Owner/host separation and upward moves are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | Prerequisite claims and reroutes are not changed; `completeRerouteSync` still returns `deferred`. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-6, task-3 | `runStackPreflight` completes host 1's exit restack and returns `navigate-host` for host 2, with host 2 `admitted` and the marker naming host 2 of that round in the same call. |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-1, task-2, task-3, task-5, task-9 | `admitRound` for a second `audit` record returns `refused` with `fence: true` |
| adr-2026-10-12-routed-whole-feature-repair#D8 | no-change | none | `resolveExecutionChild` and the cursor fields are unchanged; the fix admits the marker so the existing resolver reports `routed-host`. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | no-change | none | Routed task append at region entry is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | no-change | none | Round receipt settlement is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Repair obligation keying is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The host `build_review` snapshot base is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-4, task-7, task-11 | leave byte-identical route record blobs, marker blob and queue blob, and both select the queued child's `revalidate` round next |
| adr-2026-10-12-routed-whole-feature-repair#D14 | task | task-12 | `consumeLowestQueued` returns `busy`, creates no route record, and leaves the `refs/conductor/«slug»/revalidate` blob byte-identical |
| adr-2026-10-12-routed-whole-feature-repair#D15 | existing | none | `returnToLeaf` already re-pends the leaf gates through `restageLeafGates` in `routing/routed-exit.ts`; Task 6 only reaches it on the resume path. |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-5 | one persisted `routing_rounds_stalled` event with `attempt` 1 |
| adr-2026-10-12-routed-whole-feature-repair#D17 | no-change | none | All changed paths run only for a feature with route refs; a flat N=1 feature has none, so `reconcileRounds` returns `none` as today. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | existing | none | `runStackPreflight` already gates routing reconciliation on `routingSettingOn` and `routingEligible`; nothing here changes the flag. |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-as-built-R1: In stack-preflight.ts, when the resume-exit continuation (or reconciliation) returns leaf-returned and the queue is empty, return the completed routed result after confirming terminal routing state instead of reusing the pre-exit receiptCursor and reaching the feature-repair restack; add a runStackPreflight test proving no second restack runs
**Gate:** as-built
**Rationale:** Verified (90%): after resume-exit, stack-preflight.ts uses the continuation's leaf-returned result only for queue consumption. It then falls through to the pre-exit receiptCursor and the automatic feature-repair restack with stale repairChildren. ADR D13 is authoritative and clear that every exit caller consumes the returned next step. This is conforming implementation drift and needs no architectural decision.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 13
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 13 is satisfied by this task.
- The repair for task rem-as-built-R1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-S1.8: stack-preflight.ts resume-exit: route exit-halted from an unreadable restacked route record through recordRoundStall (or a haltClass 'mechanical' detail naming the round id) instead of needs-human; add task 8 test for the unreadable reread after restack
**Gate:** prd-audit
**Rationale:** Verified (95%, read stack-preflight.ts:269): the resume-exit branch maps exitRoutedHostAndReconcile's `exit-halted` to `{kind:'halted', detail}` with no haltClass, so line 464 writes `needs-human`, and the detail names only the host. Task 8's done-when needs an unreadable reread of the restacked route record to stop with HALT.class `mechanical`, with a first line that names the unreadable round. The approved architecture already covers this; the code does not conform. It is BUILD work under task 8 and needs no architecture or product decision. Fix: when the exit continuation halts because the route record is unreadable (a reread after restack, or a failed drain), reconcile to the stalled round set and send it through recordRoundStall, as the failed-drain path at stack-preflight.ts:233-241 already does. If that reconcile is not `stalled`, return `haltClass:'mechanical'` with a detail that names the round id. Keep refused or rolled-back exit restacks on their existing stop semantics, which task 8's last done-when covers. Add the task 8 test: after restack the reread fails, no host is admitted, no route record is created, and HALT.class is `mechanical` with a first line that names the round.
**Criterion:** S1.8
**Parent task:** 8
**Done when:**
- [test] S1.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-S1.8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-S1.9: stack-preflight.ts: never reach the pre-exit receiptCursor feature-repair path after routed reconciliation yields deferred/busy with an open round (stop instead); round-admission.ts reconcileRounds checks all open rounds before returning deferred; add task 6 test for the deferred+busy fence
**Gate:** prd-audit
**Rationale:** Verified (90%, read stack-preflight.ts:279-322 and round-admission.ts:316-353): when reconciled is `deferred` (another open round still has a pending host) and consumeLowestQueued returns `busy`, preflight falls through to the plain-cursor path through the pre-exit receiptCursor. That path can run a feature-repair restack and return `repaired`. This breaks task 6's done-when, which says preflight never returns `repaired` while a round holds a `pending` host. Earlier remediation rem-as-built-R1 guarded only `leaf-returned`; this is the same defect class on its `deferred`/`busy` sibling. Approved architecture (ADR D13) already requires every exit caller to consume the returned next step, so this is conforming BUILD work under task 6. Fix: once the routed block has run (a resume-exit continuation, or any non-terminal reconcile with open rounds), never fall through to the receiptCursor/feature-repair path. When the result is deferred or busy with an open round, return a stop (`unavailable` or a mechanical halt naming the blocking round), not a restack. Also make reconcileRounds scan every open round before it returns `deferred`, so a later round's actionable state is not hidden. Keep the existing leaf-returned terminal fast path. Add the task 6 test: two open rounds, the second holds a pending child host, so the queue fence returns busy, and runStackPreflight does not return `repaired` or run a restack.
**Criterion:** S1.9
**Parent task:** 6
**Done when:**
- [test] S1.9 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-S1.9 is committed and its targeted tests pass.
