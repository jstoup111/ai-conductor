# Implementation Plan: Small features are cheap through the existing pipeline's own knobs (#668)

**Date:** 2026-07-21 · **Tier:** M · **Track:** technical
**Design:** .docs/decisions/adr-2026-07-21-s-tier-pipeline-knobs.md (APPROVED)
**Stories:** .docs/stories/s-tier-pipeline-knobs.md (Accepted, S1–S8)
**Conflict check:** .docs/conflicts/s-tier-pipeline-knobs.md (clean)

## Summary

Express "smallness" as a lean **resolution profile** of the one pipeline: add `S` rows to the existing
`DEFAULT_STEP_TIER_OVERRIDES` table, keep S budgets at the #188 floor of 3, refresh the model
rationale + HARNESS.md, and (optional, separable) seed `Tier: S` deterministically from a `size: S`
label into the complexity artifact the existing reader already consumes. No new step type, artifact
type, flow, or gate reader. RED-first: each behavioral task names its failing test.

## Task Dependency Graph

- T1 → T2 → T3 (core override rows, then metadata/docs sync)
- T4, T5, T6 (invariant tests) depend on T1
- T7 (optional D5 seed) depends on T1; independent of T4–T6
- T8 (verify-only integrity/regen sweep) depends on all

---

## T1: Add `S` rows to `DEFAULT_STEP_TIER_OVERRIDES` (explore, build)

**Dependencies:** none
**Files likely touched:**
- `src/conductor/src/engine/resolved-config.ts` (the `DEFAULT_STEP_TIER_OVERRIDES` map, lines 144-158)
- `src/conductor/test/engine/resolved-config.test.ts` (RED test)

RED test: assert `resolveStepConfig('explore', 'DECIDE', undefined, { tier: 'S' })` returns
`effort: 'low'`, and `resolveStepConfig('build', 'BUILD', undefined, { tier: 'S' })` returns
`max_retries: 3`. Then add `explore: { S: { effort: 'low' } }` and `build: { S: { max_retries: 3 } }`
rows (leaving the existing `stories.S` / `plan.S` / `conflict_check.L` rows intact). Satisfies S1.

## T2: Guard M/L resolution is unchanged by the S rows

**Dependencies:** T1
**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts` (RED test)

RED test: `resolveStepConfig('explore', 'DECIDE', undefined, { tier: 'M' })` and `{ tier: 'L' }`
return the unchanged base effort (`medium`), and `build` under `L` is unchanged — proving the new S
rows carry no M/L keys. Satisfies S2.

## T3: Refresh `STEP_RATIONALE` for tuned steps + regenerate HARNESS.md

**Dependencies:** T1
**Files likely touched:**
- `src/conductor/src/engine/model-table-metadata.ts` (`STEP_RATIONALE`, line 14)
- `HARNESS.md` (regenerated, not hand-edited)
- `src/conductor/test/model-table-metadata.test.ts` (completeness assertion)

Update the `explore` / `build` rationale prose to note the S-tier lean profile, run the model-table
generator, and confirm the completeness test passes. Satisfies S4.

## T4: Pin the S authoring-skip set (no new skip)

**Dependencies:** T1
**Files likely touched:**
- `src/conductor/test/engine/steps.test.ts` (RED test)

RED test: assert `getSkippableSteps('S')` equals exactly
`['architecture_diagram','architecture_review','conflict_check','acceptance_specs','architecture_review_as_built','retro']`
(unchanged). Satisfies S3. No production change to `steps.ts` — the test locks the invariant.

## T5: Pin the #188 retry-budget floor for S (≥3)

**Dependencies:** T1
**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts` (RED test)

RED test: iterate every `DEFAULT_STEP_TIER_OVERRIDES[*].S` row and assert any `max_retries` is `>= 3`;
assert `plan.S.max_retries === 3` and `build.S.max_retries === 3`. Comment cites
`adr-2026-07-05-retry-as-escalation-ladder` Decision 4. Satisfies S5.

## T6: Pin the tier-invariant evidence-gate set

**Dependencies:** T1
**Files likely touched:**
- `src/conductor/test/engine/steps.test.ts` (RED test)
- `src/conductor/test/engine/resolved-config.test.ts` (RED test — `disabled === false` for S build)

RED test: `shouldSkipForTier(step, 'S') === false` for each of `build`, `build_review`,
`wiring_check`, `manual_test`, `rebase`, `finish`; and the resolved S `build_review`/`manual_test`
config has `disabled === false`. Satisfies S6 (and, with T7's escalation check, the S7 escalation
path). No production change — locks the invariant.

## T7: (Optional, separable) Deterministic `size: S` → `Tier: S` seed on the complexity step

**Dependencies:** T1
**Files likely touched:**
- `src/conductor/src/engine/complexity.ts` (label→tier helper feeding the `Tier:` line)
- `src/conductor/test/engine/complexity.test.ts` (RED test)

RED test: a helper maps labels containing `size: S` to `'S'`, which is written into the `Tier:` line of
`.docs/complexity/<slug>.md` that `parseComplexityTier` (`artifacts.ts:1902`) already reads,
short-circuiting only `assessTier`. Also assert escalation still applies to the resulting S config
(`escalateAttempt(model, 'low', 2, true)` bumps to `medium`) — S7. This task is independent and may be
deferred without blocking T1–T6.

## T8: Verify harness integrity + generated-doc sync

**Verify-only:** yes
**Type:** verification
**Dependencies:** T1, T2, T3, T4, T5, T6, T7
**Files likely touched:** none (runs existing suites)

Run `test/test_harness_integrity.sh`, `test/test_generate_model_table_wrapper.sh`, and the conductor
vitest suite (`resolved-config`, `steps`, `complexity`, `escalation`, `model-table-metadata`); confirm
all green and that HARNESS.md matches the generator output (no drift). No code change — verification
only. Satisfies S4/S6/S8 end-to-end.
