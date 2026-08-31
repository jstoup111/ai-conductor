# Components: existing-task remediation disposition (#2119)

**Last updated:** 2026-08-31
**Scope:** The remediation disposition contract and the two append budgets it charges — adding an
`existing-task` disposition that binds a finding to existing plan task ids, bypasses plan-append,
and consumes the gate's lap allowance instead of plan-growth allowance.

## Diagram

```mermaid
graph TD
  subgraph Planner["/remediate planner (LLM judgement)"]
    RJ["Ownership judgement:<br/>does an existing plan task own this remedy?"]
  end

  subgraph Contract["artifacts.ts disposition contract"]
    DT["REMEDIATION_TARGET_STEPS<br/>build | acceptance_specs |<br/>architecture_review | plan"]
    PUB["publication<br/>(prose-only, no plan append)"]
    ET["NEW: existing-task<br/>binds to plan task ids<br/>validated via resolvePlanTaskReference<br/>no plan append"]
    HALT["halt"]
  end

  subgraph Budgets["conductor.ts append budgets"]
    GROWTH["shared plan-growth allowance<br/>prdAuditAppendCap"]
    LAPS["per-gate lap allowance<br/>kickback ledger"]
  end

  subgraph Routing
    APPEND["appendRemediationTasks<br/>amends .docs/plans/«stem».md"]
    BUILD["route → build<br/>(existing tasks finished, not grown)"]
    FIN["route → finish"]
  end

  RJ -->|new scope| DT
  RJ -->|already-planned work| ET
  RJ -->|PR prose| PUB
  RJ -->|human decision| HALT
  DT -->|charges| GROWTH
  DT --> APPEND
  ET -->|charges only| LAPS
  ET --> BUILD
  PUB --> FIN
  DT -->|also consumes lap| LAPS

  style ET fill:#e8f5e9,stroke:#2e7d32
```

## Legend

- Green node — new disposition introduced by this feature.
- «…» — variable segment placeholder.
- `existing-task` follows the `publication` precedent: deliberately outside
  `REMEDIATION_TARGET_STEPS`, so `remediationDispositionAppendsToPlan` returns false and the
  sealed plan is never amended for already-planned work.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-31 | Initial generation | DECIDE for #2119 |
