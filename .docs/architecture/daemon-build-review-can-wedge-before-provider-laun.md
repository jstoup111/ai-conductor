# Components and Sequence: Provider Lifecycle Supervision

**Last updated:** 2026-07-30
**Scope:** Bounded supervision from provider preparation through process activity, recovery, and durable halt for every daemon-managed provider step

## Component Diagram

```mermaid
flowchart LR
    DAEMON["Daemon feature run"]
    STEP["Step runner<br/>all provider-aware steps"]

    subgraph supervisor["Shared provider-execution lifecycle boundary"]
        ATTEMPT["provider-lifecycle.ts<br/>attempt identity + state"]
        PREP["Preparing lease<br/>5-minute default, configurable"]
        RUN["Running state<br/>activity telemetry only"]
        RECOVERY["Recovery coordinator<br/>cancel + fence + retry budget"]
        HALT["Durable mechanical HALT<br/>reason + attempt identity"]

        ATTEMPT --> PREP
        PREP --> RUN
        PREP --> RECOVERY
        RUN --> RECOVERY
        RECOVERY --> HALT
    end

    subgraph candidates["Provider candidate execution"]
        SELECT["Candidate resolution<br/>session + self-host preparation"]
        CLAUDE["Claude adapter"]
        CODEX["Codex adapter"]
        CUSTOM["Custom provider adapter"]
    end

    TELEMETRY["Existing event + interval infrastructure<br/>preparing / running / recovering"]
    STATUS["Daemon status + logs"]

    DAEMON --> STEP
    STEP --> ATTEMPT
    PREP --> SELECT
    SELECT --> CLAUDE
    SELECT --> CODEX
    SELECT --> CUSTOM
    CLAUDE -->|spawn + activity| RUN
    CODEX -->|spawn + activity| RUN
    CUSTOM -->|shared callback contract| RUN
    ATTEMPT --> TELEMETRY
    PREP --> TELEMETRY
    RUN --> TELEMETRY
    RECOVERY --> TELEMETRY
    HALT --> TELEMETRY
    TELEMETRY --> STATUS
```

## Sequence: Preparation Stall and Safe Replacement

```mermaid
sequenceDiagram
    participant S as Step runner
    participant L as Lifecycle supervisor
    participant E as Provider execution
    participant P as Provider adapter
    participant D as Daemon recovery

    S->>L: begin attempt «A»
    L->>E: run candidate under preparing lease
    E->>E: resolve provider, session, and candidate safety
    Note over E: preparation wedges before subprocess spawn
    L->>L: preparation deadline expires
    L->>E: cancel attempt «A»
    L->>L: fence attempt «A» against future spawn
    L->>D: recovery reason + attempt «A»
    alt retry budget remains
        D->>L: begin replacement attempt «B»
        L->>E: run candidate under preparing lease
        E->>P: spawn requested for attempt «B»
        P-->>L: spawn handle for attempt «B»
        L->>L: transition «B» to running
        P-->>L: provider activity
        L->>L: refresh running lease
        P-->>E: provider result
        E-->>S: completed result
    else retry budget exhausted
        D->>L: write durable HALT
        L-->>S: terminal diagnostic
    end
    opt superseded attempt «A» resumes late
        E->>P: spawn requested for attempt «A»
        L-->>P: reject and terminate stale spawn
    end
```

## Architectural Boundaries

- The lifecycle supervisor owns timeout policy and attempt authority; provider adapters only expose spawn, activity, and termination capabilities.
    - Preparation begins before candidate resolution, session preparation, self-host preparation, or provider invocation, so every pre-spawn await is bounded.
- Attempt identity is checked synchronously through a provider-neutral spawn permit immediately before process creation. A superseded attempt cannot create a live worker after recovery starts.
- Once spawned, output activity is telemetry only. Silence cannot terminate or replace a live provider, and recovery never depends on discovering the process through operating-system inspection.
- Recovery uses a bounded budget and ends in a durable diagnostic halt rather than an unbounded redispatch loop.
- Lifecycle records are feature-scoped and drive both daemon status and logs without becoming completion authority.

## Legend

- Solid arrows show lifecycle ownership and provider execution flow.
- “Lease” means bounded liveness evidence, not a lock shared across features.
- Guillemets denote runtime identities.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-30 | Added concrete supervisor module, five-minute default, and existing event/interval reuse | Plan-update mode: reflect the approved 20-task dependency chain |
| 2026-07-30 | Initial feature architecture | Define the approved shared lifecycle-supervisor approach for issue #1141 |
