**Status:** Accepted

# Stories: Daemon-dispatched builds emit OTel telemetry via the shared visualizer seam

Source: jstoup111/ai-conductor#1934. Technical track (no PRD); criteria derive from the intake
outcomes and the approved architecture review (conditions C1-C3).

## Story 1: Daemon dispatch emits spans and metrics through the shared wiring seam

As an operator running builds through the daemon, I want each dispatched feature to export OTel spans and metrics so that dashboards reflect production build work, not only interactive runs.

### Acceptance Criteria

#### Happy Path
- Given OTel is enabled in resolved config, when the daemon dispatches a feature and its run emits step lifecycle events on the feature-scoped bus, then the OTLP exporter receives a run trace with per-step child spans and step duration/token metrics for that dispatch
- Given OTel is enabled, when both the interactive entry point and the daemon entry point wire telemetry, then both do so through the same shared wiring helper rather than duplicated inline blocks

#### Negative Paths
- Given OTel is enabled but the visualizer constructor throws (for example a disabled config passed by mistake), when the daemon wires a dispatch, then a renderer_error event is emitted, no visualizer attaches, and the dispatch proceeds normally
- Given the shared helper is wired only into one entry point in a hypothetical regression, when the parity test in Story 5 runs, then it fails naming the unwired path

### Done When
- [ ] A daemon-dispatched feature run against a local OTLP collector produces a conductor.run trace with per-step child spans and conductor_step_* metrics
- [ ] index.ts main() and daemon-cli.ts beginFeatureRun both call the one exported shared wiring helper (verified by test, not inspection)

## Story 2: Exported telemetry is attributable to feature, project, and durable run id

As a telemetry consumer, I want every span and data point to carry feature, project, and run identity so that I can tell which feature and project it came from without reading local files.

### Acceptance Criteria

#### Happy Path
- Given a daemon dispatch for feature slug S in project P, when telemetry is exported, then its resource carries conductor.feature=S, conductor.project=P, and a non-empty conductor.run.id
- Given a feature worktree whose .pipeline/conduct-session-id exists from a prior dispatch, when a later daemon process re-dispatches the feature, then the exported conductor.run.id equals the durable file's id, stitching both dispatches

#### Negative Paths
- Given a fresh worktree where .pipeline/conduct-session-id does not exist yet at wiring time, when the daemon path resolves the run id, then it uses the caller-injected dispatch session id and does not write .pipeline/conduct-session-id (the step runner remains that file's only writer)
- Given the worktree's .pipeline directory is unreadable, when the daemon path resolves the run id, then resolution degrades to the injected id without throwing and the dispatch proceeds

### Done When
- [ ] A test asserts daemon-path resource attributes carry feature slug, project, and a run id equal to the pre-existing conduct-session-id content when present
- [ ] A test asserts the daemon-path wiring performs no write to .pipeline/conduct-session-id when the file is absent

## Story 3: Telemetry flushes when a dispatch ends, including HALT and error

As an operator, I want the tail of a feature run's telemetry to reach the exporter even when the run halts or errors so that failed runs are visible, not just clean ones.

### Acceptance Criteria

#### Happy Path
- Given an attached per-dispatch visualizer, when the dispatch completes cleanly and its feature scope stop runs, then the visualizer's stop is awaited and force-flushes traces and metrics before the scope is torn down

#### Negative Paths
- Given an attached per-dispatch visualizer, when the dispatch ends in HALT or a thrown error, then the same stop path runs and the final events emitted before the halt are flushed to the exporter
- Given the exporter endpoint hangs during the final flush, when stop runs, then stop resolves within the visualizer's bounded flush behavior and the daemon continues to its next dispatch
- Given two signals or a repeated stop during flush, when stop is invoked again, then the second invocation returns the existing stop promise and no second flush starts

### Done When
- [ ] A test drives a dispatch that halts and asserts events emitted before the halt are present in the exporter output
- [ ] A test asserts beginFeatureRun's returned stop awaits the visualizer stop (flush) before detaching persistence

## Story 4: Disabled or degraded OTel never changes daemon behavior

As an operator without an OTel collector, I want the daemon to behave exactly as before so that telemetry stays strictly opt-in and non-fatal.

### Acceptance Criteria

#### Happy Path
- Given no otel block or a disabled otel config, when the daemon dispatches features, then no visualizer is constructed, no OTel dependency work runs, and dispatch behavior and log output are unchanged

#### Negative Paths
- Given OTel enabled with an unreachable endpoint, when a dispatch emits events, then export failures surface as bounded renderer_error warnings on the bus and the build's outcome is unaffected
- Given OTel enabled with an invalid config value, when config resolves, then resolution yields enabled false with an error message and the daemon runs as if OTel were absent

### Done When
- [ ] A test asserts a daemon dispatch with otel absent constructs no visualizer and produces byte-identical event handling
- [ ] A test asserts an unreachable endpoint yields renderer_error warnings while the dispatch completes successfully

## Story 5: A parity test fails when a signal reaches one path's exporter but not the other

As a maintainer, I want a cross-path parity guard so that a third entry point or a drifted subscription list cannot silently lose daemon telemetry again.

### Acceptance Criteria

#### Happy Path
- Given the interactive and daemon wiring paths, when the parity test emits each telemetry-relevant event type through both paths, then both exporters observe the same signal set and the test passes
- Given the shared helper's subscription set, when it is constructed, then the set derives from the EVENT_SINKS registry rather than a hand-maintained literal list

#### Negative Paths
- Given a telemetry-relevant event type reaching the interactive exporter but not the daemon path, when the parity test runs, then it fails naming the missing event type
- Given a new ConductorEvent type is added to EVENT_SINKS with telemetry relevance, when the parity test runs without updating the helper, then derivation keeps both paths in sync and the test still passes

### Done When
- [ ] A committed test fails when a signal reaches the interactive path's exporter but not the daemon path's
- [ ] The existing beginFeatureRun EVENT_SINKS derivation acceptance guard still passes with the new wiring
