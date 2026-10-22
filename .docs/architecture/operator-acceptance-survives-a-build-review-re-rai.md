# Components: operator acceptance survives a build_review re-raise (respec of #3271)

**Last updated:** 2026-10-21
**Scope:** Proposed change for jstoup111/ai-conductor#3271, including the outcomes consolidated from
#3303.

Operator acceptance becomes durable case state, written at the moment it happens:

- **Coordinator `finalize`** writes acceptance marks on cases, at the point where it already retires
  operator-accepted cases. It is the only writer of those marks.
- **Reconciler carry lane** is the only component that decides carry. A later `existingCaseId`
  binding to a marked case is appended there as a `carried` source.
- **Settled-source function** (`finalizedBuildReviewSourceIds`) is the only reader path for carry.
- **Case-store outbox** holds each occurrence this feature adds. It is written in the same
  transaction as the state change and drained through the event persister's eventId dedup.

The disposition store remains the only writer of exact accepted risk.

## Diagram

```mermaid
graph TD
  subgraph Operator["Operator (interactive TTY only)"]
    ACCEPT["build-review accept<br/>(unchanged)"]
    RESOLVE["NEW build-review resolve-case<br/>--feature --case --rationale [--child]<br/>RemediationCaseStore.resolveByOperator"]
    FINDINGS["build-review findings [--child]<br/>shows carried, operator-resolved, pending outbox"]
  end

  subgraph State["Feature-scoped durable state"]
    OPDISP["Disposition store<br/>build-review-dispositions.json<br/>sole writer of exact accepted risk"]
    CASES["RemediationCaseStore v3<br/>remediation-cases.json (child-scoped)<br/>case operatorAcceptance marks<br/>case operatorResolution<br/>source outcome carried<br/>outbox of pending occurrences"]
  end

  subgraph Engine["build_review engine"]
    COORD["Adjudication coordinator<br/>finalize: sole writer of acceptance marks<br/>routes proposals by reuse classification"]
    CLASSIFY["classifyRemediationCaseReuse + isCarryEligibleRemediationCase<br/>returns carry for a resolved marked case<br/>or an operator-resolved case<br/>origin dispositions still effective<br/>mark lap differs from this lap"]
    RECON["Reconciler carry lane (admitsCarry)<br/>appends source as carried<br/>no effect, no charge, no decision stop"]
    SETTLE["retiresOpenBuildReviewCase (one function)<br/>reconciler absence, finalize, resolveAbsentFailedBuildReviewCases,<br/>clean-PASS settlement<br/>covered: accepted, origin-marked or carried<br/>failed or unbuilt act retires when covered or absent"]
    SETTLED["finalizedBuildReviewSourceIds<br/>carried authoritative link (currentBuildReviewSourceLinks) is settled"]
    EFF["Effective verdict resolver<br/>child and adjudication flag are required inputs<br/>at every caller"]
    CTX["Adjudication context<br/>prior case shows operatorAccepted"]
    DRAIN["drainRemediationCaseOutbox via emitOrThrow<br/>at coordinator entry, after adding mutations,<br/>settlement entry and exit"]
  end

  subgraph Judge["Existing judgement point"]
    REM["remediate dispatch<br/>binds re-raise via existingCaseId"]
  end

  subgraph Spine["Existing telemetry spine"]
    PERSIST["EventPersister.persistDurably<br/>eventId dedup gains new variants"]
    EVENTS[".pipeline/events.jsonl"]
  end

  subgraph Publish["Publication"]
    PR["Accepted-risk renderer<br/>PR body and shipped record"]
  end

  ACCEPT --> OPDISP
  RESOLVE --> CASES
  OPDISP --> COORD
  COORD -->|marks fully accepted cases| CASES
  CASES --> CTX --> REM --> COORD
  COORD --> CLASSIFY
  CLASSIFY -->|carry| RECON --> CASES
  CASES --> SETTLED --> EFF
  CASES --> SETTLE
  SETTLE --> COORD
  CASES --> DRAIN --> PERSIST --> EVENTS
  CASES --> FINDINGS
  OPDISP --> FINDINGS
  CASES --> PR
  OPDISP --> PR
```

## Legend

- **NEW**: a component or command that does not exist on main.
- `CASES` is the only new persisted state. v2 stays readable and is upgraded to v3 on write,
  following the existing v1→v2 precedent.
- The carry decision lives in exactly one place, `CLASSIFY` → `RECON`. `SETTLED` and every reader
  consume the persisted `carried` outcome and never re-derive it.
- Event emission happens only in `DRAIN`. Nothing this feature adds emits directly after a write.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-20 | Initial generation | Respec of #3271 after revert #3319 |
| 2026-10-20 | Carry requires a resolved case; retirement predicate shared with reconciler absence | Architecture review refinement (ADR D3, D5) |
| 2026-10-21 | Plan-update: owner function names, #3292 authoritative-link baseline, drain points, findings --child | /plan for the #3271 respec |
