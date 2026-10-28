# Components: recurrence lineage for build_review act cases at a resolved anchor

**Last updated:** 2026-10-23
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#3124. An unbound `act`
proposal whose source's authoritative link (D5.5) belongs to a resolved `act` case is still admitted
as a new case. The engine records that new case as a recurrence of the resolved case unless the
judge declares it distinct, with a reason. A lineage shares one BUILD attempt count with a cap of 3.
Only an exhausted lineage halts. Non-`act` dispositions, decision stops, and explicit rebinds are
unchanged.

## Diagram

```mermaid
graph TD
  subgraph Contract["One provider contract (Claude and Codex)"]
    SKILL["skills/remediate/SKILL.md<br/>optional distinctFrom on an<br/>unbound act row: caseId + reason"]
    CTX["build-review-adjudication-context.ts<br/>freezePriorCase exposes<br/>recurrenceOf, distinctFrom,<br/>lineage attempt count"]
  end

  subgraph Judge["Existing remediate judgement"]
    RESULT["case-v2 judgement<br/>.pipeline/remediation.json"]
  end

  subgraph Admit["Engine-owned admission"]
    PARSE["remediation-case-artifact.ts<br/>parses optional distinctFrom"]
    VALID["remediation-case-validator.ts<br/>distinctFrom only on unbound act;<br/>an entry not naming a resolved act<br/>owner of a row source is dropped<br/>(row becomes a recurrence)"]
    COORD["build-review-adjudication-coordinator.ts<br/>pre-reconcile lineage check:<br/>attempts at cap 3 halts<br/>before any effect reservation"]
    RECONCILE["remediation-case-reconciler.ts<br/>stamps recurrenceOf and<br/>distinctFrom on the new case;<br/>resolved rows byte-identical"]
  end

  subgraph State["Feature-scoped durable state"]
    STORE["remediation-case-store.ts<br/>record gains optional<br/>recurrenceOf, distinctFrom"]
    SELECT["currentBuildReviewSourceLinks<br/>(existing D5.5 selector)<br/>authoritative owner per source"]
    LINEAGE["recurrenceLineage (new pure<br/>helper in store module)<br/>walks recurrenceOf; counts act<br/>cases with applied action effect"]
    BUDGET["kickback-ledger.ts<br/>cumulative cap unchanged"]
  end

  subgraph Operator["Operator surface (existing spine)"]
    EVENT["remediation_case_reconciled<br/>+ recurrenceOf / distinctFrom<br/>remediation_semantic_repeat_halt<br/>reason recurrence-limit + lineage ids"]
    FINDINGS["build-review findings CLI<br/>shows lineage and declarations"]
  end

  SKILL -.governs.-> RESULT
  CTX --> RESULT
  RESULT --> PARSE --> VALID --> COORD
  COORD -->|reads| SELECT
  COORD -->|reads| LINEAGE
  COORD -->|under cap| RECONCILE
  RECONCILE -->|mutate| STORE
  RECONCILE -->|new act effect| BUDGET
  STORE --> SELECT
  STORE --> LINEAGE
  LINEAGE --> CTX
  RECONCILE --> EVENT
  COORD -->|at cap| EVENT
  STORE --> FINDINGS
```

## Legend

- **Contract**: the single remediate skill and frozen context that every provider renders. A
  `distinctFrom` declaration is the judge's explicit, reasoned statement. The engine never infers it
  from prose.
- **Admit**: the existing parse, validate, coordinate and reconcile seams. Only their admission
  rules change.
- **State**: `recurrenceOf` and `distinctFrom` are optional, engine-stamped fields on a new case
  only. Lineage attempts count durable `applied` action effects, not lap-local work-order evidence.
- **Operator**: additive fields on existing `ConductorEvent` members. No new channel or sidecar.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-23 | Initial component diagram | #3124 recurrence lineage |
