# Components: Shared plan-task reference resolver (#2064)

**Last updated:** 2026-08-30
**Scope:** The reference-resolver seam between remediation-append's H9 task-id producer and
prd_audit's Verdict Table consumer; contract shaped for later adoption by #2054's ADR-decision
consumer (adoption itself out of scope here).

## Diagram

```mermaid
graph TD
  subgraph Producers
    RA["remediation-append.ts<br/>emits rem-«gate»-«gapId» ids<br/>(H9 grammar, never purely numeric)"]
    PLAN["Plan .docs/plans/«stem».md<br/>integer tasks + rem-« » tasks"]
  end

  subgraph Seam["NEW: reference-resolver seam"]
    RES["resolveArtifactReference()<br/>strip tolerated annotation<br/>validate H9 grammar<br/>check membership in artifact id set<br/>→ resolved id | diagnostic"]
  end

  subgraph Consumers
    PA["artifacts.ts prd_audit parser<br/>Verdict Table 'Plan task' cell<br/>(today: Number() — rejects rem- ids)"]
    ADR["#2054 ADR-decision consumer<br/>(future adopter, out of scope)"]
  end

  RA -->|appends tasks| PLAN
  PLAN -->|activePlanTaskIds set| RES
  PA -->|"raw cell e.g. rem-prd-audit-rem-s1-6-1 annotated"| RES
  RES -->|resolved id or rejectedPrdAuditRow diagnostic| PA
  ADR -.->|later adoption| RES

  style RES fill:#e8f5e9,stroke:#2e7d32
  style ADR stroke-dasharray: 5 5
```

## Legend

- Green node — new module introduced by this feature.
- Dashed node/edge — future adopter, not delivered here.
- «…» — variable segment placeholder.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-30 | Initial generation | DECIDE for #2064 |
