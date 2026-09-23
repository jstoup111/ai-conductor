# Implementation Plan: Park stops retries inside an already-dispatched step

**Date:** 2026-09-22
**Design:** `.docs/specs/daemon-park-does-not-stop-retries-inside-an-alread.md`
**Stories:** .docs/stories/daemon-park-does-not-stop-retries-inside-an-alread.md
**Architecture:** `.docs/architecture/daemon-park-does-not-stop-retries-inside-an-alread.md`
**Conflict check:** Clean as of 2026-09-22
**Source:** jstoup111/ai-conductor#2103

## Summary

This plan makes an operator park decline every new provider attempt of a running daemon feature: serial-step retries, both free and budgeted, and parallel-group member retries. The attempt already running is never interrupted. The `daemon park` command reports whether work is still running. The plan has 13 tasks.

## Technical Approach

- **One gate per dispatch branch, one predicate.** Every retry in the serial retry loop of `conductor.ts` re-enters one per-attempt dispatch site. There, self-host dispatch already checks park inside its admission window. The ordinary `stepRunner.run` branch gains the same check (Task 2), so every serial attempt is covered by the existing daemon-injected `operatorParkBoundary`. That predicate fails toward parked, and interactive runs never set it (`adr-2026-07-29-operator-park-scheduling-unit-boundary` D11).
- **Reuse the typed stop.** A declined attempt yields the existing `operatorParkedBeforeDispatch` result, handled by `stopAtOperatorParkBoundary(true)`. That stop returns `operator-parked`, writes no step status (the step stays `in_progress`), writes no HALT, and returns before any retry, escalation, or no-evidence accounting (D12). The attempt counter is loop-local, so resume starts a fresh budget.
- **Group members.** `group-core.ts` gains a `parked` `BranchOutcome`. The member attempt loop checks the threaded park predicate before each retry, next to its existing abort check. A parked member never reads as `no-verdict`, so it does not fail the group, and a join with a parked member maps to the typed stop (D13). A genuine failure in the same join keeps its failure outcome (D8).
- **Reporting on the existing spine.** The `operator_park_boundary` event gains an attempt boundary (Task 1); there is no new event type. `daemon park` composes a new `classifyRunningWork` export in daemon-dashboard.ts, which reuses the provider_attempt lifecycle parser, with pidfile liveness from daemon-lock.ts. It reports running, stopped, or unknown and never inspects processes (D14).
- **Sequencing.** Task 1 (event shape) comes first. Task 2 (core gate) unblocks the serial proofs, Tasks 3–7 and 13. Tasks 8 and 11 are independent roots. Task 9 needs Tasks 1 and 8, and Task 12 needs Task 11.
- **Out of scope.** Provider calls inside one attempt (review sub-reviewers and spot-audit verification) finish with that attempt (amended FR-6). Operator documentation for FR-13 is owned by the gating `maintain-documentation` step, and the coherence waiver records it.

## Prerequisites

- `adr-2026-07-29-operator-park-scheduling-unit-boundary` amended with D11–D14 (committed on this spec branch).

## Tasks

### Task 1: Attempt-level operator-park boundary on the existing event
**Story:** 12
**Type:** infrastructure

**Steps:**
1. Write failing tests: an `operator_park_boundary` event carrying an attempt boundary persists to events.jsonl with the feature slug and step; the daemon-log renderer renders an attempt boundary and a member boundary; the existing unit-boundary render test stays unchanged.
2. Verify the tests fail (RED).
3. Implement: extend `SchedulingUnitRef` in `src/conductor/src/types/scheduling-unit.ts` with an `attempt` variant `{ kind: 'attempt'; step; attempt; member? }`. Add its rendering to the existing `operator_park_boundary` case of the daemon-log renderer in `daemon-cli.ts`. Add no new event type; the event already declares render and persist sinks in `event-sinks.ts`. Pattern: follow the existing step/group/pre-first-unit variants and their render branch (search `operator_park_boundary` in daemon-cli.ts).
4. Verify the tests pass (GREEN).
5. Commit with message: "add attempt-level operator park boundary".

**Done when:**
- `SchedulingUnitRef` in scheduling-unit.ts gains an `attempt` variant carrying the step, the attempt number, and an optional member, and an `operator_park_boundary` event persisted to events.jsonl carries the feature slug and that attempt boundary, as asserted by the attempt-boundary persistence test.
- The daemon-log renderer in daemon-cli.ts renders an attempt boundary as a line naming the feature, the step, and that an attempt was declined for an operator park, and a member boundary as a line naming the group step and the member, as asserted by the attempt and member render tests.
- The existing unit-boundary render test in daemon-render.test.ts passes unchanged, so step, group, and pre-first-unit boundaries keep their existing shape and rendered text.

**Files:** src/conductor/src/types/scheduling-unit.ts, src/conductor/src/daemon-cli.ts, src/conductor/test/engine/daemon-render.test.ts, src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** none

### Task 2: Per-attempt park gate on the ordinary serial dispatch path
**Story:** 1
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing conductor tests on the ordinary (non-self-host) dispatch path. (a) A park lands during attempt 1 of a step allowed three attempts: exactly one runner dispatch and an `operator-parked` termination. (b) A rejecting park predicate after a failed attempt: no further dispatch and an `operator-parked` termination. (c) No park, and a park removed before the next attempt: the second dispatch happens and no termination. (d) A declined attempt emits exactly one `operator_park_boundary` event with an attempt boundary.
2. Verify the tests fail (RED).
3. Implement in the serial retry loop of `conductor.ts`. The self-host admission cancellation keeps its behavior and now also reports the attempt boundary through the same stop. At the per-attempt dispatch site, the ordinary branch (the `stepRunner.run` call, not `runSelfBuildDispatch`) gets the same check the self-host admission window already runs: `this.daemon && this.featureSlug !== undefined && this.operatorParkBoundary && await this.operatorParkBoundary().catch(() => true)`. When the check is true, yield `{ success: false, operatorParkedBeforeDispatch: true }` without calling the runner. The existing `result.operatorParkedBeforeDispatch` handling then returns through `stopAtOperatorParkBoundary(true)`. Make that stop emit the attempt boundary from Task 1 (step name and attempt number) instead of the last settled unit. Place the check before the attempt emits any start, escalation, or provider event. Pattern: mirror the self-host check in `runSelfBuildDispatch` (same predicate, fail toward parked, typed result consumed at the dispatch site, no status write). Allowed variation: the ordinary branch has no admission window, so it checks immediately before the runner call.
4. Verify the tests pass (GREEN).
5. Commit with message: "decline ordinary-path attempts after an operator park".

**Done when:**
- On the ordinary dispatch path, the per-attempt park check in conductor.ts consults the injected operatorParkBoundary before `stepRunner.run` and, when it returns true, dispatches nothing and the run returns an `operator-parked` termination, as asserted by the ordinary-path park test that records exactly one runner dispatch for a step allowed three attempts when the park lands during attempt 1.
- When operatorParkBoundary rejects with an error at the per-attempt check, the feature is treated as parked, no runner dispatch follows the failed attempt, and the run returns an `operator-parked` termination, as asserted by the throwing-predicate test.
- With no park active, or with a park removed before the next attempt's check, the per-attempt check lets the next attempt dispatch and no `operator-parked` termination is returned, as asserted by the no-park and removed-park retry tests that record the second runner dispatch.
- A declined attempt emits exactly one `operator_park_boundary` event, whose attempt boundary carries the feature slug, the step name, and the attempt number, as asserted by the single-boundary-event test.

**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 1

### Task 3: Every free and budgeted retry path passes the attempt gate
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write conductor tests for a parked feature, one per free-retry path of the serial retry loop (rate-limit wait, stale-session reset, auth refresh, finish-publication progress retry, test_suite infrastructure retry, build_review mechanical-fault retry), plus a budgeted completion-check miss with budget remaining. Each asserts zero runner dispatches after the park, an `operator-parked` termination, and that the park predicate was consulted on loop re-entry.
2. Verify: any path that re-enters without passing the Task 2 check fails (RED); none is expected, since every `continue` re-enters at the per-attempt dispatch site.
3. Implement: if a path bypasses the per-attempt dispatch site, route it through the same check rather than adding a second predicate call site.
4. Verify the tests pass (GREEN), and that the existing self-host admission park test still observes the cancellation before dispatch.
5. Commit with message: "prove every retry path honors the attempt park gate".

**Done when:**
- For each free-retry path of the serial retry loop (rate-limit wait, stale-session reset, auth refresh, finish-publication progress retry, test_suite infrastructure retry, and build_review mechanical-fault retry), a parked-feature conductor test records zero runner dispatches after the park and an `operator-parked` termination.
- A parked-feature conductor test whose attempt ends in a completion-check miss with retry budget remaining records zero runner dispatches after the park even though the budget would allow another attempt.
- The free-retry tests assert that the park predicate is consulted on each re-entry of the retry loop, so a free retry never bypasses the per-attempt check.
- A self-host attempt reached while parked is still cancelled before dispatch with a `self_host_dispatch_admission` event in state `cancelled` and no runner call, as asserted by the existing self-host admission park test.

**Files:** src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 2

### Task 4: The attempt already running drains uninterrupted
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write conductor tests with a fake runner that resolves only after the park marker is written. One case succeeds and one fails.
2. Verify the tests fail if the gate were to abort or skip the running attempt (RED); expected GREEN once Task 2 lands, since the gate runs only before a dispatch.
3. Implement: no production change is expected. If the tests reveal the running attempt is cut short, fix the gate placement in conductor.ts so it only runs before a dispatch.
4. Verify the tests pass (GREEN).
5. Commit with message: "prove a parked step drains its running attempt".

**Done when:**
- A conductor test whose runner resolves successfully after the park is written observes that attempt's result persisted, the step's persisted status set to its natural terminal status, and the run stopping only afterwards at the next unit boundary.
- The same drain test asserts that the runner receives no abort signal, cancellation, or kill, and that its runner call returns only when the fake provider resolves.
- A conductor test whose running attempt fails after the park lands observes that failure output recorded as the attempt's result and zero further runner dispatches.

**Files:** src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 2

### Task 5: A declined attempt spends no budget and writes no HALT
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write conductor tests for a declined attempt. Event stream: it ends with `operator_park_boundary`, with no step_failed, step_retry, or retry-exhaustion event after it. State: no HALT file, and conduct state shows the step `in_progress`. For a build step declined at attempt 3: no escalation-ladder rung recorded for attempt 3, and the persisted no-evidence attempt count is unchanged.
2. Verify the tests fail (RED) if any accounting runs before the gate.
3. Implement: make sure the Task 2 check in conductor.ts runs before the attempt's escalation resolution and any no-evidence or progress accounting. Move the check earlier in the iteration if the tests show accounting ahead of it.
4. Verify the tests pass (GREEN).
5. Commit with message: "keep declined park attempts free of retry accounting".

**Done when:**
- After a declined attempt the conductor run returns an `operator-parked` termination, and the event stream ends with the `operator_park_boundary` event and contains no step_failed, step_retry, or retry-exhaustion event after it, as asserted by the declined-attempt event test.
- After a declined attempt the feature worktree contains no HALT marker file and persisted conduct state shows the step `in_progress`, not failed, as asserted by the declined-attempt state test.
- For a build step whose declined attempt would have been its third, the escalation ladder records no model or effort rung for attempt 3 and the persisted no-evidence attempt count is identical before and after the declined attempt, as asserted by the declined-build-accounting test.

**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 2

### Task 6: Unpark resumes the parked step with a fresh budget
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write resume tests. Unpark after a declined attempt: the resume index lands on the parked `in_progress` step and the first dispatched attempt is numbered 1. A build with committed-complete plan tasks: those statuses are unchanged after resume and no dispatch for them. Resume while still parked: the pre-unit gate returns `operator-parked` before any dispatch.
2. Verify the tests fail (RED) if resume diverges from ordinary resume rules.
3. Implement: no production change is expected, because the attempt counter is loop-local and `findResumeIndex` already selects the first `in_progress` step. Fix only what the tests show.
4. Verify the tests pass (GREEN).
5. Commit with message: "prove resume after an attempt-level park".

**Done when:**
- A resume test that removes the park after a declined attempt observes the conductor's resume index landing on the parked `in_progress` step and its first dispatched attempt numbered 1, the start of a fresh attempt budget.
- A resume test for a build parked after some plan tasks were committed complete observes those task statuses still complete after resume and no dispatch for those tasks.
- A resume test that resumes while the park is still active observes the existing pre-unit gate returning `operator-parked` before any runner dispatch and the step still `in_progress`.

**Files:** src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 2

### Task 7: Park races between attempts fail toward parked
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write conductor race tests with a controllable park predicate. The park is written between attempts N and N+1. The predicate rejects with an error at the check. The park is written after the check passed while the dispatch is starting.
2. Verify the tests fail (RED) where the check is not re-read per attempt.
3. Implement: the Task 2 check reads the predicate fresh on every attempt, with no cached park state. Adjust conductor.ts only if a test shows a cached read.
4. Verify the tests pass (GREEN).
5. Commit with message: "prove attempt park races fail toward parked".

**Done when:**
- A test that writes the park between attempt N and attempt N+1 records exactly N runner dispatches, because the per-attempt park check observes the park before the next dispatch.
- A test whose park predicate rejects with an error at the per-attempt check records zero runner dispatches at that check and an `operator-parked` termination, treating the feature as parked.
- A test that writes the park after the per-attempt check passed and while that attempt's dispatch is starting observes that attempt running to completion with its result recorded and the following attempt declined.

**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 2

### Task 8: Group members settle as parked instead of retrying
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing group-core tests. `classifyOutcome` of a `parked` outcome returns `parked`, not `no-verdict` or `aborted`. A member whose first attempt fails while the injected park predicate returns true makes one dispatch and settles `parked`. A member whose predicate rejects before a retry settles `parked`.
2. Verify the tests fail (RED).
3. Implement in `group-core.ts`: add a `parked` variant to `BranchOutcome` and handle it in `classifyOutcome`'s exhaustive switch (no `default`). Add an optional park predicate to the branch deps. In `runGroupBranchInner`'s per-attempt loop, check it before every dispatch after the first, next to the existing `deps.signal?.aborted` check, treating a rejection as parked. Pattern: the existing abort check before each member dispatch. Allowed variation: return the new `parked` outcome, not `makeNoVerdictOutcome("aborted")`, because a no-verdict branch fails the group.
4. Verify the tests pass (GREEN).
5. Commit with message: "settle parked group members with a parked outcome".

**Done when:**
- `BranchOutcome` in group-core.ts gains a `parked` kind, and `classifyOutcome` returns `parked` for it through its exhaustive switch with no default branch, as asserted by the classify-parked test, which also asserts the result is neither `no-verdict` nor `aborted`.
- In `runGroupBranchInner`, a member whose first attempt fails while the injected park predicate returns true makes no further `stepRunner.run` call and settles with the `parked` outcome, as asserted by the member-retry-park test that records one dispatch.
- A member whose park predicate rejects with an error before a retry settles with the `parked` outcome and dispatches nothing more, as asserted by the member-predicate-error test.

**Files:** src/conductor/src/engine/group-core.ts, src/conductor/test/engine/group-core.test.ts

**Dependencies:** none

### Task 9: A join with a parked member stops the feature as parked
**Story:** 7
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing tests. Mixed join (passing, parked, still-running members): every started member settles, then the conductor returns `operator-parked`. `buildParallelFailureEvents` emits nothing for a parked member. Parked plus failed members: the failed member's parallel_failure keeps its original error. The member-level stop emits one `operator_park_boundary` naming the group step and member.
2. Verify the tests fail (RED).
3. Implement: thread the conductor's daemon park predicate into the group deps built for built-in and configured groups in conductor.ts. Make `buildParallelFailureEvents` skip `parked` members. In the conductor's group-result handling, map a join containing a `parked` member to `stopAtOperatorParkBoundary`, with an attempt boundary naming the group step and member, instead of a group pass or failure. Genuine member failures keep their events and diagnostics.
4. Verify the tests pass (GREEN).
5. Commit with message: "stop a group join with a parked member as an operator park".

**Done when:**
- A join over passing, parked, and still-running members waits for every started member to settle, and then the conductor returns an `operator-parked` termination rather than a group pass or failure, as asserted by the mixed-join park test.
- `buildParallelFailureEvents` emits no parallel_failure event for a `parked` member, as asserted by the join test that counts zero parallel_failure events for the parked member.
- A join with one parked and one failed member emits the failed member's parallel_failure event with its original error and diagnostics unchanged, and the conductor's group result is the existing failure outcome, not an `operator-parked` termination, as asserted by the parked-plus-failed join test.
- The member-level stop emits one `operator_park_boundary` event whose attempt boundary names the group step and the member, as asserted by the member-boundary event test.

**Files:** src/conductor/src/engine/conductor.ts, src/conductor/src/engine/group-core.ts, src/conductor/test/engine/when-parallel.test.ts, src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 1, 8

### Task 10: Parking one feature leaves the daemon pool running
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write a daemon pool test. Feature A's fake conductor returns an `operator-parked` termination from a declined attempt, while feature B keeps dispatching and feature C is queued.
2. Verify the test fails (RED) if the pool stalls or shuts down on the termination.
3. Implement: no production change is expected, since the pool already maps `operator-parked` to a distinct `parked` outcome. Fix only what the test shows.
4. Verify the test passes (GREEN).
5. Commit with message: "prove an attempt-level park leaves other features running".

**Done when:**
- A daemon pool test in which feature A's conductor returns an `operator-parked` termination from a declined attempt observes feature B's dispatch count still increasing afterwards and B reaching completion.
- The same pool test observes queued feature C dispatched into the slot A freed, with no daemon shutdown event emitted.

**Files:** src/conductor/test/engine/daemon.test.ts

**Dependencies:** 2

### Task 11: Classify a feature's running work from the persisted spine
**Story:** 9
**Story:** 10
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing unit tests for `classifyRunningWork(worktreePath)` in daemon-dashboard.ts. The latest provider_attempt `running` or `preparing` gives `running` with step and attempt id. `settled`, or an absent events file, gives `stopped`. An unreadable events file (non-ENOENT) or all-malformed provider_attempt lines give `unknown`.
2. Verify the tests fail (RED).
3. Implement: export `classifyRunningWork` from daemon-dashboard.ts. It reads `.pipeline/events.jsonl` itself so it can tell ENOENT apart from other read errors, and it reuses `parseProviderLifecycleDiagnostic` for each provider_attempt line. It inspects no process table (adr-2026-07-30-provider-preparation-lifecycle-supervision D5).
4. Verify the tests pass (GREEN).
5. Commit with message: "classify running work from persisted provider attempts".

**Done when:**
- `classifyRunningWork` in daemon-dashboard.ts returns `running` with the step and attempt id when the latest persisted provider_attempt lifecycle is `running` or `preparing`, reusing `parseProviderLifecycleDiagnostic`, as asserted by the running and preparing classifier tests.
- `classifyRunningWork` returns `stopped` when the latest provider_attempt lifecycle is settled and when the events file is absent, as asserted by the settled and no-events classifier tests.
- `classifyRunningWork` returns `unknown` when the events file exists but reading it fails with a non-ENOENT error, and when every provider_attempt line is malformed, as asserted by the unreadable and malformed classifier tests.

**Files:** src/conductor/src/engine/daemon-dashboard.ts, src/conductor/test/engine/daemon-dashboard.test.ts

**Dependencies:** none

### Task 12: The park command reports running, stopped, or unknown work
**Story:** 9
**Story:** 10
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing park CLI tests, one per report: running (live pidfile, running or preparing attempt), stopped (settled attempt, no live daemon, no worktree or events), unknown (unreadable events, malformed lines, liveness lookup error), and re-parking an already-parked feature. Each asserts the marker is written and the exit status is 0.
2. Verify the tests fail (RED).
3. Implement in `daemon-park-cli.ts`: after the marker write, determine daemon liveness with `readPidRecord` and `isLive` from daemon-lock.ts, treating a thrown lookup as unknown. When the daemon is live, call `classifyRunningWork` on the feature worktree, and print one report line: still running (naming the step and attempt), fully stopped, or unknown. An unknown report never prints the fully-stopped text and does not change the exit status.
4. Verify the tests pass (GREEN).
5. Commit with message: "report running work from daemon park".

**Done when:**
- After writing the park marker, `daemon park` prints a report stating that an attempt is still running and naming the step and attempt when the daemon pidfile is live per `readPidRecord` and `isLive` and `classifyRunningWork` returns `running` for a running or preparing attempt, as asserted by the park CLI running tests.
- `daemon park` prints that the feature is fully stopped when `classifyRunningWork` returns `stopped`, when no daemon pidfile is live, and when the feature has no worktree and no persisted events, and in each case the park marker is written, as asserted by the park CLI stopped tests.
- With a live daemon pidfile and a feature whose latest persisted provider_attempt lifecycle is settled, `classifyRunningWork` returns `stopped` and `daemon park` prints that the feature is fully stopped, as asserted by the park CLI settled-attempt test.
- `daemon park` prints that running work is unknown, and never the fully-stopped text, when the events file is unreadable, when the provider-attempt lines are all malformed, or when pidfile liveness cannot be determined, and the park marker is still written, as asserted by the park CLI unknown tests.
- Every unknown-report park CLI test asserts exit status 0, because the park itself was written.
- Re-parking an already-parked feature prints the existing already-parked notice together with the running-work report, as asserted by the already-parked report test.

**Files:** src/conductor/src/engine/daemon-park-cli.ts, src/conductor/test/engine/daemon-park-cli.test.ts

**Dependencies:** 11

### Task 13: Interactive conduct keeps every retry
**Story:** 13
**Type:** negative-path

**Steps:**
1. Write conductor tests constructed without an operatorParkBoundary option. A failing step dispatches its full retry count. With a park marker on disk for the slug, every retry still dispatches, and a spy on the park read records zero calls.
2. Verify the tests fail (RED) if any interactive path reads park state.
3. Implement: no production change is expected, since every check short-circuits on an absent predicate. Fix only what the tests show.
4. Verify the tests pass (GREEN).
5. Commit with message: "prove interactive runs ignore attempt parking".

**Done when:**
- A conductor constructed without an operatorParkBoundary option dispatches every retry of a failing step, as asserted by the interactive-retry test that records the full retry count.
- The same interactive test with a park marker present on disk for its slug records every retry dispatched and the park marker never read, as asserted by a park-read spy with zero calls.

**Files:** src/conductor/test/engine/operator-park-boundary.test.ts

**Dependencies:** 2

## Task Dependency Graph

```
Task 1 ──► Task 2 ──► Tasks 3, 4, 5, 6, 7, 10, 13
Task 1 ─┐
Task 8 ─┴► Task 9
Task 11 ──► Task 12
```

## Integration Points

- After Task 2: a daemon-run serial step stops launching attempts after a park (the core #2103 fix).
- After Task 9: parallel groups stop cleanly on a parked member.
- After Task 12: the operator can see from `daemon park` whether work is still running.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon-run build step whose first provider attempt fails and whose retry budget allows another attempt, When the feature is parked before that attempt ends, Then no second provider attempt is dispatched and the conductor returns an operator-parked termination. | 2 | "On the ordinary dispatch path, the per-attempt park check in conductor.ts consults the injected operatorParkBoundary before `stepRunner.run` and, when it returns true, dispatches nothing and the run returns an `operator-parked` termination, as asserted by the ordinary-path park test that records exactly one runner dispatch for a step allowed three attempts when the park lands during attempt 1." | diff-local |
| Story 1 happy: Given a daemon-run build step on the ordinary (non-self-host) dispatch path with no park active, When its first attempt fails, Then the next attempt is dispatched exactly as today. | 2 | "With no park active, or with a park removed before the next attempt's check, the per-attempt check lets the next attempt dispatch and no `operator-parked` termination is returned, as asserted by the no-park and removed-park retry tests that record the second runner dispatch." | diff-local |
| Story 1 negative: Given a daemon-run build step whose attempt fails, When the park-state read throws an error before the next attempt, Then no further attempt is dispatched and the conductor returns an operator-parked termination. | 2 | "When operatorParkBoundary rejects with an error at the per-attempt check, the feature is treated as parked, no runner dispatch follows the failed attempt, and the run returns an `operator-parked` termination, as asserted by the throwing-predicate test." | diff-local |
| Story 1 negative: Given a feature whose park was removed before the next attempt began, When the retry loop reaches that attempt, Then the attempt is dispatched and no operator-parked termination is returned. | 2 | "With no park active, or with a park removed before the next attempt's check, the per-attempt check lets the next attempt dispatch and no `operator-parked` termination is returned, as asserted by the no-park and removed-park retry tests that record the second runner dispatch." | diff-local |
| Story 2 happy: Given a parked feature whose running attempt ended with a rate-limit wait, a stale session, an auth refresh, a finish-publication progress retry, a test_suite infrastructure retry, or a build_review mechanical-fault retry, When the conductor would re-enter the attempt loop for that free retry, Then no provider attempt is dispatched and the run returns an operator-parked termination. | 3 | "For each free-retry path of the serial retry loop (rate-limit wait, stale-session reset, auth refresh, finish-publication progress retry, test_suite infrastructure retry, and build_review mechanical-fault retry), a parked-feature conductor test records zero runner dispatches after the park and an `operator-parked` termination." | diff-local |
| Story 2 happy: Given a self-host daemon build whose attempt fails while the feature is parked, When the next attempt reaches self-host dispatch admission, Then it is cancelled before dispatch exactly as it is today. | 3 | "A self-host attempt reached while parked is still cancelled before dispatch with a `self_host_dispatch_admission` event in state `cancelled` and no runner call, as asserted by the existing self-host admission park test." | diff-local |
| Story 2 negative: Given a parked feature whose running attempt produced a completion-check miss that would normally count as a budgeted retry, When the loop continues, Then no provider attempt is dispatched even though retry budget remains. | 3 | "A parked-feature conductor test whose attempt ends in a completion-check miss with retry budget remaining records zero runner dispatches after the park even though the budget would allow another attempt." | diff-local |
| Story 2 negative: Given a parked feature whose running attempt ended in a free retry that does not consume budget, When the loop re-enters, Then the park is still consulted before dispatch and the free retry does not bypass it. | 3 | "The free-retry tests assert that the park predicate is consulted on each re-entry of the retry loop, so a free retry never bypasses the per-attempt check." | diff-local |
| Story 3 happy: Given a provider attempt that is running when the feature is parked, When the attempt later completes successfully, Then its result is recorded normally and the step reaches its natural terminal status before the feature stops. | 4 | "A conductor test whose runner resolves successfully after the park is written observes that attempt's result persisted, the step's persisted status set to its natural terminal status, and the run stopping only afterwards at the next unit boundary." | diff-local |
| Story 3 negative: Given a provider attempt that is running when the feature is parked, When the park lands, Then the attempt receives no abort, cancellation, or kill and its runner call returns only when the provider finishes. | 4 | "The same drain test asserts that the runner receives no abort signal, cancellation, or kill, and that its runner call returns only when the fake provider resolves." | diff-local |
| Story 3 negative: Given a running attempt that fails after the park lands, When it returns, Then its failure output is recorded as the attempt's result and the park stops only the next attempt. | 4 | "A conductor test whose running attempt fails after the park lands observes that failure output recorded as the attempt's result and zero further runner dispatches." | diff-local |
| Story 4 happy: Given a step whose next attempt is declined for a park, When the conductor returns, Then the termination is operator-parked and no step_failed, step_retry, or retry-exhaustion event is emitted for the declined attempt. | 5 | "After a declined attempt the conductor run returns an `operator-parked` termination, and the event stream ends with the `operator_park_boundary` event and contains no step_failed, step_retry, or retry-exhaustion event after it, as asserted by the declined-attempt event test." | diff-local |
| Story 4 negative: Given a step whose next attempt is declined for a park, When the conductor returns, Then no HALT marker file is written to the feature worktree. | 5 | "After a declined attempt the feature worktree contains no HALT marker file and persisted conduct state shows the step `in_progress`, not failed, as asserted by the declined-attempt state test." | diff-local |
| Story 4 negative: Given a build step whose declined attempt would have been its third, When the conductor returns, Then no escalation-ladder model or effort rung is recorded for that attempt and the no-evidence attempt count is unchanged from before the park. | 5 | "For a build step whose declined attempt would have been its third, the escalation ladder records no model or effort rung for attempt 3 and the persisted no-evidence attempt count is identical before and after the declined attempt, as asserted by the declined-build-accounting test." | diff-local |
| Story 4 negative: Given a step whose next attempt is declined for a park, When the persisted conduct state is read, Then the step's status is in_progress, not failed. | 5 | "After a declined attempt the feature worktree contains no HALT marker file and persisted conduct state shows the step `in_progress`, not failed, as asserted by the declined-attempt state test." | diff-local |
| Story 5 happy: Given a feature stopped by a declined attempt with its step left in_progress, When the park is removed and the daemon resumes the feature, Then the conductor resumes at that same step and dispatches its first attempt with a fresh attempt budget. | 6 | "A resume test that removes the park after a declined attempt observes the conductor's resume index landing on the parked `in_progress` step and its first dispatched attempt numbered 1, the start of a fresh attempt budget." | diff-local |
| Story 5 happy: Given a feature parked mid-build after some plan tasks were committed complete, When it resumes, Then those tasks remain complete and are not dispatched again. | 6 | "A resume test for a build parked after some plan tasks were committed complete observes those task statuses still complete after resume and no dispatch for those tasks." | diff-local |
| Story 5 negative: Given a feature stopped by a declined attempt, When it resumes while still parked, Then the pre-unit gate stops it before any attempt and the step remains in_progress. | 6 | "A resume test that resumes while the park is still active observes the existing pre-unit gate returning `operator-parked` before any runner dispatch and the step still `in_progress`." | diff-local |
| Story 6 happy: Given an attempt that has returned and a park written before the next attempt's dispatch check, When the check runs, Then it observes the park and no attempt is dispatched. | 7 | "A test that writes the park between attempt N and attempt N+1 records exactly N runner dispatches, because the per-attempt park check observes the park before the next dispatch." | diff-local |
| Story 6 negative: Given a park-state read that rejects with an error at the attempt check, When the check completes, Then it treats the feature as parked and no attempt is dispatched. | 7 | "A test whose park predicate rejects with an error at the per-attempt check records zero runner dispatches at that check and an `operator-parked` termination, treating the feature as parked." | diff-local |
| Story 6 negative: Given a park written after the attempt check passed and while that attempt's dispatch is starting, When the attempt runs, Then it runs to completion (per Story 3) and the following attempt is declined. | 7 | "A test that writes the park after the per-attempt check passed and while that attempt's dispatch is starting observes that attempt running to completion with its result recorded and the following attempt declined." | diff-local |
| Story 7 happy: Given a daemon-run parallel group whose member's first attempt fails while the feature is parked, When that member would retry, Then it dispatches no further attempt and settles with a parked outcome. | 8 | "In `runGroupBranchInner`, a member whose first attempt fails while the injected park predicate returns true makes no further `stepRunner.run` call and settles with the `parked` outcome, as asserted by the member-retry-park test that records one dispatch." | diff-local |
| Story 7 happy: Given a parallel group whose members are passing, parked, or still running when the park lands, When every started member settles, Then the group join returns an operator-parked termination rather than a pass or a failure. | 9 | "A join over passing, parked, and still-running members waits for every started member to settle, and then the conductor returns an `operator-parked` termination rather than a group pass or failure, as asserted by the mixed-join park test." | diff-local |
| Story 7 negative: Given a parallel group with one parked member and one failed member, When the group joins, Then the failed member's genuine failure and diagnostics are reported and are not overwritten by the park. | 9 | "A join with one parked and one failed member emits the failed member's parallel_failure event with its original error and diagnostics unchanged, and the conductor's group result is the existing failure outcome, not an `operator-parked` termination, as asserted by the parked-plus-failed join test." | diff-local |
| Story 7 negative: Given a parallel group with one parked member, When the group joins, Then no parallel_failure event is emitted for the parked member. | 9 | "`buildParallelFailureEvents` emits no parallel_failure event for a `parked` member, as asserted by the join test that counts zero parallel_failure events for the parked member." | diff-local |
| Story 7 negative: Given a parked member, When its outcome is classified, Then it is classified as parked and never as no-verdict or aborted. | 8 | "`BranchOutcome` in group-core.ts gains a `parked` kind, and `classifyOutcome` returns `parked` for it through its exhaustive switch with no default branch, as asserted by the classify-parked test, which also asserts the result is neither `no-verdict` nor `aborted`." | diff-local |
| Story 8 happy: Given a daemon pool running feature A and feature B, When A is parked and its next attempt is declined, Then B's attempts continue to dispatch and B can finish. | 10 | "A daemon pool test in which feature A's conductor returns an `operator-parked` termination from a declined attempt observes feature B's dispatch count still increasing afterwards and B reaching completion." | diff-local |
| Story 8 negative: Given a daemon pool with feature A parked mid-step and feature C queued, When A returns its operator-parked termination, Then C is dispatched into the freed slot and the daemon process keeps running. | 10 | "The same pool test observes queued feature C dispatched into the slot A freed, with no daemon shutdown event emitted." | diff-local |
| Story 9 happy: Given a live daemon and a feature whose latest persisted provider attempt for its current step is running, When the operator parks the feature, Then the output states that an attempt is still running and names the step and attempt. | 12 | "After writing the park marker, `daemon park` prints a report stating that an attempt is still running and naming the step and attempt when the daemon pidfile is live per `readPidRecord` and `isLive` and `classifyRunningWork` returns `running` for a running or preparing attempt, as asserted by the park CLI running tests." | diff-local |
| Story 9 happy: Given a live daemon and a feature whose latest persisted provider attempt is preparing, When the operator parks the feature, Then the output states that an attempt is still running. | 12 | "After writing the park marker, `daemon park` prints a report stating that an attempt is still running and naming the step and attempt when the daemon pidfile is live per `readPidRecord` and `isLive` and `classifyRunningWork` returns `running` for a running or preparing attempt, as asserted by the park CLI running tests." | diff-local |
| Story 9 negative: Given a feature already parked, When the operator parks it again, Then the output still carries the running-work report alongside the existing already-parked notice. | 12 | "Re-parking an already-parked feature prints the existing already-parked notice together with the running-work report, as asserted by the already-parked report test." | diff-local |
| Story 10 happy: Given a feature whose latest persisted provider attempt has settled, When the operator parks it, Then the output states that the feature is fully stopped. | 12 | "`daemon park` prints that the feature is fully stopped when `classifyRunningWork` returns `stopped`, when no daemon pidfile is live, and when the feature has no worktree and no persisted events, and in each case the park marker is written, as asserted by the park CLI stopped tests." | diff-local |
| Story 10 happy: Given no running daemon for the repository, When the operator parks a feature, Then the output states that the feature is fully stopped. | 12 | "`daemon park` prints that the feature is fully stopped when `classifyRunningWork` returns `stopped`, when no daemon pidfile is live, and when the feature has no worktree and no persisted events, and in each case the park marker is written, as asserted by the park CLI stopped tests." | diff-local |
| Story 10 negative: Given a feature with no worktree and no persisted events, When the operator parks it, Then the output states that the feature is fully stopped and the park is still written. | 12 | "`daemon park` prints that the feature is fully stopped when `classifyRunningWork` returns `stopped`, when no daemon pidfile is live, and when the feature has no worktree and no persisted events, and in each case the park marker is written, as asserted by the park CLI stopped tests." | diff-local |
| Story 11 happy: Given a live daemon and a feature whose events file exists but cannot be read, When the operator parks it, Then the output states that running work is unknown and the park is still written. | 12 | "`daemon park` prints that running work is unknown, and never the fully-stopped text, when the events file is unreadable, when the provider-attempt lines are all malformed, or when pidfile liveness cannot be determined, and the park marker is still written, as asserted by the park CLI unknown tests." | diff-local |
| Story 11 negative: Given a feature whose events file contains only malformed provider-attempt lines, When the operator parks it, Then the output states that running work is unknown and does not state that the feature is stopped. | 12 | "`daemon park` prints that running work is unknown, and never the fully-stopped text, when the events file is unreadable, when the provider-attempt lines are all malformed, or when pidfile liveness cannot be determined, and the park marker is still written, as asserted by the park CLI unknown tests." | diff-local |
| Story 11 negative: Given a daemon pidfile whose liveness cannot be determined, When the operator parks a feature, Then the output states that running work is unknown. | 12 | "`daemon park` prints that running work is unknown, and never the fully-stopped text, when the events file is unreadable, when the provider-attempt lines are all malformed, or when pidfile liveness cannot be determined, and the park marker is still written, as asserted by the park CLI unknown tests." | diff-local |
| Story 11 negative: Given any unknown report, When the park command exits, Then it exits successfully because the park itself was written. | 12 | "Every unknown-report park CLI test asserts exit status 0, because the park itself was written." | diff-local |
| Story 12 happy: Given a serial step whose next attempt is declined for a park, When the operator-park boundary event is emitted, Then it identifies the feature, the step, and an attempt-level boundary, and the daemon log renders a line naming them. | 1, 2 | "The daemon-log renderer in daemon-cli.ts renders an attempt boundary as a line naming the feature, the step, and that an attempt was declined for an operator park, and a member boundary as a line naming the group step and the member, as asserted by the attempt and member render tests." | diff-local |
| Story 12 happy: Given a parallel-group member whose retry is declined, When the boundary event is emitted, Then it names the group step and the member. | 1, 9 | "The daemon-log renderer in daemon-cli.ts renders an attempt boundary as a line naming the feature, the step, and that an attempt was declined for an operator park, and a member boundary as a line naming the group step and the member, as asserted by the attempt and member render tests." | diff-local |
| Story 12 negative: Given a park observed at a scheduling-unit boundary with no attempt declined, When the boundary event is emitted, Then it keeps the existing unit-level shape and rendering unchanged. | 1 | "The existing unit-boundary render test in daemon-render.test.ts passes unchanged, so step, group, and pre-first-unit boundaries keep their existing shape and rendered text." | diff-local |
| Story 12 negative: Given a declined attempt, When the event is persisted, Then exactly one operator-park boundary event is recorded for that stop, not one per retry path. | 2 | "A declined attempt emits exactly one `operator_park_boundary` event, whose attempt boundary carries the feature slug, the step name, and the attempt number, as asserted by the single-boundary-event test." | diff-local |
| Story 13 happy: Given an interactive conduct run with no daemon park predicate, When a step retries, Then every retry is dispatched exactly as before. | 13 | "A conductor constructed without an operatorParkBoundary option dispatches every retry of a failing step, as asserted by the interactive-retry test that records the full retry count." | diff-local |
| Story 13 negative: Given an interactive conduct run and a park marker present on disk for its slug, When a step retries, Then the marker is not consulted and the retry is dispatched. | 13 | "The same interactive test with a park marker present on disk for its slug records every retry dispatched and the park marker never read, as asserted by a park-read spy with zero calls." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D1 | existing | none | Repo-root operator park state under `.daemon/parked/` remains the only park directive; `isOperatorParked` in park-marker.ts is the single reader and this feature adds no worktree park file. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D2 | existing | none | The daemon composition in daemon-cli.ts already injects `operatorParkBoundary` from `isOperatorParked`; interactive construction passes none. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D3 | existing | none | The pre-unit gate `stopAtOperatorParkBoundary` in conductor.ts already runs before every pending serial step and parallel group. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D4 | no-change | none | Amended by D11: drain now applies per provider attempt; the in-unit prohibition is replaced by the attempt gate that tasks 2 and 9 deliver, and no code enforces the old prohibition. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D5 | existing | none | `OperatorParkedTermination` is already returned by conductor.ts and propagated unchanged through daemon-runner.ts; the attempt stop reuses it. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D6 | existing | none | The pre-rebase park check in daemon-cli.ts already returns the typed pre-first-unit termination. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D7 | existing | none | The feature runner already maps `operator-parked` to a distinct `parked` pool outcome with no HALT and a retained worktree. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D8 | task | task-9 | A join with one parked and one failed member emits the failed member's parallel_failure event with its original error and diagnostics unchanged, and the conductor's group result is the existing failure outcome, not an `operator-parked` termination, as asserted by the parked-plus-failed join test. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D9 | existing | none | The `operator_park_boundary` event is already persisted and rendered in the feature-scoped daemon log. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D10 | no-change | none | Amended by D13: groups still share one next-unit gate; per-member park handling lives in the shared group core rather than per-group code, which task 8 delivers. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D11 | task | task-2, task-3 | On the ordinary dispatch path, the per-attempt park check in conductor.ts consults the injected operatorParkBoundary before `stepRunner.run` and, when it returns true, dispatches nothing and the run returns an `operator-parked` termination, as asserted by the ordinary-path park test that records exactly one runner dispatch for a step allowed three attempts when the park lands during attempt 1. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D12 | task | task-5, task-6 | After a declined attempt the feature worktree contains no HALT marker file and persisted conduct state shows the step `in_progress`, not failed, as asserted by the declined-attempt state test. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D13 | task | task-8, task-9 | A join over passing, parked, and still-running members waits for every started member to settle, and then the conductor returns an `operator-parked` termination rather than a group pass or failure, as asserted by the mixed-join park test. |
| adr-2026-07-29-operator-park-scheduling-unit-boundary#D14 | task | task-1, task-11, task-12 | After writing the park marker, `daemon park` prints a report stating that an attempt is still running and naming the step and attempt when the daemon pidfile is live per `readPidRecord` and `isLive` and `classifyRunningWork` returns `running` for a running or preparing attempt, as asserted by the park CLI running tests. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
