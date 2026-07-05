# Components + Sequences: Daemon Event-Driven Wake for Parked (HALTED) Features

**Last updated:** 2026-07-04
**Scope:** Event-driven unpark of HALTED features in the conductor daemon — chokidar
`watchHaltCleared` seam, latched single-shot Waker racing the injected idle sleep, per-slug
watcher lifecycle, 60s poll backstop shared with new-spec discovery, `--no-watch` escape
hatch, and transition-only logging (issue jstoup111/ai-conductor#111).

## Component Diagram

```mermaid
graph TD
    subgraph cli ["daemon-cli.ts"]
        WIRE["dep wiring<br/>builds watchHaltCleared unless --no-watch"]
        TLOG["transition-only logger NEW<br/>per-slug last status plus fetch-failure onset/recovery"]
    end

    subgraph engine ["engine/"]
        CMD["daemon-command.ts<br/>--no-watch flag, idle-poll default 60s"]
        DMN["daemon.ts<br/>runDaemon idle loop plus Waker latch NEW"]
        DEPS["daemon-deps.ts<br/>watchHaltCleared seam NEW - chokidar"]
        BLOG["daemon-backlog.ts<br/>discoverBacklog accepts transition logger"]
    end

    HALT[".pipeline/HALT file<br/>per-slug park marker"]
    CHOK["chokidar watcher<br/>new dependency, fsevents external in tsup"]
    OPER["operator<br/>clears HALT after fixing cause"]

    CMD --> WIRE
    WIRE --> DMN
    WIRE --> TLOG
    DEPS --> CHOK
    CHOK -->|unlink event| DEPS
    DEPS -->|onCleared verified via exists| DMN
    DMN -->|register on park, dispose on re-dispatch and exit| DEPS
    DMN --> BLOG
    BLOG --> TLOG
    OPER -->|rm| HALT
    CHOK -.watches.-> HALT

    style DEPS fill:#e8f5e9,stroke:#2e7d32
    style DMN fill:#fff3e0,stroke:#ef6c00
    style CMD fill:#fff3e0,stroke:#ef6c00
    style WIRE fill:#fff3e0,stroke:#ef6c00
    style TLOG fill:#e8f5e9,stroke:#2e7d32
    style BLOG fill:#fff3e0,stroke:#ef6c00
```

## Sequence: event-driven unpark (fast path)

```mermaid
sequenceDiagram
    participant OP as operator
    participant CH as chokidar watcher
    participant DD as watchHaltCleared seam
    participant WK as Waker latch
    participant RL as runDaemon idle loop
    participant DISP as dispatch gate

    Note over RL: feature «slug» parked - watcher registered after parked.add
    RL->>RL: await race of sleep(60s) and waker.armed()
    OP->>OP: rm .pipeline/HALT for «slug»
    CH-->>DD: unlink event
    DD->>DD: re-verify via exists helper
    DD->>WK: wake()
    WK-->>RL: race resolves on waker arm (~1s, no network)
    RL->>RL: discoverBacklog refresh false - local scan only
    RL->>DISP: pickEligible - requires isHalted false and not inFlight
    DISP-->>RL: re-dispatch «slug»
    RL->>DD: dispose watcher for «slug» before runFeature teardown
    RL->>RL: log resume transition carrying prior status
```

## Sequence: backstop path (watcher missed or --no-watch)

```mermaid
sequenceDiagram
    participant RL as runDaemon idle loop
    participant BL as discoverBacklog
    participant GIT as git fetch
    participant DISP as dispatch gate

    Note over RL: no wake event arrives - event-hostile FS or --no-watch
    RL->>RL: sleep(60s) arm of the race resolves
    RL->>BL: discoverBacklog refresh true - full sweep
    BL->>GIT: fetch origin
    GIT-->>BL: new specs plus existing backlog (halted not processed)
    BL-->>RL: backlog including cleared «slug»
    RL->>DISP: pickEligible - isHalted false now
    DISP-->>RL: re-dispatch «slug» within one backstop interval
    Note over RL: correctness never depends on the watcher - poll always recovers
```

## Legend

- **Green** — new modules/surfaces (`watchHaltCleared` seam, Waker latch, transition-only logger).
- **Orange** — modified existing modules.
- The watcher is an **optimization, never dispatch authority**: `isHalted()` plus the
  `inFlight`/`started`/`parked` sets remain the sole re-dispatch gate. A missed, duplicate, or
  spurious event costs at most one extra no-op loop iteration.
- Wake arm = cheap local scan (`refresh:false`, no network). Timeout arm = periodic full
  `git fetch` sweep — one timer serves both HALT-clear backstop and new-spec discovery.
- `--no-watch --idle-poll 5` restores today's pure-polling responsiveness on event-hostile
  filesystems.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | DECIDE phase for intake #111 (engineer loop) |
