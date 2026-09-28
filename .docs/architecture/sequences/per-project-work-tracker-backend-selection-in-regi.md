# Sequence: Intake Poll with Per-Project Tracker Selection (#845)

**Last updated:** 2026-09-28
**Scope:** How `buildIntake()` picks each registered project's tracker backend during a poll, and
how a land/handoff write-back reaches the owning backend.

## Diagram

```mermaid
sequenceDiagram
    participant Caller as compose poll / claim
    participant BI as buildIntake
    participant Reg as RegistryReader
    participant Sel as resolveTrackerSelection
    participant GH as GitHub issues adapter
    participant Spine as event spine

    Caller->>BI: build intake composition
    BI->>Reg: listProjects()
    Reg-->>BI: registered projects
    loop each project
        BI->>Sel: resolve «project» tracker config
        Sel-->>BI: github (default when absent) or jira
    end
    BI->>GH: create over github projects only
    alt any project selects jira
        BI->>Spine: tracker backend unavailable (jira, «project»)
    end
    Caller->>BI: poll()
    BI->>GH: poll()
    GH-->>BI: envelopes
    BI-->>Caller: envelopes (github projects only)

    Note over Caller,GH: land/handoff write-back with a sourceRef
    Caller->>BI: report(routed or done, «sourceRef»)
    BI->>GH: report (sourceRef owned by a github project)
```

## Legend

- `«project»` and `«sourceRef»` are placeholders.
- When every project resolves to `github`, the composite hands the whole registry to one GitHub
  adapter, so its behavior matches today's unconditional construction.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-28 | Initial generation | #845 DECIDE |
