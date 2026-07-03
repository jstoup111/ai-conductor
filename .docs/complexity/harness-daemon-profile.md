# Complexity: harness-daemon-profile

Tier: M

## Rationale

- Modifies a fail-closed self-host release gate (`src/conductor/src/engine/self-host/version-gate.ts`):
  PATCH-class changes auto-pass, MINOR/MAJOR signals HALT. Gate logic on the safety path — needs
  negative-path tests, not a Small.
- Adds a new semver-signal classifier (new skill/hook/gate → MINOR; reuse
  `classifyBreakingSurfaces` for MAJOR; undeterminable → HALT fail-closed).
- Adds committed `bin/setup` (worktree prep: npm install + build in src/conductor) — the daemon's
  conventional post-worktree hook.
- ADR + README/src/conductor/README reconciliation (retire "cutover MUST NOT be set on harness"
  guidance contradicted by committed config).
- No new models, external integrations, auth, or subsystems; single-repo, ~5 stories → not Large.

Tier M ⇒ architecture-diagram: yes; architecture-review: lightweight; conflict-check: yes.
