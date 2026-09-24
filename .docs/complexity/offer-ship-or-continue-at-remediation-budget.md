# Complexity: offer-ship-or-continue-at-remediation-budget

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None new; the kickback ledger's cap evidence gains an exhausted-allowance dimension and the growth record gains an operator-raised limit |
| External integrations | None |
| Auth / permission surface | Existing operator-authorized budget grant (`kickback-budget raise`); no new authority |
| State machines | Existing halt → authorization → daemon clear → resume cycle, extended to growth exhaustion |
| Story count | ~4 (evidence at every budget exit, growth raise, halt names the command, shared-allowance exit) |
| Files touched | ~4 engine modules: remediation budget exits in `conductor.ts`, `kickback-ledger.ts`, `kickback-budget-cli.ts`, plan-growth record |
| ADR impact | Amends APPROVED adr-2026-08-22 (D6 growth ledger derived from config) and adr-2026-08-29 (D2 typed cap evidence) |

## Rationale

The code change is contained, but it changes invariants that APPROVED ADRs own: the plan-growth
cap is today always re-derived from config, and budget grants are authorized only by lap-shaped
typed cap evidence. Letting an operator grant growth, and requiring evidence at the shared-growth
exit that records none today, needs ADR amendments reviewed against the existing decisions. That
calls for a lightweight architecture review, a diagram, a conflict-check, and a coherence mapping.
Not Large: no new subsystem, integration, or state machine. → **Medium** (operator-confirmed
2026-09-24).
