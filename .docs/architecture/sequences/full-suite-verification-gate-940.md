# Sequence: Deterministic BUILD verification fan-out

**Last updated:** 2026-07-29
**Scope:** Concurrent wiring and aggregate-suite verification, single-writer join, deferred model review, BUILD remediation, and proof reuse.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant FLOW as Conductor BUILD tail
    participant WIRE as Wiring probe
    participant VERIFY as FullSuiteVerifier
    participant RUN as Aggregate suite process
    participant JOIN as Deterministic join
    participant REVIEW as build_review
    participant BUILD as BUILD remediation
    participant SHIP as SHIP validators
    participant FIN as finish
    participant CI as CI

    Note over FLOW,JOIN: No model review is dispatched before both deterministic branches settle
    par Wiring verification
        FLOW->>WIRE: inspect reachability
        WIRE-->>JOIN: PASS or actionable FAIL
    and Aggregate verification
        FLOW->>VERIFY: ensure current full-suite PASS
        alt current content-addressed PASS exists
            VERIFY-->>JOIN: REUSED PASS
        else proof missing, stale, or failed
            VERIFY->>RUN: execute configured aggregate suite
            RUN-->>VERIFY: exit result and bounded diagnostics
            VERIFY-->>JOIN: EXECUTED PASS or actionable FAIL
        end
    end

    alt either deterministic branch failed
        JOIN-->>FLOW: fail-closed joined result
        FLOW->>BUILD: kick back with deterministic evidence
    else both deterministic branches passed
        JOIN-->>FLOW: joined PASS
        FLOW->>REVIEW: dispatch model-judged build review
        alt build review failed
            REVIEW-->>FLOW: blocking verdict
            FLOW->>BUILD: kick back with review evidence
        else build review passed
            REVIEW-->>FLOW: PASS
            FLOW->>SHIP: begin validation group
            SHIP->>FIN: completion verification
            FIN->>VERIFY: re-inspect current suite proof
            VERIFY-->>FIN: REUSED or blocking result
            FIN->>CI: push path retains independent CI authority
        end
    end
```

## Join contract

- Both deterministic branches are allowed to settle; neither writes conductor state directly.
- The join is the sole state, gate, and event writer for the fan-out round.
- A failed aggregate suite and a failed wiring probe retain their existing reason classifications and BUILD kickback targets.
- `build_review` is never launched on a joined deterministic failure.
- Cancellation or interruption preserves settled branch evidence and leaves incomplete branches retryable without converting absence into success.
- The aggregate suite may write ignored ephemeral outputs such as coverage data, but it does not mutate fingerprinted project inputs or wiring-probe inputs; both branches therefore observe the same completed build.

## Standalone verification

`conduct-ts test-suite` invokes `FullSuiteVerifier` directly and reports the same current, stale, executed, reused, and failed outcomes. It is a deterministic command surface, not a skill invocation.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial generation | DECIDE phase for issue #940 |
| 2026-07-25 | Added completed-state resume behavior | Issue #940 plan update |
| 2026-07-29 | Replaced the serial skill-facing flow with deterministic BUILD fan-out and deferred model review | Deterministic test-suite step specification |
