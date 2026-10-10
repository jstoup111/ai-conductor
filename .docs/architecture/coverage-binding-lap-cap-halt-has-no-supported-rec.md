# Sequence: coverage_binding lap-cap halt recovered through kickback-budget

**Last updated:** 2026-10-10
**Scope:** The coverage_binding existing-task reopen path, its lap-cap halt, and its recovery through the existing operator `kickback-budget` command family and daemon resume-authorization sweep (#2846). No new component, store, halt class, or event type.

## Diagram

```mermaid
sequenceDiagram
    participant CB as coverage_binding step runner
    participant Restage as admitAndRestageRepair
    participant Ledger as kickback-ledger.json (gates.coverage_binding)
    participant Conductor as Conductor refusal handler
    participant Op as Operator (kickback-budget CLI)
    participant Spine as Event spine (events.jsonl)
    participant Daemon as Daemon resume-authorization sweep

    CB->>Restage: Reopen bound completed tasks (gates coverage_binding)
    Restage->>Ledger: settleRemediationRound under lease
    Note over Restage,Ledger: Cap = feature-local effectiveLapCap, else engine default per-gate cap
    alt laps below cap
        Ledger-->>Restage: Lap charged, receipt recorded
        Restage-->>CB: Restaged, tasks reopened
    else laps at cap
        Ledger-->>Restage: capExceeded coverage_binding
        Restage-->>CB: Failed with capExceeded
        CB->>Ledger: recordKickbackCapEvidence (allowance laps, consumed, limit, generation)
        CB-->>Conductor: needs-human refusal with recovery hint and halt generation line
        Conductor->>Conductor: Write HALT, class needs-human
    end

    Op->>Ledger: inspect lists coverage_binding laps, cap, adjustments
    Op->>Ledger: raise --gate coverage_binding --by N --rationale (park, lease, stage)
    Op->>Spine: kickback_budget_adjustment_authorized
    Op->>Ledger: Apply: effectiveLapCap raised, adjustment history, resume authorization
    Daemon->>Ledger: Authorization matches live generation and class needs-human
    Daemon->>Daemon: Clear HALT, consume authorization
    Daemon->>CB: Re-dispatch
    CB->>Restage: Reopen replays admission
    Restage->>Ledger: Settle under raised cap succeeds
    Restage-->>CB: Restaged, tasks reopened
```

## Legend

- `gates.coverage_binding` is the existing ledger key the coverage_binding reopen already charges (adr-2026-09-06-reopened-task-resolution decision 10).
- The single lap-counted-gate predicate decides, for staging, apply, inspect, and the CLI, that `coverage_binding` is budgeted in `laps` and `effectiveLapCap` like `prd_audit` and `architecture_review_as_built`, not in `cumulative` and `effectiveLimit` like `build_review`.
- Every operator-side step is the existing #2190 / adr-2026-08-29 recovery mechanism, unchanged except that it now admits this gate.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | DECIDE for #2846 |
