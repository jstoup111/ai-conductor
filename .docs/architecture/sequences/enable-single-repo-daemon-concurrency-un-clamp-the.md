# Sequence: Two concurrent feature builds in one daemon (N=2)

**Last updated:** 2026-08-27
**Scope:** The target dispatch flow for issue #568 — claim, work-order manifest, concurrent executors, non-starving shared maintenance, and interleaving-correct live-boundary windows.

## Diagram

```mermaid
sequenceDiagram
    participant D as Dispatcher
    participant C as WorkClaims
    participant M as Maintenance scheduler
    participant A as Executor «slug-a»
    participant B as Executor «slug-b»
    participant R as Root checkout / .daemon

    D->>D: backlog scan (merged specs)
    D->>C: claim(«slug-a»)
    C-->>D: claimed
    D->>A: WorkOrder «slug-a» (base SHA S1, manifest refs+hashes)
    activate A
    A->>A: materialize workspace from S1, build feature
    D->>C: claim(«slug-b»)
    C-->>D: claimed
    D->>B: WorkOrder «slug-b» (base SHA S1, manifest refs+hashes)
    activate B
    B->>B: materialize workspace from S1, build feature

    Note over M,R: shared ops no longer wait for full idle
    M->>R: fetch + fast-forward root (S1 to S2)
    Note over D: in-flight orders stay pinned to S1,<br/>new orders pin S2

    A-->>D: result «slug-a» (shipped)
    deactivate A
    D->>C: release(«slug-a»)

    Note over D,R: self-host: per-dispatch fingerprint/verify windows<br/>coordinated so B's window never blames A's writes

    M->>M: stale-engine detected
    M->>D: request drain (no new claims)
    B-->>D: result «slug-b» (shipped)
    deactivate B
    D->>C: release(«slug-b»)
    M->>R: rebuild engine + restart daemon
```

## Legend

- `«slug»` is a per-feature placeholder.
- WorkOrder is a serializable struct; executors receive identities and a document manifest, never root paths or live objects.
- At the default concurrency of 1 this flow degenerates to today's serial daemon: one claim at a time and maintenance runs between builds exactly as it does now.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-27 | Initial N=2 dispatch sequence | DECIDE architecture for issue #568 |
