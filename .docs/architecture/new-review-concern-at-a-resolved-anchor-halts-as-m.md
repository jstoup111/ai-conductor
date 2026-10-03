# Components: lifecycle-scoped source ownership for a new concern at a resolved anchor

**Last updated:** 2026-10-02
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#2464: a case-v2 judgement may
open a new case at a source id already linked from a resolved case, but only by an explicit,
schema-constrained `distinctFrom` declaration naming that resolved case. An undeclared reuse is a
recurrence bound to the prior case and keeps the existing regression halt. The store's ownership
invariant becomes "at most one unresolved owner per source", every source→case reader selects the
current owner, and a rejected proposed transition is reported with its own typed reason instead of
`malformed-state`. Nothing new is added outside these seams.

## Diagram

```mermaid
graph TD
  subgraph Judge["Existing remediate case-v2 judgement"]
    CTX["build-review-adjudication-context.ts<br/>current findings + every prior case<br/>(unchanged)"]
    JUDGE["remediate skill, case-v2 mode<br/>either binds existingCaseId<br/>or declares distinctFrom «resolvedCaseId»"]
    RESULT[".pipeline/remediation.json"]
  end

  subgraph Admit["Engine-owned admission"]
    PARSE["remediation-case-artifact.ts<br/>parse optional distinctFrom<br/>on unbound case rows"]
    VALIDATE["remediation-case-validator.ts<br/>distinctFrom equals exactly the resolved<br/>act cases linking the row's sources<br/>(prior case records from the coordinator)"]
    RECONCILE["remediation-case-reconciler.ts<br/>declared: append new case<br/>undeclared reuse: bind as recurrence"]
    CLASSIFY["classifyRemediationCaseReuse<br/>resolved act recurrence = halt-regression"]
    COORD["build-review-adjudication-coordinator.ts<br/>transition-rejected diagnostic<br/>vs store malformed-state"]
    REDUCE["build-review-adjudication.ts<br/>coverage + routing read<br/>current owner per source"]
  end

  subgraph State["Feature-scoped durable state"]
    STORE["RemediationCaseStore<br/>.pipeline/remediation-cases.json<br/>at most one unresolved owner per source<br/>resolved history retained"]
    ORDER["build-review-work-order.ts<br/>attemptedCaseIds evidence"]
  end

  subgraph Render["Operator surface"]
    CLI["build-review-cli.ts findings<br/>shows distinctFrom lineage"]
    HALT["needs-human HALT<br/>regression or rejected transition<br/>names case and source ids"]
  end

  subgraph Spine["Existing telemetry spine"]
    EMIT["ConductorEventEmitter"]
    UNION["ConductorEvent union<br/>remediation_adjudication_failed<br/>carries typed rejection reason"]
    PERSIST["EventPersister"]
    EVENTS[".pipeline/events.jsonl"]
  end

  STORE --> CTX
  ORDER --> CTX
  CTX --> JUDGE
  JUDGE --> RESULT
  RESULT --> PARSE
  PARSE --> VALIDATE
  VALIDATE --> RECONCILE
  STORE --> RECONCILE
  RECONCILE --> CLASSIFY
  CLASSIFY -->|recurrence of resolved act| HALT
  RECONCILE -->|admitted| STORE
  RECONCILE -->|rejected transition| COORD
  COORD --> HALT
  STORE --> REDUCE
  REDUCE --> COORD
  STORE --> CLI
  COORD --> EMIT
  EMIT --> UNION
  UNION --> PERSIST
  PERSIST --> EVENTS
```

## Legend

- **Judge** — the existing semantic judgement; it owns the "same concern or new concern?" call.
- **Admit** — deterministic engine admission; it validates the declaration's references but never
  compares rationale prose.
- **State** — feature-scoped durable files; history is never deleted or rewritten.
- `«resolvedCaseId»` — placeholder for a resolved case id from the prior-case context.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-02 | Initial generation | jstoup111/ai-conductor#2464 DECIDE |
| 2026-10-02 | Plan update: context unchanged; validator receives prior case records | Plan Tasks 4 and 10 |
