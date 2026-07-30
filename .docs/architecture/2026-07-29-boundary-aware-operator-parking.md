# Components: Boundary-aware operator parking

**Last updated:** 2026-07-29
**Scope:** Proposed daemon-only control flow that drains the active serial step or parallel group, persists its natural outcome, and honors an operator park before the next lifecycle unit starts.

## Diagram

```mermaid
graph TD
    OP["Operator"] -->|"places or removes park"| PS[("Repo-root park state for «slug»")]

    subgraph Daemon["Daemon feature execution"]
        WI["Worktree wrapper"]
        DR["Feature runner"]
        DP["Daemon pool"]
        OR["Intentional outcome classifier"]
    end

    subgraph Scheduler["Conductor scheduler - daemon mode"]
        BG{"Pre-unit boundary gate"}
        SS["Serial step executor"]
        PG["Generic parallel-group executor"]
        JOIN["Parallel-group join"]
        SW["Lifecycle state writer"]
        EV["Boundary reporting"]
    end

    WI -->|"inject main-root predicate + slug"| BG
    BG -->|"park absent"| SS
    BG -->|"park absent"| PG
    BG -->|"park active or indeterminate"| EV
    BG -->|"reads at each boundary"| PS

    SS -->|"natural terminal result"| SW
    PG -->|"all started members settle"| JOIN
    JOIN -->|"member and group results"| SW
    SW -->|"status durable before progression"| BG

    EV -->|"typed operator-parked result + last settled unit"| WI
    WI -->|"propagate unchanged"| OR
    OR -->|"parked outcome; keep worktree; no marker inference"| DR
    DR -->|"normal parked collection; no HALT watcher"| DP

    PS -->|"unparked later"| DP
    DP -->|"resume from persisted lifecycle state"| WI
```

## Legend

- **Pre-unit boundary gate** is the single policy point before any serial step or parallel group starts. It is enabled only for daemon-managed runs.
- **Lifecycle state writer** remains authoritative for the active unit's natural result; the park decision occurs only after those writes complete.
- **Generic parallel-group executor and join** represent every current and future parallel group. The boundary is after the complete join, never inside one member.
- **Intentional outcome classifier** keeps an operator boundary stop distinct from a machine failure or an indeterminate loop exit.
- **Worktree wrapper and feature runner** propagate the typed stop before terminal-marker inference;
  the daemon pool collects it without a machine-HALT watcher or completion side effects.
- An unreadable park decision fails toward stopped: no later lifecycle unit starts.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-29 | Initial proposed component flow | DECIDE for boundary-aware operator parking |
| 2026-07-29 | Added planned wrapper, typed-result, and pool wiring | Plan-update mode |
