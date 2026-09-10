# Components: bounded refutation lane for a re-raised build_review case

**Last updated:** 2026-09-09
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#2409: the existing case-v1
adjudicator gains one judge-authored terminal outcome for an already-attempted action case, the
engine admits it only under mechanical bounds, persists the rationale, renders it, and routes the
narrow residual through the existing deferral effect. Nothing new is added outside these seams.

## Diagram

```mermaid
graph TD
  subgraph Judge["Existing remediate case-v1 judgement"]
    CTX["build-review-adjudication-context.ts<br/>current findings, prior cases,<br/>effect pointers incl. BUILD attempted"]
    JUDGE["remediate skill, case-v1 mode<br/>rebinds existingCaseId with a<br/>schema-constrained refutation record"]
    RESULT["Current case-v1 result<br/>.pipeline/remediation.json"]
  end

  subgraph Admit["Engine-owned admission and bounds"]
    PARSE["remediation-case-artifact.ts<br/>parse refutation record:<br/>claim, assertion verdicts, anchors,<br/>confidence, optional residual"]
    VALIDATE["remediation-case-validator.ts<br/>source-complete graph<br/>refutation outcome agrees with case"]
    ANCHORS["remediation-refutation-evidence.ts<br/>every cited path exists and<br/>its normalized excerpt occurs"]
    RECONCILE["remediation-case-reconciler.ts<br/>admit refutation only on an<br/>attempted, applied action case<br/>once per case; else halt-repeat"]
    CLASSIFY["classifyRemediationCaseReuse<br/>unrefuted repeat still halts"]
    COORD["build-review-adjudication-coordinator.ts<br/>settle refuted source; no kickback;<br/>route residual to deferral"]
    REDUCE["build-review-adjudication.ts<br/>finalized non-action outcome routes PASS"]
  end

  subgraph Effects["Existing deterministic effect boundary"]
    DEFER["remediation-case-effects.ts<br/>deferral effect for the residual<br/>files one intake issue"]
    BUDGET["kickback-ledger.ts<br/>refutation charges nothing"]
  end

  subgraph State["Feature-scoped durable state"]
    HISTORY["RemediationCaseStore<br/>.pipeline/remediation-cases.json<br/>case resolved with refuted terminal<br/>and persisted rationale"]
    ORDER["build-review-work-order.ts<br/>attemptedCaseIds evidence"]
    OPDISP["Operator accepted-risk state<br/>.pipeline/build-review-dispositions.json<br/>never written by a refutation"]
  end

  subgraph Render["Operator surface"]
    CLI["build-review-cli.ts findings<br/>reads case store; shows case,<br/>refuted terminal, rationale"]
    HALT["needs-human HALT<br/>only for unrefuted repeat"]
  end

  subgraph Spine["Existing telemetry spine"]
    EMIT["ConductorEventEmitter"]
    UNION["ConductorEvent union<br/>+ remediation_case_refuted"]
    PERSIST["EventPersister"]
    EVENTS[".pipeline/events.jsonl"]
  end

  subgraph External["Existing external boundary"]
    GH["GitHub Issues"]
  end

  CTX --> JUDGE
  ORDER --> CTX
  HISTORY --> CTX
  JUDGE --> RESULT
  RESULT --> PARSE
  PARSE --> VALIDATE
  VALIDATE --> ANCHORS
  ANCHORS --> RECONCILE
  ORDER --> RECONCILE
  RECONCILE --> CLASSIFY
  CLASSIFY -->|unrefuted act repeat| HALT
  RECONCILE -->|refutation admitted| COORD
  RECONCILE --> HISTORY
  COORD --> DEFER
  COORD --> BUDGET
  COORD --> REDUCE
  DEFER --> GH
  DEFER --> HISTORY
  HISTORY --> CLI
  OPDISP --> CLI
  COORD --> EMIT
  EMIT --> UNION
  UNION --> PERSIST
  PERSIST --> EVENTS
```

## Legend

- **Judge** — the existing `remediate` case-v1 dispatch; it gains one representable move
  (a refutation record on an `existingCaseId`) and no new authority.
- **Admit** — engine-owned, deterministic. Admission is mechanical: attempted plus applied action
  case, once per case, `high` confidence, resolvable anchors. A judge that re-proposes `act` on the
  same case reaches `classifyRemediationCaseReuse` unchanged and halts as today.
- **Effects** — reused as-is. The refutation itself has no effect and consumes no kickback; the
  optional residual is an ordinary deferral effect.
- **State** — the case store gains a refuted terminal plus the persisted rationale; the operator
  disposition store is never touched by this lane.
- **Render** — `build-review findings` opens the case store for the first time.
- **Spine** — one new `ConductorEvent` member on the existing emitter/persister path.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-09 | Initial generation | DECIDE for jstoup111/ai-conductor#2409 |
| 2026-09-09 | Evidence node is a path-plus-excerpt resolver | Plan update: content-region hashes anchor test titles, not file content |
