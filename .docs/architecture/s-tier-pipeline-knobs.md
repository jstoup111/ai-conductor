# Architecture: Small features are cheap through the existing pipeline's own knobs (#668)

**Track:** technical · **Tier:** M · **Design:** adr-2026-07-21-s-tier-pipeline-knobs.md (APPROVED)

## Context (current state)

Two authoring paths exist today: full `/engineer` DECIDE, and an ad-hoc hotfix worktree that
**bypasses** DECIDE entirely (tonight's #634/#644/#548) — producing no `.docs/` artifacts and forcing
the #656/#662/#625 hand-stamping. PR #670 proposed a **third** path (a lightweight DECIDE flow with a
mini-spec type + expander). The operator rejected adding a parallel flow.

The existing pipeline already right-sizes Small — it just was never tuned to be cheap end-to-end:

```
                       the ONE pipeline (steps.ts ALL_STEPS)
  ┌──────────────────────────── DECIDE ───────────────────────────┐  ┌──── BUILD/SHIP ────┐
  explore  complexity  [arch_diagram] [arch_review] stories        build  build_review
     │         │            SKIP-S        SKIP-S       │  [conflict]  │      wiring_check
     │         │         (steps.ts:69)  (steps.ts:82)  │   SKIP-S     │      manual_test
     │         │                                       │ (steps.ts:104)│     rebase / finish
     └─ resolveStepConfig(step, phase, config, {tier}) ─────────────────────────────┘
              (conductor.ts:1975-1977, :5961-5962)
                          │
                          ▼
        DEFAULT_STEP_TIER_OVERRIDES[step][tier]   ← the seam we extend (resolved-config.ts:144-158)
                          │  applied at the `hardcodedStepTier` rung (:234-236 → :245/:256/:266)
                          ▼
        base (model, effort, max_retries)  ──▶  escalateAttempt(base, attempt, escalate)
                                                 (escalation.ts:76 — effort@2, model@3+)
```

## Decision (component view)

There is **no new component.** The change is data in an existing table plus rationale metadata:

1. **`DEFAULT_STEP_TIER_OVERRIDES` gains `S` rows** (`resolved-config.ts:144-158`) — `explore.S`,
   `build.S` join the already-present `stories.S` / `plan.S`. Same `TierOverride` shape, same
   resolver rung (`resolved-config.ts:234-236`). Nothing reads a new field; the conductor already
   threads the tier (`conductor.ts:1975-1977`).
2. **`STEP_RATIONALE` updated** (`model-table-metadata.ts:14`) for the tuned steps, and `HARNESS.md`
   regenerated from it (the existing generator + `test/test_generate_model_table_wrapper.sh` /
   `model-table-metadata.test.ts` completeness check keep them in sync).
3. **Optional D5 — label→tier seed** on the DECIDE `complexity` step: a deterministic helper maps a
   `size: S` label to the `Tier: S` line written into the *same* `.docs/complexity/<slug>.md` that
   `parseComplexityTier` (`artifacts.ts:1902`) already reads, short-circuiting only `assessTier`
   (`complexity.ts:30-50`). Separable; ships behind its own story.

## Why this shape

- **Deterministic-first (CLAUDE.md).** Cost behavior for S is a table the resolver already
  interprets, not prompt discipline and not a new branch.
- **No new gate readers, no parallel flow.** The evidence tail (`build_review`, `wiring_check`,
  `manual_test`, `rebase`, `finish`) has no `skippableForTiers` (`steps.ts:145-262`) and is untouched
  — smallness cannot reach it.
- **Recovery is the existing ladder.** A mis-judged S climbs `escalateAttempt` (`escalation.ts:76`)
  exactly like any tier; the ≥3 budget floor (#188 Decision 4) keeps the model-bump rung reachable.

## Failure modes → negative-path stories

- A future edit tier-skips an evidence gate → pinned by the tier-invariant gate-set test (S6).
- S budget cut below 3 breaks the #188 model rung → pinned by S5.
- Under-tiered S → ladder escalates / mid-flight re-tier (`conductor.ts:1905` re-reads tier) — S7,
  never corrupts (S8).
