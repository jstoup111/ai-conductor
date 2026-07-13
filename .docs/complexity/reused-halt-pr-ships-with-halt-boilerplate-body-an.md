# Complexity: Reused halt PR ships with halt boilerplate body and slug title (#632)

Tier: S

## Rationale

Small. A bounded, additive extension of an existing, well-tested module following a pattern the
codebase already established twice in the same file:

- **One module carries the logic.** `src/conductor/src/engine/halt-pr-rehabilitation.ts` gains a
  banner-body halt signal and a `bodyFloor` mechanic mirroring the existing `retitleFloor`
  (same read → detect → mutate → verify-after-write → warn-only shape, same `GhRunner` seam, same
  dedicated test file `test/engine/halt-pr-rehabilitation.test.ts`).
- **Two one-shape call-site edits.** The finish repair callback (`conductor.ts:639-673`) adds the
  bodyFloor call and threads a `log` fn (today rehabilitation outcomes are silent); the finish
  completion gate (`artifacts.ts:1259-1277`) extends the existing `readStaleHaltTitle` check to the
  body, line-for-line the same fail-open pattern.
- **No new state, config, schema, CLI, or subsystem.** Detection stays stateless (ADR 2026-07-03
  Decision 4) — the engine-authored banner sentence is observable PR state. Engine body mutation is
  already precedented in this module (`cleanupHaltPresentation` removes the body marker).
- **Breaking-surface check:** no `bin/conduct` CLI, `settings.json` schema, hook wiring, or skill
  symlink change → no CHANGELOG Migration block at build time; plain `### Fixed` entry.

Not M: unlike the halt-PR label-reliability spec (M — new verify-after-write plumbing + a new
reconciliation sweep across all open PRs) or the #499 finish-engine-machinery spec (M — new repair
step orchestration), this composes primitives those specs already landed and tested. The gate edit
is risk-bounded by design: fail-open on gh errors, and the deterministic floor runs *before* the
gate in the same finish pass, so the gate is a backstop, not a new blocking path. Negative paths
(fresh PR untouched, in-remediation halt PR untouched, gh outage) are cheap unit cases against the
injected `GhRunner`, not new machinery.
