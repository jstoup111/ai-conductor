# Sequence: a dispatch does not produce a usable PRD verdict

**Last updated:** 2026-09-30
**Scope:** Missing result, malformed judgment, invalid reference, or unavailable required input.

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor
    participant R as Step runner
    participant V as Selected provider
    participant S as Verdict authority
    participant E as Existing fault and event paths
    C->>R: Start audit attempt
    alt Required input or native-schema capability unavailable
        R-->>C: Named input or capability fault before review
    else Review can run
        R->>V: Invoke reviewer with native schema
        alt No terminal structured judgment
            V-->>R: No structured result
            R-->>C: Current dispatch produced no verdict
        else Supported envelope has independently invalid entries
            V-->>R: Structured result with valid siblings
            R->>S: Persist validated siblings and named entry diagnostics
            R-->>C: Incomplete evidence cannot satisfy gate
        else Missing, malformed or unsupported root
            V-->>R: Unusable output
            R-->>C: Named mechanical no-verdict fault
        end
    end
    C->>S: Do not accept prior evidence as this attempted dispatch
    C->>E: Record mechanical failure through existing reporting
    Note over C,E: No synthetic PASS or substantive finding is invented
```

## Legend

Detailed retry classification remains governed by the existing provider and step-fault policies;
the approved architecture and plan specify their mapping. Authentication, rate limits and unavailable models
retain their established handling. Error reporting names the missing current-dispatch result
instead of suggesting an old report merely needs a timestamp update. The carried #2875 outcome
also requires the already-typed as-built path to make that distinction where needed.

See the [component diagram](../prd-audit-receives-bounded-inputs-and-returns-vali.md).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial sequence | Preserve #2875 missing-verdict diagnostics |
| 2026-09-30 | Plan update: separate unusable root from incomplete entries | Tasks 8–12 persist valid siblings and keep defects blocking |
