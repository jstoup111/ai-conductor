# Complexity: Anchor marker-scoped changed tests outside conventional test paths

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

One production file changes: the changed-test title snapshot in the build_review input assembler takes its selector set from the union of the existing path classification and the already-computed marker-derived scope, and the two snapshot helpers are ordered so the scope is available. Everything downstream is reused unchanged: the coordinator's in-scope filter, the content-region projection, the anchor validator, the tautology preflight, and the per-selector static-extraction fallback that guarantees at least one region per selector. No new module, event, metric, configuration key, schema, or telemetry channel is introduced, and no ADR is required or amended. Small-tier architecture, conflict-check, and coherence artifacts are not required.
