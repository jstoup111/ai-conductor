# Complexity: test_suite re-runs and re-passes the full suite ~10x per feature

Tier: L

Rationale: touches the engine's verification state machine (FullSuiteVerifier
freshness resolution and the drift-budget judgement), the config schema and its
fail-at-load cross-key validation, the evidence schema (version bump: mode +
drifted-category fields), the ConductorEvent union (new/extended verification
events), the bootstrap CLI (`conduct-ts config init` gains recorded answers),
and requires amendments to at least three APPROVED ADRs plus consumer-registry
entries for the new keys. Multiple interacting invariants (tree-attesting
membership, kickback budget, rebase invalidation refunds) and an expected
double-digit story count put this firmly in Large.
