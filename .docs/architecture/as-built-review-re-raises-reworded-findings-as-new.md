# Components: as-built finding reconciliation in the remediate gap-plan

**Last updated:** 2026-10-28
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#3127.

- **What changes:** A BLOCKED as-built verdict already routes its REMEDIABLE findings through the
  remediate `gap-plan` dispatch (`planRemediation` in `conductor.ts`). That dispatch now also
  reconciles each current as-built finding against prior `as_built` cases in the shared remediation
  case store. Each finding is classed `same`, `recurrence`, `materially-changed` or `new`, with a
  reason.
- **What the engine enforces:** The engine validates the reconciliation and persists it as
  `as_built` case records. It appends plan tasks only for `new` and `materially-changed` findings.
  A `same` finding binds its prior case's open repair task. A `recurrence` restages its prior case's
  repair task. Neither draws plan growth. The gate's existing tier lap cap bounds repeated laps; no
  separate recurrence limit is added.
- **DESIGN findings:** These still halt `needs-human` without a dispatch. They are recorded as
  `as_built` cases with outcome `needs-human`.
- **Authority:** As-built review keeps its verdict authority. The gate passes only on an
  APPROVED-family or `plan-gap-delivered` verdict. Reconciliation never changes a verdict.
- **Unchanged:** The build_review case mode, the prd-widening-reconciliation mode, prd_audit
  references in `gap-plan`, and the as-built verdict contract.

## Diagram

```mermaid
graph TD
  subgraph Review["As-built review (authority unchanged)"]
    VERDICT["as-built-contract.ts / as-built-verdict-store.ts<br/>BLOCKED verdict, attempt-stamped<br/>finding ids (unchanged)"]
  end

  subgraph Plan["Existing remediate gap-plan dispatch"]
    PROJ["remediation-projection.ts<br/>+ priorAsBuiltCases: id, sources,<br/>status, repair task ids, recurrence count;<br/>repair tasks join task context<br/>(byte-bounded, overflow faults,<br/>never truncates)"]
    SKILL["skills/remediate/SKILL.md<br/>gap-plan: reconcile each<br/>as-built finding"]
    CONTRACT["remediation-plan-contract.ts<br/>as-built-finding disposition +<br/>reconciliation: relation,<br/>priorCaseId, reason"]
  end

  subgraph Admit["Engine-owned admission (conductor.ts planRemediation)"]
    VALIDATE["validateRemediationPlan<br/>exactly one result per finding;<br/>priorCaseId names a known as_built case;<br/>same/recurrence must bind a<br/>repair task of that case or halt"]
    APPEND["remediation-append.ts<br/>appends tasks for new and<br/>materially-changed only"]
    BIND["existing-task restage<br/>same/recurrence bind and restage<br/>prior repair tasks; no growth"]
  end

  subgraph State["Feature-scoped durable state"]
    STORE["remediation-case-store.ts<br/>v4 envelope + asBuiltCases;<br/>outbox paired atomically;<br/>as_built record: sources,<br/>relation, reason, changedFrom,<br/>recurrence count, repair task ids,<br/>status open/resolved/needs-human"]
    LEDGER["kickback-ledger.ts<br/>tier lap cap bounds laps;<br/>shared growth (unchanged)"]
  end

  subgraph Spine["Existing event spine"]
    EVENT["as_built_finding_reconciled<br/>(outbox drain, emitOrThrow):<br/>finding id to case id,<br/>relation, reason"]
  end

  VERDICT -->|REMEDIABLE| PROJ
  VERDICT -->|DESIGN halts| STORE
  STORE -->|prior as_built cases| PROJ
  PROJ --> SKILL -.governs.-> CONTRACT
  CONTRACT --> VALIDATE
  VALIDATE -->|rejected: bounded retry| SKILL
  VALIDATE -->|new / materially-changed| APPEND
  VALIDATE -->|same / recurrence| BIND
  APPEND -->|records cases| STORE
  BIND -->|records cases| STORE
  APPEND --> LEDGER
  BIND -->|lap only| LEDGER
  STORE --> EVENT
  VERDICT -->|gate passes: open cases resolved| STORE
```

## Sequence: a reworded finding on a later lap

```mermaid
sequenceDiagram
  participant AB as As-built review
  participant C as conductor planRemediation
  participant P as remediation-projection
  participant R as remediate gap-plan
  participant S as remediation-case-store
  participant A as remediation-append
  AB->>C: BLOCKED, finding as-built:«attempt2»:1 (reworded)
  C->>S: read as_built cases
  S-->>P: case «c1», open, repair task rem-as-built-«t»
  C->>P: build projection with priorAsBuiltCases
  P-->>R: findings + prior cases
  R-->>C: finding 1 relation same, priorCaseId «c1», reason
  C->>C: validate (priorCaseId known, binds open repair task)
  C->>S: add source to case «c1», relation same, reason
  C->>A: no task appended, no growth drawn
  C-->>AB: navigate to BUILD, gate restaged stale
```

## Legend

- **Solid arrows:** data or control flow. **Dotted:** governance (the skill text governs the
  provider output the contract validates).
- **«name»:** a variable value (attempt id, case id, task id).
- **Unchanged components** are named for context only: the as-built verdict contract, the
  kickback-ledger caps, and the build_review and prd-widening modes of remediate.
- The `as_built` record shape and its relation vocabulary are proposals that
  `/architecture-review` fixes in its ADR.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-28 | Initial generation | #3127 DECIDE (tier M): as-built finding reconciliation |
| 2026-10-28 | v4 envelope with asBuiltCases; events through the case-store outbox | Plan review PR-003 and PR-006 |
| 2026-10-28 | Dropped the separate recurrence limit; same/recurrence bind through existing-task restage | Architecture review: the tier lap cap already bounds laps |
