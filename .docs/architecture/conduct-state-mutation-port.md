# Components: conduct-state mutation ownership

**Last updated:** 2026-08-01
**Scope:** Proposed state mutation boundary for conductor and out-of-process CLI writers.

## Diagram

```mermaid
graph LR
  subgraph writers["State clients"]
    conductor["Conductor run loop"]
    finish["finish-record CLI"]
    daemon["Daemon and recovery CLIs"]
  end

  subgraph boundary["Engine-owned state boundary"]
    port["ConductStateStore port<br/>read snapshot<br/>apply mutation batch<br/>replace for reset"]
    rules["Conflict policy<br/>idempotent same value<br/>proven semantic precedence<br/>otherwise refuse and log"]
  end

  subgraph local["Open-source local adapter"]
    lease["Cross-process lease<br/>bounded acquisition and recovery"]
    file["conduct-state.json<br/>read under lease<br/>atomic temp and rename"]
  end

  future["Future hosted state service adapter<br/>authoritative mutation owner"]

  conductor -->|"field mutation or atomic batch"| port
  finish -->|"pr_url mutation"| port
  daemon -->|"field mutation or explicit reset"| port
  port --> rules
  rules --> lease
  lease --> file
  port -.->|"same port, later deployment"| future

  classDef proposed fill:#d5f5e3,stroke:#1e8449,stroke-width:2px;
  classDef store fill:#fdebd0,stroke:#b9770e;
  class port,rules,lease proposed;
  class file,future store;
```

## Mutation Sequence

```mermaid
sequenceDiagram
  participant W as State writer
  participant P as ConductStateStore
  participant L as Local lease
  participant F as conduct-state.json

  W->>P: apply mutation «field, expected, next, intent»
  P->>L: acquire bounded lease
  L-->>P: exclusive ownership
  P->>F: read current snapshot
  alt expected value still current
    P->>F: atomic temp write and rename
    P-->>W: applied with new revision
  else mutation is already reflected
    P-->>W: idempotent success
  else proven semantic precedence exists
    P->>F: persist semantically dominant value
    P-->>W: resolved with logged disposition
  else same-field conflict
    P-->>W: conflict with field and values logged
  end
  P->>L: release lease
```

## Legend

- Green components are the new engine-owned mutation boundary and serialized local implementation.
- The ordinary command changes one field. A batch is permitted only when several fields form one invariant and must commit together.
- `replace` is a distinct privileged operation used by deliberate reset/start-over paths; omission never means deletion.
- Semantic precedence is field-specific and exhaustive. `feature_status: complete` is terminal; step `done` is not generally dominant because explicit invalidation may change it to `stale`.
- The future hosted adapter is out of scope. It replaces the local adapter behind the same port rather than changing state clients.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-01 | Initial proposed architecture | Prevent lost updates and establish the adapter boundary for a future state authority |
| 2026-08-01 | Confirmed against the 18-task implementation plan | Kept mutation, conflict, lease, persistence, reset, and adapter wiring aligned with the approved task sequence |
