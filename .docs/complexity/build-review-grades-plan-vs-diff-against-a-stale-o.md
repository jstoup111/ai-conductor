# Complexity: build-review-grades-plan-vs-diff-against-a-stale-o

Tier: M

## Rationale

- Two interacting mechanisms: (A) verified-fresh base resolution for
  `assembleBuildReviewInputs`, and (B) a deterministic, bounded disposition layer on
  build_review scope failures (refresh → recompute → regrade-once vs kick-to-build vs
  HALT). B is a small state machine with a hard loop bound — the "state machines"
  M-tier signal.
- Touches the core gating path (`build-review-inputs.ts`, the conductor's
  build_review failure handling) where a regression means false ships or false halts;
  warrants architecture review (lightweight) and conflict-check against adjacent
  shipped work (#569 stall remediation, #817 gate-code-validity, #828 per-task floor,
  and the in-flight #859 trailer-union spec).
- No new models, integrations, or auth. Story count ~7. Not S because of the
  disposition state machine and core-gate blast radius; not L (single subsystem,
  no schema/CLI surface change).
