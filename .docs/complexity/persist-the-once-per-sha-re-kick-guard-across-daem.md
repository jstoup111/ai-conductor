# Complexity: Durable once-per-SHA re-kick guard

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to three production files: two new marker primitives beside the existing `.daemon/` marker helpers, one optional write-through dependency on the re-kick sweep, and the daemon's single construction site for the guard. It reuses the existing marker directory convention, the existing optional-dependency pattern that keeps the sweep backward-compatible when a dependency is absent, and the existing in-run `Map` as the read path. It introduces no service, no record schema beyond a single SHA line, no configuration key, no CLI verb, and no telemetry channel. Halt classification, park ordering, shipped dedup, and the re-kick sentinel's lifecycle are untouched. Small-tier architecture, conflict, and coherence artifacts are not required.
