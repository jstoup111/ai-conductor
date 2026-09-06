# Complexity: Accept trailing tables in a coherence artifact

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one exported pure function in one production module: how
`parseCoherenceArtifact` decides which pipe-delimited lines belong to the mapping table. It adds no
module, type, failure reason id, configuration key, event, metric, or storage, and touches no call
site — the land gate, daemon discovery, and the coverage-binding assembler all consume the same
function and inherit the widening unchanged. Its blast radius is measured by an existing shared
regression corpus that both the parser tests and the discovery tests already run. No new ADR and no
ADR amendment is required; the governing shared-parser ADR names this issue as the place the
question is decided. Small-tier architecture, conflict-check, and coherence artifacts are not
required.
