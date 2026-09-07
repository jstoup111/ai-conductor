**Status:** Accepted

# Stories: Daemon-level metrics — queue depth, halts, gate outcomes, and monotonic counters

Source: jstoup111/ai-conductor#1937. Technical track (no PRD); criteria derive from the intake's
six desired outcomes, adr-014 decisions 7–9, and the approved architecture review conditions C1–C8.
Instrument names below are the OTel names; Prometheus renders `conductor.daemon.backlog` as
`conductor_daemon_backlog` and counters gain a `_total` suffix.

## Story 1: Metric counters survive re-dispatch because the daemon owns the meter

As an operator, I want a feature's halt and retry counts to keep counting across re-dispatches so that "how many times did this feature halt" is a real number instead of a per-dispatch flag.

### Acceptance Criteria

#### Happy Path
- Given OTel is enabled and one daemon process dispatches feature S, which halts, is re-kicked, and halts again, when metrics are exported after the second dispatch, then conductor.run.outcomes{feature=S, outcome=halted} reads 2 and never reads 1 in between
- Given one daemon process dispatches feature S twice and each dispatch retries the build step once, when metrics are exported after the second dispatch, then conductor.step.retries{feature=S, step=build} reads 2, monotonic across both dispatches
- Given OTel is enabled, when the daemon starts, then exactly one MeterProvider exists for the daemon's lifetime and both dispatches of Story 1's feature are recorded onto it by the daemon's metrics listener from their forwarded events
- Given a dispatch runs in a process that exits at dispatch end, when its forwarded step and terminal events reach the daemon bus, then the same per-feature counters continue from their prior values, because no metric state lived in the exited process

#### Negative Paths
- Given feature A's dispatch stops while feature B is still running under the same daemon, when A's per-dispatch visualizer stops, then the daemon meter is force-flushed (so A's final data points are exported before the daemon could die) but not shut down, the visualizer holds no meter of its own to shut down, and B's next step still exports conductor.step.duration{feature=B}
- Given the daemon process itself restarts, when metrics resume, then counters restart from zero exactly once (an ordinary process restart) and the exported series carries the same identity so backend rate functions treat it as a counter reset, not a new series
- Given OTel is disabled or the otel config block is absent, when the daemon starts and dispatches a feature, then no MeterProvider is constructed, no recorder is passed to the dispatch, and daemon behavior is byte-for-byte unchanged from today

### Done When
- [ ] An acceptance test drives two sequential dispatches of one feature under one daemon with an in-memory exporter and asserts conductor.run.outcomes{outcome=halted} = 2 and conductor.step.retries monotonic, with no duplicate-instrument warning
- [ ] An acceptance test stops feature A's visualizer while feature B is mid-run and asserts B's later data points still export
- [ ] The daemon start path constructs the MeterProvider once and the per-dispatch visualizer constructs no MeterProvider under the daemon (unit test on the spans-only mode)
- [ ] An acceptance test runs a dispatch through a child-process-shaped fake that exits after emitting its events and asserts the feature's counters continue from their prior values

## Story 2: Metric identity is project plus worker, with feature on data points only

As a telemetry consumer running several projects and possibly several workers per project against one backend, I want every series attributable to its project and worker, and per-feature series joinable by a feature label, so that fleet, project, and worker views are each one query.

### Acceptance Criteria

#### Happy Path
- Given project P and a worker whose resolved name is W, when the daemon exports metrics, then the metric Resource carries service.name=ai-conductor, service.instance.id=P/W, conductor.project, conductor.worker=W, and host.name equal to the OS hostname
- Given a per-feature instrument such as conductor.step.duration for feature S, when it is exported, then its data point carries project=P, worker=W, and feature=S as attributes
- Given a daemon-level instrument such as conductor.daemon.backlog, when it is exported, then its data point carries project=P and worker=W and no feature attribute
- Given otel.worker_name is set to a non-blank value in .ai-conductor/config.yml, when the daemon exports, then W is that trimmed value; given it is absent or blank, then W is the OS hostname

#### Negative Paths
- Given the shared meter serves many features, when the metric Resource is inspected, then it carries no conductor.feature and no conductor.branch attribute (asserted on the exported Resource, not on data-point attributes)
- Given a per-dispatch visualizer exports spans, when the trace Resource is inspected, then it still carries conductor.feature, conductor.branch, conductor.run.id, and conductor.engine.version, unchanged from today
- Given os.hostname() throws or returns an empty string, when identity is resolved, then W falls back to the literal unknown and the daemon proceeds without failing

### Done When
- [ ] A test asserts the exported metric Resource directly: service.instance.id = P/W, host.name present, conductor.feature absent
- [ ] A test asserts the exported trace Resource still carries conductor.feature and conductor.run.id
- [ ] A test covers otel.worker_name set, blank, and absent, plus the hostname-failure fallback

## Story 3: An idle daemon exports backlog, slot, liveness, and blocking signals

As an operator, I want to see whether the backlog is growing, draining, or stuck, how many workers are executing, and whether the daemon is alive and able to dispatch, without running a CLI or reading local files, even when nothing is being built.

### Acceptance Criteria

#### Happy Path
- Given a running daemon with an empty backlog and no dispatch in flight, when a metrics export occurs, then conductor.daemon.up reads 1 and conductor.daemon.backlog{state} has a data point for each of eligible, waiting, blocked, gated, and parked (each 0)
- Given discovery finds 3 eligible, 2 waiting, 1 blocked, 4 gated specs and 2 operator-parked features, when the tick's snapshot is exported, then conductor.daemon.backlog reads 3, 2, 1, 4, 2 for those states respectively
- Given the oldest eligible spec became eligible 36 hours ago, when the snapshot is exported, then conductor.daemon.backlog.oldest_age{state=eligible} reads approximately 129600 seconds
- Given daemon concurrency is 3 and 2 features are in flight, when the snapshot is exported, then conductor.daemon.slots{state=busy} reads 2, conductor.daemon.slots{state=free} reads 1, and conductor.daemon.inflight{feature} reads 1 for each of the two in-flight slugs
- Given a discovery pass took 840 ms, when the snapshot is exported, then conductor.daemon.poll.duration has one observation of 840 ms

#### Negative Paths
- Given the daemon is paused, when the snapshot is exported, then conductor.daemon.blocked_reason{reason=paused} reads 1 and the other three reasons read 0, so an idle-because-paused daemon is distinguishable from an idle-because-drained one
- Given build auth is missing, when the snapshot is exported, then conductor.daemon.blocked_reason{reason=build_auth_missing} reads 1
- Given the daemon is hard-killed, when the backend's next scrape interval passes, then conductor.daemon.up stops being reported (the series goes stale) rather than continuing to read 1
- Given a backlog state has no members, when the snapshot is exported, then that state's data point reads 0 rather than being absent, so dashboards never show a gap for an empty state
- Given the backlog contains an eligible spec whose eligibility timestamp cannot be determined, when oldest_age is computed, then that spec is excluded from the age and the count still includes it

### Done When
- [ ] An acceptance test starts the daemon loop with OTel enabled, an empty backlog, and no dispatch, and asserts conductor.daemon.up, all five conductor.daemon.backlog states, and both conductor.daemon.slots states are exported
- [ ] A test feeds a discovery result with known counts, ages, in-flight slugs, and the four blocking flags, and asserts every daemon-level data point matches
- [ ] The snapshot is computed from the discovery pass that already ran, and the metrics handler performs no I/O (unit test asserts no filesystem or git calls from the handler)

## Story 4: Feature dispatches, halts by class, and ships are counted

As an operator, I want feature starts, halts (by class and step), and ships as counts over time so that halt rate is chartable and alertable and re-dispatch churn is visible.

### Acceptance Criteria

#### Happy Path
- Given the daemon dispatches feature S for the first time, when the dispatch begins, then conductor.feature.dispatches{feature=S, kind=initial} increments by 1
- Given feature S halts with class needs-human at step build_review and a halt record is written, when metrics are exported, then conductor.feature.halts{feature=S, haltClass=needs-human, step=build_review} reads 1
- Given the operator clears S's HALT and the daemon re-dispatches it, when the dispatch begins, then conductor.feature.dispatches{feature=S, kind=rekick} increments by 1
- Given feature S ships, when the shipped record is landed, then conductor.feature.shipped{feature=S} increments by 1

#### Negative Paths
- Given a halt whose HALT.class sidecar is missing, unreadable, or holds an unrecognized value, when it is recorded, then haltClass carries the existing disposition value unclassified, never an invented label and never an empty string
- Given a halt from a build older than the class sidecar, when it is recorded, then haltClass carries the existing disposition value legacy
- Given a halt whose sidecar holds kickback-cap or over-scope (the two operator-owned classes the conductor writes beyond the base HaltClass union), when it is recorded, then haltClass carries that value verbatim rather than folding it to unclassified, so operator-attention halts are never miscounted as unknown
- Given a feature is operator-parked, when metrics are exported, then it appears in conductor.daemon.backlog{state=parked} and increments neither conductor.feature.halts nor conductor.feature.shipped
- Given the daemon resumes a feature whose worktree already exists and which was not halted, when the dispatch begins, then kind is resume, not initial and not rekick
- Given the halt record write fails after the HALT marker was written, when metrics are exported, then conductor.feature.halts still increments from the loop_halt event and the metrics handler does not throw

### Done When
- [ ] A test drives initial, resume, and rekick dispatches and asserts the kind attribute on each
- [ ] A test covers every sidecar classification value on conductor.feature.halts: needs-human, mechanical, protected-artifact, plan-gap, kickback-cap, over-scope, legacy, and unclassified — a closed set of eight, no free text
- [ ] A test asserts a parked feature increments neither halts nor shipped and appears in backlog{state=parked}

## Story 5: Gate verdicts and kickbacks are counted per gate and per feature

As an operator deciding whether a gate is worth keeping, I want pass and fail counts per gate and kickback routing counts over time so that a gate's behavior can be compared across weeks from reported numbers.

### Acceptance Criteria

#### Happy Path
- Given gate build_review passes for feature S, when the verdict event is emitted, then conductor.gate.verdicts{feature=S, step=build_review, outcome=pass} increments by 1
- Given gate build_review fails for feature S and routes work back to build, when the events are emitted, then conductor.gate.verdicts{feature=S, step=build_review, outcome=fail} increments by 1 and conductor.gate.kickbacks{feature=S, from=build_review, to=build} increments by 1
- Given a build stalls with reason no_task_progress, when the stall event is emitted, then conductor.daemon.stalls{feature=S, reason=no_task_progress} increments by 1

#### Negative Paths
- Given a gate verdict is emitted on the feature bus during a daemon dispatch, when it reaches the daemon-level listener, then it is counted exactly once (the forwarded copy is counted, the original is not double-counted)
- Given a gate verdict for a step name outside the known gate set, when it is recorded, then the step attribute carries the step name verbatim and no error is raised
- Given the same gate fails three times in one dispatch, when metrics are exported, then verdicts{outcome=fail} reads 3, not 1

### Done When
- [ ] A test emits gate_verdict pass and fail plus a kickback and a build_stall through the daemon path and asserts each named instrument has exactly one data point with the expected attributes and value
- [ ] A test proves a forwarded gate_verdict is counted once

## Story 6: End-to-end feature duration is observable as wall-clock and active time

As an operator, I want how long a feature takes from first dispatch to ship, and how much of that was active engine time, so that the cost of waiting on humans and queues is visible.

### Acceptance Criteria

#### Happy Path
- Given feature S was first dispatched at T0 and ships at T1, when the ship is recorded, then conductor.feature.duration.wall{feature=S} has one observation of T1 minus T0 in milliseconds
- Given feature S's timing rollup reports an exact active total of A ms, when the ship is recorded, then conductor.feature.duration.active{feature=S} has one observation of A
- Given S halted for two days between two dispatches, when both durations are recorded, then wall exceeds active by at least those two days

#### Negative Paths
- Given the timing rollup reports state partial or unavailable, when the ship is recorded, then conductor.feature.duration.active has no data point for S (absent, never zero or a fabricated total) and conductor.feature.duration.wall is still recorded
- Given the worktree's conduct-state has no run_started_at, when the ship is recorded, then conductor.feature.duration.wall has no data point for S and the ship counter still increments
- Given a feature terminates by halt rather than ship, when the terminal is recorded, then neither duration histogram gains an observation

### Done When
- [ ] A test ships a feature with known run_started_at and an exact rollup and asserts both histograms have one observation with the expected values
- [ ] A test with a partial rollup asserts duration.active is absent (not zero) while duration.wall is present
- [ ] A test with no run_started_at asserts duration.wall is absent while feature.shipped still increments

## Story 7: Daemon-level signals ride the event spine and are persisted once

As a maintainer, I want the new daemon signals to be ordinary typed events that every existing consumer can see, persisted to a daemon ledger, with forwarded per-feature events never written twice.

### Acceptance Criteria

#### Happy Path
- Given the daemon completes a discovery tick, when the snapshot is emitted, then a daemon_backlog_snapshot event is appended to the daemon ledger at .daemon/events.jsonl in the same schema as .pipeline/events.jsonl
- Given the daemon dispatches or ships a feature, when the lifecycle point is reached, then feature_dispatch_started, feature_dispatch_ended, and feature_shipped events are emitted on the daemon bus and appended to the daemon ledger
- Given a step_completed is emitted on a feature bus and forwarded to the daemon bus, when the daemon's metrics listener records it, then the resulting conductor.step.duration data point carries that feature's slug as its feature attribute and the same attribute keys, unit, and name as the pre-change instrument
- Given the three new event types exist, when the event-sink registry is compiled, then each has a sink declaration row with otel true and the OTel subscription list derived from the registry includes them

#### Negative Paths
- Given a gate_verdict is emitted on a feature bus and forwarded to the daemon bus, when both ledgers are read, then the event appears once in that feature's .pipeline/events.jsonl and zero times in .daemon/events.jsonl
- Given a new event type is added to the union without a sink row, when the project compiles, then compilation fails naming the missing row
- Given a new event type has a sink row with otel true but no metrics-listener handler case, when the listener coverage test runs, then it fails naming the unhandled type
- Given the daemon ledger's directory is unwritable, when a snapshot is emitted, then the daemon logs the write failure once, the metrics are still recorded, and the loop continues

### Done When
- [ ] A test reads both ledgers after a forwarded event and asserts single persistence in the feature ledger only
- [ ] A test drives each of the four new event types through the daemon path and asserts the named instrument gains a data point
- [ ] A parity test asserts the listener-recorded instrument set (names, units, attribute keys) equals the pre-change visualizer-recorded set and step.duration agrees with the span duration within 5 ms
- [ ] The existing sink-registry exhaustiveness and OTel parity tests pass with the three new rows

## Story 8: The interactive run path is unchanged

As an operator running conduct interactively without a daemon, I want telemetry to behave exactly as it does today so that the daemon refactor cannot regress the single-run path.

### Acceptance Criteria

#### Happy Path
- Given OTel is enabled and conduct runs interactively, when the run completes, then the visualizer owns the TracerProvider, a metrics listener on the same run bus owns an interactive MeterProvider, the existing instruments are exported with unchanged names and attributes, and both providers are shut down on stop
- Given the interactive path, when the metric Resource is inspected, then service.instance.id is P/W with W resolved exactly as in Story 2 and per-feature data points still carry feature

#### Negative Paths
- Given the interactive path passes no spans-only flag, when the visualizer and listener initialize, then the listener constructs its own meter and the visualizer initializes without throwing on the absent flag
- Given the interactive listener owns its meter, when the run stops, then meterProvider.shutdown() is called exactly once

### Done When
- [ ] The existing interactive OTel wiring tests pass unchanged
- [ ] A test asserts the interactive listener shuts down its own meter on stop
