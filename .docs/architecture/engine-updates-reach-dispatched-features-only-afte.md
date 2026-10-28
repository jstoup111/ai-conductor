# Architecture: Per-dispatch engine pinning (#2392)

**Last updated:** 2026-10-15
**Scope:** The daemon supervisor/dispatcher, the process-separated feature executor pinned to one
`dist-versions/«id»`, the cadence fetch+rebuild job, engine-store GC protection, and per-feature
engine-version telemetry and status. Self-host and consumer daemons share the dispatch path; the
cadence rebuild applies where the daemon already owns engine rebuilds (self-host).

## Components (L3)

```mermaid
graph TD
    subgraph Supervisor["Daemon supervisor process — single generation, boot-pinned engine"]
        Loop["Claim loop (daemon.ts)"]
        Claims["WorkClaims"]
        WOB["WorkOrder builder<br/>baseSha + manifest + engineVersionId"]
        Resolver["engine-pin.ts resolveEnginePin<br/>dist symlink → «id» at claim time"]
        Launcher["child-feature-executor.ts<br/>fork dist-versions/«id»/index.js executor-child"]
        Broker["executor-broker.ts<br/>rate-limit, availability, live-boundary, worktree lock, events, logs"]
        Cadence["daemon-maintenance.ts job<br/>fetch + fast-forward + rebuild (gates armed)"]
        LBC["LiveBoundaryCoordinator"]
        RLE["RateLimitEpisode"]
    end

    subgraph Store["src/conductor engine store"]
        Current["dist symlink (current)"]
        Versions["dist-versions/«id» (immutable)"]
        GC["gcVersions<br/>protects current, live pidfiles, live executor pins"]
        ExecRec[".daemon/executors/«slug».json"]
    end

    subgraph Executor["Executor child process — one per in-flight feature"]
        Entry["executor-child.ts<br/>proxies + verifyWorkOrder"]
        Conductor["Conductor + step runner"]
    end

    subgraph Worktree[".worktrees/«slug»"]
        Order[".pipeline/work-order.json"]
        Events[".pipeline/events.jsonl"]
    end

    Status["daemon status (observe CLI)<br/>per-feature version vs current"]

    Loop --> Claims
    Loop --> WOB
    WOB --> Resolver
    Resolver --> Current
    Loop --> Launcher
    Launcher --> Versions
    Launcher --> Entry
    Launcher --> ExecRec
    GC --> ExecRec
    Status --> ExecRec
    Entry -->|"persist after worktree exists"| Order
    Broker -->|"WorkOrder after hello"| Entry
    Entry --> Conductor
    Conductor --> Events
    Entry <-->|"IPC channel"| Broker
    Broker --> LBC
    Broker --> RLE
    Broker --> Claims
    Cadence --> LBC
    Cadence -->|"publish-engine flip"| Current
    Cadence --> GC
    GC --> Versions
    Status -->|".daemon/events.jsonl feature_dispatch_started"| Events
    Status --> Current
```

## Sequence: rebuild lands while a feature is in flight

```mermaid
sequenceDiagram
    participant Disp as Claim loop
    participant Cad as Cadence job
    participant Store as Engine store (dist → «id»)
    participant ExA as Executor A (feature-a)
    participant ExB as Executor B (feature-b)
    participant Ev as .worktrees/«slug»/.pipeline/events.jsonl
    participant St as daemon status

    Disp->>Store: resolve dist → v1
    Disp->>ExA: spawn from dist-versions/v1 with WorkOrder(engineVersionId=v1)
    ExA->>Ev: executor_started (engineVersionId=v1)
    Cad->>Cad: interval elapsed, executors busy
    Cad->>Store: fetch + fast-forward + publish → flip dist to v2
    Note over ExA,Store: A keeps running v1, GC protects v1 while A's pin is live
    Disp->>Store: resolve dist → v2 at next claim
    Disp->>ExB: spawn from dist-versions/v2 with WorkOrder(engineVersionId=v2)
    ExB->>Ev: executor_started (engineVersionId=v2)
    St->>Ev: read per-feature engineVersionId
    St->>Store: read current → v2
    St-->>St: feature-a on v1 (older than current v2), feature-b current
    ExA-->>Disp: exit with outcome, claim released
```

## Legend

- **Supervisor** stays a single generation (adr-2026-07-07 D1). It still runs its boot-pinned
  engine; a drained self-restart remains only for changes to the supervisor/dispatcher code itself,
  never as the path by which features adopt a new engine.
- **Engine pin resolver** turns the floating `dist` symlink into a concrete immutable version id at
  claim time; that id travels in the WorkOrder beside `baseSha`. The supervisor sends the
  serialized order over IPC after an accepted hello; the child persists it to
  `.pipeline/work-order.json` once the worktree exists.
- **Executor child** is spawned from `dist-versions/«id»` directly (not through the `dist` symlink),
  so a later flip cannot change the engine under a running feature. The pin lasts one dispatch:
  a halted or parked feature re-dispatched later resolves the current build again.
- **Executor records** (`.daemon/executors/«slug».json`, written by the supervisor) name each
  live child's pid and engine dir; GC and `daemon status` read them.
- **IPC channel / broker**: dispatcher-owned shared services (rate-limit episode, live-boundary
  fingerprint windows, claim release) stay in the supervisor; the executor reaches them over a
  versioned message channel rather than shared memory.
- **Cadence job** runs only in a self-host daemon with the stale-engine gates armed, as background
  maintenance while executors are busy; root mutations are
  serialized against open live-boundary windows by the existing `LiveBoundaryCoordinator`.
- **GC** adds live executor pins to its protected set, fail-closed like the pidfile check.
- **Telemetry** uses the existing event spine: the executor stamps its engine version id onto a
  `ConductorEvent` in the feature's own `events.jsonl`; no sidecar file.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-15 | Initial generation | #2392 per-dispatch engine pinning |
