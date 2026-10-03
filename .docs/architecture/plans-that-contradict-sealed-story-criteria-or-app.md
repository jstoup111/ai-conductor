# Architecture: coverage_binding refuses plans that contradict sealed criteria or ADR decisions

**Last updated:** 2026-10-03
**Scope:** The new conflict-claim class inside `coverage_binding` (the first BUILD step): every
sealed story criterion and every approved ADR decision the plan is subject to is judged against
**all** plan tasks' `Done when` checks, on every tier, and a conflict halts before any task code.
**Tier:** M, technical track. Source: intake #2750 (plus the 2026-10-02 ADR-conflict comment).

## Problem in one line

A coverage claim only shows the judge the `Done when` of the tasks its row cites
(`coverage-binding-inputs.ts` `assembleCoverageBindingClaims`), so an uncited task that requires
the opposite outcome is invisible. All three 2026-09-25 evidence features passed coverage_binding
(enabled here since 2026-09-19) and halted in SHIP. The ADR layer is a mechanical row check that is
skipped for Tier S (`step-runners.ts` ADR layer guard), so the reporting_app ADR conflicts were never read.

## Diagram 1 — where the conflict class sits

```mermaid
graph TD
    subgraph SEALED["Sealed DECIDE inputs"]
        ST[("stories<br/>.docs/stories/«stem».md<br/>criteria")]
        ADR[("approved ADRs<br/>.docs/decisions/ D«n»")]
        PL[("plan<br/>all tasks + Done when")]
        CAR[("coverage carrier<br/>coherence rows (M/L)<br/>plan coverage rows (S)")]
    end

    subgraph CB["coverage_binding (first BUILD step, before any task code)"]
        MECH["existing mechanical layers<br/>plan slices · ADR obligation rows (M/L)"]
        COV["existing coverage claims<br/>criterion vs CITED tasks"]
        AMD["existing amendment claims"]
        CON["NEW conflict claims<br/>each criterion · each subject ADR D«n»<br/>vs ALL tasks' Done when · all tiers"]
        ASM["NEW conflict input assembly<br/>criteria from sealed stories<br/>ADRs: obligation table + DECIDE set + plan-cited stems"]
        JDG["auxiliary judge<br/>closed verdict: consistent or conflicts"]
    end

    ST --> ASM
    ADR --> ASM
    PL --> ASM
    CAR --> COV
    PL --> COV
    MECH --> COV --> AMD --> JDG
    ASM --> CON --> JDG

    JDG -->|"all consistent and covered"| BLD["build tasks"]
    JDG -->|"conflicts"| HALT["needs-human HALT<br/>names criterion or adr#D«n»<br/>+ conflicting task ids + reason"]
    JDG -.->|"coverage_binding_conflict_judged"| EV[("events.jsonl")]

    classDef newwork fill:#2d6a4f,stroke:#95d5b2,color:#ffffff,stroke-width:2px
    classDef gate fill:#6a3d2d,stroke:#d5a795,color:#ffffff
    classDef store fill:#333d5c,stroke:#8fa3d5,color:#ffffff
    class CON,ASM newwork
    class MECH,COV,AMD,JDG,HALT gate
    class ST,ADR,PL,CAR,EV store
```

## Diagram 2 — conflict judgement sequence

```mermaid
sequenceDiagram
    participant Cd as conductor
    participant Cb as coverage_binding
    participant As as conflict assembly
    participant Jg as auxiliary judge
    participant Ev as events.jsonl

    Cd->>Cb: run first BUILD step (judge enabled)
    Cb->>Cb: existing mechanical layers + coverage + amendment claims
    Cb->>As: plan, sealed stories, subject ADRs, tier
    As-->>Cb: conflict claims, one per criterion or adr#D«n», each with every task's Done when
    Cb->>Jg: batched conflict claims, short issued ids
    Jg-->>Cb: per-claim verdict consistent or conflicts(taskIds, reason)
    Cb->>Cb: strict payload parse, unknown claim or task id is a payload error
    Cb->>Ev: conflict judged (claim, verdict, taskIds)
    alt any conflicts
        Cb-->>Cd: needs-human refusal naming criterion or decision and tasks
    else all consistent
        Cb-->>Cd: pass, build proceeds with no new refusal
    end
```

## Legend

- **Green** — new behavior this feature adds. **Brown** — existing gate machinery reused unchanged.
  **Blue** — inputs and the event spine.
- The conflict verdict is a judgement (two outcomes can or cannot hold together), so it is an LLM
  claim with a closed, strictly parsed verdict; the bookkeeping (which criteria, which ADRs, which
  tasks, payload validation, halt) is machinery.
- It rides the existing `coverage_binding.judge.enabled` flag and the existing needs-human refusal;
  it never routes to plan and never appends tasks (adr-2026-08-31-coverage-binding-judge-step D6).
- Outcomes are emitted on the existing `ConductorEvent` spine; no sidecar channel.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | Intake #2750 DECIDE |
| 2026-10-03 | Plan update: conflict inputs live in `coverage-binding-conflict-inputs.ts`; refusal is evaluated before the D19 reopen; no structural change to the diagrams | /plan |
