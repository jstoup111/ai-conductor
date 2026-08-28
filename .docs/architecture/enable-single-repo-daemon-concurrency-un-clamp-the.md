# Components: Daemon dispatcher/executor seam and N-worker un-clamp

**Last updated:** 2026-08-27
**Scope:** The daemon orchestration core affected by issue #568 — the worker pool in `engine/daemon.ts`, the concurrency clamp, the idle-gated shared operations, the self-host live boundary, and the new dispatcher/executor contract.

## Current architecture

```mermaid
graph TD
    CLI["daemon-cli.ts<br/>runDaemonMode"]
    CLAMP["clampDaemonConcurrency<br/>always returns 1"]
    POOL["daemon.ts run loop<br/>fill to concurrency, Promise.race"]
    BACKLOG["discoverBacklog<br/>refresh + fastForwardRoot"]
    IDLE["idle branch<br/>inFlight.size === 0 only"]
    SWEEPS["sweepBestEffort<br/>halt/park/scratch/labels"]
    STALE["stale-engine rebuild + restart"]
    RUNF["runFeature<br/>in-process conductor in worktree"]
    LB["live boundary<br/>fingerprint + verify per dispatch"]
    ROOT[("root checkout<br/>+ .daemon/ state")]
    WT[("per-slug worktree<br/>+ .pipeline/")]

    CLI --> CLAMP --> POOL
    POOL -->|"slot"| RUNF --> WT
    RUNF --> LB --> ROOT
    POOL --> IDLE
    IDLE --> BACKLOG --> ROOT
    IDLE --> SWEEPS --> ROOT
    IDLE --> STALE --> ROOT

    style CLAMP fill:#c62828,color:#ffffff
    style IDLE fill:#ef6c00,color:#ffffff
```

The pool is already N-capable, but the clamp forces serial execution and every shared operation
(root fast-forward, backlog refresh, sweeps, stale-engine recovery, queued restarts) hides behind
`inFlight.size === 0` — correct at N=1, starvation at N>1. `runFeature` couples execution to the
daemon's own process state, root paths, and `.daemon/` files, so no dispatcher/executor boundary
exists.

## Target architecture

```mermaid
graph TD
    subgraph DISPATCHER["Dispatcher (owns shared repo state)"]
        BACKLOG2["backlog scan<br/>merged-spec discovery"]
        CLAIMS["WorkClaims interface<br/>in-memory impl v1"]
        ORDER["WorkOrder builder<br/>slug + base SHA + document manifest"]
        SCHED["maintenance scheduler<br/>quiesce/drain policies, not idle-only"]
        FF["root fast-forward + refresh"]
        STALE2["stale-engine rebuild + restart<br/>drain-then-act"]
        SWEEPS2["periodic sweeps"]
        LBC["live-boundary coordinator<br/>interleaving-correct windows"]
        ROOT2[("root checkout<br/>+ .daemon/ state")]
    end

    subgraph EXECUTORS["Executors (one feature build each)"]
        EX1["FeatureExecutor «slug-a»<br/>in-process v1"]
        EX2["FeatureExecutor «slug-b»<br/>in-process v1"]
        WS1[("workspace «slug-a»<br/>worktree + .pipeline/")]
        WS2[("workspace «slug-b»<br/>worktree + .pipeline/")]
    end

    CFG["config: daemon concurrency key<br/>default 1 = serial, byte-for-byte"]
    LOGS["slug-attributed logs + events<br/>per-executor scoped bus"]

    CFG --> CLAIMS
    BACKLOG2 --> CLAIMS
    CLAIMS -->|"claim(slug)"| ORDER
    ORDER -->|"serializable WorkOrder<br/>(manifest refs + hashes)"| EX1
    ORDER -->|"serializable WorkOrder"| EX2
    EX1 --> WS1
    EX2 --> WS2
    EX1 --> LOGS
    EX2 --> LOGS
    SCHED --> FF --> ROOT2
    SCHED --> STALE2 --> ROOT2
    SCHED --> SWEEPS2 --> ROOT2
    LBC --> ROOT2
    EX1 -.->|"never reads root or .daemon/"| ROOT2
    EX2 -.->|"never reads root or .daemon/"| ROOT2

    style CLAIMS fill:#2e7d32,color:#ffffff
    style ORDER fill:#2e7d32,color:#ffffff
    style SCHED fill:#2e7d32,color:#ffffff
    style LBC fill:#2e7d32,color:#ffffff
    style CFG fill:#2e7d32,color:#ffffff
```

## Component responsibilities

| Component | Responsibility |
|---|---|
| WorkClaims | Claim/release lifecycle for feature slugs; dedup authority. Interface designed for a durable future implementation; v1 ships in-memory only (single process keeps it authoritative). |
| WorkOrder builder | Assemble a serializable work order: slug, repo identity, pinned base SHA, and a document manifest (spec/plan artifact refs + content hashes). Git-resolvable today; the contract does not require the documents to be in git. |
| FeatureExecutor | Execute exactly one work order in its own workspace. Process-separable contract; v1 implementation runs in-process (wraps today's `runFeature`). Never touches the root checkout or `.daemon/`. |
| Maintenance scheduler | Run shared root operations under explicit policies instead of the `inFlight.size === 0` gate: base-SHA pinning lets refresh/fast-forward run while executors are busy; stale-engine restart drains executors first. |
| Live-boundary coordinator | Dispatcher-side ownership of self-host fingerprint/verify windows, correct under interleaved executor dispatch boundaries (no cross-executor false halts). |
| Concurrency config key | Explicit operator opt-in; resolver + validation in the config allowlist; replaces the unconditional clamp. Default 1 preserves today's serial behavior byte-for-byte. |
| Slug-attributed logging | Extend the existing per-feature loggers/scoped event buses to the remaining unattributed sinks (process-level warn/error tee, global bus subscriber) so interleaved worker output stays triageable. |

## Legend

- Green nodes are new seams introduced by this feature.
- Red marks the clamp being removed; orange marks the idle-only gate being replaced with policies.
- Dashed arrows are prohibitions the seam enforces, not data flows.
- `«slug»` denotes a per-feature placeholder.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-27 | Initial current/target component flow | DECIDE architecture for issue #568 (dispatcher/executor seam + un-clamp, topology B destination) |
