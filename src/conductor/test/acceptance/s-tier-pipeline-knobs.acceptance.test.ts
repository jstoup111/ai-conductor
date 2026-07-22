/**
 * RED acceptance specs for #668 — "Small features are cheap through the
 * existing pipeline's own knobs" (.docs/stories/s-tier-pipeline-knobs.md).
 *
 * These specs drive the PUBLIC resolution surface (`resolveStepConfig` →
 * `escalateAttempt`, and the tier-gate predicates `shouldSkipForTier` /
 * `getSkippableSteps`) as the flow a real dispatch goes through: a step is
 * resolved for a tier, then — on retry — escalated. Neither function's own
 * unit test proves the CHAIN works; that's the acceptance-level claim these
 * specs make. Per the plan (.docs/plans/s-tier-pipeline-knobs.md), this
 * feature adds S rows to `DEFAULT_STEP_TIER_OVERRIDES` (table data only) —
 * no new step type, artifact, flow, or gate reader.
 *
 * Covers stories: S1 (lean base), S2 (M/L untouched), S5 (retry floor),
 * S6 (no gate weakened), S7 (escalation still fires). S3/S4/S8 are pinned
 * as unit/verify-only tests per the plan (T4, T3, T8) — not duplicated here.
 *
 * RED reason: `DEFAULT_STEP_TIER_OVERRIDES` has no `explore` or `build` rows
 * yet (resolved-config.ts:144-158) — the S1/S7 test fails today because
 * `resolveStepConfig('explore', 'DECIDE', undefined, { tier: 'S' })` returns
 * the unchanged base effort (`medium`), not the lean `low` the story requires.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveStepConfig,
  DEFAULT_STEP_TIER_OVERRIDES,
  DEFAULT_STEP_EFFORT,
} from '../../src/engine/resolved-config.js';
import { escalateAttempt } from '../../src/engine/escalation.js';
import { shouldSkipForTier, getSkippableSteps } from '../../src/engine/steps.js';

describe('S-tier pipeline knobs (#668)', () => {
  describe('Story 1 + Story 7 — an S explore step resolves lean, then still climbs the escalation ladder', () => {
    it('resolves S explore to the lean profile and escalates it on retry (resolve -> escalate chain)', () => {
      const resolved = resolveStepConfig('explore', 'DECIDE', undefined, { tier: 'S' });

      // S1: the S override table gives explore a lean base effort.
      expect(resolved.effort).toBe('low');

      // S7: the lean base is not exempt from the escalation ladder — a
      // mis-judged S recovers instead of failing at the floor. Attempt 2
      // bumps effort one rung; attempt 3 holds effort at that rung and
      // climbs the model tier (escalation.ts:76-93).
      //
      // CONFIDENCE NOTE (verify-claims): the story text reads "attempt 3
      // bumps the model tier", but `explore`'s base model is `fable`
      // (DEFAULT_STEP_MODELS.explore, resolved-config.ts:30) — already the
      // top rung of MODEL_TIER_ORDER (escalation.ts:29), so `bumpModel`
      // documents this exact case as a no-op ("a model already at the top
      // tier is a no-op", escalation.ts:53). VERIFIED (not a guess): asserting
      // a model CHANGE here would hardcode a claim that is never true for the
      // real `explore` step and would stay red forever after T1 lands — the
      // wrong-reason-failure this skill's RED gate exists to catch. This test
      // asserts the actual documented ladder behavior (effort held, model
      // saturated at its ceiling) instead of the story's literal wording.
      expect(resolved.escalate).toBe(true);
      const attempt2 = escalateAttempt(resolved.model, resolved.effort, 2, resolved.escalate);
      expect(attempt2.effort).toBe('medium');
      const attempt3 = escalateAttempt(resolved.model, resolved.effort, 3, resolved.escalate);
      expect(attempt3.effort).toBe('medium');
      expect(attempt3.model).toBe('fable');
    });
  });

  describe('Story 2 — M/L resolution is untouched by the new S rows', () => {
    it('leaves explore effort at the unchanged base for M and L', () => {
      const m = resolveStepConfig('explore', 'DECIDE', undefined, { tier: 'M' });
      const l = resolveStepConfig('explore', 'DECIDE', undefined, { tier: 'L' });
      expect(m.effort).toBe(DEFAULT_STEP_EFFORT.explore);
      expect(l.effort).toBe(DEFAULT_STEP_EFFORT.explore);
    });

    it('resolves build under L byte-identically to today (no build.L row is introduced)', () => {
      const before = resolveStepConfig('build', 'BUILD', undefined, {});
      const afterL = resolveStepConfig('build', 'BUILD', undefined, { tier: 'L' });
      expect(afterL).toEqual(before);
    });
  });

  describe('Story 5 (negative) — the #188 retry floor of 3 holds for every S row', () => {
    it('never lets a DEFAULT_STEP_TIER_OVERRIDES[*].S row set max_retries below 3', () => {
      const sRows = Object.values(DEFAULT_STEP_TIER_OVERRIDES)
        .map((byTier) => byTier?.S)
        .filter((row): row is NonNullable<typeof row> => row !== undefined);
      expect(sRows.length).toBeGreaterThan(0);
      for (const row of sRows) {
        if (row.max_retries !== undefined) {
          expect(row.max_retries).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it('pins plan.S and build.S at exactly 3 (the #188 model-bump rung needs attempt 3 reachable)', () => {
      expect(resolveStepConfig('plan', 'DECIDE', undefined, { tier: 'S' }).max_retries).toBe(3);
      expect(resolveStepConfig('build', 'BUILD', undefined, { tier: 'S' }).max_retries).toBe(3);
    });

    it('documents that a budget of 2 would truncate the ladder before the model bump', () => {
      // escalateAttempt only bumps the MODEL tier at attempt >= 3 (escalation.ts:88-92).
      // A max_retries of 2 would mean attempts 1-2 only — the model-bump rung
      // (attempt 3) is never reached. This is the #188 rationale (adr-2026-07-05
      // Decision 4) that the S5 floor test above guards against regressing.
      const budgetOfTwoAttempts = [1, 2];
      const modelEverBumped = budgetOfTwoAttempts.some((attempt) => attempt >= 3);
      expect(modelEverBumped).toBe(false);
    });
  });

  describe('Story 6 (negative) — no evidence gate is tier-weakened for S', () => {
    // manual_test is intentionally excluded (ADR D5, #775): S-tier features
    // legitimately skip manual testing.
    const gateSteps = ['build', 'build_review', 'wiring_check', 'rebase', 'finish'] as const;

    it('never tier-skips any build/SHIP-tail gate for S', () => {
      for (const step of gateSteps) {
        expect(shouldSkipForTier(step, 'S')).toBe(false);
      }
    });

    it('resolves the S build/build_review config with disabled === false (no S row sets disable)', () => {
      const build = resolveStepConfig('build', 'BUILD', undefined, { tier: 'S' });
      const buildReview = resolveStepConfig('build_review', 'BUILD', undefined, { tier: 'S' });
      const manualTest = resolveStepConfig('manual_test', 'SHIP', undefined, { tier: 'S' });
      expect(build.disabled).toBe(false);
      expect(buildReview.disabled).toBe(false);
      expect(manualTest.disabled).toBe(false);
    });

    it('does not add build/build_review/wiring_check/manual_test/rebase/finish to the S skip set', () => {
      const skippable = getSkippableSteps('S');
      for (const step of gateSteps) {
        expect(skippable).not.toContain(step);
      }
    });
  });
});
