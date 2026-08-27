# Track: connector-seam-for-event-submissions-is-registered

Track: technical

Scope boundary: Comprehensive (operator-confirmed) — wire registry retrieval for `visualizer`
plugins, error isolation on start/submit/stop, identity context on `start()`, config enablement
surface, OTel registered through the same seam, load-time shape validation for visualizer plugins,
sink-registry divergence documented (visualizers stay self-selecting), and a plugin docs page.
Excluded: wiring or removing the dead `step`/`hook` kinds (separate intake), full sink-declaration
delivery redesign (Approach B), and any durable-telemetry store.

Plugin-author/operator infrastructure completing approved ADR-014; no product-facing behavior, so
acceptance criteria live directly in stories.
