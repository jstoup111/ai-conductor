# Sequence: unbound act re-raise over a resolved act case

**Last updated:** 2026-10-23
**Scope:** The build_review lap path for jstoup111/ai-conductor#3124: undeclared recurrence, declared
distinct, and an exhausted lineage.

## Diagram

```mermaid
sequenceDiagram
  participant J as remediate judge
  participant V as artifact parser + validator
  participant C as adjudication coordinator
  participant L as recurrenceLineage
  participant R as case reconciler
  participant S as case store
  participant E as event spine

  J->>V: unbound act row on source «S» (authoritative owner resolved act «R»)
  V->>V: drop any distinctFrom entry that is not a resolved act owner of a row source
  V->>C: admitted graph
  C->>S: read cases
  C->>L: lineage of «R» (follow recurrenceOf)
  alt row declares distinctFrom «R» with reason
    C->>R: reconcile (fresh lineage)
    R->>S: new case «N», distinctFrom [«R», reason]
    R->>E: remediation_case_reconciled open + distinctFrom
  else undeclared, lineage applied attempts below 3
    C->>R: reconcile (recurrence)
    R->>S: new case «N», recurrenceOf [«R»], fresh action effect
    R->>E: remediation_case_reconciled open + recurrenceOf
    Note over C,S: kickback charged once for «N» effect, as today
  else undeclared, lineage applied attempts at 3
    C->>R: link halting binding sources only
    C->>E: remediation_semantic_repeat_halt reason recurrence-limit, lineage case ids
    C-->>J: HALT names lineage, attempts, work orders
  end
```

## Legend

- «R» is unchanged in every branch.
- The cap check runs before reconciliation reserves any sibling effect, like the existing
  regression halt does.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-23 | Initial sequence | #3124 recurrence lineage |
