# Architecture: PRD-audit no-owner OVER_SCOPE findings

**Last updated:** 2026-08-25
**Scope:** Feature-scoped view of parsing and routing OVER_SCOPE findings that own no story
criterion — the `## Findings without an owning criterion` section the prd-audit skill already
teaches, its `NC.«n»` ordinal keys, duplicate-criterion rejection, per-row rejection
diagnostics, and decisions bound to key + summary. Issue jstoup111/ai-conductor#1848.

## Components

```mermaid
graph TD
  subgraph prd-audit skill output
    RPT[.pipeline/prd-audit.md<br/>Verdict Table: S«s».«c» rows<br/>+ Findings-without-an-owning-criterion<br/>section: NC.«n» rows]
  end
  subgraph Conductor engine
    PA[parsePrdAuditReport<br/>parses BOTH sections<br/>rejects duplicate criterion keys<br/>collects per-row rejects instead of<br/>discarding the whole report]
    OR[overScopeRelations<br/>relations keyed by S«s».«c» or NC.«n»]
    CL[classifyOverScopeCriterion<br/>decision match requires key AND summary<br/>mismatch → blocking-undecided, re-ask]
    GT[prd_audit gate route<br/>blocks on: non-PASS rows,<br/>undecided outside-visible findings,<br/>and any rejected rows — halt names them]
    REC[recordOverScopeDecisions<br/>entries carry key + summary]
  end
  subgraph Pipeline state
    HALT[.pipeline/HALT<br/>OVER_SCOPE_DECISIONS block<br/>+ rejected-row diagnostics]
    AW[.pipeline/accepted-widenings.json<br/>decision bound to key + summary]
  end
  OP((Operator))

  RPT --> PA --> OR --> CL --> GT --> HALT
  OP -- accept/refuse per finding --> HALT
  HALT --> REC --> AW
  AW -- key+summary matched decisions --> CL
```

## Sequence: no-owner finding parsed, decided, and re-matched next lap

```mermaid
sequenceDiagram
  participant A as prd-audit skill
  participant P as parsePrdAuditReport
  participant G as prd_audit gate
  participant O as Operator
  participant W as accepted-widenings.json

  A->>P: report with S1.1 PASS + NC.1 OVER_SCOPE outside-visible
  P->>G: findings incl. NC.1 (parsed, no mechanical fault)
  G->>O: HALT: decide NC.1 («summary echoed»)
  O->>W: accept NC.1 with summary + rationale
  G->>G: re-route: NC.1 accepted → not blocking → pass
  Note over A,W: next lap — report re-authored
  A->>P: re-audit lists the same finding as NC.1, same summary
  P->>G: NC.1 (key + summary both match recorded decision)
  G->>G: decision applies → no re-ask
  Note over A,W: drift case — re-audit renumbers or rewords
  A->>P: finding now NC.2 or summary changed
  G->>O: no match → re-ask (never apply a mismatched decision)
```

## Legend

- **NC.«n» key:** report-scoped ordinal assigned by the audit author in the
  `## Findings without an owning criterion` section (row headed `Finding`); valid only
  together with its summary.
- **Rejected row:** a table row whose key matches neither `S«s».«c»` nor `NC.«n»`, or a
  duplicate criterion key. Correctly-parsed rows are kept; rejected rows are named in the
  halt with the reason — salvage is for visibility, and rejected rows still block.
- **Decision match:** key AND summary equal → decision applies (last-write-wins);
  any mismatch → blocking-undecided, operator re-asked. Never wrong, occasionally re-asks.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-25 | Initial generation | DECIDE for #1848 |
