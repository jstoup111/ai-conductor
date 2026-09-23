# Components: Park honored at every provider dispatch

**Last updated:** 2026-09-22
**Scope:** How the daemon-injected operator-park predicate reaches each provider dispatch inside a running
step, and how `daemon park` reports whether work is still running for the slug. Covers intake
`jstoup111/ai-conductor#2103` and PRD `.docs/specs/daemon-park-does-not-stop-retries-inside-an-alread.md`.

## Current state (defective)

The park predicate is consulted before each scheduling unit (serial step or parallel group), plus
before a self-host dispatch. The serial retry loop re-enters the dispatch site on every `continue`.
Only the self-host branch checks park there, so an ordinary build keeps launching attempts after a
park.

```mermaid
graph TD
    subgraph Daemon
        CLI["daemon-park-cli.ts<br/>writes the park marker, prints Parked"]
        INJ["daemon-cli.ts<br/>injects operatorParkBoundary"]
    end

    subgraph "Durable — main repo root"
        MARK[".daemon/parked/«slug»"]
    end

    subgraph "conductor.ts — one scheduling unit"
        UNIT["pre-unit gate<br/>stopAtOperatorParkBoundary"]
        LOOP["serial retry loop<br/>budgeted and free continue paths"]
        SITE["per-attempt dispatch site"]
        SH["runSelfBuildDispatch<br/>park check inside liveBoundaryCoordinator only"]
        SR["stepRunner.run<br/>no park check"]
    end

    PROV["Provider process"]

    CLI --> MARK
    MARK --> INJ
    INJ --> UNIT
    UNIT --> LOOP
    LOOP --> SITE
    SITE -->|self-host| SH
    SITE -->|every other build| SR
    SH --> PROV
    SR -->|"attempt 2, 3, ... after park"| PROV
    LOOP -.->|"continue: no park check"| SITE

    classDef bad fill:#fdd,stroke:#c00,stroke-width:2px
    class SR bad
```

## Target state

One pre-attempt park check sits at the per-attempt dispatch seam, above the self-host/ordinary fork.
It covers every serial attempt, budgeted or free, and every parallel-group member attempt. A declined
attempt returns the existing typed operator-parked stop and emits a spine event. `daemon park` reads
the feature's persisted provider-attempt events through the dashboard projection that already exists,
and reports running, stopped, or unknown.

```mermaid
graph TD
    subgraph Daemon
        CLI["daemon-park-cli.ts<br/>writes marker, then reports running work"]
        INJ["daemon-cli.ts<br/>injects operatorParkBoundary"]
        PROJ["daemon-dashboard.ts<br/>provider_attempt lifecycle projection"]
        LOCK["daemon-lock.ts<br/>daemon liveness"]
    end

    subgraph "Durable — main repo root"
        MARK[".daemon/parked/«slug»"]
    end

    subgraph "Worktree spine"
        EV[".pipeline/events.jsonl"]
    end

    subgraph "conductor.ts"
        UNIT["pre-unit gate — unchanged"]
        LOOP["serial retry loop"]
        GATE["pre-attempt park gate<br/>fail toward parked"]
        MEM["parallel group member attempt"]
        DISP["self-host or ordinary dispatch"]
    end

    PROV["Provider process"]

    CLI --> MARK
    MARK --> INJ
    INJ --> UNIT
    INJ --> GATE
    UNIT --> LOOP
    LOOP --> GATE
    MEM --> GATE
    GATE -->|not parked| DISP
    DISP --> PROV
    GATE -->|parked| EV
    DISP -->|provider_attempt events| EV
    CLI --> PROJ
    PROJ --> EV
    CLI --> LOCK

    classDef new fill:#dfd,stroke:#080,stroke-width:2px
    class GATE,PROJ new
```

## Sequence: park lands mid-step

```mermaid
sequenceDiagram
    participant Op as Operator
    participant Park as daemon park
    participant Marker as park marker
    participant Cond as conductor retry loop
    participant Gate as pre-attempt gate
    participant Prov as provider
    participant Spine as events.jsonl

    Cond->>Gate: attempt N
    Gate->>Marker: parked?
    Marker-->>Gate: no
    Gate->>Prov: dispatch attempt N
    Prov->>Spine: provider_attempt running
    Op->>Park: park «slug»
    Park->>Marker: write marker
    Park->>Spine: read latest provider_attempt
    Park-->>Op: parked, attempt N of build still running
    Prov-->>Cond: attempt N ends (failed)
    Cond->>Gate: attempt N+1 (retry)
    Gate->>Marker: parked?
    Marker-->>Gate: yes
    Gate->>Spine: declined-attempt park event
    Gate-->>Cond: operator-parked stop
    Cond-->>Park: feature returns parked, no HALT, budget unspent
```

## Legend

- Red node: the defect. `stepRunner.run` is reached on every retry with no park check.
- Green nodes: new or newly reused components.
- «slug»: the feature slug placeholder.
- The pre-unit gate from ADR 2026-07-29 is unchanged. The new gate adds a check inside the unit and
  still drains the attempt that is already running (FR-2).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-22 | Initial generation | #2103: park must stop in-step retries |
| 2026-09-22 | Plan update: no structural change | Plan tasks 1–13 match the target-state components; the group member gate is the `parallel group member attempt` node |
