# Complexity: exported-step-cost-under-records-spend-20x-so-ever

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | Two new per-dimension gauge instruments (cost, tokens); step × model × source cost buckets and step × model token buckets added to `CostRollup` |
| External integrations | OTLP export path (existing); dashboards in the out-of-repo LGTM stack must be re-pointed |
| Auth / permission surface | None |
| State machines | Visualizer stop lifecycle changes (forceFlush → flush + meter shutdown); no new states |
| Story count | 5 (whole-feature cost, per-dimension cost, per-dimension tokens, reader shutdown, export-failure surfacing (exact totals across lifetimes, per-dimension exactness, spend-over-time, reader shutdown, export-failure surfacing, unavailable-not-small) |
| Files touched | `engine/otel/metrics.ts`, `engine/otel/otel-visualizer.ts`, `engine/cost-rollup.ts`, `engine/conductor.ts` (settle hook), `engine/event-sinks.ts` / daemon render, tests, `docs/` telemetry pages, dashboard JSON |
| New runtime code | Rollup-per-settle emission on the event spine; gauge recording; shutdown seam |

## Rationale

Two open issues (#2095 critical, #2086 high) with one root cause spanning the exporter lifecycle,
the metrics recorder, the cost rollup, and the dashboards. Touches an ADR-governed surface
(ADR-014 identity contract) and the event spine, so it needs an architecture pass and a conflict
check, but introduces no new integration, auth, or state machine. → **Medium**: lightweight
architecture review, diagram, conflict-check, and coherence-check apply.
