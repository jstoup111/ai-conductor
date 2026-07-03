# Conflict Check: Model Availability Fallback Ladder
**Date:** 2026-07-03
**New stories:** .docs/stories/model-availability-fallback-ladder.md (TS-1..TS-6)
**Result:** PASSED — zero blocking, zero degrading conflicts

## Scope scanned

All `.docs/stories/*.md`, with focused pairwise checks against:
- **Fable rollout siblings** (`fable-front-of-funnel-decide.md` #188,
  `fable-recovery-steps.md` #189) — both explicitly declare #186's fallback ladder
  out-of-scope and cite it as prerequisite. No contradiction, no overlap: they set
  per-step Fable defaults; this feature handles unavailability of any configured model.
- **Retry/HALT semantics** (`daemon-halt-reconciliation.md`,
  `rebase-resolution-skill.md`, `phase-9.0-rebase-on-latest.md`) — the ladder walk is
  intra-attempt at the step-runner seam; retry counting, HALT writing, and rebase
  resolution attempt caps are untouched. No state or sequencing conflict.
- **Interactive-mode contract** (`runmode-interactive-flag.md`) — TS-3's pre-invoke
  cache consult substitutes the model argument only; REPL/print dispatch semantics
  unchanged. No conflict.
- **Config schema additions in flight** (multi-operator, self-host guardrails,
  pluggable memory) — new top-level `model_fallback_ladder` key collides with no
  existing or in-flight key. No resource contention.

## Coordination note (resolved in stories, not a conflict)

`fable-recovery-steps.md` (#189) documents an **interim** fallback in HARNESS.md:
"until #186's ladder lands, use the `--model` override." TS-6 was amended to
explicitly REPLACE that interim note when this feature's docs land, keeping the
model table, HARNESS.md note, and README in agreement. Sequencing is safe in both
merge orders: if #186 lands first, #189's note is never written as-is; if #189
lands first (already merged), TS-6 replaces it.

## Verdict

Proceed to `/plan`.
