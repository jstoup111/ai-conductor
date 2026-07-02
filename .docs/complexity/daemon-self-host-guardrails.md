# Complexity: Harness daemon self-host guardrails

Tier: L

## Signals

- **New cross-cutting seam** — a self-host detection seam (repo == harness root) that
  activates a guardrail bundle across build + finish; swappable for platform identity later.
- **Novel isolation mechanism** — sandboxed build via a throwaway `CLAUDE_CONFIG_DIR` with
  skills/hooks symlinked into the worktree; correctness of the isolation is safety-critical
  (a leak corrupts the operator's ~20 concurrent live sessions).
- **Config schema change** — new `HarnessConfig` keys (activation override + gate config),
  validated in `validateConfig()`.
- **Multiple new gates with human-park semantics** — VERSION-approval, CHANGELOG/[Unreleased],
  migration-block, and integrity-suite gates that must HALT (not prompt) in daemon `auto` mode.
- **Broad surface** — daemon-cli, conductor finish handling, install-freshness preflight,
  steps registry, config types, plus bin/install skill-relink path.
- **State-machine impact** — new HALT/resume paths in the build lifecycle.

Story count is expected to exceed the Small threshold (≈10+ across four guardrails + the
detection seam + sandbox), integration-heavy, with real architectural decisions. → **Large.**

Full DECIDE: architecture-diagram (full) → architecture-review (full, ADRs) → stories →
conflict-check → plan.
