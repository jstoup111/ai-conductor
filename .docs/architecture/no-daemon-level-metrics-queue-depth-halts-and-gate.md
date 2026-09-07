# Components: Daemon-owned meter and daemon-level metrics

**Last updated:** 2026-09-06
**Scope:** Where metrics are recorded after #1937 — one long-lived `MeterProvider` and
`MetricsRecorder` owned by the daemon process, shared by every per-dispatch OTel visualizer
(which keeps owning spans), plus the daemon-scoped listener that turns backlog snapshots,
dispatch starts, halts, ships, and gate verdicts into daemon-level and per-feature instruments.
Interactive `conduct` runs (no daemon) are unchanged.

## Diagram

```mermaid
graph TD
    subgraph daemon["Daemon process (daemon-cli.ts / daemon.ts) — lives across dispatches"]
        loop["daemon loop<br/>discoverBacklog per tick"]
        rbus["daemon bus (root events)"]
        dwire["wireDaemonOtel(config, ctx, rootEvents) — NEW"]
        meter["MeterProvider + MetricsRecorder — NEW owner<br/>resource: service.instance.id = «project»/«worker»<br/>data-point attrs: project, worker (+ feature on per-feature instruments)"]
        dlistener["DaemonMetricsListener — NEW<br/>daemon_backlog_snapshot → daemon.backlog / oldest_age / slots / inflight / blocked_reason / poll.duration<br/>feature_dispatch_started → feature.dispatches«kind»<br/>loop_halt + halt_record_written → feature.halts«haltClass,step»<br/>feature_shipped → feature.shipped + feature.duration.wall/active<br/>gate_verdict / kickback / build_stall → gate.verdicts / gate.kickbacks / daemon.stalls<br/>heartbeat → daemon.up"]
        bfr["beginFeatureRun(worktree, item)"]
        fbus["per-feature bus (persistence.events)"]
        fwd["forward selected feature events → daemon bus — NEW<br/>(gate_verdict, kickback, loop_halt, halt_record_written, build_stall, feature_complete)"]
        vis["OtelVisualizer (per dispatch)<br/>spans only: own TracerProvider<br/>metrics: records onto the SHARED recorder (no own MeterProvider)"]
        dpers["daemon EventPersister — NEW<br/>«mainRoot»/.daemon/events.jsonl (same schema)<br/>skips forwardedFromFeature-tagged events"]
    end

    subgraph spine["Event spine (extended)"]
        ev["ConductorEvent union + EVENT_SINKS<br/>NEW variants: daemon_backlog_snapshot,<br/>feature_dispatch_started, feature_shipped"]
    end

    subgraph interactive["Interactive entry (index.ts) — unchanged"]
        ivis["OtelVisualizer with its own MeterProvider<br/>(single run, single process)"]
    end

    otlp["OTLP endpoint / file exporter"]

    loop -->|"emit daemon_backlog_snapshot each tick"| rbus
    loop -->|"emit feature_dispatch_started / feature_shipped"| rbus
    rbus --> dlistener
    rbus --> dpers
    dwire --> meter
    dwire --> dlistener
    dlistener --> meter
    bfr --> fbus
    fbus --> vis
    fbus --> fwd
    fwd --> rbus
    vis -->|"step.duration, step.retries, step.dispatches,<br/>feature.cost/step.cost/step.tokens, closeout.duration, run.outcomes"| meter
    meter -->|"PeriodicExportingMetricReader (60 s)"| otlp
    vis -->|"spans (BatchSpanProcessor)"| otlp
    ivis --> otlp
    ev -.-> rbus
    ev -.-> fbus
```

## Legend

- **NEW owner** — the daemon constructs the one `MeterProvider`; it lives for the daemon's life, so
  every counter recorded on it is monotonic across re-dispatches. This is what fixes
  `conductor.run.outcomes` (stuck at 1.0) and `conductor.step.retries` (resets per dispatch).
- **Per-dispatch visualizer** — still one per feature dispatch on the feature bus, still owns the
  `TracerProvider` (spans are per-run by nature, `conductor.run.id` stays on the trace resource).
  It receives the shared `MetricsRecorder` handle from `beginFeatureRun` instead of building its
  own meter.
- **Forwarding** — the per-feature events the daemon-level listener needs are re-emitted onto the
  daemon bus (one listener per bus, adr-014 D1). Forwarded events are not re-persisted; the
  per-feature `events.jsonl` remains their ledger.
- **Identity** — `service.instance.id = «project»/«worker»`; `worker` defaults to hostname and is
  overridable by `otel.worker_name`. Backlog gauges report the same value from every worker of a
  project (query with `max by (project)`); slots/inflight are per-worker (`sum`).
- **Interactive path** — no daemon, no shared meter; the existing single-visualizer wiring is
  byte-for-byte unchanged in behavior.
- Disabled/absent OTel config → `wireDaemonOtel` returns null and `beginFeatureRun` passes no
  recorder; daemon behavior unchanged.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | DECIDE for #1937 (daemon-level metrics) |
| 2026-09-06 | Added daemon EventPersister node | Plan update (architecture-review condition C6) |
