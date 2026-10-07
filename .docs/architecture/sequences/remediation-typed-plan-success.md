# Sequence: remediation returns a validated typed plan

**Last updated:** 2026-10-06
**Scope:** A remediation source requests a gap plan and receives validated dispositions.

## Diagram

```mermaid
sequenceDiagram
    participant G as Source gate
    participant C as Conductor planRemediation
    participant R as Step runner
    participant V as Selected provider
    participant K as Disposition contract
    participant S as Typed plan store
    G->>C: Request remediation with source context
    C->>R: Run remediate for this attempt
    R->>R: Check native-schema capability
    R->>R: Build versioned projection with required references
    R->>V: Invoke with projection, rendered shape and native schema
    V-->>R: Terminal structured dispositions
    R->>K: Validate shape, vocabulary and reference accounting
    K-->>R: Every required reference accounted for exactly once
    R->>S: Persist plan stamped with attempt identity
    C->>S: Read typed plan for current attempt
    S-->>C: Validated dispositions
    C->>C: Apply existing admission, budget, authority and repair rules
```

## Legend

The provider returns judgment only. The engine renders the shape from the same schema it
validates against, so prompt and validator cannot drift.

See the [component diagram](../remediation-dispositions-honor-the-engine-owned-in.md).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-06 | Initial sequence | #2522 target flow |
