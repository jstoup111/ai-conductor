# Components: bounded retries at the raiser and operator budget recovery (#2190)

**Last updated:** 2026-09-05
**Scope:** The two halves as approved by architecture-review — (1) retry at the raiser inside the
existing retry ladder, no new dispatch state; (2) the `kickback-budget` operator command family from
adr-2026-08-29, with the daemon clearing the halt on authorization. Nothing here adds a marker, a
timer, or a grant kind.

## Diagram

```mermaid
graph TD
  subgraph Ladder["Existing step retry ladder (conductor.ts)"]
    GRP["Validation-group member dispatch<br/>attempt budget: literal 1 → serial budget<br/>(R1, folds #1425)"]
    SUITE["test_suite verifier result<br/>reason ≠ nonzero_exit"]
    LANE["NEW: suite-infra bounded lane<br/>typed fault · non-charging<br/>MAX_SUITE_INFRA_RETRIES, durable per feature<br/>(shape: adr-2026-08-18 D3/D4/D5)"]
    BUDGET["Three budget halts<br/>manual-test cap · test_suite cap ·<br/>per-gate remediation budget<br/>class mechanical → needs-human (R3)"]
  end

  subgraph Excluded["Excluded — fail-closed by decided design"]
    LB["Live-boundary trip<br/>adr-2026-08-17 §4 · adr-2026-06-30"]
    SEAL["Protected-artifact seal error<br/>adr-2026-07-26 §2 · adr-2026-08-05"]
  end

  subgraph Marker["halt-marker (unchanged)"]
    WH["writeHaltMarker(root, body, class)"]
    HALT["HALT + HALT.class<br/>needs-human, naming attempts spent"]
  end

  subgraph Ledger["Kickback ledger (adr-2026-08-29 D1)"]
    ENTRY["gate entry<br/>consumed · effectiveLimit<br/>+ adjustment history<br/>+ staged adjustment (D5)"]
  end

  subgraph CLI["Operator-only command family (D3)"]
    RAISE["NEW: kickback-budget raise<br/>--feature «slug» --by N --rationale"]
    RESET["NEW: kickback-budget reset<br/>--feature «slug» --rationale"]
    INSPECT["NEW: kickback-budget inspect<br/>one renderer (D8)"]
  end

  subgraph Daemon["Daemon halted-feature boundary"]
    AUTH["NEW: read typed ledger authorization<br/>bound to live cap evidence + generation<br/>(08-29-successor D3)"]
    CLEAR["existing atomic halt-state clear<br/>adr-2026-08-09"]
    RESUME["existing resume after<br/>last completed step"]
    STATUS["daemon status<br/>shows adjustment + laps remaining"]
  end

  subgraph Spine["Event spine"]
    EV["step_retry (existing)<br/>kickback-budget adjustment events (D7)<br/>declared in total sink registry"]
  end

  GRP -->|"attempt < budget"| GRP
  GRP -->|"exhausted"| WH
  SUITE --> LANE
  LANE -->|"fault, allowance left"| SUITE
  LANE -->|"allowance spent"| WH
  BUDGET --> WH
  WH --> HALT
  RAISE -->|"park quiescence (D4)"| ENTRY
  RESET -->|"park quiescence (D4)"| ENTRY
  ENTRY --> INSPECT
  ENTRY --> AUTH
  HALT --> AUTH
  AUTH -->|"valid, generation matches"| CLEAR --> RESUME
  ENTRY --> STATUS
  GRP --> EV
  LANE --> EV
  RAISE --> EV
  RESET --> EV
  AUTH --> EV

  style LANE fill:#e8f5e9,stroke:#2e7d32
  style RAISE fill:#e8f5e9,stroke:#2e7d32
  style RESET fill:#e8f5e9,stroke:#2e7d32
  style INSPECT fill:#e8f5e9,stroke:#2e7d32
  style AUTH fill:#e8f5e9,stroke:#2e7d32
  style LB fill:#fdecea,stroke:#c62828
  style SEAL fill:#fdecea,stroke:#c62828
```

## Legend

- Green — new by this feature. Red — explicitly excluded; these halts stay fail-closed and are
  never retried, by adr-2026-08-17, adr-2026-06-30, adr-2026-07-26, adr-2026-08-05.
- «…» — variable segment placeholder.
- No new dispatch state, marker, timer, or grant store. `pickEligible`, `rekickSweep`, and
  `HALT.class` are unchanged (adr-2026-08-05 §4, adr-2026-07-28 D2).
- The CLI never clears a halt (08-29 D6; adr-2026-08-03 D6). It records an authorization in the
  ledger; the daemon boundary consumes it and clears through the existing atomic clear.
- The `mechanical` class is unchanged in meaning; three writers move to `needs-human` because a
  budget exhaustion must not be auto-cleared by the base-advance sweep (adr-2026-07-26 D4).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-05 | Initial generation (DEFERRED + laps-grant design) | DECIDE for #2190 |
| 2026-09-05 | Scoped DEFERRED writers to four raisers; mechanical unchanged | architecture-review found mechanical includes budget halts |
| 2026-09-05 | Rewritten to resolution R + absorbed adr-2026-08-29 command family | architecture-review BLOCKED on six APPROVED ADRs; operator chose R and absorb |
