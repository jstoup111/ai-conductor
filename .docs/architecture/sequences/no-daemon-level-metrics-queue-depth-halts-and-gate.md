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
    participant L as DaemonMetricsListener
    participant B as beginFeatureRun
    participant V as OtelVisualizer (per dispatch)
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
    D->>B: beginFeatureRun(worktree «slug», item, recorder=M)
    B->>V: wire spans-only visualizer with shared recorder
    D->>C: runConductorInWorktree(...)
    C-->>V: step / gate / cost events on featureEvents
    V->>M: step.duration, step.retries, run.outcomes «feature»
    C-->>V: gate_verdict, kickback (forwarded to rootEvents)
    V-->>L: forwarded gate_verdict / kickback
    L->>M: gate.verdicts«feature,step,outcome», gate.kickbacks«feature,from,to»
    C-->>V: loop_halt + halt_record_written (forwarded)
    L->>M: feature.halts«feature,haltClass,step» and run.outcomes«halted» (incremented)
    D->>B: stop() → V flushes spans, M keeps running

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
- A daemon restart still resets counters — that is ordinary Prometheus counter semantics handled
  by `increase()`/`rate()`; the defect being fixed is a reset on every dispatch.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | DECIDE for #1937 |
