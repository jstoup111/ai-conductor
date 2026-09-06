# Complexity: Authenticate OTLP export with env-referenced headers

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one additive config key, its resolution inside the existing `resolveOtelConfig` function, the two HTTP exporter constructions inside the existing `buildExporters` function, and the reference documentation for the block. It introduces no new event, metric, span, storage, service, or artifact, and no new dependency: the credential is read from the process environment and handed to an option field the installed exporter already accepts. Every failure mode reuses the block's existing disabled-with-a-named-error contract. Additional secret sources, gRPC metadata carriage, and authentication-specific export-failure classification are excluded. Small-tier architecture, conflict-check, and coherence artifacts are not required, and no ADR is created or amended: ADR 014's dual-transport, config-selected decision is extended in the direction it already specifies, not revised.
