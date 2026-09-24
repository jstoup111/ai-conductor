# Architecture: post-plan DECIDE amendments reconcile at BUILD entry

**Last updated:** 2026-09-23
**Scope:** How `coverage_binding` (the first BUILD step) re-derives DECIDE obligations from the
current sealed artifacts — including amendments made after plan approval — and how an operator
reseal re-arms that check and reopens completed work the amendment contradicts.
**Tier:** M — technical track. Source: intake #1700.

## Problem in one line

The plan's `## Architecture Obligation Coverage` table and coherence criterion rows are validated
only at `engineer land` (`engineer/coherence-validator.ts:1585` → `validateArchitectureObligationCoverage`).
A DECIDE amendment made after land (new ADR `D<n>`, an amended architecture-review condition, a
replaced story criterion) is never compared with the plan again, so the gap surfaces laps later in
`build_review`/`remediate` as a refused `plan` routing and a needs-human HALT (recurred 2026-09-10).

## Diagram 1 — where the obligation refresh sits

```mermaid
graph TD
    subgraph DECIDE["DECIDE (spec PR)"]
        ADR[("ADRs<br/>.docs/decisions/ — D«n» decisions")]
        AR[("architecture review<br/>.docs/decisions/ — conditions")]
        ST[("stories<br/>.docs/stories/ — criteria")]
        PL[("plan<br/>Architecture Obligation Coverage + tasks")]
        CO[("coherence<br/>criterion rows")]
        LAND["engineer land<br/>coherence gate (existing)"]
        ADR --> LAND
        ST --> LAND
        PL --> LAND
        CO --> LAND
    end

    OP["operator amendment + reseal<br/>reseal-cli.ts → resealProtectedArtifactSeal"]
    OP -.amends.-> ADR
    OP -.amends.-> AR
    OP -.amends.-> ST
    OP ==>|"NEW: DECIDE content changed<br/>→ void coverage_binding verdict"| CB

    subgraph BUILD["BUILD"]
        SEAL["seal check<br/>conductor.ts:9919 (existing)"]
        CB["coverage_binding<br/>first BUILD step"]
        OBL["NEW ADR-obligation layer<br/>mechanical: D«n» rows<br/>vs current ADR decisions"]
        JUDGE["existing coverage judge<br/>+ NEW amendment-clause claims<br/>+ NEW contradicted-completed-task verdict"]
        BLD["build tasks"]
        SEAL --> CB --> OBL --> JUDGE
    end

    JUDGE -->|"all covered"| BLD
    OBL -->|"missing D«n» row"| HALT["needs-human HALT<br/>names artifact · clause · plan gap"]
    JUDGE -->|"uncovered clause"| HALT
    JUDGE -->|"completed task contradicts amendment"| REOPEN["reopen task<br/>#1831 reopened-task path"]
    REOPEN --> BLD

    classDef newwork fill:#2d6a4f,stroke:#95d5b2,color:#ffffff,stroke-width:2px
    classDef gate fill:#6a3d2d,stroke:#d5a795,color:#ffffff
    classDef store fill:#333d5c,stroke:#8fa3d5,color:#ffffff
    class OBL,JUDGE,REOPEN newwork
    class LAND,SEAL,HALT gate
    class ADR,AR,ST,PL,CO store
```

## Diagram 2 — amend-after-plan sequence

```mermaid
sequenceDiagram
    participant Op as Operator
    participant Rs as reseal CLI
    participant Cd as conductor
    participant Cb as coverage_binding
    participant Jg as coverage judge
    participant Ev as events.jsonl

    Op->>Rs: amend ADR D«n» / condition, then reseal
    Rs->>Cd: seal rotated (operator-reseal)
    Cd->>Cd: DECIDE content changed, void prior coverage_binding verdict
    Cd->>Cb: next BUILD step entry re-runs coverage_binding
    Cb->>Cb: ADR-obligation layer vs current decisions
    alt required D«n» row missing
        Cb->>Ev: coverage gap event (artifact, clause, plan gap)
        Cb-->>Cd: needs-human HALT naming the gap
    else rows present
        Cb->>Jg: criterion claims + amendment-clause claims + completed tasks
        Jg-->>Cb: schema-constrained verdicts
        alt clause uncovered
            Cb-->>Cd: needs-human HALT naming the gap
        else completed task contradicts amendment
            Cb->>Cd: reopen named tasks
            Cd->>Ev: task reopened (cause: amendment)
        else all covered
            Cb-->>Cd: pass, build proceeds with no ceremony
        end
    end
```

## Legend

- **Green** — new behavior this feature adds. **Brown** — existing gates. **Blue** — sealed
  DECIDE artifacts (`protected-artifact-seal.ts:18-24`; coherence is not sealed).
- **Mechanical** checks (missing `D«n»` row) never call the judge; story criteria stay validated at land only; only
  coverage of free-prose amendment clauses and task contradiction are judgement calls, per the
  repository's machinery-plus-judgement principle.
- Every outcome is emitted on the existing event spine; no sidecar channel.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-23 | Initial generation | Intake #1700 DECIDE |
| 2026-09-23 | Drop BUILD-time criterion layer; reopen only after a reseal void | Conflict-check resolutions |
| 2026-09-23 | Plan update: void lives in `coverage-binding-void.ts`, reopen through shared `repair-restage.ts`; no structural change to the diagrams | /plan |
