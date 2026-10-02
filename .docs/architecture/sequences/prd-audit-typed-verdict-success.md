# Sequence: successful PRD-audit dispatch

**Last updated:** 2026-09-30
**Scope:** Both supported providers through the existing provider-aware step runner.

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor
    participant P as Projection builder
    participant R as Step runner
    participant V as Selected provider
    participant S as Typed verdict store
    participant G as Existing gate consumers
    C->>P: Resolve active feature authorities and available history
    P-->>C: Versioned bounded projection
    C->>R: Dispatch PRD audit with current attempt identity
    R->>V: Skill role, projection and native output schema
    V-->>R: Terminal structured judgment
    R->>R: Validate structure and resolve references
    R->>S: Persist validated verdict with engine-owned identity
    S->>S: Render human-readable Markdown view
    S-->>C: Persisted current-dispatch judgment
    C->>G: Read through the single typed-verdict reader
    G->>G: Apply existing grades, routing and approval authority
```

## Legend

Successful dispatch means the judgment was obtained and persisted, not that its findings pass.
FIXABLE, PLAN_GAP and unresolved OVER_SCOPE retain their existing blocking meaning. The reviewer
cannot supply the authoritative attempt identity or operator approval.

See the [component diagram](../prd-audit-receives-bounded-inputs-and-returns-vali.md).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial sequence | Engine-owned persistence selected for #2521 |
