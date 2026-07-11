# Complexity: Daemon auto-resolve gitignored build-artifact rebase conflicts

Tier: M

## Rationale

Raw signals lean Small — 0 models/tables, 0 external integrations, no auth surface, a
narrow set of pure git-injected helpers, ~7 stories. Classified **Medium** because:

- Touches the daemon's core `rebase` loopGate (`src/conductor/src/engine/rebase.ts`
  `performRebase` / `resolveRebaseConflicts`), an **ADR-001 keystone** (the gate verdict
  must never report SATISFIED for a genuinely stale/un-rebased branch). Regression risk is
  daemon-wide, not feature-local — a wrong auto-resolution silently ships an un-rebased or
  source-dropped tree.
- **Safety-critical negative paths dominate the design.** Auto-resolution must be bounded
  so it NEVER widens from base-ignored build artifacts to real source files; the
  orphaned-index recovery must NEVER reset a genuinely-active rebase; the processed
  re-dispatch must NEVER re-dispatch a healthy/shipped slug. Each is a distinct adversarial
  case that the architecture review + negative-path stories must pin.
- Spans **two call sites** that must stay behaviorally identical — the finish-time
  `runRebaseStep` and the re-kick play-forward path (#300/#340 already unified these
  through `runGatedRebaseResolution`); a new conflict class must plug into both without
  divergence.
- Requires a **lightweight ADR** recording the "take-base-deletion for base-ignored
  delete/modify only" resolution rule and its safety boundary — an architecture decision
  Small's review-skip cannot produce.
- Gap #3 (re-dispatch a `processed` feature whose only open PR is `needs-remediation`)
  touches the dispatch/skip decision and dedup anchors — a second subsystem beyond the
  rebase engine.

Not Large: no new data model, no external-service integration, no multi-service state
machine; the change is additive within one engine module plus one dispatch-gate seam,
with a well-understood existing test harness to extend.

Operator absent — host engineer classified MEDIUM on 2026-07-05 on the above signals.
