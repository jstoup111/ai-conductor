# Implementation Plan: Reset the daemon idle-poll counter when work is dispatched

**Date:** 2026-09-06
**Stories:** .docs/stories/reset-the-daemon-idle-poll-counter-when-work-is-di.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing daemon contract — ceilings stop the start of new work while in-flight features always drain, and the counting branch is reached only at a fully drained boundary.

## Summary

Two bounded tasks deliver #2156. Task 1 restarts the empty-poll count at the one place the loop starts work and corrects the flag's documented semantics; Task 2 pins the polls that must still count, including the two boundaries where the loop finds a candidate it cannot start. The ceiling's off-by-one arithmetic, the waker's early-wake cadence, the idle-poll interval default, the supervisor's deliberate omission of this flag, and every other stop reason are outside this slice.

## Technical Approach

The counter lives in `runDaemon`'s closure and is incremented in exactly one branch: the fully-idle boundary reached when a pool slot is free, selection produced no item, and maintenance reports the pool drained. A successful dispatch never reaches that branch — it takes the `continue` that tries to fill another slot — so the count is already immune to in-flight work; it is only missing a restart. Assign zero immediately before that `continue`, where `guardedDispatch` has already returned true, and carry a short comment naming the consecutive-count contract.

Keying the restart to the dispatch return value, rather than to a non-empty backlog or to a completed feature, is what makes the remaining cases behave. A candidate that is filtered by the pre-dispatch park guard returns false and deliberately falls through to the same idle branch, so that poll still counts. A backlog that never yields an eligible item never reaches the assignment at all. A worker completion needs no restart of its own: while that worker was in flight the branch was unreachable, and the dispatch that started it already restarted the count.

Coverage belongs at the loop seam that owns the behavior, which is the existing `runDaemon` unit file. Its fixtures already inject the backlog, the feature runner, and the sleep function, and the established pattern keys fixture state changes to the injected sleep count, which makes "how many idle polls elapsed" directly observable without touching a clock or a real timer. Record the sleep count at dispatch time inside the injected runner and assert the difference, so an incidental busy-poll sleep cannot make the assertion brittle while a missing restart still fails it. The park-race fixture drives the injected park predicate so the selection-time check passes and the immediately-following dispatch guard fails, reusing the exported guard's documented fail-closed behavior rather than adding a seam. No conductor run, no temporary repository, and no third-party boundary is involved; every dependency is injected.

Documentation is corrected in the same change rather than split out: the flag's reference row already claims consecutive semantics, so it gains only the explicit statement that a dispatched feature restarts the count, and the foreground-run guidance gains the same clause where it lists the ceilings. No new flag, config key, event, metric, span, or log line is introduced, so no telemetry channel question arises.

## Preconditions and claim ledger

- Operator-delegate approved Small scope, the technical track, the dispatch-keyed restart, and both stories on 2026-09-06.
- Verified: `src/conductor/src/engine/daemon.ts` declares the counter at line 917, increments it at 1548, and compares it at 1549; those are its only three occurrences in the file, so nothing resets it today.
- Verified: the increment is inside the branch guarded by a free pool slot, an empty selection, and `maintenance.isDrained()`, whose implementation in `src/conductor/src/engine/daemon-maintenance.ts` line 56 returns true only when the active work count is zero.
- Verified: line 1348 takes `guardedDispatch`'s boolean and `continue`s on true, and its own comment records that a false return falls through to the idle section on purpose.
- Verified: `guardedDispatchWith` is exported from the same module and returns false for a parked slug, so the park race is reachable through injected dependencies alone.
- Verified: `src/conductor/test/engine/daemon.test.ts` already drives `runDaemon` with injected `discoverBacklog`, `runFeature`, and `sleep`, and its empty-backlog ceiling case asserts one injected sleep per empty poll.
- Verified: the progress-gated re-kick path is bounded by a per-slug dispatch ceiling defaulting to 20 in the same file, so no existing fixture can re-dispatch without end once the count restarts.
- Verified: `docs/reference/cli.md` line 293 documents the flag as stopping after this many consecutive empty polls, and the daemon guide lists it among the ceilings that bound a continuous run.
- Verified: the approved supervisor-hosting decision record mentions this flag only to record that the tmux-hosted daemon deliberately omits it; nothing in it constrains the counting rule, so no decision record is added or amended.
- Verify-claims verdict: CLEAR. Every path, line, and symbol above was read in the worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Restart the empty-poll count when a feature is dispatched
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon.ts, src/conductor/test/engine/daemon.test.ts, docs/reference/cli.md, docs/guides/running-the-daemon.md
**Dependencies:** none

**Steps:**
1. Add a failing unit case to the daemon loop's existing test file: a continuous run with a modest idle ceiling, an injected sleep that counts calls, and a backlog that returns one feature only after fewer idle sleeps than the ceiling and stays empty forever afterwards.
2. Capture the sleep count inside the injected feature runner and assert both that the run stops for `idle_timeout` and that at least a full ceiling's worth of sleeps happened after the dispatch, which fails today because the pre-dispatch polls are still on the count.
3. Establish RED, then assign zero to the counter immediately before the dispatch branch's `continue`, with a comment naming the consecutive-count contract and why a false dispatch result deliberately does not restart it.
4. Correct the flag's reference row so it states that a dispatched feature restarts the count, and add the same clause to the daemon guide's bullet that lists the ceilings bounding a continuous run.
5. Run the daemon loop's unit file, the repository's type check that includes tests, and its lint command, then commit the focused change.

**Done when:**
1. The new unit case stops for `idle_timeout` only after a full ceiling's worth of empty polls following the dispatch, and fails against the unmodified loop.
2. The counter's only assignment outside its declaration is the dispatch branch, and no other loop branch was changed.
3. The flag's reference row and the daemon guide both state that dispatching a feature restarts the count.

### Task 2: Pin the polls that must still count toward the ceiling
**Story:** Story 1
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/daemon.test.ts
**Dependencies:** 1

**Steps:**
1. Add a case whose backlog always returns one feature whose injected halted predicate never clears, and assert it stops for `idle_timeout` with the same injected sleep count as the existing empty-backlog case.
2. Add a case that drives the injected park predicate so selection passes and the immediately-following dispatch guard rejects the same slug on every poll, and assert the run still reaches `idle_timeout` at the empty-backlog cadence with no feature ever started.
3. Confirm the existing empty-backlog ceiling case still observes exactly one idle sleep per empty poll, and leave it unchanged as the cadence baseline.
4. Run the daemon unit files and the daemon acceptance files that pass an idle ceiling, confirming none of them depended on cumulative counting; if one now runs longer only because a bounded re-kick sequence repeats, record that in the commit message rather than weakening the new behavior.
5. Run the repository's type check that includes tests and its lint command, then commit the focused change.

**Done when:**
1. A permanently ineligible backlog stops for `idle_timeout` with the same injected sleep count as an empty backlog.
2. A candidate rejected by the pre-dispatch park guard leaves no feature started and does not restart the count, and the run still stops for `idle_timeout`.
3. The pre-existing empty-backlog ceiling case is unchanged and still passes.
4. The daemon unit and acceptance files that pass an idle ceiling pass without fixture edits that relax an existing assertion.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a continuous run with an idle ceiling and a backlog that stays empty for fewer polls than that ceiling before one feature appears, when the feature is dispatched and the backlog stays empty afterwards, then a full ceiling's worth of empty polls elapses after that dispatch before the run stops for `idle_timeout`. | 1 | "The new unit case stops for `idle_timeout` only after a full ceiling's worth of empty polls following the dispatch, and fails against the unmodified loop." | diff-local |
| Story 1 negative: Given a candidate is selected and then operator-parked before it starts, when the poll ends with no feature started, then the empty-poll count advances and the ceiling still stops the run for `idle_timeout`. | 2 | "A candidate rejected by the pre-dispatch park guard leaves no feature started and does not restart the count, and the run still stops for `idle_timeout`." | diff-local |
| Story 2 happy: Given a continuous run whose backlog is empty from the first poll, when idle polls elapse without any work appearing, then the run stops for `idle_timeout` at its existing cadence of exactly one idle sleep per empty poll up to the ceiling. | 2 | "The pre-existing empty-backlog ceiling case is unchanged and still passes." | diff-local |
| Story 2 negative: Given a backlog that always returns a feature whose durable HALT marker is never cleared, when no feature can be started on any poll, then the run stops for `idle_timeout` at the same cadence as an empty backlog rather than polling forever. | 2 | "A permanently ineligible backlog stops for `idle_timeout` with the same injected sleep count as an empty backlog." | diff-local |

## Test dispositions and integration ownership

All four criteria are diff-local against injected-dependency fixtures at the daemon loop seam. Task 1 owns the restart case and the documentation correction; Task 2 owns the three counting cases that must remain unchanged or newly pinned. Every dependency is injected, no test spawns a process or reaches a third party, and no conductor run or temporary repository is involved. The existing daemon unit and acceptance suites supply the surrounding stop-reason permutations and are re-run as regression evidence rather than duplicated. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
