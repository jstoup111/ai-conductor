# Complexity: daemon-stale-engine-origin-advance

Tier: M

## Rationale

- **Surfaces touched:** daemon quiescent-boundary gate (`rebuildAndMaybeRestartForStaleEngine`),
  `fastForwardRoot` reuse, `publish-engine.mjs` source-SHA stamping, new loud-staleness warning
  path, docs (`daemon-operations.md`, `configuration.md`, conductor README).
- **State-machine interplay:** must compose with the #400 single-generation restart handoff,
  quiescence guards (never mid-build), non-convergence suppression, and fail-closed semantics —
  moderate coordination risk, all within existing ADR-guarded machinery.
- **No new integrations, auth, models, or schema migrations.** No product track.
- **Estimated stories:** ~5-6 (ff-before-rebuild, loud fallback per skip-cause, SHA stamp,
  non-self-host advisory, negative paths).

Not S: multi-surface with restart-safety invariants and degraded-path matrix.
Not L: no new subsystem; reuses existing fetch/publish/restart primitives at one seam.
