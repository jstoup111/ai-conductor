/**
 * RED acceptance specs for provider-aware model and effort resolution (#902).
 *
 * These specs exercise the real resolver, runner, attribution dispatcher,
 * composition-root source, and generated-document entry points. The expected
 * policies are copied from the accepted story matrix so a production table
 * cannot make its own acceptance oracle pass.
 *
 * Existing coverage intentionally reused instead of duplicated here:
 * - resolver precedence/hooks/disable/review:
 *   test/engine/resolved-config.test.ts
 * - configured/empty/off-ladder and auth/rate-limit behavior:
 *   test/acceptance/model-availability-fallback-ladder.test.ts
 * - non-consuming retry branches and escalate:false:
 *   test/acceptance/retry-as-escalation.acceptance.test.ts
 * - generated-region byte preservation and drift mechanics:
 *   test/acceptance/generate-model-table.acceptance.test.ts
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import { phaseForStep, resolveStepConfig } from '../../src/engine/resolved-config.js';
import { escalateAttempt } from '../../src/engine/escalation.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { dispatchAttributionVerifier } from '../../src/engine/attribution-lane.js';
import { buildPinsJson, renderModelTable } from '../../src/tools/generate-model-table.js';
import type { ComplexityTier, StepName } from '../../src/types/index.js';
import type { EffortLevel, HarnessConfig, TierOverride } from '../../src/types/config.js';

interface AcceptancePolicy {
  stepModels: Record<StepName, string>;
  stepEfforts: Record<StepName, EffortLevel>;
  stepTierOverrides: Partial<
    Record<StepName, Partial<Record<ComplexityTier, TierOverride>>>
  >;
  effortOrder: readonly EffortLevel[];
  modelEscalationOrder: readonly string[];
  modelFallbackLadder: readonly string[];
}

const CLAUDE_MODELS: Record<StepName, string> = {
  bootstrap: 'sonnet',
  memory: 'haiku',
  assess: 'sonnet',
  explore: 'fable',
  prd: 'fable',
  complexity: 'sonnet',
  stories: 'sonnet',
  conflict_check: 'sonnet',
  plan: 'sonnet',
  architecture_diagram: 'sonnet',
  architecture_review: 'fable',
  worktree: 'haiku',
  acceptance_specs: 'sonnet',
  build: 'sonnet',
  build_review: 'opus',
  wiring_check: 'sonnet',
  manual_test: 'sonnet',
  prd_audit: 'opus',
  architecture_review_as_built: 'sonnet',
  retro: 'sonnet',
  rebase: 'fable',
  finish: 'haiku',
  remediate: 'fable',
  attribution_verify: 'opus',
};

const CODEX_MODELS: Record<StepName, string> = {
  bootstrap: 'gpt-5.6-terra',
  memory: 'gpt-5.6-luna',
  assess: 'gpt-5.6-terra',
  explore: 'gpt-5.6-sol',
  prd: 'gpt-5.6-sol',
  complexity: 'gpt-5.6-terra',
  stories: 'gpt-5.6-terra',
  conflict_check: 'gpt-5.6-terra',
  plan: 'gpt-5.6-terra',
  architecture_diagram: 'gpt-5.6-terra',
  architecture_review: 'gpt-5.6-sol',
  worktree: 'gpt-5.6-luna',
  acceptance_specs: 'gpt-5.6-terra',
  build: 'gpt-5.6-terra',
  build_review: 'gpt-5.6-sol',
  wiring_check: 'gpt-5.6-terra',
  manual_test: 'gpt-5.6-terra',
  prd_audit: 'gpt-5.6-sol',
  architecture_review_as_built: 'gpt-5.6-terra',
  retro: 'gpt-5.6-terra',
  rebase: 'gpt-5.6-sol',
  finish: 'gpt-5.6-luna',
  remediate: 'gpt-5.6-sol',
  attribution_verify: 'gpt-5.6-sol',
};

const STEP_EFFORTS: Record<StepName, EffortLevel> = {
  bootstrap: 'low',
  memory: 'low',
  assess: 'high',
  explore: 'high',
  prd: 'high',
  complexity: 'low',
  stories: 'medium',
  conflict_check: 'medium',
  plan: 'high',
  architecture_diagram: 'medium',
  architecture_review: 'high',
  worktree: 'low',
  acceptance_specs: 'medium',
  build: 'low',
  build_review: 'high',
  wiring_check: 'low',
  manual_test: 'medium',
  prd_audit: 'high',
  architecture_review_as_built: 'medium',
  retro: 'medium',
  rebase: 'max',
  finish: 'low',
  remediate: 'high',
  attribution_verify: 'high',
};

const COMMON_TIER_OVERRIDES: AcceptancePolicy['stepTierOverrides'] = {
  stories: {
    S: { effort: 'low' },
    L: { effort: 'high' },
  },
  explore: {
    S: { effort: 'low' },
  },
  plan: {
    S: { effort: 'medium', max_retries: 3 },
    L: { effort: 'xhigh' },
  },
  build: {
    S: { max_retries: 3 },
  },
};

const CLAUDE_POLICY: AcceptancePolicy = {
  stepModels: CLAUDE_MODELS,
  stepEfforts: STEP_EFFORTS,
  stepTierOverrides: {
    ...COMMON_TIER_OVERRIDES,
    plan: {
      ...COMMON_TIER_OVERRIDES.plan,
      L: { effort: 'xhigh', model: 'fable' },
    },
    conflict_check: { L: { model: 'fable' } },
  },
  effortOrder: ['low', 'medium', 'high', 'xhigh', 'max'],
  modelEscalationOrder: ['haiku', 'sonnet', 'opus', 'fable'],
  modelFallbackLadder: ['fable', 'opus', 'sonnet'],
};

const CODEX_POLICY: AcceptancePolicy = {
  stepModels: CODEX_MODELS,
  stepEfforts: STEP_EFFORTS,
  stepTierOverrides: {
    ...COMMON_TIER_OVERRIDES,
    plan: {
      ...COMMON_TIER_OVERRIDES.plan,
      L: { effort: 'xhigh', model: 'gpt-5.6-sol' },
    },
    conflict_check: { L: { model: 'gpt-5.6-sol' } },
  },
  effortOrder: ['low', 'medium', 'high', 'xhigh', 'max'],
  modelEscalationOrder: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
  modelFallbackLadder: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
};

type Resolved = {
  model: string;
  effort: EffortLevel;
};

/**
 * #902's explicit production resolver contract:
 * step, phase, selected policy, optional config, optional CLI/tier options.
 * Cast through unknown so this RED spec executes against the old signature
 * instead of failing collection/type transformation.
 */
function resolveWithPolicy(
  policy: AcceptancePolicy,
  step: StepName,
  tier?: ComplexityTier,
  config?: HarnessConfig,
  options: Record<string, unknown> = {},
): Resolved {
  const resolver = resolveStepConfig as unknown as (
    step: StepName,
    phase: ReturnType<typeof phaseForStep>,
    policy: AcceptancePolicy,
    config?: HarnessConfig,
    options?: Record<string, unknown>,
  ) => Resolved;
  const phase =
    step === 'bootstrap' || step === 'assess'
      ? 'UNDERSTAND'
      : phaseForStep(step);
  return resolver(step, phase, policy, config, { ...options, tier });
}

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  vi.restoreAllMocks();
});

describe('#902 built-in provider policy matrix', () => {
  it('resolves every Claude and Codex base row without cross-provider aliases', () => {
    for (const [policy, models] of [
      [CLAUDE_POLICY, CLAUDE_MODELS],
      [CODEX_POLICY, CODEX_MODELS],
    ] as const) {
      for (const step of Object.keys(models) as StepName[]) {
        expect(resolveWithPolicy(policy, step)).toMatchObject({
          model: models[step],
          effort: STEP_EFFORTS[step],
        });
      }
    }

    const codexResolved = (Object.keys(CODEX_MODELS) as StepName[]).map(
      (step) => resolveWithPolicy(CODEX_POLICY, step).model,
    );
    expect(codexResolved).toHaveLength(24);
    expect(codexResolved.every((model) => /^gpt-5\.6-(luna|terra|sol)$/.test(model))).toBe(true);
  });

  it('applies the accepted S/M/L outcomes without changing non-tier-aware steps', () => {
    for (const policy of [CLAUDE_POLICY, CODEX_POLICY]) {
      expect(resolveWithPolicy(policy, 'stories', 'S').effort).toBe('low');
      expect(resolveWithPolicy(policy, 'stories', 'M').effort).toBe('medium');
      expect(resolveWithPolicy(policy, 'stories', 'L').effort).toBe('high');

      expect(resolveWithPolicy(policy, 'explore', 'S').effort).toBe('low');
      expect(resolveWithPolicy(policy, 'explore', 'M').effort).toBe('high');
      expect(resolveWithPolicy(policy, 'explore', 'L').effort).toBe('high');

      expect(resolveWithPolicy(policy, 'plan', 'S').effort).toBe('medium');
      expect(resolveWithPolicy(policy, 'plan', 'M').effort).toBe('high');
      expect(resolveWithPolicy(policy, 'plan', 'L').effort).toBe('xhigh');

      const bootstrapValues = (['S', 'M', 'L'] as const).map(
        (tier) => resolveWithPolicy(policy, 'bootstrap', tier),
      );
      expect(new Set(bootstrapValues.map((value) => `${value.model}:${value.effort}`)).size).toBe(1);
    }

    expect(resolveWithPolicy(CLAUDE_POLICY, 'plan', 'L').model).toBe('fable');
    expect(resolveWithPolicy(CODEX_POLICY, 'plan', 'L').model).toBe('gpt-5.6-sol');
    expect(resolveWithPolicy(CLAUDE_POLICY, 'conflict_check', 'L').model).toBe('fable');
    expect(resolveWithPolicy(CODEX_POLICY, 'conflict_check', 'L').model).toBe('gpt-5.6-sol');
    expect(resolveWithPolicy(CODEX_POLICY, 'plan', 'M').model).toBe('gpt-5.6-terra');
    expect(resolveWithPolicy(CODEX_POLICY, 'conflict_check', 'S').model).toBe('gpt-5.6-terra');
  });

  it('keeps explicit cross-provider models opaque and above policy defaults', () => {
    expect(
      resolveWithPolicy(CODEX_POLICY, 'memory', undefined, {
        steps: { memory: { model: 'sonnet', effort: 'max' } },
      }).model,
    ).toBe('sonnet');
    expect(
      resolveWithPolicy(CLAUDE_POLICY, 'memory', undefined, {
        steps: { memory: { model: 'gpt-5.6-sol', effort: 'max' } },
      }).model,
    ).toBe('gpt-5.6-sol');
    expect(
      resolveWithPolicy(
        CODEX_POLICY,
        'memory',
        undefined,
        { steps: { memory: { model: 'gpt-5.6-terra' } } },
        { modelCliOverride: 'gpt-5.6-sol' },
      ).model,
    ).toBe('gpt-5.6-sol');
  });
});

describe('#902 provider-native retry escalation', () => {
  it('bumps effort on attempt 2 and model on attempt 3 within each provider order', () => {
    const escalate = escalateAttempt as unknown as (
      model: string,
      effort: EffortLevel,
      attempt: number,
      enabled: boolean,
      policy: AcceptancePolicy,
    ) => { model: string; effort: EffortLevel };

    expect(escalate('gpt-5.6-luna', 'low', 1, true, CODEX_POLICY)).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'low',
    });
    expect(escalate('gpt-5.6-luna', 'low', 2, true, CODEX_POLICY)).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'medium',
    });
    expect(escalate('gpt-5.6-luna', 'low', 3, true, CODEX_POLICY)).toEqual({
      model: 'gpt-5.6-terra',
      effort: 'medium',
    });
    expect(escalate('gpt-5.6-luna', 'low', 4, true, CODEX_POLICY)).toEqual({
      model: 'gpt-5.6-sol',
      effort: 'medium',
    });
    expect(escalate('gpt-5.6-sol', 'max', 8, true, CODEX_POLICY)).toEqual({
      model: 'gpt-5.6-sol',
      effort: 'max',
    });
    expect(escalate('custom-model', 'high', 8, true, CODEX_POLICY)).toEqual({
      model: 'custom-model',
      effort: 'xhigh',
    });
    expect(escalate('gpt-5.6-luna', 'low', 8, false, CODEX_POLICY)).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'low',
    });

    expect(escalate('haiku', 'low', 3, true, CLAUDE_POLICY)).toEqual({
      model: 'sonnet',
      effort: 'medium',
    });
    expect(escalate('fable', 'high', 2, true, CLAUDE_POLICY)).toEqual({
      model: 'fable',
      effort: 'xhigh',
    });
    expect(escalate('gpt-5.6-sol', 'high', 2, true, CODEX_POLICY)).toEqual({
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    });
  });
});

describe('#902 real execution paths', () => {
  it('DefaultStepRunner dispatches the Codex policy model and effort', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'provider-policy-runner-'));
    tempDirs.push(dir);
    const calls: InvokeOptions[] = [];
    const provider: LLMProvider = {
      invoke: vi.fn(async (options: InvokeOptions) => {
        calls.push(options);
        return { success: true, output: 'done', exitCode: 0 };
      }),
      invokeInteractive: vi.fn(),
    };

    const runner = new DefaultStepRunner(provider, 'session-1', dir, {
      modelPolicy: CODEX_POLICY,
    } as never);
    const result = await runner.run('memory', {});

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'gpt-5.6-luna', effort: 'low' });
  });

  it('attribution verification walks Sol to Terra to Luna within one dispatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'provider-policy-attribution-'));
    tempDirs.push(dir);
    const planPath = join(dir, 'plan.md');
    await writeFile(
      planPath,
      '# Plan\n\n### Task 1: Example\n\n**Files:** src/example.ts\n',
      'utf8',
    );

    const models: string[] = [];
    const provider: LLMProvider = {
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        models.push(options.model ?? '');
        if (options.model === 'gpt-5.6-luna') {
          return { success: true, output: '{"schema":1}', exitCode: 0 };
        }
        return {
          success: false,
          output: 'model unavailable',
          exitCode: 1,
          modelUnavailable: true,
        };
      }),
      invokeInteractive: vi.fn(),
    };
    const gitRunner: GitRunner = vi.fn(async (args: string[]) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse'
        ? 'abc1234567890def1234567890def1234567890'
        : '',
      stderr: '',
    })) as unknown as GitRunner;

    const result = await dispatchAttributionVerifier({
      provider,
      modelPolicy: CODEX_POLICY,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner,
    } as never);

    expect(result.success).toBe(true);
    expect(models).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  });

  it('inline and daemon composition roots carry policy to every runner and conductor', async () => {
    const indexSource = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
    const daemonSource = await readFile(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8');

    expect(indexSource).toContain('resolveProviderModelPolicy');
    expect(daemonSource).toContain('resolveProviderModelPolicy');

    const indexRunnerBlocks = indexSource.split('new DefaultStepRunner(').slice(1);
    const daemonRunnerBlocks = daemonSource.split('new DefaultStepRunner(').slice(1);
    expect(indexRunnerBlocks).toHaveLength(1);
    expect(daemonRunnerBlocks).toHaveLength(4);
    for (const block of [...indexRunnerBlocks, ...daemonRunnerBlocks]) {
      expect(block.slice(0, block.indexOf(');'))).toContain('modelPolicy');
    }

    const indexConductorBlock = indexSource.split('new Conductor(')[1]?.split(');')[0] ?? '';
    const daemonConductorBlock = daemonSource.split('new Conductor(')[1]?.split(');')[0] ?? '';
    expect(indexConductorBlock).toContain('modelPolicy');
    expect(daemonConductorBlock).toContain('modelPolicy');
  });
});

describe('#902 unknown-provider compatibility policy', () => {
  it('warns once at lookup, reuses Claude policy, and keeps the selected provider instance', async () => {
    const modulePath = ['../../src/engine', 'provider-model-policy.js'].join('/');
    let policyModule: Record<string, unknown> | undefined;
    try {
      policyModule = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
    } catch {
      // Missing module is the expected pre-implementation RED cause. Keep the
      // failure inside the test rather than turning it into collection ERROR.
    }
    if (!policyModule) {
      expect.fail('provider-model-policy module is not implemented');
      return;
    }

    const lookup = policyModule.resolveProviderModelPolicy;
    expect(typeof lookup).toBe('function');
    if (typeof lookup !== 'function') return;

    const warnings: string[] = [];
    const compatibilityPolicy = (
      lookup as (key: string, warn: (line: string) => void) => AcceptancePolicy
    )('recorder', (line) => warnings.push(line));

    expect(warnings).toHaveLength(1);
    expect(compatibilityPolicy.stepModels).toEqual(CLAUDE_MODELS);
    for (const step of ['memory', 'explore', 'prd'] as const) {
      expect(resolveWithPolicy(compatibilityPolicy, step).model).toBe(CLAUDE_MODELS[step]);
    }
    expect(warnings).toHaveLength(1);

    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, output: 'done', exitCode: 0 })),
      invokeInteractive: vi.fn(),
    };
    const dir = await mkdtemp(join(tmpdir(), 'compatibility-policy-runner-'));
    tempDirs.push(dir);
    const runner = new DefaultStepRunner(provider, 'session-compat', dir, {
      modelPolicy: compatibilityPolicy,
    } as never);
    await runner.run('memory', {});
    expect(provider.invoke).toHaveBeenCalledOnce();

    const knownWarnings: string[] = [];
    (lookup as (key: string, warn: (line: string) => void) => AcceptancePolicy)(
      'claude',
      (line) => knownWarnings.push(line),
    );
    (lookup as (key: string, warn: (line: string) => void) => AcceptancePolicy)(
      'codex',
      (line) => knownWarnings.push(line),
    );
    expect(knownWarnings).toEqual([]);
  });
});

describe('#902 generated provider documentation', () => {
  it('labels both autonomous policies and the Claude interactive path', () => {
    const table = renderModelTable();
    expect(table).toContain(
      '| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |',
    );
    expect(table).toMatch(
      /\| memory \| autonomous engine \| haiku \| low \| gpt-5\.6-luna \| low \|/,
    );
    expect(table).toMatch(
      /\| plan \| autonomous engine \| sonnet \(S\/M\), fable \(L\) \| medium \(S\), high \(M\), xhigh \(L\) \| gpt-5\.6-terra \(S\/M\), gpt-5\.6-sol \(L\) \| medium \(S\), high \(M\), xhigh \(L\) \|/,
    );
    expect(table).toContain('| code-review | Claude interactive |');
    expect(table.match(/\| autonomous engine \|/g)).toHaveLength(24);

    const pins = buildPinsJson();
    expect(pins.rebase).toEqual({ expected: 'fable' });
    expect(JSON.stringify(pins)).not.toContain('gpt-5.6-sol');
  });
});
