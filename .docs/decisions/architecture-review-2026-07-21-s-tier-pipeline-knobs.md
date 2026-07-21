# Architecture Review: Small features are cheap through the existing pipeline's own knobs (#668)

**Date:** 2026-07-21 · **Track:** technical · **Tier:** M · **Mode:** pre-implementation (lightweight+)
**Verdict:** APPROVED · **ADR:** adr-2026-07-21-s-tier-pipeline-knobs.md (APPROVED)

## Scope reviewed

The D1-D6 decisions: extend `DEFAULT_STEP_TIER_OVERRIDES` with an S profile, floor S budgets at 3,
lean base + escalation ladder as recovery, tier-invariant evidence gates, optional deterministic
label→tier seed, and reliance on the un-bypassed pipeline to satisfy #656/#662/#625.

## Feasibility

- **Reuses one verified seam.** The resolver already applies `DEFAULT_STEP_TIER_OVERRIDES[step][tier]`
  at the `hardcodedStepTier` rung (`resolved-config.ts:234-236`, consumed `:245/:256/:266`) and the
  conductor already threads `state.complexity_tier` (`conductor.ts:1975-1977`). Adding `S` rows is
  pure data — the lowest-risk change class. (confidence: high — `stories.S`/`plan.S` already exist and
  prove the path.)
- **Metadata sync is test-guarded.** `STEP_RATIONALE` edits + HARNESS.md regen are covered by the
  existing model-table completeness test and `test_generate_model_table_wrapper.sh`. (confidence: high.)
- **D5 targets an existing reader.** `parseComplexityTier` (`artifacts.ts:1902`) already consumes the
  `Tier:` line; seeding it from a label changes the *source*, not the reader. (confidence: high.)

## Alignment / risks

- **Evidence-gate integrity (target #1).** The design lowers cost knobs only; it adds nothing to any
  `skippableForTiers` list. The review **requires** a test pinning the tier-invariant gate set
  (`build`, `build_review`, `wiring_check`, `manual_test`, `rebase`, `finish` — `steps.ts:130-262`) so
  a later edit cannot quietly tier-skip a gate. APPROVED on that condition (satisfied by S6).
- **#188 reconciliation is load-bearing.** Any S `max_retries` must stay ≥3 or the model-bump rung is
  unreachable (`adr-2026-07-05` Decision 4). S5 pins the floor.
- **Under-tier safety.** A mis-judged S must recover via the ladder and must never corrupt state; S7
  (escalation fires) and S8 (no corruption / mid-flight re-tier) lock this.
- **No parallel flow.** The review confirms zero new step types, artifact types, or land primitives —
  the operator's binding constraint. S1-S4 assert behavior on the existing steps only.

## Verdict

APPROVED. Additive table + metadata edits on verified seams, no new mechanism, no gate weakened, #188
floor respected. Proceed to stories.
