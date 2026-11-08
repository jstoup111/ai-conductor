**Status:** Accepted

# Stories: A dispatch's OTel is projected by the engine that emitted its events

Technical track (no PRD). Source: jstoup111/ai-conductor#3646. Governing decisions:
adr-2026-11-07-child-projected-dispatch-otel D1–D9. It amends adr-2026-10-15-per-dispatch-engine-pinned-executor
D4 and adr-014-otel-observability-exporter D7. Architecture review:
`.docs/decisions/architecture-review-2026-11-07-newer-engine-child-events-vanish-from-otel-when-th.md`.
Scope boundary: `.docs/track/newer-engine-child-events-vanish-from-otel-when-th.md`.

Notation: a *skewed pair* is a child whose event registry declares an OTel event type that the
supervisor's registry lacks. *Accepted* means the child advertised the OTel projection capability
and the supervisor accepted it for that dispatch.

## Story 1: A newer child's spans reach the spool

**Requirement:** #3646 desired outcome 1; adr-2026-11-07-child-projected-dispatch-otel D1, D3, D8

As the operator, I want every span a child's engine traces to be exported even when the supervisor's engine predates that event type, so that a new engine's traces are never lost to an older supervisor.

### Acceptance Criteria

#### Happy Path
- Given an accepted skewed pair with the OTLP spool enabled, when the child emits the OTel-traced event type the supervisor lacks, then a span for that event is written to `.daemon/otel-spool/traces/` by the child, and the supervisor's drainer sends it.
- Given an accepted child with the spool enabled, when it exports spans, then it writes spool batch files, never acquires the spool lease, and never runs a spool drainer.
- Given an accepted child with the spool not enabled (`exporter: file`), when it emits OTel-traced events, then their spans are exported through the same exporter the supervisor-side visualizer would build for that config.

#### Negative Paths
- Given an accepted skewed pair, when the child emits the type the supervisor lacks, then the supervisor still neither renders nor persists that event, and the child's own `.pipeline/events.jsonl` keeps it.
- Given an accepted child whose spool batch write fails, when it exports a batch, then the failure takes the existing direct-send fallback with its bounded warning, and the child's feature run continues.
- Given an accepted child, when the supervisor attaches the child's proxy feature bus, then no supervisor-side span visualizer is attached to it, so no span is produced twice.

### Done When
- [ ] A skewed-pair dispatch test shows the unknown-to-supervisor traced type producing a span batch in the spool, written by the child.
- [ ] A test shows an accepted child holding no spool lease and running no drainer.
- [ ] A test shows no supervisor-side span visualizer attached for an accepted child.

## Story 2: A newer child's metrics are recorded on the supervisor's one meter

**Requirement:** #3646 desired outcome 1; adr-2026-11-07-child-projected-dispatch-otel D5, D6

As the operator, I want every metric a child's engine projects to be recorded on the daemon's single long-lived meter, so that a new engine's metrics are exported with the daemon's monotonic counters and identity.

### Acceptance Criteria

#### Happy Path
- Given an accepted skewed pair, when the child's metrics projection records a measurement for the event type the supervisor lacks, then the supervisor's `MeterProvider` exports that measurement.
- Given an accepted child recording `conductor.step.duration`, when the supervisor exports metrics, then the child's points and any supervisor-recorded points of that name form one metric stream, not two.
- Given an accepted child that sends a measurement whose `project`, `worker` or `feature` attribute differs from the supervisor's values, when the supervisor records it, then the exported point carries the supervisor's `project` and `worker` and the dispatch slug as `feature`.
- Given an accepted child, when it records a measurement, then the recording call returns without waiting on any response from the supervisor.

#### Negative Paths
- Given an accepted child, when its metrics projection creates an observable (asynchronous) instrument on the brokered meter, then creation throws and no measurement for it is sent.
- Given a malformed meter message from a child, when the broker receives it, then it is logged as a malformed executor message and nothing is recorded.
- Given a meter message that arrives after the child's attachment has closed, when the broker receives it, then it is discarded and nothing is recorded.

### Done When
- [ ] A skewed-pair dispatch test shows the unknown-to-supervisor metric exported from the supervisor's provider.
- [ ] A test shows the supervisor's identity attributes overriding child-sent `project`, `worker` and `feature` values.
- [ ] Tests show observable-instrument creation throws, malformed meter messages are dropped, and late meter messages are discarded.

## Story 3: Each dispatch is counted exactly once

**Requirement:** architecture review condition 3; adr-2026-11-07-child-projected-dispatch-otel D1, D7

As the operator, I want each step, run and dispatch to be counted once, whichever process projects it, so that moving projection into the child does not inflate any metric.

### Acceptance Criteria

#### Happy Path
- Given an accepted child that completes one step, when the supervisor exports metrics, then `conductor.step.duration` and `conductor.step.outcomes` each carry exactly one point for that step.
- Given an accepted child that emits `feature_complete`, when the supervisor then emits `feature_dispatch_ended`, then `conductor.run.outcomes` counts that run exactly once.
- Given an accepted child, when the supervisor emits `feature_dispatch_started` and `feature_dispatch_ended`, then `conductor.feature.dispatches` and the dispatch-end metrics are recorded once, by the supervisor.

#### Negative Paths
- Given an accepted child that exits without emitting `feature_complete` or `loop_halt`, when the supervisor emits `feature_dispatch_ended`, then `conductor.run.outcomes` counts that run once, from the supervisor's fallback.
- Given an accepted child emitting `feature_shipped`, when the event reaches the supervisor's root bus, then the supervisor records no shipment for it, and only the child's projection records `conductor.feature.shipped` once.

### Done When
- [ ] A dispatch test with an accepted child shows exactly one point per step for the step duration and outcome metrics.
- [ ] Tests show `conductor.run.outcomes` counted once both when the child closes the run and when it exits without closing it.

## Story 4: Mixed-version pairs keep complete supervisor-side telemetry

**Requirement:** #3646 desired outcome 2; adr-2026-11-07-child-projected-dispatch-otel D2

As the operator, I want a dispatch whose child or supervisor predates this change to keep today's complete supervisor-side telemetry, so that rolling the change out never drops or doubles a signal.

### Acceptance Criteria

#### Happy Path
- Given a child whose hello carries no OTel projection capability and whose OTel types are all known to the supervisor, when it runs a feature, then the supervisor projects its spans and metrics exactly as today, and every OTel event type it emits is exported.
- Given a capable child under a supervisor that does not accept the capability, when it runs a feature, then the child starts no span visualizer, sends no meter messages, and the supervisor's projection exports its events.
- Given a supervisor whose OTel is disabled, when a capable child dispatches, then the supervisor does not accept the capability, and the child projects nothing.

#### Negative Paths
- Given a capable child that receives a work order without acceptance, when it emits OTel events, then no span batch from that child appears in the spool, so nothing is projected twice.
- Given a capable child and an accepting supervisor, when the accepted work order is processed, then `EXECUTOR_PROTOCOL_VERSION` is unchanged and no `executor_protocol_mismatch` is emitted.

### Done When
- [ ] Dispatch tests cover the three pairings (capable with accepting, older child with accepting supervisor, capable child with non-accepting supervisor), showing one projector and complete export in each.
- [ ] A test shows a supervisor with OTel disabled never accepting the capability.

## Story 5: Child-local event types stay out of daemon telemetry

**Requirement:** #3646 desired outcome 3; adr-2026-11-07-child-projected-dispatch-otel D8

As the operator, I want event types that the child's engine marks as not OTel to stay out of daemon-level telemetry, so that the fix exports only what the emitting engine declares.

### Acceptance Criteria

#### Happy Path
- Given an accepted child whose registry declares a type with `otel: false`, when it emits that type, then neither process produces a span or a metric for it.

#### Negative Paths
- Given an accepted skewed pair whose child declares an unknown-to-supervisor type with `otel: false`, when it emits that type, then no span batch or measurement for it is produced, and the supervisor neither renders nor persists it.
- Given an accepted child whose registry declares a type with `otel: true` and `otelTrace: false`, when it emits that type, then a metric is recorded and no span is produced.

### Done When
- [ ] A test shows an `otel: false` type emitted by an accepted child producing no span and no measurement.
- [ ] A test shows a metrics-only type producing a measurement and no span.

## Story 6: The child's dispatch trace keeps its identity and flushes before dispatch end

**Requirement:** architecture review condition 1; adr-2026-11-07-child-projected-dispatch-otel D3, D4

As the operator, I want a child-projected trace to carry the same identity the supervisor-side trace carried and to be fully flushed before the dispatch ends, so that traces stay joinable and complete.

### Acceptance Criteria

#### Happy Path
- Given a resumed feature whose worktree holds `conduct-session-id` `s1`, when an accepted child traces its dispatch, then the trace's run id is `s1`, `service.version` is the installed released harness version, `conductor.engine.version` is the child's pinned `engineVersionId`, and the trace carries the order's `sourceRef`.
- Given an accepted child, when its feature finishes, then its span visualizer is stopped and flushed and every meter message is sent before its terminal outcome, and `feature_dispatch_ended` is emitted after that outcome.

#### Negative Paths
- Given an accepted child whose feature run throws, when the child reports the `error` outcome, then its span visualizer is still stopped and flushed before that outcome is sent.
- Given an initial dispatch with no feature worktree, when an accepted child traces it, then the trace uses a fresh run id.
- Given an accepted child with an open run span, when the supervisor sends it SIGTERM, then the child exports the root span with `conductor.run.outcome` `terminated` before it exits.

### Done When
- [ ] A dispatch test shows the child-projected trace's run id, `service.version`, engine version and `sourceRef`.
- [ ] Tests show the child's flush completing before its outcome on both the success and error paths.
- [ ] A test shows a SIGTERMed accepted child exporting its root span as `terminated`.
