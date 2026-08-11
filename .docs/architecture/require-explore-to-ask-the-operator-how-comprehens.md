# Component Flow: Operator-Chosen Fix Comprehensiveness

**Last updated:** 2026-08-11
**Scope:** The DECIDE-phase flow that captures and preserves the operator's chosen repair breadth and limits ADR creation to structural change.

## Diagram

```mermaid
flowchart LR
    Operator[Operator] -->|states problem and outcome| Explore[explore]
    Explore -->|asks how comprehensive the fix should be| Operator
    Operator -->|chooses breadth and boundaries| Explore
    Explore -->|records confirmed scope| Decision[Explore decision]
    Decision --> Architecture[architecture-review]
    Architecture -->|real structural change| ADR[ADR]
    Architecture -->|no structural change| NoADR[No ADR]
    Decision --> Stories[stories]
    Architecture --> Stories
    Stories --> Plan[plan]
    Plan -->|must remain within confirmed scope| Build[BUILD]
    Architecture -.->|unapproved expansion returns for confirmation| Operator
    Stories -.->|unapproved expansion returns for confirmation| Operator
    Plan -.->|unapproved expansion returns for confirmation| Operator
```

## Legend

Solid arrows are the normal DECIDE flow. Dotted arrows are blocking clarification loops when a downstream step identifies a materially broader solution than the operator approved.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-11 | Initial planned flow | Make scope breadth an explicit operator decision owned by `explore` and preserved downstream; keep ADRs structural-only |
| 2026-08-11 | Plan alignment confirmed | Three contract-only tasks implement the depicted flow without runtime machinery |
