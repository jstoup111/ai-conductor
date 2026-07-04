# Architecture: operator park — human park survives the re-kick sweep

**Last updated:** 2026-07-04
**Scope:** the seams changed by this feature — a new operator-owned PARKED marker beside the
existing HALT marker, park/unpark CLI verbs, the re-kick sweep's skip contract, dispatch
eligibility, and the dashboard's grouping precedence.

## Components

```mermaid
graph TD
    subgraph Operator["operator (CLI, no live daemon required)"]
        PARKV["daemon park «slug»"]
        UNPARKV["daemon unpark «slug»"]
    end

    subgraph RepoRoot["repo root .daemon state (gitignored)"]
        PARKED["parked/«slug» - operator-owned, NEW"]
    end

    subgraph Worktree["feature worktree .pipeline markers"]
        HALT["HALT - machine-owned"]
        CLEARED["HALT.cleared"]
        SENTINEL["REKICK sentinel"]
    end

    subgraph Daemon["daemon engine"]
        SWEEP["rekickSweep - base-advance re-kick"]
        DISCOVER["discovery / dispatch eligibility"]
        DASH["dashboard grouping"]
    end

    PARKV -->|"writes (idempotent)"| PARKED
    UNPARKV -->|"removes (no-op if absent)"| PARKED
    SWEEP -->|"NEW: check first - present means skip + log, HALT untouched"| PARKED
    SWEEP -->|"unchanged for un-parked: rename to cleared + drop sentinel"| HALT
    SWEEP --> CLEARED
    SWEEP --> SENTINEL
    DISCOVER -->|"NEW: present means ineligible, every tick and restart"| PARKED
    DISCOVER -->|"unchanged: live HALT parks, cleared HALT un-parks"| HALT
    DASH -->|"NEW: PARKED bucket, precedence above HALTED"| PARKED
    DASH -->|existing HALTED bucket| HALT
```

## Sequence: base advance with a parked feature

```mermaid
sequenceDiagram
    participant O as operator
    participant W as parked worktree
    participant S as sibling halted worktree
    participant D as daemon

    O->>W: daemon park «slug» (writes .daemon/parked/«slug» at repo root)
    Note over W: HALT may or may not also exist
    D->>D: poll detects genuine base-SHA advance
    D->>W: sweep - PARKED present
    D->>D: skip + log "parked by operator", HALT byte-for-byte intact
    D->>S: sweep - no PARKED, live HALT
    D->>S: clear HALT to HALT.cleared + drop REKICK sentinel
    D->>S: next poll re-dispatches sibling (unchanged flywheel)
    D->>D: daemon restart
    D->>W: PARKED still on disk - still ineligible
    O->>W: daemon unpark «slug» (removes PARKED)
    D->>W: next base advance treats HALT as an ordinary halt again
```

## Legend

- **PARKED** — a new operator-owned marker at repo-root `.daemon/parked/«slug»`
  (adr-2026-07-04-operator-park-marker: repo-root, not worktree, so pre-emptive parks of
  undispatched work hold and the park survives worktree teardown). Written and removed only by
  the park/unpark verbs; checked before any autonomous decision about the feature (sweep
  clear, dispatch, sentinel resume); check errors fail toward parked.
- **HALT** — the existing machine-owned marker; its writers (rebase re-conflict, gates,
  finish flow) are untouched and may rewrite it freely without affecting a park.
- **precedence** — PARKED outranks every existing dashboard group (HALTED, PROCESSED, GATED,
  IN-PROGRESS, WAITING, ELIGIBLE); interior order unchanged; a slug with both states shows
  once, as PARKED.
- **NEW** edges — behavior added by this feature; all other edges exist today.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | Spec authoring for ai-conductor#236 (engineer DECIDE) |
| 2026-07-04 | Park storage moved to repo-root `.daemon/parked/«slug»`; precedence restated as PARKED-over-all (GATED included) | ADR approval + conflict-check resolution; /plan step 8b |
