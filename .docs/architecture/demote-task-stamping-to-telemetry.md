# Components & Flow: BUILD-phase Completion Authority (#773)

**Last updated:** 2026-07-21
**Scope:** The BUILD-phase completion authority in the conductor engine — how the build step
decides "done" — BEFORE and AFTER demoting per-task stamping from a gate to telemetry. Focused
component + sequence view (this change modifies a state machine, not the L1/L2 topology).

## Diagram 1 — BEFORE: per-task evidence-ledger gate (the wedge surface)

```mermaid
graph TD
    subgraph BUILD["BUILD step completion (artifacts.ts build predicate)"]
        PRED["build predicate<br/>unresolved = tasks.filter(id =&gt; !stamps.has(id))<br/>artifacts.ts:1032-1052"]
    end

    subgraph DERIVE["Per-task stamp derivation (autoheal.ts) — WEDGE CLASSES"]
        CORR["corroboration #707<br/>path / dirname match"]
        REACH["reachability + pinned #766/#769/#771<br/>stampShaReachable"]
        NODIFF["no-diff holes #733<br/>empty-commit / Evidence:skipped"]
        VONLY["verify-only #677<br/>parsePlanTaskVerifyOnly"]
        SEED["evidence-based reseed #692<br/>task-seed restore-from-stamps"]
    end

    subgraph JUDGE["Attribution judge lane (per-task citation gate)"]
        LANE["runAttributionLane<br/>writes semantic-verified stamps"]
        VALID["validateCitations<br/>5-check: reachability/ancestry/<br/>non-empty/not-bookkeeping/path-overlap"]
    end

    subgraph PARK["No-evidence stall / park"]
        NOEV["noEvidenceAttempts counter"]
        AUTOPARK["checkAndAutoPark<br/>park on counter &gt;= max"]
        NOPROG["no_task_progress<br/>countResolvedTasks delta"]
    end

    SIDECAR[("task-evidence.json<br/>EvidenceStamp map")]

    CORR --> SIDECAR
    REACH --> SIDECAR
    NODIFF --> SIDECAR
    VONLY --> SIDECAR
    SEED --> SIDECAR
    LANE --> VALID --> SIDECAR
    SIDECAR --> PRED
    PRED -->|miss| DERIVE
    PRED -->|residue| JUDGE
    PRED -->|repeated miss| PARK
    PARK -->|park/HALT| STOP["build wedged / operator intervention"]
    PRED -->|all stamped| DONE1["build done"]

    classDef del fill:#4a1616,stroke:#b60205,color:#fff;
    class PRED,CORR,REACH,NODIFF,VONLY,SEED,LANE,VALID,NOEV,AUTOPARK,NOPROG del
```

## Diagram 2 — AFTER: build-end judgement gate + telemetry-only stamps

```mermaid
graph TD
    subgraph BUILDA["BUILD step completion (redefined)"]
        STRUCT["structural advance<br/>(no per-task stamp check)"]
        COMPLETE["plan-completeness gate (NEW)<br/>LLM: plan tasks vs build diff<br/>same class as build_review/prd_audit"]
    end

    subgraph OUTCOME["Outcome gates (sole completion authority) — UNCHANGED"]
        ACC["acceptance_specs RED→GREEN"]
        BREV["build_review"]
        WIRE["wiring_check (export reachability)"]
        MAN["manual_test"]
        PRD["prd_audit (product track)"]
        ASB["architecture_review_as_built"]
    end

    subgraph BOUNDS["Independent stall bounds — KEPT"]
        RETRY["stepMaxRetries"]
        LADDER["#188 escalation ladder"]
        KB["MAX_KICKBACKS_PER_GATE"]
        HALT["halt_marker"]
    end

    subgraph TELEM["Stamps as TELEMETRY only — KEPT"]
        TRAIL["git Task: trailers (attribution)"]
        PROG["progress counts #757<br/>countResolvedTasks"]
        SPOT["attribution spot-audit ledger"]
    end

    STRUCT --> COMPLETE
    COMPLETE -->|named gaps| REMED["remediation kickback<br/>(bounded by KB / ladder)"]
    REMED --> STRUCT
    COMPLETE -->|complete| OUTCOME
    OUTCOME --> DONE2["build/SHIP done"]
    BOUNDS -.bounds.-> COMPLETE
    BOUNDS -.bounds.-> REMED
    TRAIL -.reads.-> PROG
    TRAIL -.reads.-> SPOT

    classDef new fill:#123d1a,stroke:#2ea043,color:#fff;
    classDef keep fill:#16324a,stroke:#1f6feb,color:#fff;
    class COMPLETE,REMED new
    class ACC,BREV,WIRE,MAN,PRD,ASB,RETRY,LADDER,KB,HALT,TRAIL,PROG,SPOT keep
```

## Diagram 3 — AFTER: build-completion sequence

```mermaid
sequenceDiagram
    participant C as conductor (build loop)
    participant B as build step
    participant J as plan-completeness gate (LLM)
    participant R as remediation
    participant O as outcome gates
    participant T as telemetry (trailers/progress/spot-audit)

    C->>B: run build step (dispatch tasks)
    B->>T: stamp Task: «id» trailers, update progress counts
    Note over B,T: stamps are recorded, they NEVER gate
    C->>J: judge — were all plan tasks implemented? (plan vs diff)
    alt gaps found
        J-->>C: named gaps
        C->>R: kickback (bounded by MAX_KICKBACKS / #188 ladder)
        R->>B: re-dispatch missing work
    else complete
        J-->>C: complete
        C->>O: acceptance GREEN, build_review, wiring, manual_test, prd_audit, as_built
        O-->>C: pass → build/SHIP done
    end
    Note over C,R: no per-task stamp reachability/corroboration — cannot wedge on stamp bookkeeping
```

## Legend

- **Red nodes (Diagram 1):** code paths DELETED by #773 — the per-task mechanical stamp gating
  and its wedge classes (#692/#677/#707/#733/#766/#769/#771).
- **Green nodes (Diagram 2/3):** NEW — the single build-end LLM plan-completeness judgement gate
  and its bounded remediation kickback.
- **Blue nodes:** KEPT unchanged — the outcome gates that become the sole completion authority,
  the independent stall bounds, and the stamps surviving as pure telemetry.
- **Separate same-named gates that stay untouched** (not shown as changed): `wiring_check` export
  reachability, acceptance-specs RED-evidence, shipped-record dedup ledger, owner-gate provenance,
  push-evidence finish false-ship guard. They share vocabulary ("reachability"/"evidence"/"ledger")
  with the demoted gate but are distinct systems.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-21 | Initial generation | Created during DECIDE for #773 (demote task-stamping to telemetry) |
