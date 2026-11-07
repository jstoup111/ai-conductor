# Implementation Plan: Refused over-scope rework can't start while a routing round is open

**Date:** 2026-11-07
**Design:** `.docs/decisions/architecture-review-2026-11-07-refused-over-scope-rework-can-t-start-while-a-rout.md`; `adr-2026-10-12-routed-whole-feature-repair` decisions 7 (amended by #3445, #3455 and #3597), 13 and 15; diagram `.docs/architecture/refused-over-scope-rework-can-t-start-while-a-rout.md`
**Stories:** .docs/stories/refused-over-scope-rework-can-t-start-while-a-rout.md
**Conflict check:** Clean as of 2026-11-07 (`.docs/conflicts/2026-11-07-refused-over-scope-rework-can-t-start-while-a-rout.md`)

## Summary

This plan makes three changes:
- A `build_review` that settles through adjudication closes its child region as a clean PASS does.
- No whole-feature gate starts on a stacked feature while routed work is outstanding.
- A round-admission fence refusal, including one hit by refusal rework, becomes a bounded,
  retryable routing stop that names the blocking round instead of an over-scope decision request.

8 tasks, single PR.

## Technical Approach

- **Root causes (verified against the wedged `path-policy-still-decides-feature-ownership-by-fol` worktree).**
  - **(a) The settled arm skips the region closure.** In `conductor.ts`, the build_review
    adjudication arm `if (outcome.kind === 'settled')` settles cases, saves `build_review` `done`
    and runs a bare `continue`. That skips the clean-PASS success tail, the child-region closure
    block (`step.name === 'build_review' && activeChild !== undefined && activeChildRequiresClosure`,
    which calls `continueRoutedHostExit` or `advanceChildRegion`) and `advanceTail`. The loop's
    `i++` then walks into `manual_test` and the `prd_audit` validation group.
  - **(b) Resume skips the same exit.** The resume index comes from `findResumeIndex` plus an
    `earliestUnsatisfiedGateIndex` clamp that has no routed parking. Reconciliation's
    `navigate-leaf-to-build` activates the leaf, and the host's four `done` region steps take the
    `alreadyResolved` short-circuit `continue`. The host exit therefore never runs, because
    `repairing → built` happens only inside `continueRoutedHostExit` / `requestRoutedExit`.
  - **(c) Refusal rework rewrites the fence stop.** The stacked-route fence returns
    `haltClass: 'mechanical'`. The refusal-rework callers (the serial SHIP-tail refusal path and
    `haltGroupedRefusalRework`) then pass it through `refusalRoundFault` (in
    `prd-widening-refusal-rework.ts`), which keeps only the detail. `writeRefusalReworkHalt` then
    always writes `over-scope` with a `revise-decision` block.

- **One success tail for both build_review outcomes.**
  - The settled arm stops `continue`-ing. After its durable case settlement succeeds, it runs the
    same success tail as a clean PASS: `step_completed`, then the child-region closure (routed
    exit or `advanceChildRegion`), then `advanceTail`.
  - Settlement is not run a second time: the clean tail's `settleRemediationCasesOnCleanBuildReview`
    call is skipped when the settled arm already ran it.
  - For a non-closing child (the leaf or N=1), `advanceTail`'s existing `computeAndWriteVerdict`
    records the effective `build_review` verdict as a clean PASS does. `resolveEffectiveBuildReviewVerdict`
    already folds in settled source ids.

- **One routed-work test, one guard.**
  - Extract the inline routed-parking derivation from `advanceTail` (the `resolveSealedLeaf` → `readRepairMarker` →
    `readRevalidationQueue` block) into `routedWorkOutstanding(worktree, slug, config)` in
    `routing/round-admission.ts`. It sits beside `routedRoundOpen` and adds that function's non-closed
    route-record test.
  - It returns either `none`, or the existing `RoutedParking` kinds (`child`, `leaf-host`, `queue`)
    plus a new `open-round` kind for a non-closed record with no marker or queue entry. A read
    failure returns `unreadable` with its subject.
  - At the top of the `stepLoop` body, for any index after `build_review`, the guard calls it before
    the done/skipped short-circuit and the validation-group fan-out.
  - When routed work is outstanding, the guard reuses `advanceTail`'s parked sequence:
    1. Activate the marker's host through `resolveExecutionChild` and `activateChildRegionState`.
    2. Try `continueRoutedHostExit(state, indexOf, true)`. A satisfied host takes its exit.
    3. Otherwise reconcile, then consume the queue through `admitQueuedRevalidation`. A
       `navigate-leaf-to-build`, `navigate-host` or queue admission re-enters the BUILD region at the
       earliest unsatisfied region gate.
    4. Otherwise stop through `stopParkedForRouting`, the bounded `recordRoundStall` path.

- **The fence stop is a routing stop.**
  - `checkRoundAdmissionFence` names the blocking round's id, `phase`, open host and that host's
    state, and `ai-conductor stack rounds --slug <slug>`.
  - `resolveStackedRoute` marks a fence halt with a new `routingFence: true` field on its halt
    result, because `'mechanical'` is not unique to the fence. It also records the stop through
    `diagnoseAffectedRounds` + `recordRoundStall` (mechanical twice, needs-human on the third
    identical stop).
  - `refusalRoundFault` and both refusal-rework callers carry that field. When it is present they
    write the routing stop with the refused criterion keys listed (`Findings: <keys>`, as
    `writeRefusalReworkAllowanceHalt` lists them) and no decision block. Every other refusal-rework
    outcome is unchanged.

- **Pattern basis.**
  - The guard follows `advanceTail`'s parked handling: try the exit with `requireSatisfiedRegion`,
    else `stopParkedForRouting`.
  - The fence stop follows `haltAdmissionStall`: diagnose, then `recordRoundStall`, then halt with
    `stall.haltClass ?? 'needs-human'`.
  - Allowed variation: helper names and where the shared success-tail helper lives inside
    `conductor.ts`.

## Prerequisites

- None. #3445, #3455 and #3477 are on main. The D7 amendment for #3597 is committed on this spec
  branch.

## Tasks

### Task 1: One routed-work-outstanding test shared by gate selection
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-admission.realgit.test.ts` for each Done-when check (RED).
2. Implement `routedWorkOutstanding` in `src/conductor/src/engine/routing/round-admission.ts` by moving the inline parking derivation out of `advanceTail` in `src/conductor/src/engine/conductor.ts`. Preserve its traits: routing-on and sealed leaf > 1 precondition, marker first, then queue, `leaf-host` vs `child`, unreadable queue counts as outstanding. Add a final non-closed route-record test (`open-round`) and an `unreadable` result naming the subject (marker, queue, or round id). Make `advanceTail` derive its `RoutedParking` from it (GREEN).
3. Commit.

**Done when:**
- [test] `routedWorkOutstanding` returns `leaf-host` or `child` for a marker on the leaf or a non-leaf host, `queue` for a non-empty queue with no marker, and `open-round` naming the round id for an `open` record with a `pending` host, no marker and an empty queue.
- [test] `routedWorkOutstanding` returns `none` when every route record is `closed`, no marker exists and the queue is empty.
- [test] `routedWorkOutstanding` returns `unreadable` naming `marker`, `queue` or the round id when the marker blob, the queue blob or one route record blob cannot be parsed.
- [test] With `stacked_prs.route_whole_feature_fixes` false, or a sealed leaf of 1, `routedWorkOutstanding` returns `none` and its injected git runner records no `for-each-ref`, `cat-file` or `rev-parse` call against `refs/conductor/`.
- [test] The existing `conductor-routed-verify-green.test.ts` parked-selection cases pass unchanged with `advanceTail` deriving `RoutedParking` from `routedWorkOutstanding`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — `routedWorkOutstanding`
- `src/conductor/src/engine/conductor.ts` — `advanceTail` uses it
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — tests

**Dependencies:** none

### Task 2: A settled build_review runs the clean-PASS success tail
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing conductor-loop tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` for each Done-when check (RED). Pattern: the existing settled-adjudication cases ("lets an exactly covered infrastructure branch settle…"), extended with a stacked routed round fixture (route record, repair marker) like `test/engine/routing/conductor-routing-resume.test.ts`.
2. In `src/conductor/src/engine/conductor.ts`, replace the settled arm's `saveConductorStepStatus` + bare `continue` with a call into the shared build_review success tail. Factor the clean-PASS tail into one private helper both arms call: status `done`, `step_completed`, the child-region closure (`continueRoutedHostExit` or `advanceChildRegion`), then `advanceTail`. Skip the second `settleRemediationCasesOnCleanBuildReview` when the settled arm already settled. Keep the invalid-settlement needs-human halt before the tail (GREEN).
3. Commit.

**Done when:**
- [test] With audit round r2 (host 1 `repairing` holding the marker, host 2 `pending`), a host 1 `build_review` FAIL whose adjudication rejects every finding leaves host 1 `restacked`, host 2 `admitted`, the marker naming host 2 of r2, and the run's next `step_started` is host 2's BUILD region (`child: 2`) with no `step_started` for `manual_test`, `prd_audit` or `architecture_review_as_built`.
- [test] Running the same r2 refs once through a clean `build_review` PASS and once through adjudication settlement leaves byte-identical `routes/r2` blobs and marker blobs, and both runs select the same next routed step; with host 1 the last unsettled child host and an empty queue, both select the same leaf host or leaf return.
- [test] An ordinary non-leaf child (cursor source, no route refs) whose `build_review` settles by adjudication is recorded closed exactly as a clean PASS closes it (`advanceChildRegion` creates `refs/conductor/«slug»/closed/c«k»` for that child), then emits `child_started` for the next child and re-enters at `acceptance_specs` on that child, with no whole-feature gate `step_started` event.
- [test] When `settleRemediationCasesOnCleanBuildReview` returns `invalid`, the run writes a `needs-human` HALT containing `build_review clean-PASS durable settlement halted` and makes no `requestRoutedExit` call, no `advanceChildRegion` call and no whole-feature gate `step_started` event.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — settled arm and shared success tail
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — loop tests

**Dependencies:** none

### Task 3: A settled child's region-exit refusal stops as a PASS exit refusal does
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` for each Done-when check (the N=1 and leaf fixtures run the settled outcome with no refusal), injecting `requestRoutedExit` and `advanceChildRegion` refusals through the existing conductor options (RED).
2. Confirm the Task 2 success tail carries both refusals to the existing stops: a HALT the exit already wrote stands, otherwise `haltChildRegionRefusal`. Fix the tail if it does not (GREEN).
3. Commit.

**Done when:**
- [test] A routed host whose `build_review` FAILs and settles by adjudication (every finding rejected), then reaches a refused or rolled-back exit restack (injected `requestRoutedExit` halt) ends the run with the existing routed-exit refusal HALT, host 1 still `built` or `repairing` with the marker unchanged, and no `step_started` for any whole-feature gate.
- [test] An ordinary non-leaf child whose settled `build_review` reaches an injected `advanceChildRegion` refusal writes the HALT `child <k> region exit refused: <reason>` naming that child, with no whole-feature gate `step_started` event.
- [test] For an N=1 feature, for the leaf of a stacked feature with no route refs, and for the leaf of a stacked feature whose `routes/«roundId»` refs all exist and are `closed` (three fixtures), a `build_review` that FAILs and settles by adjudication (every finding rejected) is followed by `advanceTail` writing `.pipeline/[children/<k>/]gates/build_review.json` with `satisfied: true`, the next `step_started` is the next whole-feature gate as today, and the set of `refs/conductor/` refs and each ref's value are byte-identical before and after, with no ref added or removed.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — success-tail refusal handling, if needed
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — refusal tests

**Dependencies:** Task 2

### Task 4: Whole-feature gate guard takes a satisfied host's exit, including on resume
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` for each Done-when check (RED). Fixture: the wedged r2 state, with host 1 `repairing` holding the marker, every host 1 region step `done` and its gates stamped `routedRound: r2`, host 2 `pending`, and the whole-feature gates pending. Resume it through `run()`.
2. In `src/conductor/src/engine/conductor.ts`, add the guard at the top of the `stepLoop` body for `i > indexOf('build_review')`, before the done/skipped short-circuit and the validation-group fan-out. Call `routedWorkOutstanding`. When it reports a marker, activate the marker's host (`resolveExecutionChild` → `activateChildRegionState`) and call `continueRoutedHostExit(state, indexOf, true)`. Navigate to its result as the closure block does. Follow `advanceTail`'s parked handling (try the exit with `requireSatisfiedRegion`, else stop) (GREEN).
3. Commit.

**Done when:**
- [test] Resuming the r2 fixture emits no `step_started` for `manual_test`, `prd_audit` or `architecture_review_as_built` before r2 is `closed`. Host 1 ends `restacked`, host 2 is `admitted` with the marker, and the next `step_started` carries `child: 2`.
- [test] Resuming a fixture whose routed host's `build_review` settled by adjudication before an interruption emits no `step_started` for `build_review` and takes the host's routed exit, with the next `step_started` on the next routed host.
- [test] Resuming after the exit restack of an earlier host whose `build_review` FAILed and settled by adjudication (every finding rejected) was refused (host `built`) and, separately, after it was rolled back (host `repairing`, marker unchanged), each with the HALT cleared (two fixtures), takes that host's routed exit with no `step_started` for `build_review`.
- [test] A stacked feature with every route record `closed`, no marker and an empty queue runs `manual_test`, `prd_audit` and `architecture_review_as_built` in the same order and with the same `step_started` events as before the guard.
- [test] A conductor run of an N=1 feature, and of a stacked feature with `stacked_prs.route_whole_feature_fixes` false, through `manual_test` and `prd_audit` records no git call against `refs/conductor/` from the guard (injected git runner).

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — loop-top guard
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — resume tests

**Dependencies:** Tasks 1, 2

### Task 5: Guard re-enters an unfinished host, admits queued or pending work
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` for each Done-when check (RED).
2. Extend the Task 4 guard. When no satisfied host exit applies, run `reconcileRounds` and pass its result to `admitQueuedRevalidation`, as the routed-exit continuation does. Navigate a `navigate-leaf-to-build`, `navigate-host` or queue admission to the BUILD region at the earliest unsatisfied region gate (GREEN).
3. Commit.

**Done when:**
- [test] After a HALT is written and cleared, resuming with the marker naming host 1 whose `test_suite` and `build_review` are both unsatisfied in the executing round re-enters host 1's BUILD region with the next `step_started` being `test_suite` (the earliest unsatisfied region gate) with `child: 1`, and no whole-feature gate `step_started` event.
- [test] With no marker and one queued child, the guard admits that child's `revalidate` round (a new `routes/«roundId»` ref of kind `revalidate` and a marker naming the child), the next `step_started` is that child's BUILD region carrying its `child`, and no whole-feature gate `step_started` event is emitted.
- [test] With an `open` audit round whose host 2 is `pending`, no marker and an empty queue, the guard admits host 2 (marker naming host 2, a `routed_repair_phase` admission event) and the next `step_started` carries `child: 2`, with no whole-feature gate `step_started` event.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — guard reconcile and queue paths
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — tests

**Dependencies:** Task 4

### Task 6: Guard stops on unadvanceable or unreadable routed work, bounded
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` (pattern: "escalates the third identical parked r5 stall…") for each Done-when check (RED).
2. In the guard, route every outcome that can make no progress, and every `unreadable` result, to `stopParkedForRouting`. That function diagnoses the affected rounds, calls `recordRoundStall`, writes the HALT with `stall.haltClass ?? 'needs-human'` and emits the loop halt. For `unreadable`, name the subject in the stall detail (GREEN).
3. Commit.

**Done when:**
- [test] An outstanding marker whose reconciliation is contested (injected compare-and-swap loss) writes `.pipeline/HALT.class` `mechanical`. The HALT's first line names the round id, the host or `queue`, and the reason, and no whole-feature gate `step_started` event is emitted.
- [test] The same unadvanceable state stopping three consecutive times with no intervening routing event writes `mechanical`, `mechanical`, then `needs-human`, each naming the same round, with persisted `routing_rounds_stalled` `attempt` 1, 2 and 3.
- [test] An unreadable marker blob, queue blob or route record blob at the guard writes a HALT naming `marker`, `queue` or that round id, with no whole-feature gate `step_started` event.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — guard stop path
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — stall tests

**Dependencies:** Task 4

### Task 7: The fence names its blocking round and stops through the bounded routing stall
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-admission.realgit.test.ts` and `src/conductor/test/engine/prd-audit-kickback-typed.test.ts` for each Done-when check (RED).
2. In `src/conductor/src/engine/routing/round-admission.ts`, change `checkRoundAdmissionFence`'s `detail` to name the round id, its `phase`, the open host and that host's state (the marker host when the marker names the round, else the first unsettled host), plus `ai-conductor stack rounds --slug <slug>`. For an unreadable round, name the round and claim no host. In `resolveStackedRoute` in `src/conductor/src/engine/conductor.ts`, add `routingFence: true` to the fence halt (both the pre-allocation fence and the `admitRound` refusal with `fence: true`). Record the stop through `diagnoseAffectedRounds` + `recordRoundStall`, and use `stall.haltClass ?? 'needs-human'` as the halt class (GREEN).
3. Commit.

**Done when:**
- [test] With r2 `open`, host 1 `repairing` holding the marker and host 2 `pending`, `checkRoundAdmissionFence` for an `audit` r3 returns `fence: true` and a `detail` containing `r2`, `open`, `host 1`, `repairing` and `ai-conductor stack rounds --slug` followed by the fixture's feature slug.
- [test] With another round's record blob unreadable (it is the only other round), an audit or revalidate admission is refused, and the fence `detail` and the whole HALT text name that round id and contain no `host` substring and none of the host-state tokens `pending`, `admitted`, `repairing`, `built`, `restacked`.
- [test] Stacked audit routing refused by the fence returns a halt with `routingFence: true`, persists one `routing_rounds_stalled` event, writes `.pipeline/HALT.class` `mechanical` on attempts 1 and 2 and `needs-human` on attempt 3, and each HALT's first line contains the blocking round id, its phase, its open host, that host's state and `ai-conductor stack rounds --slug` followed by the fixture's feature slug.
- [test] With every route record `closed`, no marker and an empty queue, stacked audit routing creates exactly one new `refs/conductor/«slug»/routes/«roundId»` ref, emits one `remediation_routed` event and admits its first host, with no `routing_rounds_stalled` event.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — fence detail
- `src/conductor/src/engine/conductor.ts` — `resolveStackedRoute` fence marking and stall
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — fence detail tests
- `src/conductor/test/engine/prd-audit-kickback-typed.test.ts` — routing-stop tests

**Dependencies:** none

### Task 8: Refusal rework treats a fence refusal as a routing deferral
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/prd-audit-kickback-typed.test.ts` and `src/conductor/test/prd-audit-kickback.test.ts` (patterns: "keeps the refused-widening HALT and appends the final planner fault", "dispatches refusal rework through the serial SHIP tail to BUILD"), plus one real-git resume case in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts`, for each Done-when check (RED).
2. Carry `routingFence` through `RefusalRoundOutcome` and `refusalRoundFault` in `src/conductor/src/engine/prd-widening-refusal-rework.ts`. In the serial refusal path and `haltGroupedRefusalRework` in `src/conductor/src/engine/conductor.ts`, write the routing-stop HALT when `routingFence` is set: Task 7's stall detail and class, then `Findings: <refused keys>`, with no `renderOverScopeDecisionBlock` output. Leave `writeRefusalReworkHalt` and `writeRefusalReworkAllowanceHalt` unchanged for every other outcome (GREEN).
3. Commit.

**Done when:**
- [test] Serial and grouped refusal rework whose route is fence-refused write `.pipeline/HALT.class` `mechanical`, a body that lists the refused criterion keys after `Findings:` and contains neither `revise-decision` nor a `json over-scope-decisions` fence nor `Remediation planner fault`, and leave the recorded refusal decisions in `.pipeline/accepted-widenings.json` byte-identical.
- [test] Serial and grouped refusal rework fence-refused three consecutive times with no intervening routing event write `.pipeline/HALT.class` `mechanical`, `mechanical`, then `needs-human`, persist `routing_rounds_stalled` `attempt` 1, 2 and 3, and each HALT's first line contains the blocking round id, its phase, its open host, that host's state and `ai-conductor stack rounds --slug` followed by the fixture's feature slug.
- [test] Refusal rework whose allowance is spent, whose planner returns a human disposition, whose admission loses the marker race, that hits the round limit, or whose route record creation fails keeps its existing HALT class and body (five fixtures, asserted against the pre-change renderers).
- [test] Real-git resume: a recorded `refuse` decision for NC-4 plus r2 `open` (host 1 `repairing` with satisfied region, host 2 `pending`) emits host 2's BUILD region `step_started` (`child: 2`) and leaves both r2 hosts `restacked` before r2 closes, closes r2 before any `prd_audit` `step_started`, then admits r3, whose `refs/conductor/«slug»/routes/r3` record has kind `audit` and whose every host allocation carries only the NC-4 refusal rework tasks, the next `step_started` after that admission is the BUILD region of r3's first host (its `child`) building the NC-4 rework task, and no HALT contains `cannot admit` or `Remediation planner fault`.
- [test] After `halt clear` of an over-scope HALT whose every decision is recorded, the resumed run emits a routing progress event (`routed_repair_phase` host exit, admission, or round close) and writes no HALT containing `revise-decision`.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-refusal-rework.ts` — carry `routingFence`
- `src/conductor/src/engine/conductor.ts` — serial and grouped refusal-rework halts
- `src/conductor/test/engine/prd-audit-kickback-typed.test.ts` — halt-shape tests
- `src/conductor/test/prd-audit-kickback.test.ts` — non-fence regression fixtures
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — real-git resume case

**Dependencies:** Tasks 4, 7

## Task Dependency Graph

```text
Task 1 ─┐
Task 2 ─┼─> Task 4 ─┬─> Task 5
        │           ├─> Task 6
        │           └─┐
Task 2 ─> Task 3      │
Task 7 ───────────────┴─> Task 8
```

## Integration Points

- After Task 4, a wedged r2 resume through `run()` closes r2 before any whole-feature gate.
- After Task 8, a recorded refusal raised during an open round is reworked in a new round after r2
  closes, through the real conductor resume.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | no-change | none | Routing entry and classification are untouched; this feature changes build_review completion, whole-feature gate entry and the fence stop. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Owner derivation is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | The residue routing judgement is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | no-change | none | Owner/host separation and upward host moves are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | Prerequisite claims and reroutes are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | no-change | none | Route records stay the round authority; the guard only reads them through `routedWorkOutstanding` and the existing reconciliation. |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-1, task-4, task-5, task-6, task-7, task-8 | `open-round` naming the round id for an `open` record with a `pending` host, no marker and an empty queue |
| adr-2026-10-12-routed-whole-feature-repair#D8 | no-change | none | `resolveExecutionChild` and the cursor fields are used as they are; the guard activates the marker's host through them. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | no-change | none | Routed task append at region entry is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | no-change | none | Round receipt settlement is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Repair obligation keying is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The host `build_review` snapshot base and grading are not changed; only the settled outcome's continuation changes. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-2, task-3 | Running the same r2 refs once through a clean `build_review` PASS and once through adjudication settlement leaves byte-identical `routes/r2` blobs and marker blobs |
| adr-2026-10-12-routed-whole-feature-repair#D14 | existing | none | The guard consumes the queue through the existing `admitQueuedRevalidation` helper (`routing/queue-admission.ts`); queue semantics are unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-4 | emits no `step_started` for `manual_test`, `prd_audit` or `architecture_review_as_built` before r2 is `closed` |
| adr-2026-10-12-routed-whole-feature-repair#D16 | existing | none | Stops reuse `recordRoundStall`, which already persists `routing_rounds_stalled` on the event spine; no new event variant. |
| adr-2026-10-12-routed-whole-feature-repair#D17 | task | task-1 | With `stacked_prs.route_whole_feature_fixes` false, or a sealed leaf of 1, `routedWorkOutstanding` returns `none` |
| adr-2026-10-12-routed-whole-feature-repair#D18 | no-change | none | The routing flag and its default are not changed. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] No task targets another feature's sealed artifact
