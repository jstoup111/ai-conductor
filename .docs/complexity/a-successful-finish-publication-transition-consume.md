# Complexity: FINISH publication progress is not a retry

Tier: M

Four engine seams change in a fixed order — the publication disposition union, the
production adapter that currently collapses success into a retry, the conductor's retry
gate, and the telemetry event union plus its renderer. The change carries a termination
obligation (a non-consuming re-entry must stay bounded) and touches a fail-closed
validator (`isExactDisposition`), which lifts it above Small. It introduces no new
integration, no persisted schema, no auth surface and no state machine of its own — it
reshapes accounting inside an existing one — so it is not Large.

The plan stem must remain `a-successful-finish-publication-transition-consume`.
