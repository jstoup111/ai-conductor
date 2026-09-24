# Components: every remediation budget halt is recoverable by one kickback-budget raise (#2185)

**Last updated:** 2026-09-24
**Scope:** The continue-only slice of #2185. The three remediation budget exits in the
remediation router (per-gate lap cap, per-gate plan-growth cap, shared plan-growth allowance),
the kickback ledger's typed cap evidence and plan-growth record, the existing
`kickback-budget` operator command family, and the daemon's existing authorization → clear →
resume boundary. Nothing here adds a halt class, marker, grant store, or unattended grant.

## Diagram

```mermaid
graph TD
  subgraph Router["Remediation router (conductor.ts)"]
    LAPX["Per-gate lap exit<br/>prd_audit · architecture_review_as_built<br/>laps ≥ effectiveLapCap"]
    GROWX["Per-gate growth exit<br/>requested exceeds growth remaining"]
    SHAREDX["Shared growth exit<br/>consolidated request exceeds remaining<br/>CHANGED: records evidence (none today)"]
    BUD["readRemediationGateAppendBudget<br/>CHANGED: growth cap = operator-raised cap<br/>when present, else config-derived"]
  end

  subgraph Ledger["Kickback ledger (.pipeline/kickback-ledger.json)"]
    EVID["gate capEvidence<br/>gate · consumed · limit · haltGeneration<br/>NEW: allowance = laps | growth"]
    GROWTH["plan-growth record<br/>authored · added · byGate<br/>(recomputable from the plan)"]
    GCAP["NEW: effective growth cap<br/>own ledger field beside growth<br/>fail-closed, never recomputed"]
    AUTHZ["resumeAuthorization<br/>adjustmentId · haltGeneration · consumed"]
  end

  subgraph Halt["halt-marker (unchanged)"]
    HALT["HALT + HALT.class kickback-cap<br/>body: findings · Kickback halt generation<br/>NEW: exact recovery command line"]
  end

  subgraph CLI["kickback-budget (existing operator family)"]
    INSPECT["inspect<br/>CHANGED: shows growth used / cap"]
    RAISE["raise --feature «slug» --gate G --by N<br/>CHANGED: grows the allowance the<br/>live evidence names"]
  end

  subgraph Daemon["Daemon halted-feature boundary (unchanged)"]
    CONSUME["consumeResumeAuthorizations<br/>generation + class match"]
    CLEAR["atomic halt clear → resume<br/>after last completed step"]
    STATUS["daemon status KICKBACK BUDGET<br/>CHANGED: names exhausted allowance"]
  end

  subgraph Spine["Event spine"]
    EV["kickback_budget_adjustment_authorized<br/>CHANGED: carries allowance<br/>plan_growth (existing)"]
  end

  BUD --> LAPX
  BUD --> GROWX
  BUD --> SHAREDX
  LAPX -->|"allowance laps"| EVID
  GROWX -->|"allowance growth"| EVID
  SHAREDX -->|"allowance growth"| EVID
  LAPX --> HALT
  GROWX --> HALT
  SHAREDX --> HALT
  HALT --> RAISE
  EVID --> RAISE
  RAISE -->|"laps"| AUTHZ
  RAISE -->|"growth"| GCAP
  RAISE --> AUTHZ
  RAISE --> EV
  GROWTH --> BUD
  GCAP --> BUD
  EVID --> INSPECT
  GROWTH --> INSPECT
  GCAP --> INSPECT
  AUTHZ --> CONSUME
  HALT --> CONSUME
  CONSUME -->|"valid"| CLEAR
  EVID --> STATUS

  style SHAREDX fill:#e8f5e9,stroke:#2e7d32
  style EVID fill:#e8f5e9,stroke:#2e7d32
  style GCAP fill:#e8f5e9,stroke:#2e7d32
  style RAISE fill:#e8f5e9,stroke:#2e7d32
  style BUD fill:#e8f5e9,stroke:#2e7d32
```

## Sequence: operator continues a feature halted on the shared growth allowance

```mermaid
sequenceDiagram
  participant R as Remediation router
  participant L as Kickback ledger
  participant H as HALT marker
  participant O as Operator
  participant C as kickback-budget raise
  participant D as Daemon boundary

  R->>L: read laps, growth, operator-raised cap
  R->>R: consolidated request exceeds growth remaining
  R->>L: record capEvidence (allowance growth, consumed added, limit cap)
  R->>H: HALT kickback-cap with findings, generation, recovery command
  O->>C: raise --feature «slug» --gate G --by N --rationale
  C->>H: verify live class and generation
  C->>L: stage adjustment, emit authorized event, apply growth cap raise
  C->>L: write resumeAuthorization
  D->>L: consume matching authorization
  D->>H: atomic clear
  D->>R: re-dispatch resumes after last completed step
  R->>L: read budget with raised growth cap
  R->>R: append fix tasks within new allowance
```

## Legend

- Green — changed by this feature. Everything else is existing machinery reused as-is.
- «…» — variable segment placeholder.
- The CLI never clears a halt (adr-2026-08-29 successor D4); it records an authorization the
  daemon consumes at its existing boundary.
- The exhausted allowance is read from typed evidence written at the exit, never parsed from
  halt prose (adr-2026-08-29 successor D2). The recovery-command line in the HALT body is for
  the operator only; nothing reads it.
- Out of scope: ship-as-draft at budget, residual lists, unattended self-granted laps, and
  removal of the growth allowance (owned by #2184).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-24 | Initial generation | DECIDE for #2185 (continue-only, approach A) |
| 2026-09-24 | Effective growth cap split out of the growth record into its own ledger field | conflict-check C1/C2: #1805 Story 14 recomputes an impossible growth record |
