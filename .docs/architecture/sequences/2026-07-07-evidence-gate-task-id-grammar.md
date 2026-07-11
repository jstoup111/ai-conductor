# Sequence: Evidence Derivation with Id Alias (#417)

**Last updated:** 2026-07-07
**Scope:** One build-gate evaluation after the fix — how a plan task id resolves against
commit trailers, including the new alias path and the empty-commit Evidence form.

## Diagram

```mermaid
sequenceDiagram
    participant Gate as build gate (artifacts.ts)
    participant Derive as deriveCompletion
    participant Plan as parsePlanTaskPaths
    participant Git as git log trailers
    participant Sidecar as task-evidence.json

    Gate->>Derive: evaluate plan «stem»
    Derive->>Plan: parse task headers
    Plan-->>Derive: bare ids 1..N
    Derive->>Git: list commits with trailers
    Git-->>Derive: Task and Evidence trailers
    Note over Derive: match order per id<br/>1. exact Task: «id»<br/>2. alias Task: task-«id»<br/>(alias skipped if plan declares literal task-«id»)
    alt Evidence commit (empty, no-op task)
        Derive->>Git: verify satisfied-by «sha» reachable
        Git-->>Derive: reachable
        Derive->>Sidecar: stamp evidence satisfied-by
    else Feature commit with files
        Derive->>Derive: path corroboration vs plan paths
        Derive->>Sidecar: stamp evidence trailer
    else No matching trailer
        Derive-->>Gate: id unresolved
    end
    Derive-->>Gate: resolved and unresolved ids
    Gate-->>Gate: unresolved remain → auto-park with named ids
```

## Legend

- `«id»` / `«stem»` / `«sha»` — placeholders for a plan task id, plan filename stem, and
  commit SHA respectively.
- The alias branch is the #417 addition; every other step is existing behavior shown for
  context.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | DECIDE phase for #417 (engineer worktree) |
