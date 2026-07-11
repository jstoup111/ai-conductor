# Complexity: engine-invoked-task-attribution-494-freezes-curren

Tier: M

## Rationale

- Three interacting enforcement layers change together: `pre-dispatch.sh`
  (session-hook-assets.ts), `prepare-commit-msg` and `commit-msg` (git-hook-assets.ts) — a
  mistake in one silently shifts failure to another, so a lightweight architecture review is
  warranted.
- Interplay with live machinery: #509's fail-closed commit gate (armed 2026-07-11T08:30Z) and
  the #522 judged-attribution build in flight on adjacent evidence seams — conflict-check is
  load-bearing, not ceremony.
- No new models, integrations, auth, or persistent schema; the stamp-lifecycle state machine is
  small; expected story count ~5–7 — below Large.
- Regression tests must exercise real git hooks (commit-time behavior), which is fixture-heavy
  but well-precedented in this repo.
