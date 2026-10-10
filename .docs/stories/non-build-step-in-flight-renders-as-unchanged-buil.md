**Status:** Accepted

# Stories: Non-build step in flight renders as unchanged build progress

Source: jstoup111/ai-conductor#2806. Track: technical (no PRD). Tier: S.

While a lifecycle step other than `build` runs, the daemon currently prints its start header and
then nothing until the step settles. `daemon status` shows only the repository's last log line.
These stories make every running non-build step visibly alive in both places, under its own name.
They also pin that `build` progress lines stop when `build` closes.

The heartbeat interval is `build_progress.heartbeat_minutes` (default 5) and the off switch is
`build_progress.enabled`, the same keys that already govern the build heartbeat.

## Story 1: The daemon log shows a non-build step is still running

**Requirement:** #2806 desired outcomes 1, 2, 3

As an operator tailing `daemon.log`, I want a periodic line naming each non-build step that is
still executing, and how long it has run, so that I can tell a working step from a hang without
opening sidecars.

### Acceptance Criteria

#### Happy Path
- Given a daemon-dispatched feature whose `test_suite` step is still executing one `build_progress.heartbeat_minutes` interval after that step started, when the interval elapses, then the feature's daemon log receives a line `▶ test_suite running <elapsed>` that names `test_suite` and gives the time since that step started, and another such line follows at each later interval while the step is still executing.
- Given the `validation` group dispatches `manual_test` and `prd_audit` concurrently and both are still executing one interval after admission, when the interval elapses, then the daemon log receives one running line naming `manual_test` and one naming `prd_audit`, each under its own step name and neither under the group's first member's name.
- Given a feature whose `build` step has settled and whose `test_suite` step is now executing, when heartbeat intervals elapse during `test_suite`, then the running lines name `test_suite` and no `build_progress` event for that feature is emitted after `build` settled.

#### Negative Paths
- Given a non-build step that settles (completes, fails, is refused, or throws) before one interval has elapsed since it started, when the step settles, then no running line is ever emitted for that step attempt.
- Given a non-build step that settled after one or more running lines, when later intervals elapse, then no further running line names that step attempt.
- Given `build_progress.enabled: false`, when a non-build step runs longer than the interval, then no running line is emitted for it.
- Given the `build` step is executing, when heartbeat intervals elapse, then no running line of this kind is emitted for `build`, and its existing `▶ build N/M` progress lines are emitted as before.

### Done When
- [ ] A rendered `step_in_flight` event produces exactly one daemon-log line containing `▶`, the event's step name, `running`, and the elapsed time.
- [ ] An engine test shows a non-build step that outlives the interval emits `step_in_flight` naming that step, and stops emitting once it settles, including when it throws.
- [ ] An engine test shows each concurrently admitted `validation` member emits `step_in_flight` under its own name.
- [ ] Engine tests show no `step_in_flight` for `build`, for a step that settles inside the interval, or with `build_progress.enabled: false`.
- [ ] An engine test shows no `build_progress` event follows `build`'s `step_completed` while the following `test_suite` step emits `step_in_flight`.

## Story 2: `daemon status` names each in-flight step

**Requirement:** #2806 desired outcomes 1, 2, 3

As an operator running `conduct daemon status`, I want each in-progress feature's currently
executing steps listed by name with elapsed time, so that the status reflects the step actually
running rather than whichever line the log printed last.

### Acceptance Criteria

#### Happy Path
- Given a running daemon and an in-progress feature whose persisted events contain `step_started` for `test_suite` with no later terminal event for `test_suite`, when the operator runs `conduct daemon status`, then the output contains `IN FLIGHT [<slug>]: test_suite running <elapsed>` with the elapsed time measured from that `step_started` timestamp.
- Given a running daemon and an in-progress feature whose persisted events show `build` started then `step_completed` for `build`, followed by `step_started` for `test_suite`, when the operator runs `conduct daemon status`, then the feature's in-flight output names `test_suite` and contains no in-flight line naming `build`.
- Given a running daemon and an in-progress feature whose persisted events contain unterminated `step_started` events for both `manual_test` and `prd_audit`, when the operator runs `conduct daemon status`, then the output contains one `IN FLIGHT [<slug>]` line naming `manual_test` and one naming `prd_audit`.

#### Negative Paths
- Given an in-progress feature whose latest event for a step after its `step_started` is `step_completed`, `step_failed`, `step_interrupted`, or `step_refused`, when the operator runs `conduct daemon status`, then no in-flight line names that step.
- Given a step whose `step_started` is followed by `step_retry` events and no terminal event, when the operator runs `conduct daemon status`, then that step is still listed as in flight, with elapsed time measured from its `step_started`.
- Given the repository's daemon liveness is `stale` or `stopped`, when the operator runs `conduct daemon status`, then no `IN FLIGHT` line is printed for that repository even if a feature's events contain an unterminated `step_started`.
- Given an in-progress feature whose `.pipeline/events.jsonl` contains a malformed line, when the operator runs `conduct daemon status`, then the command still exits 0, prints the repository status row and the other features' in-flight lines, and prints no in-flight line for that feature.

### Done When
- [ ] A `runDaemonStatus` test with a running daemon and fixture worktree ledgers prints `IN FLIGHT [<slug>]: test_suite running <elapsed>` and no in-flight line for a settled `build`.
- [ ] The same suite shows two lines for two unterminated `validation` members and none for steps closed by each of the four terminal event types.
- [ ] The same suite shows a retried, unterminated step stays listed, and a stale or stopped daemon prints no `IN FLIGHT` line.
- [ ] The same suite shows a malformed ledger omits only that feature's in-flight lines while the command exits 0.
