# Complexity: parallel-validation-phase-fan-out-manual-test-prd-

Tier: L

Rationale: concurrency introduced into the conductor's core step loop (group state
keys, join semantics, retry + rate-limit-episode interaction across concurrent
branches); config schema addition (`validation_concurrency`); rework of the ADR-004
`parallel:` DSL onto a new shared core with deletion of `runParallelGroup`; ADR 004
amendment plus preservation constraints from the 2026-07-06 manual-test-fail-routing
ADR; dynamic fan-out width under tier/track skips. No new external integrations,
auth, or data models — but engine-state-machine depth and expected story count
(10+) put this firmly at L. Full architecture-review + conflict-check required.
