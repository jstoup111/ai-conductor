# Complexity: coverage_binding lap-cap halt has no supported recovery (#2846)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — reuses the kickback-ledger gate entry, typed cap evidence, adjustment history, and resume authorization |
| External integrations | None |
| Auth / permission surface | None new — the existing TTY-bound, operator-identity, park, and lease authority applies unchanged |
| State machines | None new — reuses the staged adjustment and daemon-side resume-authorization consumption |
| Story count | ~4 (cap halt is recoverable; raise/reset accepted with rationale history; next dispatch reopens bound tasks; inspect lists coverage_binding; invalid requests refused) |
| Files touched | Engine: kickback-budget-cli, kickback-budget-view, kickback-ledger (stage/apply/settle), halt-classification, step-runners coverage_binding reopen path; docs: CLI reference, stuck-feature runbook, gates explanation |
| New runtime code | Yes — a new gate admitted to the operator recovery family and cap evidence at the coverage_binding cap halt |

## Rationale

The code delta is small (the intake labels it `size: S`), but it extends the command grammar and
recoverable-gate set that the approved
`adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` fixes (its carried-forward D3
gate grammar, D2 typed evidence, D4 halt-class-per-gate table), so it amends an approved ADR and
needs a lightweight architecture review. It spans five engine modules across the halt, ledger,
CLI, and view layers with no new subsystem, schema, or integration. → **Medium.**

Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check + coherence-check;
stories + plan as always.
