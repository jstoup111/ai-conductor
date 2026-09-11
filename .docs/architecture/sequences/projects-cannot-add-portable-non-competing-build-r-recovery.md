# Sequence: Recovery after interrupted review repair

**Last updated:** 2026-09-10
**Plan update approved:** James Stoup, 2026-09-11
**Scope:** Existing durable-effect behavior preserved as custom policies enter review; diagram approved by operator 2026-09-10.


> **Amended 2026-09-10 by #1986:** Tasks 35–39 reuse existing leased/atomic recovery and charge ownership. Stored custom descriptors survive policy removal, unresolved decision stops survive restart, and only explicit owning decisions permit re-evaluation. Genuine existing rebase refunds and operator reset semantics remain.

## Diagram

```mermaid
sequenceDiagram
  participant G as Aggregate review authority
  participant S as Existing case and effect store
  participant W as Existing work-order store
  participant B as BUILD worker
  participant A as Existing shared adjudicator
  G->>S: Reserve admitted repair effect using existing durable identity
  G->>W: Publish work order through existing effect protocol
  Note over G,W: Interruption can occur before or after publication or charge
  G->>S: Acquire existing lease and read original custom descriptors and effect state
  Note over G,S: Competing resumes cannot own the same effect, corrupt state stops
  G->>W: Reconcile persisted work order and attempt evidence
  alt Recorded decision-owner stop
    S-->>G: Retain stop until explicit owning decision changes approved baseline
  else Authorized effect has not been attempted
    G->>B: Resume the same effect without duplicate authorization or charge
    B->>W: Record attempt evidence
  else Prior effect was attempted
    G->>A: Current findings plus complete prior attempt evidence
    alt Equivalent unresolved repair returns
      A-->>G: Repeated case requiring existing bounded stop
    else New admitted case or resolved prior finding
      A-->>G: Traceable current disposition
    end
  end
  G->>S: Persist resulting case state through the existing protocol
  Note over G,S: Missing, contradictory, or unreadable evidence cannot settle the lap
  Note over G,W: Policy removal/update and restart retain provenance and charges, genuine existing refunds remain
```

## Legend

This diagram preserves existing case identity, effect reservation, budget, and replay ownership; it does not introduce a second recovery ledger. The precise existing crash-state transitions remain authoritative and must be reviewed before any extension. Custom rubric identifiers and policy changes must retain enough evidence for that protocol to judge continuity without confusing a changed policy with repeated implementation work.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-10 | Initial recovery sequence | Carry PRD restart guarantees across custom policy evidence |
| 2026-09-10 | Plan-update: concrete candidate, authority, and recovery boundaries | Reflect the approved architecture and 40-task implementation plan |
