# Implementation Plan: Routed remediation skips re-run steps on stale child verdicts, then exits markerless

**Date:** 2026-10-28
**Design:** `.docs/decisions/architecture-review-2026-10-28-routed-remediation-skips-re-run-steps-on-stale-chi.md`; `adr-2026-10-12-routed-whole-feature-repair` decisions 7, 9 and 13 (amended by #3455); diagram `.docs/architecture/routed-remediation-skips-re-run-steps-on-stale-chi.md`
**Stories:** .docs/stories/routed-remediation-skips-re-run-steps-on-stale-chi.md
**Conflict check:** Clean as of 2026-10-28 (`.docs/conflicts/2026-10-28-routed-remediation-skips-re-run-steps-on-stale-chi.md`)

## Summary

Scope a routed host's child region verdicts to the round that wrote them, so a re-pended step always
re-runs and in-round work survives a resume. Let a host region finished in the round take its routed
exit on resume. Replace the silent parked and refused-completion exits with a named, bounded HALT.
10 tasks, single PR.

## Technical Approach

- **Prerequisite shape (#3445, spec `routed-repair-opens-a-new-round-while-an-earlier-r`).**
  - That plan supplies `recordRoundStall(worktree, slug, stall, events)` in
    `src/conductor/src/engine/routing/round-admission.ts`. The stall is `{ detail, rounds: RoundStallEntry[] }`
    and the result is `{ detail, haltClass }`: `mechanical` for attempts 1 and 2, `undefined` (needs-human)
    from attempt 3. Identity is deep-equal `rounds`; `routed_repair_phase` and `remediation_routed` reset it.
  - It also supplies `exitRoutedHostAndReconcile(input)`, the one exit continuation, which the conductor's
    in-loop BUILD-region exit calls after its Task 7.
  - BUILD starts after #3445 merges. Verify both landed shapes first; if they differ, map onto what landed
    without widening scope (architecture-review Condition 1).
- **Executing round (one resolver).** A new private conductor method `routedRoundForActiveChild(state)`
  returns the marker's `roundId` only when `stacked_prs.route_whole_feature_fixes` is on,
  `activeRegionChild` is set, and `readRepairMarker` returns a marker whose `host` equals
  `activeRegionChild`. Every other case (flag off, flat N=1, unrouted child, no marker, unreadable marker)
  returns `undefined`, which means no stamp and no mask (Condition 2; D17 parity).
- **Stamp at the writer (D9 as amended).**
  - `GateVerdict` gains optional `routedRound?: string` in `src/conductor/src/engine/gate-verdicts.ts`.
  - `CompletionContext` (`src/conductor/src/engine/artifacts.ts`) gains optional `routedRound`.
    `computeAndWriteVerdict` stamps `ctx.routedRound` on a region step's child verdict.
  - `writeVerdict` gains an optional trailing `options: { routedRound?: string }`, applied only when `child`
    is set and the step is a region step.
  - The conductor's `completionCtx` adds `routedRound` from the resolver. The one direct child-region
    `writeVerdict` (the routed-forward `build` verdict in the success tail) passes it. A verdict written
    by any other path stays unstamped, which fails safe (a re-run, never a skip).
- **Round-scoped read (D9 as amended).** `readGateVerdictOverlay` keeps its per-child replacement loop.
  When the resolver returns a round, it also deletes a child verdict that is `satisfied: true` and whose
  `routedRound` is not that round, including an unstamped one. An unsatisfied verdict is never deleted.
  `selectNextGate` and `gateSatisfied` (`src/conductor/src/engine/selector.ts`) are unchanged: with the
  entry gone, the step's status decides.
- **Resume exit (D13 as amended).** The in-loop exit (after #3445, the `exitRoutedHostAndReconcile` call
  and its `next.kind` handling in the `build_review` closure branch of `conductor.ts`) moves into one
  private method, `continueRoutedHostExit(execution, slug, state)`. The closure branch calls it unchanged.
  `advanceTail`'s `parked` arm calls it first when `routedParking.kind` is `child` or `leaf-host`, the
  marker's host is `activeRegionChild`, and every `CHILD_REGION_STEPS` entry passes `gateSatisfied` over
  the masked overlay. Its refusal handling stays the in-loop arm's: an exit-written HALT stands, otherwise
  `haltChildRegionRefusal`. No routing stall is recorded for it.
- **Named parked stop (D7 as amended).**
  - A new private method, `stopParkedForRouting(cause, state)`, replaces the step loop's two silent
    `parkedForRouting = true` exits: `advance === 'parked'`, and a `completeRun` that returns `false`.
    The `parkedForRouting` flag and its catch-all exemption stay.
  - The cause is `{ kind: 'child' | 'leaf-host' | 'queue' | 'completion-refused', subject, reason }`.
    For a marker kind, `rounds` is the marker's round with its unsettled hosts (`readRouteRecord`). For
    `queue` and `completion-refused`, it is every non-closed round, which may be empty.
  - It calls `recordRoundStall` with detail cause `parked <kind> <subject>: <reason>`, or
    `completion refused: <reason>`.
  - When `.pipeline/HALT` is absent, it writes the returned detail with `haltClass ?? 'needs-human'`
    through `this.writeHaltMarker`. In every case it emits `loop_halt`, with the existing HALT's first line
    when one is live, and returns.
  - A live HALT is never rewritten (Condition 3). The daemon's resume-authorization sweep clears an
    authorized HALT before dispatch, so none reaches this stop.
- **Daemon reason.** A dispatch that ends with a HALT already reports that HALT's text through
  `src/conductor/src/engine/daemon-runner.ts`. Only Story 4's daemon test is new; the markerless
  fallback string remains for genuinely markerless exits.
- **Test homes.**
  - `src/conductor/test/engine/gate-verdicts.test.ts`: the record shape.
  - `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts`: conductor-level routed
    region tests. It already drives a routed host through `childRegionLifecycle` and real refs.
  - `src/conductor/test/engine/routing/conductor-routing-resume.test.ts`: resume.
  - `src/conductor/test/engine/daemon-runner.test.ts`: the daemon reason.

## Prerequisites

- #3445 merged and built: `recordRoundStall`, the `routing_rounds_stalled` event and
  `exitRoutedHostAndReconcile` exist on main.

## Tasks

### Task 1: Round stamp on the gate-verdict record
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-verdicts.test.ts` for every Done-when check below (RED).
2. Add optional `routedRound` to `GateVerdict`, optional `routedRound` to `CompletionContext`, the `writeVerdict` trailing options, and the `computeAndWriteVerdict` stamp for region steps with a child (GREEN).
3. Commit.

**Done when:**
- [test] `writeVerdict(dir, 'build', verdict, 1, { routedRound: 'r5' })` writes `children/1/gates/build.json` whose parsed `routedRound` is `r5`, and `readVerdict(dir, 'build', 1)` returns it.
- [test] `computeAndWriteVerdict` with `ctx.activeChild` 1 and `ctx.routedRound` `r5` stamps `routedRound` `r5` on each of `acceptance_specs`, `build`, `test_suite` and `build_review`.
- [test] `writeVerdict` and `computeAndWriteVerdict` without a child, or with no `routedRound`, write a record with no `routedRound` key, and a feature-level verdict file written with `routedRound` supplied still has no `routedRound` key.

**Files likely touched:**
- `src/conductor/src/engine/gate-verdicts.ts` — `routedRound` field and stamp
- `src/conductor/src/engine/artifacts.ts` — `CompletionContext.routedRound`
- `src/conductor/test/engine/gate-verdicts.test.ts` — record-shape tests

**Dependencies:** none

### Task 2: The conductor stamps every routed host region verdict with the executing round
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` for every Done-when check below (RED).
2. Add `routedRoundForActiveChild`, add its result to `completionCtx` as `routedRound`, and pass it to the routed-forward `build` `writeVerdict` call in the success tail (GREEN).
3. Commit.

**Done when:**
- [test] With `route_whole_feature_fixes` on and the marker `{ host: 1, roundId: 'r5' }`, driving host 1's `acceptance_specs`, `build`, `test_suite` and `build_review` to completion through the conductor leaves each `children/1/gates/<step>.json` with `routedRound` `r5`, including a routed-forward `build` verdict.
- [test] With the flag off, with no marker, or with the marker naming host 2 while child 1 is active, the same drive writes child 1 region verdicts with no `routedRound` key.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `routedRoundForActiveChild`, `completionCtx`, routed-forward verdict
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — stamp tests

**Dependencies:** Task 1

### Task 3: The verdict overlay ignores a routed host's satisfied verdicts from any other round
**Story:** Story 1, Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` for every Done-when check below (RED).
2. In `readGateVerdictOverlay`, delete a child region verdict that is satisfied and whose `routedRound` differs from `routedRoundForActiveChild`, when that resolver returns a round (GREEN).
3. Commit.

**Done when:**
- [test] With host 1 `repairing` in `r5`, region steps restaged `pending`, and unstamped satisfied `build`, `test_suite` and `build_review` verdicts on disk, `advanceTail`'s selection chooses `acceptance_specs` or `build`, and the masked overlay reports `test_suite` and `build_review` not satisfied.
- [test] With an unstamped `build_review` verdict reading `satisfied: false` with a kickback and `build_review` not re-pended, the masked overlay keeps that verdict and `build_review` dispatches on host 1.
- [test] A satisfied host 1 `test_suite` verdict stamped `r4` is not counted while host 1 executes `r5`, and one stamped `r5` with `test_suite` status `pending` is counted satisfied and `test_suite` is not re-run.
- [test] A flat N=1 feature with no marker whose `.pipeline/gates/test_suite.json` reads satisfied and status is `pending` selects past `test_suite` as before, and an unrouted stacked feature's active cursor child's satisfied region verdicts count as before (same selection with and without this change, compared on one fixture).

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `readGateVerdictOverlay` mask
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — mask tests

**Dependencies:** Task 1

### Task 4: Revalidate and operator rounds re-run their re-pended steps
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` for every Done-when check below (RED).
2. Fix any round-kind gap the tests expose in the Task 2 and Task 3 seams only (GREEN).
3. Commit.

**Done when:**
- [test] A `revalidate` round whose queued entry names `test_suite` and `build_review` for child 2, with child 2 holding satisfied unstamped verdicts for both, dispatches `test_suite` and then `build_review` on child 2 before that round's routed exit for child 2 is requested.
- [test] An `operator` round entered at `test_suite` on a closed child holding satisfied earlier-lap `test_suite` and `build_review` verdicts dispatches `test_suite` on that child and then `build_review` on that child.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — round-kind tests

**Dependencies:** Task 2, Task 3

### Task 5: A routed repair build is followed by fresh validation before the exit
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` for every Done-when check below (RED).
2. Fix any ordering gap the tests expose in the Task 2 and Task 3 seams only (GREEN).
3. Commit.

**Done when:**
- [test] An audit round whose host 1 holds satisfied earlier-lap `test_suite` and `build_review` verdicts dispatches, after host 1's repair `build` completes, `test_suite` then `build_review` on host 1, and `renderDaemonEvent` over the persisted events emits a `test_suite` running line and a `build_review` running line for host 1 after its `build` line.
- [test] When that host's fresh `test_suite` and `build_review` pass, each of its four `children/1/gates/<step>.json` verdicts carries `routedRound` equal to the executing round, and the routed exit for host 1 is requested exactly once.
- [test] When host 1's repair `build` completes with the tree unchanged, `test_suite` and `build_review` still dispatch on host 1.
- [test] When host 1's fresh `test_suite` fails after the repair build, no routed exit is requested for host 1, the marker still names host 1, and the next selected step is a host 1 region step.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — repair-validation tests

**Dependencies:** Task 2, Task 3

### Task 6: Resuming a round keeps its own work and heals an already-wedged host
**Story:** Story 1, Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` for every Done-when check below (RED).
2. Fix any resume gap the tests expose in the Task 2 and Task 3 seams only (GREEN).
3. Commit.

**Done when:**
- [test] With host 1 `repairing` in `r5` whose `build` and `test_suite` completed in `r5`, a resumed run dispatches `build_review` on host 1 and dispatches neither `build` nor `test_suite`.
- [test] On that resume, host-region restage is not invoked, and every `children/1/gates/<step>.json` written in `r5` is byte-identical before and after the resumed run's first selection.
- [test] After `r5` closes and `r6` admits host 1, entering `r6` dispatches each step `r6` re-pended on host 1, with every `r5`-stamped verdict ignored.
- [test] The #3455 wedged fixture (host 1 `repairing` in `r5`, region steps `pending` or `in_progress`, unstamped satisfied verdicts, and the markerless needs-human HALT) dispatches every `pending` or `in_progress` host 1 region step in region order after only `.pipeline/HALT` and `.pipeline/HALT.class` are removed, with no verdict file edited.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — resume tests

**Dependencies:** Task 2, Task 3

### Task 7: A parked exit or refused completion writes a named, bounded HALT
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` for every Done-when check below (RED).
2. Add `stopParkedForRouting` and call it from the step loop's `advance === 'parked'` exit and its refused-`completeRun` exit (GREEN).
3. Commit.

**Done when:**
- [test] For parking kind `child` on host 1 of `r5`, and for `leaf-host` on the leaf host of `r5`, with no runnable region gate, the run writes `.pipeline/HALT` whose first line names `r5`, the parking kind, the host and the reason, `.pipeline/HALT.class` `mechanical`, a `loop_halt` event with the same text, and exactly one persisted `routing_rounds_stalled` event with `attempt` 1.
- [test] With a non-empty revalidation queue, no marker, and no runnable gate at or before `build_review`, the HALT first line names the lowest queued child, parking kind `queue` and the reason, and `.pipeline/HALT.class` is `mechanical`.
- [test] With every whole-feature gate converged and `completeRun` refused because a routed round is open, the run writes a HALT naming the open round and the reason with class `mechanical`, and no `.pipeline/DONE` exists.
- [test] With a live `.pipeline/HALT` already present when the parked stop runs, that file is byte-identical afterwards.
- [test] A flat N=1 feature whose gates all converge writes `.pipeline/DONE`, and records no parked HALT and no `routing_rounds_stalled` event.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `stopParkedForRouting` and both call sites
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — parked-stop tests

**Dependencies:** none

### Task 8: Parked stops escalate on the third identical stall and the daemon reports them
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` and `src/conductor/test/engine/daemon-runner.test.ts` for every Done-when check below (RED).
2. Fix any mapping gap the tests expose in `stopParkedForRouting` only (GREEN).
3. Commit.

**Done when:**
- [test] After two identical parked stalls for `r5` with no intervening `routed_repair_phase` or `remediation_routed` event, a third identical parked stall writes `.pipeline/HALT.class` `needs-human` with a first line still naming `r5`, the parking kind and the reason.
- [test] With a `routed_repair_phase` event, and separately with a `remediation_routed` event, persisted after the second parked stall, the next parked stall records `attempt` 1 and `.pipeline/HALT.class` `mechanical`.
- [test] `resolveHaltRetention` over a mechanical parked HALT for `r5` returns `retained: false`, and after its re-kick a `runStackPreflight` whose reconciliation admits, resumes or exits `r5` is followed by a conductor dispatch that runs a step or closes the round with no operator action.
- [test] A daemon dispatch whose conductor run ends on a parked stop records an outcome reason containing the HALT's first line and not `loop ended without DONE or HALT marker`.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts` — escalation tests
- `src/conductor/test/engine/daemon-runner.test.ts` — dispatch reason test

**Dependencies:** Task 7

### Task 9: A host region finished in the round takes its routed exit on resume
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` for every Done-when check below (RED).
2. Extract the in-loop exit into `continueRoutedHostExit` and call it from `advanceTail`'s `parked` arm, ahead of `stopParkedForRouting`, when the marker's host is active and every region gate passes `gateSatisfied` over the masked overlay (GREEN).
3. Commit.

**Done when:**
- [test] With host 1 `repairing` in `r5`, all four region steps completed with `r5`-stamped verdicts, and the run interrupted before the exit, a resumed run takes host 1's routed exit, host 1's route-record state is no longer `repairing`, the round's next routed step is selected, no `.pipeline/HALT` is written, and no region step is dispatched.
- [test] With host 2 `repairing` in a `revalidate` round whose `test_suite` and `build_review` completed in that round while `build` and `acceptance_specs` stayed `done`, a resumed run takes host 2's routed exit and dispatches no region step.
- [test] With host 1 `repairing` in `r5` whose `build_review` verdict is stamped `r4`, a resumed run does not request host 1's routed exit and dispatches `build_review` on host 1.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `continueRoutedHostExit` and the `parked` arm
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — resume-exit tests

**Dependencies:** Task 3, Task 7

### Task 10: The resumed exit matches the in-loop exit, including its refusal
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` for every Done-when check below (RED).
2. Fix any divergence the tests expose in `continueRoutedHostExit` only (GREEN).
3. Commit.

**Done when:**
- [test] The same refs (host 1 `repairing` in `r5`, region finished in `r5`) driven once through the in-loop `build_review` closure exit and once through an interrupted-then-resumed run leave byte-identical route record blobs and marker blobs.
- [test] With an injected `childRegionLifecycle.requestRoutedExit` returning `halted` on resume, `.pipeline/HALT` and `.pipeline/HALT.class` are byte-identical to those the in-loop exit leaves for the same injected refusal, and no `routing_rounds_stalled` event is persisted.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — parity tests

**Dependencies:** Task 9

## Task Dependency Graph

```
Task 1 ──► Task 2 ──► Task 4, Task 5, Task 6
Task 1 ──► Task 3 ──► Task 4, Task 5, Task 6, Task 9
Task 7 ──► Task 8
Task 7 ──► Task 9 ──► Task 10
```

## Integration Points

- After Task 3: a routed host re-runs every re-pended region step (the r5 skip is closed).
- After Task 7: no routed parking exit reaches the daemon without a HALT.
- After Task 9: an interrupted finished host exits on resume instead of parking.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a host child whose `children/<k>/gates/` holds satisfied `build`, `test_suite` and `build_review` verdicts written before audit round `r5` was admitted, when `r5` enters that host's region and the loop selects the next gate, then the selected step is `acceptance_specs` or `build`, and `test_suite` and `build_review` are not counted as satisfied. | 3 | "the masked overlay reports `test_suite` and `build_review` not satisfied" | diff-local |
| Story 1 happy: Given a `revalidate` round whose queued entry names `test_suite` and `build_review` for child 2, and child 2 holds satisfied verdicts for both from its original closure, when the round enters child 2's region, then both steps dispatch on child 2 before the round exits the host. | 4 | "dispatches `test_suite` and then `build_review` on child 2 before that round's routed exit for child 2 is requested" | diff-local |
| Story 1 happy: Given an `operator` round entered at `test_suite` on a closed child holding satisfied `test_suite` and `build_review` verdicts from an earlier lap, when the round enters the host region, then `test_suite` dispatches and is followed by `build_review` on that child. | 4 | "dispatches `test_suite` on that child and then `build_review` on that child" | diff-local |
| Story 1 happy: Given a feature already wedged before this change, with host 1 `repairing` in round `r5`, region steps `pending` or `in_progress`, and unstamped satisfied verdicts on disk, when the operator clears the needs-human HALT its markerless exit left and the daemon re-dispatches it, then the pending region steps run on host 1 with no verdict file edited by hand, instead of the run ending with no step dispatched. | 6 | "dispatches every `pending` or `in_progress` host 1 region step in region order after only `.pipeline/HALT` and `.pipeline/HALT.class` are removed, with no verdict file edited" | diff-local |
| Story 1 negative: Given a host child whose earlier-lap `build_review` verdict reads `satisfied: false` with a kickback and whose round did not re-pend `build_review`, when the round's host region is selected, then `build_review` is still treated as unsatisfied and dispatches. | 3 | "the masked overlay keeps that verdict and `build_review` dispatches on host 1" | diff-local |
| Story 1 negative: Given a flat N=1 feature with no routing marker whose `.pipeline/gates/test_suite.json` reads satisfied and whose `test_suite` state is `pending`, when the loop selects the next gate, then `test_suite` is treated as satisfied exactly as before this change. | 3 | "selects past `test_suite` as before" | diff-local |
| Story 1 negative: Given a stacked feature with no routing marker whose active cursor child holds satisfied region verdicts, when the loop selects the next gate for that child, then those verdicts count exactly as before this change. | 3 | "an unrouted stacked feature's active cursor child's satisfied region verdicts count as before" | diff-local |
| Story 2 happy: Given an audit round whose host child held satisfied `test_suite` and `build_review` verdicts from an earlier lap, when the host's repair `build` completes, then `test_suite` dispatches next on that host, then `build_review`, and the daemon log shows a `test_suite` running line and a `build_review` running line for that host after the build line. | 5 | "emits a `test_suite` running line and a `build_review` running line for host 1 after its `build` line" | diff-local |
| Story 2 happy: Given a host whose repair build finished and whose fresh `test_suite` and `build_review` both pass, when the region completes, then each of the host's four region verdicts on disk records the executing round and the routed exit for that host runs. | 5 | "carries `routedRound` equal to the executing round, and the routed exit for host 1 is requested exactly once" | diff-local |
| Story 2 negative: Given a host whose repair build completes with the tree unchanged, when the region continues, then `test_suite` and `build_review` still dispatch on that host and are not skipped on an earlier-lap verdict. | 5 | "`test_suite` and `build_review` still dispatch on host 1" | diff-local |
| Story 2 negative: Given a host whose fresh `test_suite` fails after the repair build, when the loop selects the next gate, then the routed exit for that host does not run and the host stays in its region. | 5 | "no routed exit is requested for host 1, the marker still names host 1, and the next selected step is a host 1 region step" | diff-local |
| Story 3 happy: Given host 1 `repairing` in round `r5` whose `build` and `test_suite` completed in `r5` with verdicts written during `r5`, when the run is interrupted and the daemon re-dispatches the feature, then the resumed run dispatches `build_review` and does not dispatch `build` or `test_suite` again. | 6 | "a resumed run dispatches `build_review` on host 1 and dispatches neither `build` nor `test_suite`" | diff-local |
| Story 3 happy: Given a verdict for `test_suite` written during round `r5` whose step state was not saved before a crash, when the feature resumes in `r5`, then `test_suite` is treated as satisfied and is not re-run. | 3 | "one stamped `r5` with `test_suite` status `pending` is counted satisfied and `test_suite` is not re-run" | diff-local |
| Story 3 happy: Given host 1 `repairing` in round `r5`, when the feature resumes, then the host region is not restaged a second time and no `r5` verdict is replaced. | 6 | "host-region restage is not invoked, and every `children/1/gates/<step>.json` written in `r5` is byte-identical" | diff-local |
| Story 3 negative: Given a satisfied verdict for host 1 written during round `r4`, when host 1 executes in round `r5`, then that verdict is not counted for `r5`. | 3 | "A satisfied host 1 `test_suite` verdict stamped `r4` is not counted while host 1 executes `r5`" | diff-local |
| Story 3 negative: Given round `r5` closes and round `r6` later admits the same host 1, when `r6` enters the host region, then `r5` verdicts are not counted for `r6` and the re-pended steps dispatch again. | 6 | "entering `r6` dispatches each step `r6` re-pended on host 1, with every `r5`-stamped verdict ignored" | diff-local |
| Story 4 happy: Given routed parking of kind `child` on host 1 of round `r5` with no runnable region gate, when the loop stops, then `.pipeline/HALT` is written whose first line names round `r5`, parking kind `child`, host 1 and the reason, `.pipeline/HALT.class` reads `mechanical`, a `loop_halt` event carries the same text, and one `routing_rounds_stalled` event is persisted with `attempt` 1. | 7 | "the run writes `.pipeline/HALT` whose first line names `r5`, the parking kind, the host and the reason, `.pipeline/HALT.class` `mechanical`, a `loop_halt` event with the same text, and exactly one persisted `routing_rounds_stalled` event with `attempt` 1" | diff-local |
| Story 4 happy: Given a non-empty revalidation queue, no repair marker and no runnable gate at or before `build_review`, when the loop stops, then the HALT first line names the queued child, parking kind `queue` and the reason, and the HALT class is `mechanical`. | 7 | "the HALT first line names the lowest queued child, parking kind `queue` and the reason, and `.pipeline/HALT.class` is `mechanical`" | diff-local |
| Story 4 happy: Given every whole-feature gate converged but completion is refused because a routed round is still open, when the run ends, then a HALT naming the open round and the reason is written with class `mechanical`, and no DONE marker is written. | 7 | "the run writes a HALT naming the open round and the reason with class `mechanical`, and no `.pipeline/DONE` exists" | diff-local |
| Story 4 happy: Given a mechanical parked HALT for round `r5`, when the daemon re-kicks the feature and the next stack preflight admits, resumes or exits the round, then the next dispatch runs a step or closes the round without operator action. | 8 | "is followed by a conductor dispatch that runs a step or closes the round with no operator action" | diff-local |
| Story 4 happy: Given a parked stop, when the daemon records the dispatch outcome, then the reason contains the HALT's first line and not "loop ended without DONE or HALT marker". | 8 | "records an outcome reason containing the HALT's first line and not `loop ended without DONE or HALT marker`" | diff-local |
| Story 4 negative: Given two identical parked stalls for round `r5` with no intervening routing progress event, when a third identical parked stall occurs, then the HALT class is `needs-human` and its first line still names round `r5`, the parking kind and the reason. | 8 | "a third identical parked stall writes `.pipeline/HALT.class` `needs-human` with a first line still naming `r5`, the parking kind and the reason" | diff-local |
| Story 4 negative: Given a routing progress event (`routed_repair_phase` or `remediation_routed`) after the second parked stall, when the next parked stall occurs, then it records `attempt` 1 with class `mechanical`. | 8 | "the next parked stall records `attempt` 1 and `.pipeline/HALT.class` `mechanical`" | diff-local |
| Story 4 negative: Given a live `.pipeline/HALT` already present when a parked stall is recorded, when the loop stops, then the existing HALT file is left byte-identical. | 7 | "that file is byte-identical afterwards" | diff-local |
| Story 4 negative: Given a flat N=1 feature whose gates all converge, when the loop ends, then DONE is written and no parked HALT or `routing_rounds_stalled` event is recorded. | 7 | "A flat N=1 feature whose gates all converge writes `.pipeline/DONE`, and records no parked HALT and no `routing_rounds_stalled` event." | diff-local |
| Story 5 happy: Given host 1 `repairing` in round `r5` whose `acceptance_specs`, `build`, `test_suite` and `build_review` all completed with verdicts written during `r5`, and whose run was interrupted before the routed exit, when the daemon re-dispatches the feature, then host 1's routed exit runs, host 1 leaves `repairing`, and the round continues to its next routed step without a HALT. | 9 | "a resumed run takes host 1's routed exit, host 1's route-record state is no longer `repairing`, the round's next routed step is selected, no `.pipeline/HALT` is written, and no region step is dispatched" | diff-local |
| Story 5 happy: Given host 2 `repairing` in a `revalidate` round whose re-pended `test_suite` and `build_review` completed in that round while its `build` and `acceptance_specs` stayed `done`, and whose run was interrupted before the routed exit, when the daemon re-dispatches the feature, then host 2's routed exit runs without dispatching any region step. | 9 | "a resumed run takes host 2's routed exit and dispatches no region step" | diff-local |
| Story 5 happy: Given the interrupted state of host 1, when the resumed run takes host 1's exit, then the route record and repair marker it leaves are identical to those left by an uninterrupted in-loop exit from the same state. | 10 | "leave byte-identical route record blobs and marker blobs" | diff-local |
| Story 5 negative: Given host 1 `repairing` in round `r5` whose `build_review` verdict was written during `r4`, when the feature resumes, then host 1's routed exit does not run and `build_review` dispatches on host 1. | 9 | "a resumed run does not request host 1's routed exit and dispatches `build_review` on host 1" | diff-local |
| Story 5 negative: Given an interrupted host whose routed exit is refused on resume, when the run stops, then the HALT left and its class are identical to those an in-loop exit refusal leaves from the same state, and no `routing_rounds_stalled` event is recorded for that refusal. | 10 | "`.pipeline/HALT` and `.pipeline/HALT.class` are byte-identical to those the in-loop exit leaves for the same injected refusal, and no `routing_rounds_stalled` event is persisted" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | no-change | none | Routing entry and classification are untouched; this feature changes only region verdict scope, the parked stop and the resume exit. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Owner derivation is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | Residue routing judgement is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | no-change | none | Owner/host separation and upward moves are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | Prerequisite claims and reroutes are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | no-change | none | The route record stays the round authority; this feature only reads it to name a stalled round's unsettled hosts. |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-7, task-8 | exactly one persisted `routing_rounds_stalled` event with `attempt` 1 |
| adr-2026-10-12-routed-whole-feature-repair#D8 | no-change | none | `resolveExecutionChild` and the cursor fields are unchanged; the executing round is read from the existing repair marker. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | task | task-2, task-3 | the masked overlay reports `test_suite` and `build_review` not satisfied |
| adr-2026-10-12-routed-whole-feature-repair#D10 | no-change | none | Round receipt settlement is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Repair obligation keying is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The host `build_review` snapshot base is not changed; only which verdict counts for selection changes. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-9, task-10 | leave byte-identical route record blobs and marker blobs |
| adr-2026-10-12-routed-whole-feature-repair#D14 | no-change | none | The re-validation queue is only read for `queue` parking; its entries and consumption are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | existing | none | `restageLeafGates` in `routing/routed-exit.ts` already writes unsatisfied leaf verdicts on return; an unsatisfied verdict is never masked, so the leaf gates still re-run. |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-7 | a `loop_halt` event with the same text, and exactly one persisted `routing_rounds_stalled` event with `attempt` 1 |
| adr-2026-10-12-routed-whole-feature-repair#D17 | task | task-3, task-7 | A flat N=1 feature whose gates all converge writes `.pipeline/DONE`, and records no parked HALT and no `routing_rounds_stalled` event. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | task | task-2 | With the flag off, with no marker, or with the marker naming host 2 while child 1 is active |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
