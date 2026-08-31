# Complexity: when: bypasses gating enforcement while disable: is gated on configDisableAllowed

Tier: S

Rationale: Two localized engine edits — extend an existing config-load validation branch
(config.ts, reusing the disable: predicate) and flip one event's render flag
(event-sinks.ts) — plus unit tests alongside the existing disable-validation tests and a
docs update. No new module, schema, step, or cross-cutting seam.
