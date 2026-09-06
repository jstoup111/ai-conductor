# Complexity: Stamp released harness version on OTel trace resource

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one attribute to an existing Resource builder and threads one already-resolved string through the start-context seam the engine dist id uses today. It introduces no service, no schema, no storage, no new telemetry channel, and no new version probe: the released-harness-version resolver, the identity normalization rules, the own-property projection guard, and the two start boundaries all exist and are already covered by tests.

The diff spans six production files, but four are single-line mirrors of an existing member — a required interface member, an optional shared type member, a guarded passthrough, and one awaited call per entry point. Only the Resource builder gains behavior. The metric scope is deliberately untouched, so the existing exact-attribute-set assertion continues to bound `target_info` growth without modification.

Publish-time capture of the release into the engine dist sidecar, backfill of already-published dists, backend span-metrics configuration, and dashboard changes are excluded. No ADR is created or amended: the approved OTel observability ADR's signal-scoped Resource contract already permits trace-only identity attributes, and this change conforms to it. Small-tier architecture, conflict-check, and coherence artifacts are not required.
