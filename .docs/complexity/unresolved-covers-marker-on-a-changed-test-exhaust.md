# Complexity: Malformed Covers token routes back to BUILD

Tier: S

Rationale: One bounded behavior along an existing seam. A pure detector over the Covers bindings the
test-scope analysis already computes (`build-review-test-scope.ts`), surfaced by input assembly outside
the frozen source snapshot (so no projection, digest, or reviewer-contract change), one pre-dispatch
check in the `build_review` step runner, and one conductor route that reuses the existing bounded
`build_review` kickback machinery (`consumeKickbackBudget`, `kickback` event, BUILD retry hint,
`navigateStateBack`, restage) exactly as the `test_suite` failure route does
(`conductor.ts:11911-11971`). No new event type, config key, CLI surface, schema, or ADR-level
decision; the existing `kickback` event on the spine carries the telemetry. Risk is confined to the
detection predicate, which is unit-testable over source fixtures.
