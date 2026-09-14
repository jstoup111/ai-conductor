# Complexity: Accurate paths in the land cleanliness refusal

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one guard block in the spec-landing primitive, its existing unit-test file, and one bullet in the guide that documents the same refusal. It classifies entries the guard already computes and rewrites the diagnostic it already raises. It adds no module, no configuration key, no schema, no event, metric, span, or report, and no new telemetry channel; the existing event spine is untouched because nothing new is observed. The guard's accept/reject decision is unchanged, so no gate, daemon behavior, or artifact contract moves. The issue's revise-route half is excluded by the track's scope boundary and would carry its own tier if it is ever decided. Small-tier architecture, conflict, and coherence artifacts are not required.
