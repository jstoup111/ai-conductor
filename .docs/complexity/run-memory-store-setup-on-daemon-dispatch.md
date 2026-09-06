# Complexity: Run memory-store setup on daemon dispatch

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change reuses the existing, already-tested setup behaviour and adds no new algorithm: a non-printing core is extracted from the existing CLI dispatch, a fail-open observer wraps it, the daemon's existing dispatch preparation binding calls it, and one variant is added to the existing event union with its sink declaration and daemon log rendering. Five production files, each edited in one place. No new module boundary, no schema, no storage, no service, no configuration key, no CLI surface, no hook wiring, and no telemetry channel outside the existing spine. The governing placement decision record already covers this placement and needs no amendment, so Small-tier architecture, conflict, and coherence artifacts are not required.
