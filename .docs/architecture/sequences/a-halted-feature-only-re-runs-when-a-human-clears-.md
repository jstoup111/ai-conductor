# Sequences: suite-infra bounded lane and kickback-budget recovery (#2190)

**Last updated:** 2026-09-05
**Scope:** The two resume paths this feature delivers — a bounded in-step retry for a test_suite
infrastructure failure, and the operator budget-recovery command with the daemon-side clear — as
approved by architecture-review under adr-2026-08-18 and adr-2026-08-29.

## Flow 1 — test_suite infrastructure failure → bounded lane → needs-human

```mermaid
sequenceDiagram
  participant C as Conductor (test_suite step)
  participant V as FullSuiteVerifier
  participant L as suite-infra lane counter (.pipeline, durable)
  participant S as Event spine
  participant M as halt-marker

  C->>V: inspect / run full suite
  V-->>C: status FAILED, reason ≠ nonzero_exit (timeout, spawn, …)
  C->>L: read attempts for this feature
  alt attempts < MAX_SUITE_INFRA_RETRIES
    C->>L: attempts + 1 (atomic temp + rename)
    C->>S: step_retry {step test_suite, attempt, reason infrastructure}
    Note over C: no kickback budget charged (adr-2026-08-18 D3)
    C->>V: re-run
  else allowance spent
    C->>M: writeHaltMarker("test_suite infrastructure failure (reason) after N automatic retries", needs-human)
    C->>S: loop_halt
    Note over C: feature waits for a human, as today
  end
```

## Flow 2 — operator raises the budget, daemon clears the halt

```mermaid
sequenceDiagram
  participant O as Operator
  participant K as kickback-budget CLI (pre-boot)
  participant P as .daemon/parked
  participant LG as .pipeline/kickback-ledger.json
  participant S as Event spine
  participant D as Daemon halted-feature boundary
  participant H as halt-state clear (atomic)
  participant C as Conductor

  O->>K: kickback-budget raise --feature «slug» --by N --rationale "…"
  K->>K: interactive-terminal gate + machine-scoped identity (D3)
  K->>P: establish park quiescence (D4)
  K->>LG: stage adjustment {kind raise, by N, rationale, generation} (D5)
  K->>LG: apply: effectiveLimit + N, history appended (D1/D2)
  K->>S: kickback_budget_adjusted {feature, gate, kind, by, rationale} (D7)
  K->>P: release quiescence
  K-->>O: rendered inspection: consumed / effectiveLimit / laps remaining (D8)
  Note over D: next boundary — HALT is needs-human (08-29-successor D1)
  D->>LG: read typed cap evidence + authorization, generation must match (successor D2/D3)
  alt authorization valid and unconsumed
    D->>H: clear HALT + HALT.class + needs-remediation label as one operation (adr-2026-08-09)
    D->>LG: mark authorization consumed
    D->>S: halt_cleared {feature, cause kickback-budget}
    D->>C: dispatch «slug» → resume after last completed step
  else no authorization, stale generation, or unreadable ledger
    D-->>D: retain halt (adr-2026-08-31 §1: never more permissive than the record)
  end
```

## Legend

- «…» — variable segment placeholder.
- Flow 1 charges nothing against the kickback budget and derives escalation from `attempt`
  (adr-2026-07-05 §7); the counter is durable across dispatches like `MAX_MECHANICAL_FAULT_LAPS_BUILD_REVIEW`.
- Flow 2: the CLI never removes the halt (D6). `reset` follows the same path with `consumed → 0`
  instead of `effectiveLimit + N` (D2).
- Live-boundary trips and seal errors have no flow here: they are excluded (fail-closed by design).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-05 | Initial generation (DEFERRED + laps-grant flows) | DECIDE for #2190 |
| 2026-09-05 | Rewritten to suite-infra lane + kickback-budget recovery | architecture-review resolution R + absorb |
