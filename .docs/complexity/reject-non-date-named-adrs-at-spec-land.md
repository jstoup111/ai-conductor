# Complexity: Reject non-date-named ADRs at spec land

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one exported filename predicate beside the existing decision-record helpers and one
rung to an existing land gate that already enumerates those records and already computes the
added-or-changed path set. It introduces no new module, no configuration key, no event, metric, or
report channel, no storage, and no command surface. Two production files change. The remaining work
is test fixture realignment in the land-reaching suites. Repository-wide sweeps, record renames, and
daemon discovery are excluded. Small-tier architecture, conflict, and coherence artifacts are not
required, and no architecture decision record is added or amended: the naming convention was already
decided and published, and this change only enforces it.
