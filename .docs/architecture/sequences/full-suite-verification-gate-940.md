# Sequence: Shared full-suite verification and reuse (#940)

**Last updated:** 2026-07-25
**Scope:** Automated and direct-Claude entry, current-proof reuse, failure
kickback, finish fallback, and independent PR/CI behavior.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant FLOW as Conductor test_suite gate<br/>or direct /test-suite
    participant VERIFY as Shared configured verifier
    participant CFG as .ai-conductor/config.yml
    participant INPUT as Git/worktree + declared env
    participant PROOF as .pipeline/test-suite-evidence.json
    participant RUN as Authoritative suite process
    participant BUILD as BUILD remediation
    participant SHIP as SHIP validators
    participant FIN as finish
    participant PR as /pr
    participant CI as CI

    Note over FLOW,VERIFY: test_suite is after build_review + wiring_check<br/>and before the first SHIP validator
    FLOW->>VERIFY: ensure current full-suite PASS
    VERIFY->>CFG: resolve aggregate command and inputs

    alt config/command/input resolution is indeterminate
        VERIFY->>PROOF: atomically record blocking reason
        VERIFY-->>FLOW: FAIL closed
        alt automated conductor
            FLOW->>BUILD: kick back with actionable evidence
        else direct Claude
            FLOW-->>FLOW: block SHIP and route to /tdd or /pipeline
        end
    else inputs resolvable
        VERIFY->>INPUT: calculate content fingerprint
        VERIFY->>PROOF: read prior result
        alt prior PASS has identical fingerprint
            PROOF-->>VERIFY: current PASS
            VERIFY-->>FLOW: REUSED with proof timestamp
        else proof missing, failed, or stale
            VERIFY->>RUN: execute aggregate project suite
            alt exit 0 before timeout
                RUN-->>VERIFY: PASS + bounded output
                VERIFY->>PROOF: atomically record PASS + fingerprint
                VERIFY-->>FLOW: EXECUTED PASS
            else launch error, timeout, or non-zero exit
                RUN-->>VERIFY: failure + bounded output
                VERIFY->>PROOF: atomically record FAIL + reason
                VERIFY-->>FLOW: FAIL closed
                alt automated conductor
                    FLOW->>BUILD: kick back with failure evidence
                else direct Claude
                    FLOW-->>FLOW: block SHIP and route to /tdd or /pipeline
                end
            end
        end
    end

    opt gate passed
        FLOW->>SHIP: begin manual_test / PRD audit / as-built review
        SHIP->>FIN: completion verification
        FIN->>VERIFY: ensure current full-suite PASS
        alt proof still current
            VERIFY-->>FIN: REUSED without process launch
        else proof missing or stale
            VERIFY->>RUN: fallback execution
            RUN-->>VERIFY: PASS or blocking FAIL
            VERIFY->>PROOF: replace evidence
            VERIFY-->>FIN: result
        end
        FIN->>PR: chosen completion path
        Note over PR: no local suite execution
        PR->>CI: push / open or update PR
        CI->>RUN: independent authoritative CI suite
    end
```

## Earlier full-suite fallback

When scoped-test selection is unsafe or impossible during BUILD, the workflow
uses the host's repository-configured verifier interface instead of calling the
project's aggregate command directly. A successful fallback therefore writes the same proof. At
the explicit `test_suite` gate, unchanged inputs produce `REUSED`, not a second
execution.

Ordinary TDD cycles, batch boundaries, parallel joins, and `build_review`
continue to execute only their scoped or impacted test sets.

## Invalidation behavior

- The verifier recalculates the fingerprint on every gate/CLI/finish call, so
  source, test, configuration, dependency, migration, test-infrastructure,
  declared environment, and relevant uncommitted changes become stale without
  relying solely on step state or `HEAD`.
- Documentation-only changes do not alter the fingerprint.
- A post-PASS BUILD kickback or rebase may preserve the proof only when the
  recalculated fingerprint is identical. Any indeterminate comparison forces a
  new run or blocks if the suite cannot be run.
- A resumed completed state performs the same current-proof check before it is
  accepted; stale completion metadata does not bypass verification.
- Status reporting distinguishes `EXECUTED`, `REUSED`, `STALE`, and `FAILED`
  and includes the invalidation/failure reason.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial generation | DECIDE phase for issue #940 |
| 2026-07-25 | Added completed-state resume behavior and confirmed plan Tasks 10–20 preserve the sequence | Plan-update architecture pass |
