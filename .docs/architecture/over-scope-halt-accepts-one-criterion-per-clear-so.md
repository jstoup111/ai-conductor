# Architecture: OVER_SCOPE multi-finding decision block

**Last updated:** 2026-08-24
**Scope:** Feature-scoped view of the OVER_SCOPE halt/clear path — candidate selection at the
conductor's two halt sites, the `OVER_SCOPE_DECISIONS` halt-body block, and the durable
accept/refuse record consumed on clear. Issue jstoup111/ai-conductor#1846.

## Components

```mermaid
graph TD
  subgraph Conductor engine
    RA[parsePrdAuditReport + overScopeRelations]
    RT[routePrdAuditOverScope<br/>selects blocking findings:<br/>outside-visible AND undecided]
    HS[Halt sites x2 in conductor.ts<br/>render OVER_SCOPE_DECISIONS block<br/>for ALL blocking findings]
    RD[readClearedOverScopeDecisions<br/>parses fenced JSON array wholesale]
    REC[recordOverScopeDecisions<br/>accept → widening entry<br/>refuse → refusal entry<br/>accept overrides prior refusal]
  end
  subgraph Pipeline state
    HALT[.pipeline/HALT<br/>body carries OVER_SCOPE_DECISIONS array]
    CLR[.pipeline/HALT.cleared<br/>operator-edited decisions]
    AW[.pipeline/accepted-widenings.json<br/>version 2: accepted + refused entries]
  end
  OP((Operator))

  RA --> RT --> HS --> HALT
  OP -- edits decision fields, clears --> CLR
  CLR --> RD --> REC --> AW
  AW -- prior decisions --> RT
```

## Sequence: multi-finding halt cleared in one pass

```mermaid
sequenceDiagram
  participant D as Daemon dispatch
  participant C as Conductor
  participant P as .pipeline state
  participant O as Operator

  C->>C: prd_audit verdict: OVER_SCOPE on S4.1, S4.3, S5.2
  C->>C: routePrdAuditOverScope filters to blocking set<br/>(outside-visible, no accepted/refused record)
  C->>P: write HALT with OVER_SCOPE_DECISIONS array (3 entries)
  O->>P: edit per-entry decision: accept S4.1, accept S4.3, refuse S5.2
  O->>P: clear halt (body preserved at HALT.cleared)
  D->>C: re-dispatch
  C->>P: read HALT.cleared, parse array wholesale
  C->>P: record 2 widenings + 1 refusal (accepted-widenings.json v2)
  C->>C: re-route: S4.1/S4.3 accepted, S5.2 refused
  C->>P: write NEW halt: «S5.2 refused — rework required»<br/>never the unchanged original halt
```

## Legend

- **Blocking finding:** grade OVER_SCOPE, intent relation `outside-visible`, and no durable
  accept/refuse decision for its criterion.
- **Durable refusal:** persists across laps; the next halt names the refusal instead of
  re-offering acceptance. A later `accept` decision for the same criterion overrides it. A
  refusal is moot once the audit no longer flags the criterion.
- The legacy single-line `OVER_SCOPE_ACCEPT:` marker and its single-match reader are removed
  (pre-v1 breaking change, operator-approved).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-24 | Initial generation | DECIDE for #1846 |
