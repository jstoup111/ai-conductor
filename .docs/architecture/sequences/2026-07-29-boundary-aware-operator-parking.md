# Sequence: Boundary-aware operator parking

**Last updated:** 2026-07-29
**Scope:** Serial-step and parallel-group park timing, durable status ordering, intentional outcome classification, and state-preserving resume.

## Serial step

```mermaid
sequenceDiagram
    participant O as Operator
    participant P as Repo park state
    participant S as Conductor scheduler
    participant U as Active serial step
    participant W as Lifecycle state
    participant X as Worktree wrapper
    participant D as Feature runner and pool

    S->>U: Start serial unit
    O->>P: Place park for «slug»
    Note over U: Running work is not interrupted
    U-->>S: Natural terminal result
    S->>W: Persist terminal status
    W-->>S: Durable
    S->>P: Check park before next unit
    P-->>S: Park active
    S-->>X: Typed operator-parked result with last settled unit
    X-->>D: Propagate result before marker inference
    Note over S,D: Keep worktree with no next unit, HALT watcher, or park-induced failure
    O->>P: Remove park
    D->>X: Resume feature
    X->>S: Start from durable state
    S->>W: Read persisted lifecycle state
    W-->>S: Settled unit remains authoritative
    S->>S: Continue through normal eligibility rules
```

## Parallel group

```mermaid
sequenceDiagram
    participant O as Operator
    participant P as Repo park state
    participant S as Conductor scheduler
    participant G as Parallel-group executor
    participant W as Lifecycle state
    participant X as Worktree wrapper
    participant D as Feature runner and pool

    S->>G: Start parallel group
    G->>G: Start applicable members
    O->>P: Place park for «slug»
    Note over G: Every already-started member continues
    G->>G: Join after all members settle
    G-->>S: Natural member and group results
    S->>W: Persist every applicable terminal status
    W-->>S: Durable
    S->>P: Check park before next lifecycle unit
    P-->>S: Park active
    S-->>X: Typed operator-parked result with last settled group
    X-->>D: Parked outcome before marker inference
    Note over S,D: No later serial step or parallel group starts and no HALT watcher is added
```

## Legend

- Park state is sampled only at lifecycle-unit boundaries, not continuously during model or test execution.
- The serial step or complete parallel group settles before the boundary stop is classified.
- Removing the park later resumes from lifecycle state; parking alone never rewrites a member result.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-29 | Initial serial and parallel boundary sequences | DECIDE for boundary-aware operator parking |
| 2026-07-29 | Added planned typed-result propagation and pool classification | Plan-update mode |
