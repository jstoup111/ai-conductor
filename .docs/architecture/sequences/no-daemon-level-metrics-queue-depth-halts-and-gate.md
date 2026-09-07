# Sequence: Daemon lifetime with a shared meter and daemon-level metrics

**Last updated:** 2026-09-06
**Scope:** One daemon process from start to stop — idle ticks emitting backlog gauges with no
dispatch, a feature dispatch recording onto the shared meter, a halt, a re-dispatch, and a ship.
Source: #1937.

## Diagram

```mermaid
sequenceDiagram
    participant D as daemon loop
    participant W as wireDaemonOtel
    participant M as shared MeterProvider + MetricsRecorder
    participant L as MetricsListener (records every metric)
    participant B as beginFeatureRun
    participant V as OtelVisualizer (per dispatch, spans only)
    participant C as Conductor (feature run)
    participant O as OTLP endpoint

    D->>W: wireDaemonOtel(config, «project»/«worker», rootEvents)
    alt otel enabled
        W->>M: create MeterProvider (identity: project, worker)
        W->>L: subscribe to rootEvents
    else disabled / absent
        W-->>D: null — daemon behavior unchanged
    end

    loop every poll tick (idle or busy)
        D->>D: discoverBacklog → items/waiting/blocked/gated + parked + slots
        D->>L: daemon_backlog_snapshot (counts, oldest ages, slots, blocked reasons, poll ms)
        L->>M: daemon.backlog«state», oldest_age, slots, inflight, blocked_reason, poll.duration, up=1
        M--)O: periodic export (60 s) — series exist with no dispatch
    end

    D->>L: feature_dispatch_started («slug», kind=initial)
    L->>M: feature.dispatches«feature,kind»
    D->>B: beginFeatureRun(worktree «slug», item)
    B->>V: wire spans-only visualizer (metrics false, no MeterProvider)
    D->>C: runConductorInWorktree(...)
    C-->>V: step / gate / cost events on featureEvents (spans)
    C-->>L: every feature event forwarded to rootEvents, tagged with «slug»
    L->>M: step.duration, step.retries, step.dispatches, cost gauges «feature»
    L->>M: gate.verdicts«feature,step,outcome», gate.kickbacks«feature,from,to»
    C-->>L: loop_halt (forwarded) and the daemon reads the HALT.class sidecar
    L->>M: feature.halts«feature,haltClass,step» and run.outcomes«halted» (incremented)
    D->>L: feature_dispatch_ended («slug», outcome=halted)
    D->>B: stop() → V flushes spans, M is force-flushed and keeps running

    Note over D,M: operator clears HALT and the daemon re-dispatches in the SAME process
    D->>L: feature_dispatch_started («slug», kind=rekick)
    L->>M: feature.dispatches«feature,kind=rekick» — counter continues, never resets
    D->>C: second dispatch, which ships
    D->>L: feature_shipped («slug», startedAt, activeMs)
    L->>M: feature.shipped, feature.duration.wall, feature.duration.active

    D->>W: daemon stop
    W->>M: forceFlush + shutdown
    M->>O: final export
```

## Legend

- The idle loop is the point of the feature: backlog, slots, and `daemon.up` series exist while
  nothing is dispatched.
- The re-dispatch after a halt lands on the **same** `MetricsRecorder`, so per-feature counters
  (`run.outcomes`, `feature.halts`, `feature.dispatches`) accumulate instead of restarting at zero.
- The listener only ever sees events. A dispatch that ran in a process that has since exited — or,
  later, on a remote worker — contributes exactly the same way, because nothing it recorded lived
  in that process.
- A daemon restart still resets counters — that is ordinary Prometheus counter semantics handled
  by `increase()`/`rate()`; the defect being fixed is a reset on every dispatch.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | DECIDE for #1937 |
| 2026-09-06 | Listener records every metric; visualizer spans-only | Operator-directed revision for remote/ephemeral workers |
