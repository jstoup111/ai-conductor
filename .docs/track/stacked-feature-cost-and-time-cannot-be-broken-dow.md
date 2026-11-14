# Track: stacked-feature-cost-and-time-cannot-be-broken-dow

Track: technical

Scope boundary: Exactly the desired outcome of jstoup111/ai-conductor#2946. For a stacked feature, the
shipped record shows cost, active time and dispatch count for each child, plus one feature-wide row
for work that belongs to no child, and those rows sum to the feature's existing Cost and Time
totals with no double counting across child switches. A feature with no child produces a
byte-identical shipped record. Excluded: per-child token counts, retries and halts; `conduct kpi`
per-child aggregation; daemon status, the dashboard and OTel per-child dimensions; any change to the
existing `## Cost` and `## Time` blocks.

Rationale: an operator-facing diagnostic projection of the existing event ledger with no product
requirements of its own; acceptance criteria live in stories.

Approach (selected): derive the breakdown from the optional `child` field on spine events (the
filer's hypothesis, kept on merit). Verified gap: `provider_attempt`, the authoritative dispatch and
cost record (`dispatch-metering.ts`), is emitted straight to the feature bus by
`providerExecutionEventCallbacks` (`provider-execution.ts`) and so never passes through
`Conductor.withActiveRegionChild` (`conductor.ts`), which stamps `child` only on region
step lifecycle, gate verdict, kickback and halt events. The feature therefore stamps `child` on a
`provider_attempt` under the same region rule, using the existing optional field: no new event,
variant or channel. The cost and timing rollups then partition the dispatches and the active-interval
union by `child`, and the shipped record gains an additive per-child block only when a child
appears in the ledger.

Rejected alternatives:
- Bracket the ledger by `child_started` / `child_switched` / `child_closed` and attribute every
  dispatch between them to that child. Restack translation and other feature-wide work inside the
  window would be charged to a child, and routed repairs that re-enter a closed child's region break
  the bracket.
- Join each `provider_attempt` to the child-stamped `step_started` that opened the same execution
  through its `executionContext` correlation key. No emission change, but attempts without a
  correlatable context (legacy, auxiliary rubric fan-out) would fall out of the breakdown, so the
  rows could not be proven to sum to the total, and it duplicates the metering tracker's matching.
