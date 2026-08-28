# Components + Sequence: skip-preserving kickback restage (#1987)

**Last updated:** 2026-08-27
**Scope:** the kickback restage path in the conductor state machine — how a `skipped` step
status survives every kickback, how a `skipped → stale` divergence is surfaced at the write,
and how `--diagnose` reports legitimately skipped steps.

## Diagram

```mermaid
graph TD
    subgraph conductor["conductor.ts (kickback handlers)"]
        K1["manual_test FAIL kickback (:5824)"]
        K2["validation group kickback (:7376)"]
        K3["validation gaps kickback (:7524)"]
        K4["build_review kickback (:10192)"]
    end

    H["restageStepsForKickback helper<br/>(skips any step whose status is 'skipped')"]
    CSC["commitStateChanges"]
    INV["write-time invariant:<br/>reject/report skipped → stale"]
    ST["conduct-state.json"]
    GATE["gates/manual_test.json<br/>(satisfied: true, 'skipped: …')"]
    FIN["FINISH observeShipEvidence<br/>(stepDone = done || skipped)"]
    DIAG["complete-verifier (--diagnose)<br/>skip-aware: status 'skipped' ⇒ satisfied"]

    K1 --> H
    K2 --> H
    K3 --> H
    K4 --> H
    H --> CSC
    CSC --> INV
    INV --> ST
    ST --> FIN
    ST --> DIAG
    GATE -. "verdict stays consistent with status" .- ST
```

```mermaid
sequenceDiagram
    participant BR as build_review kickback
    participant H as restage helper
    participant CSC as commitStateChanges
    participant ST as conduct-state.json
    participant FIN as FINISH preflight

    BR->>H: restage build_review, manual_test
    H->>ST: read current statuses
    Note over H: manual_test = 'skipped'<br/>⇒ excluded from stale set
    H->>CSC: { build_review: 'stale' }
    CSC->>CSC: invariant: no skipped → stale in changes
    CSC->>ST: persist
    FIN->>ST: stepDone(manual_test)?
    ST-->>FIN: 'skipped' ⇒ evidence present
    Note over FIN: ship proceeds — no ship_evidence_invalid
```

## Legend

- **restage helper** — the single routing point for all four explicit kickback restage sites;
  `markDownstreamStale` (state.ts:290) is already skip-safe and is unchanged.
- **invariant** — defence in depth: even a future call site that bypasses the helper cannot
  silently persist a `skipped → stale` transition; the divergence is surfaced at the write.
- Dashed line — the gate file's recorded skip verdict and the step status can no longer
  disagree, because the status is never overwritten.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-27 | Initial generation | DECIDE for #1987 (engineer worktree) |
