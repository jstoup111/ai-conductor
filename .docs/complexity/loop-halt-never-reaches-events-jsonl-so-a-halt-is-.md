# Complexity: Halt events reach the persisted spine

Tier: M

The change is bounded to the existing telemetry spine — the sink declaration table, two
additive schema edits to the `ConductorEvent` union, one conductor-owned emit path, the
audit translator's step attribution, and the halt-marker writer's result contract. It
introduces no new integration, no authentication boundary, and no state machine.

It is not Small: it edits the shared `ConductorEvent` union, changes an exported function's
return contract across six call sites, adds a new event variant that needs a renderer and a
sink declaration, and revives two consumers (`cost-rollup`, `report-renderer`/`rates`) whose
halt-counting branches have never executed — each of which needs its own regression coverage.

It is not Large: there is one writer, one ledger, no migration of existing data, no new
process boundary, and every consumer already reads the schema being extended.
