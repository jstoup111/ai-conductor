# Architecture: ADR Decision-Shape Contract (issue #2054)

**Last updated:** 2026-09-02
**Scope:** Shared ADR-decision parser as the single citability authority; land-time gate; consumers.

## Diagram

```mermaid
graph TD
    subgraph Authoring
        T[templates/adr.md.template<br/>names accepted decision forms]
        A[Authored ADR<br/>.docs/decisions/«stem».md]
        T --> A
    end

    P[parseAdrDecisions<br/>shared parser module<br/>single authority for decision shapes]

    subgraph Consumers
        G[engineer land gate<br/>rejects new/edited APPROVED ADR<br/>with zero citable decisions]
        R[resolveAsBuiltGoverningClause<br/>conductor.ts as-built resolver]
    end

    A --> P
    P --> G
    P --> R
    G -->|reject names offending decision| A
    R -->|clause resolved or REMEDIABLE| V[as-built validation group]
```

## Legend

- `parseAdrDecisions` — new shared module; every consumer of `## Decision` content calls it.
  The AB-R12 shape knowledge (numbered list, bolded D-heading, ATX heading) moves here.
- The land gate applies only to ADRs added/modified in the spec diff — the legacy corpus is
  not re-validated.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-02 | Initial generation | DECIDE for issue #2054 |
