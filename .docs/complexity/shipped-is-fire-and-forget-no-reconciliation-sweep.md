# Complexity: Shipped PRs get a re-examined readiness verdict (#438)

Tier: M

## Rationale

- Refactors the existing per-PR loop in `src/conductor/src/engine/mergeable-sweep.ts` into a
  closed readiness verdict (`ready | conflicting | ci-failing | no-checks | draft | indeterminate`)
  with one exhaustive route per verdict.
- Touches several cooperating modules: `pr-labels.ts` (state read incl. `mergeStateStatus`,
  re-read on lazy `UNKNOWN`), `autoresolve.ts` and `ci-fix.ts` (existing route targets), a new
  idempotent CI-nudge action, the `ConductorEvent` union (verdict event on the spine), and the
  `daemon status` surface.
- External integration (GitHub via `gh`) with idempotency requirements (one nudge per head SHA,
  no repeated mutations across ticks) — a small state machine, not a trivial edit.
- No new storage system, auth, or cross-repo change; scope bounded to daemon-shipped (watched)
  PRs, so it stays below Large.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check, and
coherence-check apply.
