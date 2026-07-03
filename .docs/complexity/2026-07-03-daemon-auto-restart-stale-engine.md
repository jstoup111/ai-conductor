# Complexity: Daemon auto-restart on stale engine code

Tier: M

## Rationale

Raw signals lean Small — 0 models/tables, 0 external integrations, no auth surface, one
simple state machine (record identity → detect stale → restart-intent → clean exit),
~6 stories. Classified **Medium** because:

- Touches the daemon's core lifecycle loop (`engine/daemon.ts` idle boundary) — regression
  risk is daemon-wide, not feature-local.
- Requires a narrow amendment to an APPROVED ADR
  (`adr-2026-07-03-harness-daemon-profile.md`: "new code goes live only on `bin/install`"),
  which Small's architecture-review skip cannot produce.
- Safety-critical negative paths: must never exit with a feature in flight, never
  restart-loop on a persistently-stale identity, never fire outside the self-host repo.
- Depends on open issue #215 primitives (dependency-ordered dispatch holds the build).

Operator confirmed MEDIUM on 2026-07-03.
