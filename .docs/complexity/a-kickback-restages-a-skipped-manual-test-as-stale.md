# Complexity: a-kickback-restages-a-skipped-manual-test-as-stale

Tier: M

Rationale: single-repo engine change with no new models, integrations, or auth, but it
touches the conductor state machine at four kickback sites, adds a write-time invariant to
the state-change path, and extends `--diagnose` (complete-verifier) — cross-cutting enough
to need architecture review and coherence tracing, matching the intake `size: M` label.
Not S: multiple coordinated seams plus an invariant on a hot write path. Not L: no new
subsystem, schema, or external surface.
