# Components: carried operator acceptance across build_review re-raises

**Last updated:** 2026-10-19
**Scope:** Proposed change for jstoup111/ai-conductor#3271. A read-side resolver derives carried
operator acceptance by joining the remediation case store's source links with the operator
disposition store. Every consumer of accepted risk reads that one resolver. The disposition store
stays the only writer and owner of accepted risk, and the case store stays the only owner of
equivalence links. Nothing new is persisted.

## Diagram

```mermaid
graph TD
  subgraph State["Feature-scoped durable state (schemas unchanged)"]
    OPDISP["Operator disposition store<br/>.pipeline/build-review-dispositions.json<br/>sole owner of accepted risk"]
    CASES["RemediationCaseStore<br/>.pipeline/remediation-cases.json<br/>case sources = equivalence links"]
  end

  subgraph Resolver["NEW: one shared read-side resolver"]
    CARRY["build-review-acceptance-resolver.ts<br/>resolveBuildReviewAcceptance<br/>direct: exact disposition match<br/>carried: source of a case that holds<br/>a directly accepted source<br/>returns origin finding id and lap"]
  end

  subgraph Consumers["Existing consumers, rewired to the resolver"]
    EFF["build-review-effective.ts / aggregate<br/>effective verdict and accepted ids"]
    COORD["build-review-adjudication-coordinator.ts<br/>accepted set, finalize, failUnlessAccepted"]
    RECON["remediation-case-reconciler.ts<br/>appendCarriedRemediationCaseSources<br/>appends links only, case otherwise byte-identical"]
    STOP["remediation-case-effects.ts<br/>escalate bound to accepted case:<br/>carry, no decision stop, no conflict"]
    CTX["build-review-adjudication-context.ts<br/>prior case carries operatorAccepted marker"]
    CLI["build-review-cli.ts findings<br/>carried row: origin operator, rationale, lap"]
    PR["build-review-accepted-risk.ts<br/>PR body: id, rubric, carried-from id and lap"]
  end

  subgraph Judge["Existing judgement point"]
    REM["remediate dispatch<br/>binds re-raised finding via existingCaseId"]
    SKILL["skills/remediate/SKILL.md<br/>may bind to an accepted case<br/>never asserts or creates acceptance"]
  end

  subgraph Spine["Existing telemetry spine"]
    EMIT["ConductorEventEmitter"]
    EVT["NEW variant<br/>build_review_disposition_carried"]
    EVENTS[".pipeline/events.jsonl"]
  end

  OPDISP --> CARRY
  CASES --> CARRY
  CARRY --> EFF
  CARRY --> COORD
  CARRY --> RECON
  CARRY --> STOP
  CARRY --> CTX
  CARRY --> CLI
  CARRY --> PR
  CTX --> REM
  SKILL -.governs.-> REM
  REM --> RECON
  RECON --> CASES
  COORD --> EMIT
  EMIT --> EVT
  EVT --> EVENTS
```

## Re-raise flow

```mermaid
sequenceDiagram
  participant G as Rubric graders
  participant C as Adjudication coordinator
  participant R as Acceptance resolver
  participant J as remediate judge
  participant S as Case store
  participant E as Event spine
  G->>C: lap N+1 raw FAIL, finding «new-id» (drifted identity)
  C->>R: is «new-id» accepted?
  R-->>C: no (unbound, not yet linked)
  C->>J: unresolved «new-id» plus prior cases, case «k» marked operatorAccepted
  J-->>C: existingCaseId «k» for «new-id»
  C->>S: append «new-id» as source of case «k»
  C->>R: is «new-id» accepted?
  R-->>C: carried from «orig-id», lap «L»
  C->>E: build_review_disposition_carried
  C-->>C: no halt-regression, no decision stop, no effect, no charge
  Note over C: unbound findings follow today's path unchanged
```

## Legend

- **NEW** marks the only additions: one resolver function and one `ConductorEvent` variant with
  its sink registration. Every other node is an existing module changed in place.
- Solid arrows are data reads or writes; the dotted arrow is a governing contract.
- «placeholders» are variable identifiers.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-19 | Initial generation | DECIDE for jstoup111/ai-conductor#3271 |
| 2026-10-19 | Named the resolver module and the carried-link append | Plan-update for the #3271 plan |
