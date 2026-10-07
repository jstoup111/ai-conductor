# Sequence: remediation does not produce a usable plan

**Last updated:** 2026-10-06
**Scope:** Missing result, schema-invalid output, bad references, unknown dispositions, or
unavailable required input or capability.

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor planRemediation
    participant R as Step runner
    participant V as Selected provider
    participant K as Disposition contract
    participant E as Existing fault and event paths
    C->>R: Run remediate for this attempt
    alt Required input or native-schema capability unavailable
        R-->>C: Named input or capability fault before dispatch
    else Plan can be requested
        R->>V: Invoke with native schema
        alt No terminal structured result
            V-->>R: No structured result
            R-->>C: Current dispatch produced no plan
        else Structured result returned
            V-->>R: Structured dispositions
            R->>K: Validate
            alt Missing, duplicate, foreign or malformed reference
                K-->>R: Field-specific rejection naming references
                R-->>C: Mechanical fault, no partial plan accepted
            else Unknown disposition or category
                K-->>R: Field-specific rejection naming value and accepted set
                R->>E: Emit remediation_disposition_rejected per entry
                R-->>C: Mechanical fault, no partial plan accepted
            end
        end
    end
    C->>E: Record through existing retry and halt policy
    Note over C,E: No synthetic plan, BLOCKED verdict or halt judgment is invented
```

## Legend

Retry classification follows the shipped as-built and PRD-audit policy: a missing capability or
required input halts without retry; missing or invalid output follows the existing retry then
needs-human path. The exact mapping is settled in architecture review.

See the [component diagram](../remediation-dispositions-honor-the-engine-owned-in.md).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-06 | Initial sequence | #2522 fault boundary |
