# Sequence: Daemon dispatch with per-feature OTel visualizer

**Last updated:** 2026-08-26
**Scope:** Lifecycle of one daemon feature dispatch with OTel enabled — attach, emit, and
flush-on-end (clean, HALT, or error). Source: #1934.

## Diagram

```mermaid
sequenceDiagram
    participant D as daemon loop
    participant B as beginFeatureRun
    participant W as wireOtelVisualizer (shared seam)
    participant V as OtelVisualizer
    participant C as Conductor (feature run)
    participant O as OTLP endpoint

    D->>B: beginFeatureRun(worktree «slug», item)
    B->>W: wire(config, worktree .pipeline/, featureEvents)
    alt otel enabled
        W->>V: createOtelVisualizer(resolved, ctx)
        Note over V: resource: conductor.run.id from<br/>«worktree»/.pipeline/conduct-session-id (durable),<br/>conductor.feature=«slug», conductor.project
        W->>V: start(featureEvents)
    else disabled / absent
        W-->>B: null — daemon behavior unchanged
    end
    D->>C: runConductorInWorktree(...)
    C-->>V: step/gate/token events on featureEvents
    V--)O: spans + metrics (periodic)
    Note over V,O: unreachable endpoint → onWarning →<br/>renderer_error event (bounded), build unaffected
    alt clean finish
        C-->>D: done
    else HALT or error
        C-->>D: halt / throw
    end
    D->>B: stop()
    B->>V: await stop()
    V->>O: forceFlush (traces + metrics)
    Note over V: unregister SIGINT/SIGTERM handlers<br/>(idempotent stop)
    B->>B: detach renderers + persistence
```

## Legend

- Flush rides `beginFeatureRun`'s existing `stop()`, which the daemon already invokes on every
  dispatch end — so HALT and error paths flush without new plumbing.
- A later re-dispatch of the same feature repeats this sequence in a possibly different daemon
  process; the durable `conduct-session-id` gives both dispatches the same `conductor.run.id`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1934 |
