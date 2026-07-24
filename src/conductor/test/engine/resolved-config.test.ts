import { describe, it, expect } from 'vitest';
import {
  resolveStepConfig,
  phaseForStep,
  DEFAULT_STEP_RETRIES,
  DEFAULT_STEP_REVIEW,
  FALLBACK_MODEL,
  FALLBACK_EFFORT,
  FALLBACK_RETRIES,
  FALLBACK_REVIEW,
  resolveBuildReviewConfig,
} from '../../src/engine/resolved-config.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';

describe('engine/resolved-config', () => {
  describe('resolveBuildReviewConfig (#773 Task 4 — completeness default-on)', () => {
    it('defaults to enabled when no build_review block is present at all', () => {
      const resolved = resolveBuildReviewConfig(undefined);
      expect(resolved.enabled).toBe(true);
    });

    it('defaults to enabled when config has no build_review key set', () => {
      const config: HarnessConfig = {} as HarnessConfig;
      const resolved = resolveBuildReviewConfig(config);
      expect(resolved.enabled).toBe(true);
    });

    it('still honors an explicit opt-out (enabled: false)', () => {
      const config: HarnessConfig = { build_review: { enabled: false } } as HarnessConfig;
      const resolved = resolveBuildReviewConfig(config);
      expect(resolved.enabled).toBe(false);
    });

    it('still honors an explicit opt-in (enabled: true)', () => {
      const config: HarnessConfig = { build_review: { enabled: true } } as HarnessConfig;
      const resolved = resolveBuildReviewConfig(config);
      expect(resolved.enabled).toBe(true);
    });

    it('defaults perTaskFloor to true when field is absent', () => {
      const config: HarnessConfig = { build_review: { enabled: true } } as HarnessConfig;
      const resolved = resolveBuildReviewConfig(config);
      expect(resolved.perTaskFloor).toBe(true);
    });

    it('defaults perTaskFloor to true when build_review block is absent entirely', () => {
      const resolved = resolveBuildReviewConfig(undefined);
      expect(resolved.perTaskFloor).toBe(true);
    });

    it('honors an explicit perTaskFloor: false opt-out', () => {
      const config: HarnessConfig = {
        build_review: { enabled: true, perTaskFloor: false },
      } as HarnessConfig;
      const resolved = resolveBuildReviewConfig(config);
      expect(resolved.perTaskFloor).toBe(false);
    });

    it('fails open to true when perTaskFloor is malformed (wrong type)', () => {
      const config = {
        build_review: { enabled: true, perTaskFloor: 'nope' as unknown as boolean },
      } as HarnessConfig;
      const resolved = resolveBuildReviewConfig(config);
      expect(resolved.perTaskFloor).toBe(true);
    });
  });

  describe('Claude policy and provider-neutral defaults', () => {
    it('has Claude model/effort and provider-neutral retries/review for every registry step', async () => {
      const { ALL_STEPS } = await import('../../src/engine/steps.js');
      for (const s of ALL_STEPS) {
        expect(CLAUDE_MODEL_POLICY.stepModels[s.name]).toBeDefined();
        expect(CLAUDE_MODEL_POLICY.stepEfforts[s.name]).toBeDefined();
        expect(DEFAULT_STEP_RETRIES[s.name]).toBeDefined();
        expect(DEFAULT_STEP_REVIEW[s.name]).toBeDefined();
      }
    });

    it('reasoning-heavy steps get high+ effort', () => {
      expect(CLAUDE_MODEL_POLICY.stepEfforts.prd).toBe('high');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.plan).toBe('high');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.architecture_review).toBe('high');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.assess).toBe('high');
    });

    it('mechanical steps get low effort', () => {
      expect(CLAUDE_MODEL_POLICY.stepEfforts.bootstrap).toBe('low');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.memory).toBe('low');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.worktree).toBe('low');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.finish).toBe('low');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.build).toBe('low'); // dispatcher
    });

    it('recovery steps (rebase, remediate) use fable with high+ effort', () => {
      expect(CLAUDE_MODEL_POLICY.stepModels.rebase).toBe('fable');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.rebase).toBe('max');
      expect(CLAUDE_MODEL_POLICY.stepModels.remediate).toBe('fable');
      expect(CLAUDE_MODEL_POLICY.stepEfforts.remediate).toBe('high');
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
      // #188 retry-as-escalation: deep steps dropped 5 → 3 (a retry now escalates
      // instead of repeating an identical attempt). Floored at 3 so the
      // attempt-3 model-bump rung stays reachable.
      expect(DEFAULT_STEP_RETRIES.prd).toBe(3);
      expect(DEFAULT_STEP_RETRIES.plan).toBe(3);
      expect(DEFAULT_STEP_RETRIES.build).toBe(3);
      expect(DEFAULT_STEP_RETRIES.explore).toBe(3);
      // architecture_review is out of #188 scope — stays at 5.
      expect(DEFAULT_STEP_RETRIES.architecture_review).toBe(5);
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
    it('returns the registered phase', () => {
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
    it('returns Claude policy values and provider-neutral retry/review defaults', () => {
      const r = resolveStepConfig('prd', 'DECIDE', CLAUDE_MODEL_POLICY);
      expect(r.model).toBe(CLAUDE_MODEL_POLICY.stepModels.prd);
      expect(r.effort).toBe(CLAUDE_MODEL_POLICY.stepEfforts.prd);
      expect(r.max_retries).toBe(DEFAULT_STEP_RETRIES.prd);
      expect(r.review).toBe(DEFAULT_STEP_REVIEW.prd);
      expect(r.disabled).toBe(false);
    });

    it('resolves the complete Claude policy matrix without user config', () => {
      const steps = [
        ['bootstrap', 'UNDERSTAND'], ['memory', 'UNDERSTAND'], ['assess', 'UNDERSTAND'],
        ['explore', 'DECIDE'], ['prd', 'DECIDE'], ['complexity', 'DECIDE'],
        ['stories', 'DECIDE'], ['conflict_check', 'DECIDE'], ['plan', 'DECIDE'],
        ['architecture_diagram', 'DECIDE'], ['architecture_review', 'DECIDE'],
        ['worktree', 'SETUP'], ['acceptance_specs', 'BUILD'], ['build', 'BUILD'],
        ['build_review', 'BUILD'], ['wiring_check', 'BUILD'], ['manual_test', 'SHIP'],
        ['prd_audit', 'SHIP'], ['architecture_review_as_built', 'SHIP'], ['retro', 'SHIP'],
        ['rebase', 'SHIP'], ['finish', 'SHIP'], ['remediate', 'SHIP'],
        ['attribution_verify', 'SHIP'],
      ] as const;

      expect(
        steps.map(([step, phase]) => {
          const { model, effort } = resolveStepConfig(
            step,
            phase,
            CLAUDE_MODEL_POLICY,
          );
          return { step, model, effort };
        }),
      ).toEqual([
        { step: 'bootstrap', model: 'sonnet', effort: 'low' },
        { step: 'memory', model: 'haiku', effort: 'low' },
        { step: 'assess', model: 'sonnet', effort: 'high' },
        { step: 'explore', model: 'fable', effort: 'high' },
        { step: 'prd', model: 'fable', effort: 'high' },
        { step: 'complexity', model: 'sonnet', effort: 'low' },
        { step: 'stories', model: 'sonnet', effort: 'medium' },
        { step: 'conflict_check', model: 'sonnet', effort: 'medium' },
        { step: 'plan', model: 'sonnet', effort: 'high' },
        { step: 'architecture_diagram', model: 'sonnet', effort: 'medium' },
        { step: 'architecture_review', model: 'fable', effort: 'high' },
        { step: 'worktree', model: 'haiku', effort: 'low' },
        { step: 'acceptance_specs', model: 'sonnet', effort: 'medium' },
        { step: 'build', model: 'sonnet', effort: 'low' },
        { step: 'build_review', model: 'opus', effort: 'high' },
        { step: 'wiring_check', model: 'sonnet', effort: 'low' },
        { step: 'manual_test', model: 'sonnet', effort: 'medium' },
        { step: 'prd_audit', model: 'opus', effort: 'high' },
        { step: 'architecture_review_as_built', model: 'sonnet', effort: 'medium' },
        { step: 'retro', model: 'sonnet', effort: 'medium' },
        { step: 'rebase', model: 'fable', effort: 'max' },
        { step: 'finish', model: 'haiku', effort: 'low' },
        { step: 'remediate', model: 'fable', effort: 'high' },
        { step: 'attribution_verify', model: 'opus', effort: 'high' },
      ]);
    });
  });

  describe('resolveStepConfig — precedence', () => {
    it('defaults block overrides the Claude policy step value', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'max', max_retries: 10, review: 'auto' },
      };
      const r = resolveStepConfig('bootstrap', 'UNDERSTAND', CLAUDE_MODEL_POLICY, config);
      expect(r.effort).toBe('max');
      expect(r.max_retries).toBe(10);
      expect(r.review).toBe('auto');
    });

    it('phase overrides defaults', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'low' },
        phases: { UNDERSTAND: { effort: 'high' } },
      };
      expect(resolveStepConfig('bootstrap', 'UNDERSTAND', CLAUDE_MODEL_POLICY, config).effort).toBe('high');
    });

    it('step overrides phase and defaults', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'low' },
        phases: { UNDERSTAND: { effort: 'medium' } },
        steps: { bootstrap: { effort: 'xhigh' } },
      };
      expect(resolveStepConfig('bootstrap', 'UNDERSTAND', CLAUDE_MODEL_POLICY, config).effort).toBe('xhigh');
    });

    it('CLI model override beats everything', () => {
      const config: HarnessConfig = {
        steps: { prd: { model: 'opus' } },
      };
      const r = resolveStepConfig('prd', 'DECIDE', CLAUDE_MODEL_POLICY, config, {
        modelCliOverride: 'haiku',
      });
      expect(r.model).toBe('haiku');
    });

    it('CLI effort override beats everything', () => {
      const config: HarnessConfig = {
        defaults: { effort: 'high' },
        steps: { prd: { effort: 'xhigh' } },
      };
      const r = resolveStepConfig('prd', 'DECIDE', CLAUDE_MODEL_POLICY, config, {
        effortCliOverride: 'low',
      });
      expect(r.effort).toBe('low');
    });

    it('user step.model overrides fable default on rebase', () => {
      const config: HarnessConfig = {
        steps: { rebase: { model: 'opus' } },
      };
      const r = resolveStepConfig('rebase', 'SHIP', CLAUDE_MODEL_POLICY, config);
      expect(r.model).toBe('opus');
    });

    it('user config override beats fable default for explore', () => {
      // Regression: explore defaults to 'fable', but user config
      // steps.explore.model should override it
      const config: HarnessConfig = {
        steps: { explore: { model: 'sonnet' } },
      };
      const r = resolveStepConfig('explore', 'DECIDE', CLAUDE_MODEL_POLICY, config);
      expect(r.model).toBe('sonnet');
    });

    it('user config override beats fable default for prd', () => {
      // Regression: prd defaults to 'fable', but user config
      // steps.prd.model should override it
      const config: HarnessConfig = {
        steps: { prd: { model: 'opus' } },
      };
      const r = resolveStepConfig('prd', 'DECIDE', CLAUDE_MODEL_POLICY, config);
      expect(r.model).toBe('opus');
    });

    it('user config override beats fable default for architecture_review', () => {
      // Regression: architecture_review defaults to 'fable', but user config
      // steps.architecture_review.model should override it
      const config: HarnessConfig = {
        steps: { architecture_review: { model: 'sonnet' } },
      };
      const r = resolveStepConfig('architecture_review', 'DECIDE', CLAUDE_MODEL_POLICY, config);
      expect(r.model).toBe('sonnet');
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
      const r = resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, config, { tier: 'L' });
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
      const r = resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, config, { tier: 'S' });
      expect(r.effort).toBe('medium');
    });

    it('Claude policy tier overrides apply when no user config', () => {
      // CLAUDE_MODEL_POLICY.stepTierOverrides.plan.S → effort: medium, max_retries: 3
      const rS = resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'S' });
      expect(rS.effort).toBe('medium');
      expect(rS.max_retries).toBe(3);
      // CLAUDE_MODEL_POLICY.stepTierOverrides.plan.L → effort: xhigh, model: fable
      const rL = resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'L' });
      expect(rL.effort).toBe('xhigh');
      expect(rL.model).toBe('fable');
    });

    it('conflict_check bumps to fable on Large, stays sonnet on S/M', () => {
      // Regression: HARNESS.md promised "sonnet (S/M), fable (L)" but the engine
      // never bumped the model — L ran on sonnet. Now enforced via tier override.
      expect(resolveStepConfig('conflict_check', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'S' }).model).toBe(
        'sonnet',
      );
      expect(resolveStepConfig('conflict_check', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'M' }).model).toBe(
        'sonnet',
      );
      expect(resolveStepConfig('conflict_check', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'L' }).model).toBe(
        'fable',
      );
    });

    it('front-of-funnel discovery steps use reasoning-capable defaults', () => {
      // Under-modeling here cascades into everything downstream.
      expect(resolveStepConfig('explore', 'DECIDE', CLAUDE_MODEL_POLICY).model).toBe('fable');
      expect(resolveStepConfig('explore', 'DECIDE', CLAUDE_MODEL_POLICY).effort).toBe('high');
      expect(resolveStepConfig('prd', 'DECIDE', CLAUDE_MODEL_POLICY).model).toBe('fable');
      expect(resolveStepConfig('prd', 'DECIDE', CLAUDE_MODEL_POLICY).effort).toBe('high');
      expect(resolveStepConfig('architecture_review', 'DECIDE', CLAUDE_MODEL_POLICY).model).toBe('fable');
      expect(resolveStepConfig('architecture_review', 'DECIDE', CLAUDE_MODEL_POLICY).effort).toBe('high');
      expect(resolveStepConfig('architecture_review_as_built', 'DECIDE', CLAUDE_MODEL_POLICY).model).toBe('sonnet');
      expect(resolveStepConfig('complexity', 'DECIDE', CLAUDE_MODEL_POLICY).model).toBe('sonnet');
      expect(resolveStepConfig('bootstrap', 'UNDERSTAND', CLAUDE_MODEL_POLICY).model).toBe('sonnet');
    });

    it('user step.by_tier beats Claude policy tier override', () => {
      const config: HarnessConfig = {
        steps: { plan: { by_tier: { L: { effort: 'max' } } } },
      };
      const r = resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, config, { tier: 'L' });
      expect(r.effort).toBe('max'); // user's by_tier, not policy xhigh
    });

    it('stories Claude policy tier overrides — S→low, L→high', () => {
      const rS = resolveStepConfig('stories', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'S' });
      expect(rS.effort).toBe('low');
      const rL = resolveStepConfig('stories', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'L' });
      expect(rL.effort).toBe('high');
    });

    it('explore and build S-tier overrides — explore low effort, build max_retries 3', () => {
      const rExplore = resolveStepConfig('explore', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'S' });
      expect(rExplore.effort).toBe('low');
      const rBuild = resolveStepConfig('build', 'BUILD', CLAUDE_MODEL_POLICY, undefined, { tier: 'S' });
      expect(rBuild.max_retries).toBe(3);
    });

    it('explore/build S-tier rows carry no M/L keys — M/L resolution unchanged', () => {
      // Guard: CLAUDE_MODEL_POLICY.stepTierOverrides.explore and .build only define an
      // S row. M and L tiers must fall through to the untouched base config.
      const rExploreM = resolveStepConfig('explore', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'M' });
      expect(rExploreM.effort).toBe('high');
      const rExploreL = resolveStepConfig('explore', 'DECIDE', CLAUDE_MODEL_POLICY, undefined, { tier: 'L' });
      expect(rExploreL.effort).toBe('high');

      const rBuildL = resolveStepConfig('build', 'BUILD', CLAUDE_MODEL_POLICY, undefined, { tier: 'L' });
      expect(rBuildL.max_retries).toBe(3); // provider-neutral base retry budget, not an override
    });

    // adr-2026-07-05-retry-as-escalation-ladder, Decision 4: any provider-policy
    // S-tier max_retries floor is >= 3 — S-tier is the cheapest/fastest lane,
    // so it must not silently get fewer retry attempts than the ladder assumes.
    // This is an invariant-locking test (#188): no production change expected,
    // it pins the floor so a future edit can't quietly regress it.
    it('every Claude policy S-tier max_retries override is >= 3', () => {
      for (const [step, tiers] of Object.entries(CLAUDE_MODEL_POLICY.stepTierOverrides)) {
        const sRow = tiers?.S;
        if (sRow && sRow.max_retries !== undefined) {
          expect(sRow.max_retries).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it('plan.S and build.S max_retries are pinned at exactly 3', () => {
      expect(CLAUDE_MODEL_POLICY.stepTierOverrides.plan?.S?.max_retries).toBe(3);
      expect(CLAUDE_MODEL_POLICY.stepTierOverrides.build?.S?.max_retries).toBe(3);
    });
  });

  describe('resolveStepConfig — S-tier review-step disabled invariant (Task: T6)', () => {
    // Invariant-locking test: build_review and manual_test must remain
    // enabled (disabled === false) at S tier — they are part of the
    // evidence-gate core and must never be silently disabled by tier
    // resolution. No production change expected.
    it('build_review is not disabled at S tier', () => {
      const r = resolveStepConfig('build_review', 'BUILD', CLAUDE_MODEL_POLICY, undefined, { tier: 'S' });
      expect(r.disabled).toBe(false);
    });

    it('manual_test is not disabled at S tier', () => {
      const r = resolveStepConfig('manual_test', 'SHIP', CLAUDE_MODEL_POLICY, undefined, { tier: 'S' });
      expect(r.disabled).toBe(false);
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
      const r = resolveStepConfig('build', 'BUILD', CLAUDE_MODEL_POLICY, config);
      expect(r.skill).toBe('.harness/skills/build/SKILL.md');
      expect(r.hooks).toEqual({ before: 'pre.sh', after: 'post.sh' });
      expect(r.disabled).toBe(true);
    });
  });

  describe('resolveStepConfig — collateral-drift guard on untouched steps', () => {
    it('finish stays haiku/low; build runs on sonnet (coding lane) at low effort', () => {
      // Regression guard: verify that changes to recovery/failure-response steps
      // (rebase, remediate) do not inadvertently affect unrelated steps.
      // finish stays on its mechanical haiku/low baseline.
      const rFinish = resolveStepConfig('finish', 'SHIP', CLAUDE_MODEL_POLICY);
      expect(rFinish.model).toBe('haiku');
      expect(rFinish.effort).toBe('low');

      // build was intentionally bumped haiku→sonnet: it launches the code-
      // authoring implementation session, so it needs a capable model. Effort
      // is unchanged at low (the dispatch itself is light).
      const rBuild = resolveStepConfig('build', 'BUILD', CLAUDE_MODEL_POLICY);
      expect(rBuild.model).toBe('sonnet');
      expect(rBuild.effort).toBe('low');
    });
  });

  describe('resolveStepConfig — BUILD-step models (regression guard)', () => {
    it('BUILD steps did not drift after DECIDE→fable migration', () => {
      // Regression: Task 2 changed DECIDE-step defaults (explore/prd/architecture_review→fable).
      // This test verifies BUILD-step models remain at their expected values:
      // - build (code-authoring implementation session) → sonnet (bumped from haiku)
      // - acceptance_specs (test generation) → sonnet
      // - stories (feature tasks) → sonnet
      expect(resolveStepConfig('build', 'BUILD', CLAUDE_MODEL_POLICY).model).toBe('sonnet');
      expect(resolveStepConfig('acceptance_specs', 'BUILD', CLAUDE_MODEL_POLICY).model).toBe('sonnet');
      expect(resolveStepConfig('stories', 'DECIDE', CLAUDE_MODEL_POLICY).model).toBe('sonnet');
    });
  });

  describe('resolveAuthParkTimeoutMinutes', () => {
    it('defaults to 60 when auth_park_timeout_minutes is absent', async () => {
      const { resolveAuthParkTimeoutMinutes } = await import(
        '../../src/engine/resolved-config.js'
      );
      const result = resolveAuthParkTimeoutMinutes(undefined);
      expect(result).toBe(60);
    });

    it('returns the configured value when explicitly set to a positive number', async () => {
      const { resolveAuthParkTimeoutMinutes } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        auth_park_timeout_minutes: 15,
      };
      const result = resolveAuthParkTimeoutMinutes(config);
      expect(result).toBe(15);
    });

    it('preserves 0 as an opt-out signal', async () => {
      const { resolveAuthParkTimeoutMinutes } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        auth_park_timeout_minutes: 0,
      };
      const result = resolveAuthParkTimeoutMinutes(config);
      expect(result).toBe(0);
    });

    it('preserves negative values as an opt-out signal', async () => {
      const { resolveAuthParkTimeoutMinutes } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        auth_park_timeout_minutes: -5,
      };
      const result = resolveAuthParkTimeoutMinutes(config);
      expect(result).toBe(-5);
    });

    it('throws on non-numeric string values', async () => {
      const { resolveAuthParkTimeoutMinutes } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config = {
        auth_park_timeout_minutes: 'soon',
      } as unknown as HarnessConfig;
      expect(() => resolveAuthParkTimeoutMinutes(config)).toThrow(
        /Invalid auth_park_timeout_minutes.*expected a number/
      );
    });

    it('throws on NaN (non-finite number)', async () => {
      const { resolveAuthParkTimeoutMinutes } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        auth_park_timeout_minutes: NaN,
      };
      expect(() => resolveAuthParkTimeoutMinutes(config)).toThrow(
        /Invalid auth_park_timeout_minutes.*finite/
      );
    });

    it('throws on Infinity', async () => {
      const { resolveAuthParkTimeoutMinutes } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        auth_park_timeout_minutes: Infinity,
      };
      expect(() => resolveAuthParkTimeoutMinutes(config)).toThrow(
        /Invalid auth_park_timeout_minutes.*finite/
      );
    });
  });

  describe('resolveSelfHostConfig — build_auth defaults', () => {
    it('absent block → buildAuthMode: daemon-token, buildAuthTokenPath: ~/.ai-conductor/build-auth', async () => {
      const { resolveSelfHostConfig } = await import(
        '../../src/engine/resolved-config.js'
      );
      const os = await import('os');
      const config: HarnessConfig = {
        harness_self_host: {},
      };
      const result = resolveSelfHostConfig(config);
      expect(result.buildAuthMode).toBe('daemon-token');
      expect(result.buildAuthTokenPath).toBe(`${os.homedir()}/.ai-conductor/build-auth`);
    });

    it('explicit api-key mode is honored', async () => {
      const { resolveSelfHostConfig } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        harness_self_host: {
          build_auth: {
            mode: 'api-key',
          },
        },
      };
      const result = resolveSelfHostConfig(config);
      expect(result.buildAuthMode).toBe('api-key');
    });

    it('custom token_path is honored', async () => {
      const { resolveSelfHostConfig } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        harness_self_host: {
          build_auth: {
            token_path: '/custom/path/to/token',
          },
        },
      };
      const result = resolveSelfHostConfig(config);
      expect(result.buildAuthTokenPath).toBe('/custom/path/to/token');
    });

    it('~ in token_path is expanded to home directory', async () => {
      const { resolveSelfHostConfig } = await import(
        '../../src/engine/resolved-config.js'
      );
      const os = await import('os');
      const config: HarnessConfig = {
        harness_self_host: {
          build_auth: {
            token_path: '~/.secrets/build-token',
          },
        },
      };
      const result = resolveSelfHostConfig(config);
      expect(result.buildAuthTokenPath).toBe(`${os.homedir()}/.secrets/build-token`);
    });

    it('blank token_path defaults to ~/.ai-conductor/build-auth', async () => {
      const { resolveSelfHostConfig } = await import(
        '../../src/engine/resolved-config.js'
      );
      const os = await import('os');
      const config: HarnessConfig = {
        harness_self_host: {
          build_auth: {
            token_path: '',
          },
        },
      };
      const result = resolveSelfHostConfig(config);
      expect(result.buildAuthTokenPath).toBe(`${os.homedir()}/.ai-conductor/build-auth`);
    });

    it('whitespace-only token_path defaults to ~/.ai-conductor/build-auth', async () => {
      const { resolveSelfHostConfig } = await import(
        '../../src/engine/resolved-config.js'
      );
      const os = await import('os');
      const config: HarnessConfig = {
        harness_self_host: {
          build_auth: {
            token_path: '   \t\n  ',
          },
        },
      };
      const result = resolveSelfHostConfig(config);
      expect(result.buildAuthTokenPath).toBe(`${os.homedir()}/.ai-conductor/build-auth`);
    });

    it('happy path: explicit daemon-token with custom path', async () => {
      const { resolveSelfHostConfig } = await import(
        '../../src/engine/resolved-config.js'
      );
      const config: HarnessConfig = {
        harness_self_host: {
          build_auth: {
            mode: 'daemon-token',
            token_path: '/etc/daemon/token',
          },
        },
      };
      const result = resolveSelfHostConfig(config);
      expect(result.buildAuthMode).toBe('daemon-token');
      expect(result.buildAuthTokenPath).toBe('/etc/daemon/token');
    });
  });

  // #188 retry-as-escalation: the `escalate` knob resolves through the same
  // step → phase → defaults precedence as the other tuning knobs.
  describe('escalate resolution (#188)', () => {
    it('defaults to true when unset everywhere', () => {
      expect(resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, undefined).escalate).toBe(true);
      expect(resolveStepConfig('build', 'BUILD', CLAUDE_MODEL_POLICY, {}).escalate).toBe(true);
    });

    it('step-level escalate:false wins', () => {
      const config: HarnessConfig = { steps: { plan: { escalate: false } } };
      expect(resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, config).escalate).toBe(false);
    });

    it('phase-level applies when step is unset', () => {
      const config: HarnessConfig = { phases: { DECIDE: { escalate: false } } };
      expect(resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, config).escalate).toBe(false);
    });

    it('defaults-level applies when step and phase are unset', () => {
      const config: HarnessConfig = { defaults: { escalate: false } };
      expect(resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, config).escalate).toBe(false);
    });

    it('step overrides phase (precedence parity with other knobs)', () => {
      const config: HarnessConfig = {
        phases: { DECIDE: { escalate: false } },
        steps: { plan: { escalate: true } },
      };
      expect(resolveStepConfig('plan', 'DECIDE', CLAUDE_MODEL_POLICY, config).escalate).toBe(true);
    });
  });
});
