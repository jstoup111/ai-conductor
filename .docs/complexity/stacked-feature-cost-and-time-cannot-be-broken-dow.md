# Complexity: Stacked feature cost and time broken down by child (#2946)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None persisted. One in-memory per-child projection of the existing cost and timing rollups, and one additive shipped-record body block rendered from it |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None. The active region child already exists (`Conductor.activeRegionChild`); this work only reads it when a `provider_attempt` is emitted |
| Event spine | Additive: `provider_attempt` starts carrying the existing optional `child` field under the existing region rule. No new variant, sink or ledger |
| Story count | ~4: child identity on dispatch records; per-child cost and dispatch partition; per-child active-time partition; shipped-record block with N=1 byte identity |
| Files touched | ~9: `step-runners.ts`, `conductor.ts`, `provider-execution.ts` (one optional field), `dispatch-metering.ts`, `cost-rollup.ts`, `timing-rollup.ts`, `shipped-record.ts`, `shipped-record-cli.ts`, `kpi-report.ts` (parser isolation only, if needed), plus tests |
| ADR work | One amendment: `adr-2026-10-03-stacked-child-plans-identity-and-state` decision 12 says "Rollups ignore it, so shipped-record Cost and Time stay once per feature". The `## Cost` and `## Time` blocks stay once per feature; a separate per-child block now reads the field |

## Rationale

Medium. The change is a read-side projection of a ledger the engine already writes, plus one
additive field on one existing event, and it touches no state machine, gate or remote surface. It is
not Small: it changes a recorded decision of an approved ADR, it crosses the emission seam in
`conductor.ts` and three rollup and rendering modules, and its correctness rests on an exact
partition invariant (the per-child rows must sum to the feature totals with no double counting)
across both the dispatch ledger and the active-interval union. It is not Large: there is no new
module boundary, persisted format beyond an additive shipped-record block, or behavior change for a
feature with no child.
