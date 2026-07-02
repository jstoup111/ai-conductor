import { describe, it, expect } from 'vitest';
import {
  resolveStepConfig,
  phaseForStep,
  DEFAULT_STEP_MODELS,
  DEFAULT_STEP_EFFORT,
  DEFAULT_STEP_RETRIES,
  DEFAULT_STEP_REVIEW,
  FALLBACK_MODEL,
  FALLBACK_EFFORT,
  FALLBACK_RETRIES,
  FALLBACK_REVIEW,
} from '../../src/engine/resolved-config.js';
import type { HarnessConfig } from '../../src/types/config.js';

describe('engine/resolved-config', () => {
  describe('default tables', () => {
    it('has model/effort/retries/review for every registry step', async () => {
      const { ALL_STEPS } = await import('../../src/engine/steps.js');
      for (const s of ALL_STEPS) {
        expect(DEFAULT_STEP_MODELS[s.name]).toBeDefined();
        expect(DEFAULT_STEP_EFFORT[s.name]).toBeDefined();
        expect(DEFAULT_STEP_RETRIES[s.name]).toBeDefined();
        expect(DEFAULT_STEP_REVIEW[s.name]).toBeDefined();
      }
    });

    it('reasoning-heavy steps get high+ effort', () => {
      expect(DEFAULT_STEP_EFFORT.prd).toBe('xhigh');
      expect(DEFAULT_STEP_EFFORT.plan).toBe('high');
      expect(DEFAULT_STEP_EFFORT.architecture_review).toBe('high');
      expect(DEFAULT_STEP_EFFORT.assess).toBe('high');
    });

    it('mechanical steps get low effort', () => {
      expect(DEFAULT_STEP_EFFORT.bootstrap).toBe('low');
      expect(DEFAULT_STEP_EFFORT.memory).toBe('low');
      expect(DEFAULT_STEP_EFFORT.worktree).toBe('low');
      expect(DEFAULT_STEP_EFFORT.finish).toBe('low');
      expect(DEFAULT_STEP_EFFORT.build).toBe('low'); // dispatcher
    });

    it('recovery steps (rebase, remediate) use fable with high+ effort', () => {
      expect(DEFAULT_STEP_MODELS.rebase).toBe('fable');
      expect(DEFAULT_STEP_EFFORT.rebase).toBe('max');
      expect(DEFAULT_STEP_MODELS.remediate).toBe('fable');
      expect(DEFAULT_STEP_EFFORT.remediate).toBe('high');
    });

    it('review modes match the per-step design', () => {
      expect(DEFAULT_STEP_REVIEW.conflict_check).toBe('conditional');
      expect(DEFAULT_STEP_REVIEW.architecture_review).toBe('conditional');
      expect(DEFAULT_STEP_REVIEW.architecture_diagram).toBe('auto');
      expect(DEFAULT_STEP_REVIEW.acceptance_specs).toBe('auto');
      expect(DEFAULT_STEP_REVIEW.build).toBe('auto');
      expect(DEFAULT_STEP_REVIEW.prd).toBe('manual');
    });

    it('retry budgets scale with step criticality', () => {
      expect(DEFAULT_STEP_RETRIES.prd).toBe(5);
      expect(DEFAULT_STEP_RETRIES.plan).toBe(5);
      expect(DEFAULT_STEP_RETRIES.build).toBe(5);
      expect(DEFAULT_STEP_RETRIES.bootstrap).toBe(1);
    });

    it('fallbacks are sensible', () => {
      expect(FALLBACK_MODEL).toBe('sonnet');
      expect(FALLBACK_EFFORT).toBe('medium');
      expect(FALLBACK_RETRIES).toBe(3);
      expect(FALLBACK_REVIEW).toBe('manual');
    });
  });

  describe('phaseForStep', () => {
    it('returns the hardcoded phase', () => {
      expect(phaseForStep('explore')).toBe('DECIDE');
      expect(phaseForStep('build')).toBe('BUILD');
      expect(phaseForStep('retro')).toBe('SHIP');
    });

    it('throws on unknown step', () => {
      expect(() => phaseForStep('nonexistent' as never)).toThrow(/Unknown step/);
    });

    it('resolves out-of-band steps absent from the linear sequence', () => {
      // `remediate` is dispatched only when a prd_audit blocks; it is not in
      // ALL_STEPS but must still resolve a phase (regression: it threw
      // "Unknown step: remediate", which the daemon turned into a HALT).
      expect(phaseForStep('remediate')).toBe('SHIP');
    });
  });

  describe('resolveStepConfig — no config', () => {
    it('returns hardcoded per-step defaults', () => {
      const r = resolveStepConfig('prd', 'DECIDE');
      expect(r.model).toBe(DEFAULT_STEP_MODELS.prd);
      expect(r.effort).toBe(DEFAULT_STEP_EFFORT.prd);
      expect(r.max_retries).toBe(DEFAULT_STEP_RETRIES.prd);
      expect(r.review).toBe(DEFAULT_STEP_REVIEW.prd);
      expect(r.disabled).toBe(false);
    });
  });

  describe('resolveStepConfig — precedence', () => {
    it('defaults block overrides hardcoded per-step', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'max', max_retries: 10, review: 'auto' },
      };
      const r = resolveStepConfig('bootstrap', 'UNDERSTAND', config);
      expect(r.effort).toBe('max');
      expect(r.max_retries).toBe(10);
      expect(r.review).toBe('auto');
    });

    it('phase overrides defaults', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'low' },
        phases: { UNDERSTAND: { effort: 'high' } },
      };
      expect(resolveStepConfig('bootstrap', 'UNDERSTAND', config).effort).toBe('high');
    });

    it('step overrides phase and defaults', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'low' },
        phases: { UNDERSTAND: { effort: 'medium' } },
        steps: { bootstrap: { effort: 'xhigh' } },
      };
      expect(resolveStepConfig('bootstrap', 'UNDERSTAND', config).effort).toBe('xhigh');
    });

    it('CLI model override beats everything', () => {
      const config: HarnessConfig = {
        steps: { prd: { model: 'opus' } },
      };
      const r = resolveStepConfig('prd', 'DECIDE', config, {
        modelCliOverride: 'haiku',
      });
      expect(r.model).toBe('haiku');
    });

    it('CLI effort override beats everything', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'high' },
        steps: { prd: { effort: 'xhigh' } },
      };
      const r = resolveStepConfig('prd', 'DECIDE', config, {
        effortCliOverride: 'low',
      });
      expect(r.effort).toBe('low');
    });

    it('user step.model overrides fable default on rebase', () => {
      const config: HarnessConfig = {
        steps: { rebase: { model: 'opus' } },
      };
      const r = resolveStepConfig('rebase', 'SHIP', config);
      expect(r.model).toBe('opus');
    });
  });

  describe('resolveStepConfig — by_tier', () => {
    it('step.by_tier[tier] beats step config when tier matches', () => {
      const config: HarnessConfig = {
        steps: {
          plan: {
            effort: 'medium',
            by_tier: {
              L: { effort: 'xhigh' },
            },
          },
        },
      };
      const r = resolveStepConfig('plan', 'DECIDE', config, { tier: 'L' });
      expect(r.effort).toBe('xhigh');
    });

    it('step.by_tier[tier] is ignored when tier is different', () => {
      const config: HarnessConfig = {
        steps: {
          plan: {
            effort: 'medium',
            by_tier: { L: { effort: 'xhigh' } },
          },
        },
      };
      const r = resolveStepConfig('plan', 'DECIDE', config, { tier: 'S' });
      expect(r.effort).toBe('medium');
    });

    it('hardcoded tier overrides apply when no user config', () => {
      // DEFAULT_STEP_TIER_OVERRIDES.plan.S → effort: medium, max_retries: 3
      const rS = resolveStepConfig('plan', 'DECIDE', undefined, { tier: 'S' });
      expect(rS.effort).toBe('medium');
      expect(rS.max_retries).toBe(3);
      // DEFAULT_STEP_TIER_OVERRIDES.plan.L → effort: xhigh, model: opus
      const rL = resolveStepConfig('plan', 'DECIDE', undefined, { tier: 'L' });
      expect(rL.effort).toBe('xhigh');
      expect(rL.model).toBe('opus');
    });

    it('conflict_check bumps to opus on Large, stays sonnet on S/M', () => {
      // Regression: HARNESS.md promised "sonnet (S/M), opus (L)" but the engine
      // never bumped the model — L ran on sonnet. Now enforced via tier override.
      expect(resolveStepConfig('conflict_check', 'DECIDE', undefined, { tier: 'S' }).model).toBe(
        'sonnet',
      );
      expect(resolveStepConfig('conflict_check', 'DECIDE', undefined, { tier: 'M' }).model).toBe(
        'sonnet',
      );
      expect(resolveStepConfig('conflict_check', 'DECIDE', undefined, { tier: 'L' }).model).toBe(
        'opus',
      );
    });

    it('front-of-funnel discovery steps use reasoning-capable defaults', () => {
      // Under-modeling here cascades into everything downstream.
      expect(resolveStepConfig('explore', 'DECIDE').model).toBe('opus');
      expect(resolveStepConfig('explore', 'DECIDE').effort).toBe('xhigh');
      expect(resolveStepConfig('complexity', 'DECIDE').model).toBe('sonnet');
      expect(resolveStepConfig('bootstrap', 'UNDERSTAND').model).toBe('sonnet');
    });

    it('user step.by_tier beats hardcoded tier override', () => {
      const config: HarnessConfig = {
        steps: { plan: { by_tier: { L: { effort: 'max' } } } },
      };
      const r = resolveStepConfig('plan', 'DECIDE', config, { tier: 'L' });
      expect(r.effort).toBe('max'); // user's by_tier, not hardcoded xhigh
    });

    it('stories hardcoded tier overrides — S→low, L→high', () => {
      const rS = resolveStepConfig('stories', 'DECIDE', undefined, { tier: 'S' });
      expect(rS.effort).toBe('low');
      const rL = resolveStepConfig('stories', 'DECIDE', undefined, { tier: 'L' });
      expect(rL.effort).toBe('high');
    });
  });

  describe('resolveStepConfig — skill / hooks / disable passthrough', () => {
    it('skill, hooks, disable pass through from step config', () => {
      const config: HarnessConfig = {
        steps: {
          build: {
            disable: true,
            skill: '.harness/skills/build/SKILL.md',
            hooks: { before: 'pre.sh', after: 'post.sh' },
          },
        },
      };
      const r = resolveStepConfig('build', 'BUILD', config);
      expect(r.skill).toBe('.harness/skills/build/SKILL.md');
      expect(r.hooks).toEqual({ before: 'pre.sh', after: 'post.sh' });
      expect(r.disabled).toBe(true);
    });
  });
});
