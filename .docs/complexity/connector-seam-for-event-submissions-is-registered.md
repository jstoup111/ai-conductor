# Complexity: connector-seam-for-event-submissions-is-registered

Tier: M

Rationale: single-subsystem wiring completing approved ADR-014 — registry retrieval for
visualizer plugins, an interface change (`start(emitter, context)`), one config enablement key,
error isolation, OTel re-registered as a built-in plugin, load-time shape validation, and a docs
page. No new models, integrations, auth, or state machines; moderate story count. Matches the
originating issue's `size: M` label.
