# Track: No daemon-level metrics: queue depth, halts and gate outcomes are events-only

Track: technical

Scope boundary: Comprehensive — (1) the daemon owns one long-lived MeterProvider/MetricsRecorder
per process; per-dispatch visualizers keep spans and record metrics onto the shared recorder, so
the existing eight instruments keep their names and `project`/`feature` labels but become
monotonic across dispatches (fixes the `run.outcomes` stuck-at-1 and `step.retries`/
`step.dispatches` reset defects). (2) New daemon-level instruments: `daemon.backlog{state}`,
`daemon.backlog.oldest_age{state}`, `daemon.slots{state}`, `daemon.inflight{feature}`,
`daemon.up`, `daemon.blocked_reason{reason}`, `daemon.poll.duration`, `daemon.stalls{feature,
reason}`. (3) New per-feature instruments: `feature.dispatches{feature,kind}`,
`feature.halts{feature,haltClass,step}`, `feature.shipped{feature}`,
`feature.duration.wall`, `feature.duration.active`, `gate.verdicts{feature,step,outcome}`,
`gate.kickbacks{feature,from,to}`. (4) Identity: `service.instance.id = <project>/<worker>` with
`project` and `worker` as data-point attributes on every instrument (`otel.worker_name` config,
default hostname); `feature` only on per-feature instruments. (5) Missing spine variants added
as typed events (backlog snapshot, feature dispatch start, feature shipped). Interactive
`conduct` runs (no daemon) keep today's single-visualizer behavior. Excluded: rubric-level gate
detail (#2374, separate PR), log export (#1935), OTLP auth (#1939), span/trace continuity across
dispatches (#2011), collector-side configuration, and any Grafana dashboard changes.

Telemetry/export infrastructure consumed by operators querying a metrics backend; no product
requirements — acceptance lives in stories. Operator confirmed 2026-09-06.
