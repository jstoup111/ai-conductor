/**
 * RED acceptance specs for per-step LLM provider routing (#927).
 *
 * Covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10,
 * FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-20
 *
 * These scenarios derive their oracle from the approved PRD and stories, not
 * from the current single-provider implementation. Provider doubles stand in
 * only for the external Claude/Codex process boundary. The final suite also
 * checks the production composition and auxiliary call sites named by the ADR,
 * so a green candidate-loop primitive cannot ship while the live conductor
 * still bypasses it.
 */

import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateConfig } from '../../src/engine/config.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  ProviderRuntimeSet,
  type ProviderRuntime,
} from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  TokenUsage,
} from '../../src/execution/llm-provider.js';
import type { EffortLevel, HarnessConfig } from '../../src/types/config.js';
import type { ComplexityTier, Phase, StepName } from '../../src/types/index.js';

type ResolvePreferredProviderNativeStepConfig = (input: {
  step: StepName;
  phase: Phase;
  preferredProvider: string;
  inheritedProvider: string;
  policy: ProviderModelPolicy;
  config?: HarnessConfig;
  options?: {
    tier?: ComplexityTier;
    modelCliOverride?: string;
    effortCliOverride?: EffortLevel;
  };
}) => { model: string; effort: EffortLevel };

async function loadPreferredNativeResolver(): Promise<
  ResolvePreferredProviderNativeStepConfig | undefined
> {
  const loaded = await import('../../src/engine/resolved-config.js');
  return (
    loaded as typeof loaded & {
      resolvePreferredProviderNativeStepConfig?: ResolvePreferredProviderNativeStepConfig;
    }
  ).resolvePreferredProviderNativeStepConfig;
}

type ResolveFallbackProviderNativeStepConfig = (input: {
  step: StepName;
  tier?: ComplexityTier;
  policy: ProviderModelPolicy;
  attempt: number;
  escalate: boolean;
  primaryAttempt: {
    model: string;
    effort: EffortLevel;
    modelCliOverride: string;
    effortCliOverride: EffortLevel;
    escalatedModel: string;
    escalatedEffort: EffortLevel;
    configuredModelFallbackLadder: readonly string[];
  };
}) => {
  model: string;
  effort: EffortLevel;
  modelFallbackLadder: readonly string[];
};

async function loadFallbackNativeResolver(): Promise<
  ResolveFallbackProviderNativeStepConfig | undefined
> {
  const loaded = await import('../../src/engine/resolved-config.js');
  return (
    loaded as typeof loaded & {
      resolveFallbackProviderNativeStepConfig?: ResolveFallbackProviderNativeStepConfig;
    }
  ).resolveFallbackProviderNativeStepConfig;
}

interface ProviderAttempt {
  provider: string;
  model?: string;
  sessionId?: string;
  resume?: boolean;
  reason?: string;
  tokenUsage?: TokenUsage;
}

interface ProviderExecutionResult extends InvokeResult {
  preferredProvider: string;
  actualProvider?: string;
  attempts: ProviderAttempt[];
}

interface ExecuteInput {
  step: StepName;
  executionId: string;
  attempt?: number;
  configuredProviders: string[];
  preferredProvider?: string;
  runtimes: ProviderRuntimeSet;
  config?: HarnessConfig;
  modelOverride?: string;
  effortOverride?: string;
  sessionStore?: Map<string, ProviderSessionScope>;
  unavailableProviders?: Map<string, string>;
  warn?: (message: string) => void;
}

type ExecuteProviderCandidates = (
  input: ExecuteInput,
) => Promise<ProviderExecutionResult>;

async function loadExecuteProviderCandidates(): Promise<ExecuteProviderCandidates> {
  const loaded = await import('../../src/engine/provider-execution.js').catch(() => null);
  expect(
    loaded,
    'provider-execution.ts must exist and expose the planned candidate-loop seam',
  ).not.toBeNull();
  expect(
    loaded && 'executeProviderCandidates' in loaded,
    'provider-execution.ts must export executeProviderCandidates',
  ).toBe(true);
  const execute = (
    loaded as unknown as {
      executeProviderCandidates: (
        input: Record<string, unknown>,
      ) => Promise<ProviderExecutionResult>;
    }
  ).executeProviderCandidates;
  return async (input) => {
    const sessionsByExecution =
      input.sessionStore ?? new Map<string, ProviderSessionScope>();
    let sessions = sessionsByExecution.get(input.executionId);
    if (!sessions) {
      sessions = new ProviderSessionScope(() => crypto.randomUUID());
      sessionsByExecution.set(input.executionId, sessions);
    }
    return execute({
      ...input,
      sessions,
      options: { prompt: `Acceptance fixture for ${input.step}` },
    });
  };
}

type ValidateRegisteredSelections = (input: {
  config: HarnessConfig;
  registeredProviders: readonly string[];
}) => void;

async function loadValidateRegisteredSelections(): Promise<ValidateRegisteredSelections> {
  const loaded = await import('../../src/engine/provider-selection.js').catch(() => null);
  expect(
    loaded,
    'provider-selection.ts must exist and expose post-registration validation',
  ).not.toBeNull();
  expect(
    loaded && 'validateRegisteredProviderSelections' in loaded,
    'provider-selection.ts must export validateRegisteredProviderSelections',
  ).toBe(true);
  return (
    loaded as unknown as {
      validateRegisteredProviderSelections: ValidateRegisteredSelections;
    }
  ).validateRegisteredProviderSelections;
}

function scriptedProvider(
  script:
    | InvokeResult[]
    | ((options: InvokeOptions, call: number) => InvokeResult),
) {
  const calls: InvokeOptions[] = [];
  const provider: LLMProvider = {
    invoke: vi.fn(async (options: InvokeOptions) => {
      calls.push(options);
      if (typeof script === 'function') return script(options, calls.length);
      return script[Math.min(calls.length - 1, script.length - 1)];
    }),
    invokeInteractive: vi.fn(async () => {}),
  };
  return { provider, calls };
}

const ok = (
  output: string,
  tokenUsage?: TokenUsage,
): InvokeResult => ({
  success: true,
  output,
  exitCode: 0,
  tokenUsage,
});

const providerUnavailable = (reason: string): InvokeResult =>
  ({
    success: false,
    output: reason,
    exitCode: 127,
    providerUnavailable: true,
    providerUnavailableReason: reason,
    providerUnavailableScope: 'run',
  }) as InvokeResult;

const modelUnavailable = (model: string): InvokeResult => ({
  success: false,
  output: `model unavailable: ${model}`,
  exitCode: 1,
  modelUnavailable: true,
});

function runtimes(
  claude: LLMProvider,
  codex: LLMProvider,
): ProviderRuntimeSet {
  return new ProviderRuntimeSet([
    runtime('claude', claude, CLAUDE_MODEL_POLICY),
    runtime('codex', codex, CODEX_MODEL_POLICY),
  ]);
}

function runtime(
  key: string,
  provider: LLMProvider,
  policy: ProviderModelPolicy,
): ProviderRuntime {
  return {
    key,
    provider,
    policy,
    builtIn: key === 'claude' || key === 'codex',
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ST-927-1 — configured provider set and validation', () => {
  it('accepts the scalar compatibility form and an ordered array without migration', () => {
    const scalar = validateConfig({ llm_provider: 'claude' });
    const ordered = validateConfig({ llm_provider: ['claude', 'codex'] });

    expect(scalar.ok).toBe(true);
    expect(ordered.ok).toBe(true);
    if (scalar.ok && ordered.ok) {
      expect(scalar.config.llm_provider).toBe('claude');
      expect(ordered.config.llm_provider).toEqual(['claude', 'codex']);
      expect(scalar.warnings).toEqual([]);
      expect(ordered.warnings).toEqual([]);
    }
  });

  it('accepts explicit step providers but rejects empty, blank, and duplicate selections before dispatch', () => {
    const valid = validateConfig({
      llm_provider: ['claude', 'codex'],
      steps: { build_review: { llm_provider: 'codex' } },
    });
    expect(valid.ok).toBe(true);

    for (const invalid of [
      { llm_provider: [] },
      { llm_provider: '' },
      { llm_provider: ['claude', ''] },
      { llm_provider: ['claude', 'claude'] },
      { llm_provider: ['claude', 7] },
      {
        llm_provider: ['claude', 'codex'],
        steps: { build_review: { llm_provider: '' } },
      },
    ]) {
      const result = validateConfig(invalid);
      expect(result.ok, JSON.stringify(invalid)).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/llm_provider|provider/i);
    }
  });

  it('rejects unknown run-level and named-step providers after registration with actionable scope', async () => {
    const validateRegistered = await loadValidateRegisteredSelections();

    for (const [config, expectedScope] of [
      [{ llm_provider: ['claude', 'unknown'] }, 'llm_provider'],
      [
        {
          llm_provider: ['claude', 'codex'],
          steps: { build_review: { llm_provider: 'unknown' } },
        },
        'steps.build_review.llm_provider',
      ],
    ] as const) {
      expect(() =>
        validateRegistered({
          config: config as unknown as HarnessConfig,
          registeredProviders: ['claude', 'codex'],
        }),
      ).toThrow(new RegExp(`unknown.*${expectedScope}|${expectedScope}.*unknown`, 'i'));
    }
  });
});

describe('ST-927-1/ST-927-8 — scalar built-in compatibility', () => {
  it.each([
    {
      providerKey: 'claude',
      policy: CLAUDE_MODEL_POLICY,
      expectedModel: 'sonnet',
      expectedEffort: 'medium',
    },
    {
      providerKey: 'codex',
      policy: CODEX_MODEL_POLICY,
      expectedModel: 'gpt-5.6-terra',
      expectedEffort: 'medium',
    },
  ])(
    'preserves the pre-feature $providerKey invocation, retry, session, and diagnostic fixture',
    async ({ providerKey, policy, expectedModel, expectedEffort }) => {
      const execute = await loadExecuteProviderCandidates();
      const scripted = scriptedProvider([
        {
          success: false,
          output: `${providerKey} ordinary failure`,
          exitCode: 1,
        },
        ok(`${providerKey} retry success`),
      ]);
      const sessions = new Map<string, ProviderSessionScope>();
      const warnings: string[] = [];
      const sharedInput = {
        step: 'build' as const,
        executionId: `${providerKey}-scalar-build`,
        configuredProviders: [providerKey],
        runtimes: new ProviderRuntimeSet([
          runtime(providerKey, scripted.provider, policy),
        ]),
        sessionStore: sessions,
        warn: (message: string) => warnings.push(message),
      };

      const first = await execute({ ...sharedInput, attempt: 1 });
      const retry = await execute({ ...sharedInput, attempt: 2 });

      expect(scripted.calls).toHaveLength(2);
      expect(scripted.calls.map(({ model, effort }) => ({ model, effort }))).toEqual([
        { model: expectedModel, effort: expectedEffort },
        { model: expectedModel, effort: expectedEffort },
      ]);
      expect(scripted.calls[0].resume).toBe(false);
      expect(scripted.calls[1]).toMatchObject({
        sessionId: scripted.calls[0].sessionId,
        resume: true,
      });
      expect(first).toMatchObject({
        success: false,
        output: `${providerKey} ordinary failure`,
        preferredProvider: providerKey,
        actualProvider: providerKey,
        attempts: [{ provider: providerKey, outcome: 'failure', invoked: true }],
      });
      expect(retry).toMatchObject({
        success: true,
        preferredProvider: providerKey,
        actualProvider: providerKey,
      });
      expect(warnings).toEqual([]);
    },
  );

  it('rejects an unknown scalar provider before the dispatch sentinel runs', async () => {
    const validateRegistered = await loadValidateRegisteredSelections();
    const dispatch = vi.fn();

    expect(() => {
      validateRegistered({
        config: { llm_provider: 'missing-provider' },
        registeredProviders: ['claude', 'codex'],
      });
      dispatch();
    }).toThrow(/llm_provider.*missing-provider.*claude.*codex/i);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('ST-927-2 and ST-927-3 — per-step choice and native settings', () => {
  it.each([
    {
      name: 'inherited Claude build review at M',
      preferredProvider: 'claude',
      inheritedProvider: 'claude',
      policy: CLAUDE_MODEL_POLICY,
      step: 'build_review',
      phase: 'BUILD',
      tier: 'M',
      config: undefined,
      expected: { model: 'fable', effort: 'high' },
    },
    {
      name: 'specialized Claude plan at L',
      preferredProvider: 'claude',
      inheritedProvider: 'codex',
      policy: CLAUDE_MODEL_POLICY,
      step: 'plan',
      phase: 'DECIDE',
      tier: 'L',
      config: {
        defaults: { model: 'gpt-global-default', effort: 'low' },
        phases: { DECIDE: { model: 'gpt-phase-default', effort: 'low' } },
      },
      expected: { model: 'fable', effort: 'xhigh' },
    },
    {
      name: 'inherited Codex build review at M',
      preferredProvider: 'codex',
      inheritedProvider: 'codex',
      policy: CODEX_MODEL_POLICY,
      step: 'build_review',
      phase: 'BUILD',
      tier: 'M',
      config: undefined,
      expected: { model: 'gpt-5.6-sol', effort: 'high' },
    },
    {
      name: 'specialized Codex plan at S',
      preferredProvider: 'codex',
      inheritedProvider: 'claude',
      policy: CODEX_MODEL_POLICY,
      step: 'plan',
      phase: 'DECIDE',
      tier: 'S',
      config: {
        defaults: { model: 'claude-global-default', effort: 'max' },
        phases: { DECIDE: { model: 'claude-phase-default', effort: 'max' } },
      },
      expected: { model: 'gpt-5.6-sol', effort: 'medium' },
    },
  ] satisfies Array<{
    name: string;
    preferredProvider: string;
    inheritedProvider: string;
    policy: ProviderModelPolicy;
    step: StepName;
    phase: Phase;
    tier: ComplexityTier;
    config: HarnessConfig | undefined;
    expected: { model: string; effort: EffortLevel };
  }>)('resolves $name from the selected provider policy', async (fixture) => {
    const resolvePreferred = await loadPreferredNativeResolver();

    expect(
      resolvePreferred?.({
        step: fixture.step,
        phase: fixture.phase,
        preferredProvider: fixture.preferredProvider,
        inheritedProvider: fixture.inheritedProvider,
        policy: fixture.policy,
        config: fixture.config,
        options: { tier: fixture.tier },
      }),
    ).toEqual(fixture.expected);
  });

  it('preserves an explicit opaque step-local model for a specialized provider', async () => {
    const resolvePreferred = await loadPreferredNativeResolver();

    expect(
      resolvePreferred?.({
        step: 'build_review',
        phase: 'BUILD',
        preferredProvider: 'codex',
        inheritedProvider: 'claude',
        policy: CODEX_MODEL_POLICY,
        config: {
          defaults: { model: 'claude-global-default', effort: 'low' },
          steps: {
            build_review: {
              model: 'opaque-model/verbatim',
              effort: 'xhigh',
            },
          },
        },
      }),
    ).toEqual({ model: 'opaque-model/verbatim', effort: 'xhigh' });
  });

  it('preserves opaque CLI native overrides for a specialized provider', async () => {
    const resolvePreferred = await loadPreferredNativeResolver();

    expect(
      resolvePreferred?.({
        step: 'plan',
        phase: 'DECIDE',
        preferredProvider: 'claude',
        inheritedProvider: 'codex',
        policy: CLAUDE_MODEL_POLICY,
        config: {
          defaults: { model: 'gpt-global-default', effort: 'low' },
        },
        options: {
          tier: 'L',
          modelCliOverride: 'cli-model/verbatim',
          effortCliOverride: 'max',
        },
      }),
    ).toEqual({ model: 'cli-model/verbatim', effort: 'max' });
  });

  it('retains phase and default native precedence for the inherited provider', async () => {
    const resolvePreferred = await loadPreferredNativeResolver();

    expect(
      resolvePreferred?.({
        step: 'plan',
        phase: 'DECIDE',
        preferredProvider: 'claude',
        inheritedProvider: 'claude',
        policy: CLAUDE_MODEL_POLICY,
        config: {
          defaults: { model: 'inherited-default', effort: 'low' },
          phases: {
            DECIDE: { model: 'inherited-phase', effort: 'high' },
          },
        },
      }),
    ).toEqual({ model: 'inherited-phase', effort: 'high' });
  });

  it('retains explicit step-tier native settings for a specialized provider', async () => {
    const resolvePreferred = await loadPreferredNativeResolver();

    expect(
      resolvePreferred?.({
        step: 'plan',
        phase: 'DECIDE',
        preferredProvider: 'codex',
        inheritedProvider: 'claude',
        policy: CODEX_MODEL_POLICY,
        config: {
          defaults: { model: 'inherited-default', effort: 'low' },
          phases: {
            DECIDE: { model: 'inherited-phase', effort: 'low' },
          },
          steps: {
            plan: {
              model: 'explicit-step',
              effort: 'high',
              by_tier: {
                L: {
                  model: 'opaque-tier-model/verbatim',
                  effort: 'max',
                },
              },
            },
          },
        },
        options: { tier: 'L' },
      }),
    ).toEqual({ model: 'opaque-tier-model/verbatim', effort: 'max' });
  });

  it('recomputes fallback native settings from its policy at the current retry attempt', async () => {
    const resolveFallback = await loadFallbackNativeResolver();

    expect(
      resolveFallback?.({
        step: 'build',
        tier: 'L',
        policy: CLAUDE_MODEL_POLICY,
        attempt: 3,
        escalate: true,
        primaryAttempt: {
          model: 'gpt-explicit-primary',
          effort: 'max',
          modelCliOverride: 'gpt-cli-primary',
          effortCliOverride: 'max',
          escalatedModel: 'gpt-retry-escalated',
          escalatedEffort: 'xhigh',
          configuredModelFallbackLadder: [
            'gpt-configured-first',
            'gpt-configured-second',
          ],
        },
      }),
    ).toEqual({
      model: 'opus',
      effort: 'xhigh',
      modelFallbackLadder: CLAUDE_MODEL_POLICY.modelFallbackLadder,
    });
  });

  it('uses fallback tier defaults without escalation when neutral settings opt out', async () => {
    const resolveFallback = await loadFallbackNativeResolver();

    expect(
      resolveFallback?.({
        step: 'plan',
        tier: 'L',
        policy: CLAUDE_MODEL_POLICY,
        attempt: 3,
        escalate: false,
        primaryAttempt: {
          model: 'gpt-explicit-primary',
          effort: 'low',
          modelCliOverride: 'gpt-cli-primary',
          effortCliOverride: 'max',
          escalatedModel: 'gpt-retry-escalated',
          escalatedEffort: 'max',
          configuredModelFallbackLadder: ['gpt-configured-only'],
        },
      }),
    ).toEqual({
      model: 'fable',
      effort: 'xhigh',
      modelFallbackLadder: CLAUDE_MODEL_POLICY.modelFallbackLadder,
    });
  });

  it('inherits the first provider, honors explicit specialization, and never infers a judgment provider', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude'));
    const codex = scriptedProvider(() => ok('codex'));
    const sharedRuntimes = runtimes(claude.provider, codex.provider);

    const inherited = await execute({
      step: 'build',
      executionId: 'build-1',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
    });
    const explicit = await execute({
      step: 'build_review',
      executionId: 'review-1',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
    });
    const unspecifiedJudgment = await execute({
      step: 'attribution_verify',
      executionId: 'attribution-1',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
    });

    expect(inherited.actualProvider).toBe('claude');
    expect(explicit.actualProvider).toBe('codex');
    expect(unspecifiedJudgment.actualProvider).toBe('claude');
    expect(claude.calls).toHaveLength(2);
    expect(codex.calls).toHaveLength(1);
  });

  it('keeps explicit models opaque on the preferred provider and resets to fallback-native defaults', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude'));
    const codex = scriptedProvider(() =>
      providerUnavailable('codex executable missing'),
    );

    const explicitCodex = scriptedProvider(() => ok('codex explicit'));
    await execute({
      step: 'build_review',
      executionId: 'review-explicit',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: runtimes(claude.provider, explicitCodex.provider),
      config: {
        defaults: { model: 'claude-global-default' },
        steps: {
          build_review: {
            model: 'gpt-custom-verbatim',
            effort: 'xhigh',
          },
        },
      } as HarnessConfig,
    });
    expect(explicitCodex.calls[0]).toMatchObject({
      model: 'gpt-custom-verbatim',
      effort: 'xhigh',
    });

    const fallback = await execute({
      step: 'build_review',
      executionId: 'review-fallback',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: runtimes(claude.provider, codex.provider),
      config: {
        defaults: { model: 'claude-global-default' },
        steps: {
          build_review: {
            model: 'gpt-custom-verbatim',
            effort: 'xhigh',
          },
        },
      } as HarnessConfig,
      modelOverride: 'gpt-retry-escalated',
      effortOverride: 'max',
    });

    expect(fallback.actualProvider).toBe('claude');
    expect(claude.calls.at(-1)).toMatchObject({
      model: CLAUDE_MODEL_POLICY.stepModels.build_review,
      effort: CLAUDE_MODEL_POLICY.stepEfforts.build_review,
    });
    expect(claude.calls.at(-1)?.model).not.toMatch(/^gpt-|claude-global-default/);
  });
});

describe('ST-927-4 and ST-927-5 — ordered availability fallback', () => {
  it('tries the selected provider first, then configured providers once in stable order, with loud warnings', async () => {
    const execute = await loadExecuteProviderCandidates();
    const calls: string[] = [];
    const warnings: string[] = [];
    const make = (name: string, result: InvokeResult) =>
      scriptedProvider(() => {
        calls.push(name);
        return result;
      });
    const claude = make('claude', ok('claude success'));
    const codex = make('codex', providerUnavailable('codex missing'));
    const unconfigured = make('unconfigured', ok('must not run'));

    const result = await execute({
      step: 'build_review',
      executionId: 'ordered-fallback',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', codex.provider, CODEX_MODEL_POLICY),
        runtime('claude', claude.provider, CLAUDE_MODEL_POLICY),
        runtime(
          'unconfigured',
          unconfigured.provider,
          CLAUDE_MODEL_POLICY,
        ),
      ]),
      warn: (message) => warnings.push(message),
    });

    expect(calls).toEqual(['codex', 'claude']);
    expect(result.actualProvider).toBe('claude');
    expect(unconfigured.calls).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/build_review.*codex.*codex missing.*claude/i);
  });

  it('fails closed after complete provider exhaustion and reports every attempted provider and reason', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => providerUnavailable('claude binary missing'));
    const codex = scriptedProvider(() => providerUnavailable('codex binary missing'));

    const result = await execute({
      step: 'build',
      executionId: 'all-exhausted',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: runtimes(claude.provider, codex.provider),
    });

    expect(result.success).toBe(false);
    expect(result.actualProvider).toBeUndefined();
    expect(result.attempts.map(({ provider }) => provider)).toEqual(['codex', 'claude']);
    expect(result.output).toMatch(/codex.*codex binary missing/i);
    expect(result.output).toMatch(/claude.*claude binary missing/i);
  });

  it('walks a provider-native model ladder before crossing providers and reconsiders model exhaustion on the next step', async () => {
    const execute = await loadExecuteProviderCandidates();
    const codex = scriptedProvider((options) => modelUnavailable(options.model ?? 'unset'));
    const claude = scriptedProvider(() => ok('fallback'));
    const sharedRuntimes = runtimes(claude.provider, codex.provider);

    const first = await execute({
      step: 'build',
      executionId: 'build-model-exhaustion',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
    });
    expect(first.actualProvider).toBe('claude');
    expect(codex.calls.map(({ model }) => model)).toEqual(
      CODEX_MODEL_POLICY.modelFallbackLadder.slice(
        CODEX_MODEL_POLICY.modelFallbackLadder.indexOf(
          CODEX_MODEL_POLICY.stepModels.build,
        ),
      ),
    );
    const firstStepAttemptCount = codex.calls.length;

    await execute({
      step: 'build_review',
      executionId: 'review-reconsider-codex',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
    });
    expect(codex.calls.length).toBeGreaterThan(firstStepAttemptCount);
  });

  it('caches only deterministic run-wide provider failure, never transient or step-scoped failure', async () => {
    const execute = await loadExecuteProviderCandidates();
    const deterministicCache = new Map<string, string>();
    const codex = scriptedProvider(() => providerUnavailable('codex executable missing'));
    const claude = scriptedProvider(() => ok('claude'));
    const sharedRuntimes = runtimes(claude.provider, codex.provider);

    await execute({
      step: 'build',
      executionId: 'cache-1',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
      unavailableProviders: deterministicCache,
    });
    await execute({
      step: 'build_review',
      executionId: 'cache-2',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
      unavailableProviders: deterministicCache,
    });
    expect(codex.calls).toHaveLength(1);

    const transientCodex = scriptedProvider(() => ({
      success: false,
      output: 'timeout',
      exitCode: 1,
    }));
    const transientCache = new Map<string, string>();
    await execute({
      step: 'build',
      executionId: 'transient-1',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: runtimes(claude.provider, transientCodex.provider),
      unavailableProviders: transientCache,
    });
    expect(transientCache.size).toBe(0);
  });
});

describe('ST-927-6 — failure-classification boundary', () => {
  it('does not cross providers for auth, rate limit, stale session, timeout, rejection, or ordinary failure', async () => {
    const execute = await loadExecuteProviderCandidates();
    const cases: InvokeResult[] = [
      { success: false, output: 'not logged in', exitCode: 1, authFailure: true },
      { success: false, output: '429', exitCode: 1, rateLimited: true },
      { success: false, output: 'session expired', exitCode: 1, sessionExpired: true },
      { success: false, output: 'timeout', exitCode: 1 },
      { success: false, output: 'request rejected', exitCode: 1 },
      { success: false, output: 'ordinary unavailable prose', exitCode: 1 },
    ];

    for (const [index, failure] of cases.entries()) {
      const claude = scriptedProvider(() => ok('must not run'));
      const codex = scriptedProvider(() => failure);
      const warnings: string[] = [];
      const result = await execute({
        step: 'build',
        executionId: `classification-${index}`,
        preferredProvider: 'codex',
        configuredProviders: ['claude', 'codex'],
        runtimes: runtimes(claude.provider, codex.provider),
        warn: (message) => warnings.push(message),
      });

      expect(result.success).toBe(false);
      expect(codex.calls).toHaveLength(1);
      expect(claude.calls).toHaveLength(0);
      expect(warnings).toEqual([]);
    }
  });
});

describe('ST-927-7 — provider-local sessions and accounting', () => {
  it('keeps #254-shaped BUILD then build_review on Codex when mixed-health readiness is supported', async () => {
    const execute = await loadExecuteProviderCandidates();
    const codex = scriptedProvider(() => ({
      ...ok('supported cached login completed'),
      authentication: {
        provider: 'codex',
        source: 'cached-login',
        state: 'ready',
        unrelatedHealth: 'degraded',
      },
    }));
    const claude = scriptedProvider(() => ok('must not be selected'));
    const sessionStore = new Map<string, ProviderSessionScope>();
    const shared = {
      preferredProvider: 'codex',
      configuredProviders: ['codex', 'claude'],
      runtimes: runtimes(claude.provider, codex.provider),
      sessionStore,
    };

    const build = await execute({ ...shared, step: 'build', executionId: '254-build' });
    const review = await execute({ ...shared, step: 'build_review', executionId: '254-build-review' });

    expect([build, review]).toEqual(expect.arrayContaining([
      expect.objectContaining({ success: true, actualProvider: 'codex', attempts: [expect.objectContaining({ provider: 'codex' })] }),
    ]));
    expect(codex.calls).toHaveLength(2);
    expect(claude.calls).toHaveLength(0);
  });

  it('starts fresh per step/provider, resumes only a same-step/provider retry, and attributes every attempt', async () => {
    const execute = await loadExecuteProviderCandidates();
    const sessionStore = new Map<string, ProviderSessionScope>();
    const claude = scriptedProvider([
      { success: false, output: 'retry me', exitCode: 1 },
      ok('claude retry', { input: 20, output: 5 }),
    ]);
    const codex = scriptedProvider(() =>
      ok('codex next step', { input: 10, output: 3 }),
    );
    const sharedRuntimes = runtimes(claude.provider, codex.provider);

    await execute({
      step: 'build',
      executionId: 'build-execution',
      attempt: 1,
      preferredProvider: 'claude',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
      sessionStore,
    });
    const retry = await execute({
      step: 'build',
      executionId: 'build-execution',
      attempt: 2,
      preferredProvider: 'claude',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
      sessionStore,
    });
    const nextStep = await execute({
      step: 'build_review',
      executionId: 'review-execution',
      attempt: 1,
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
      sessionStore,
    });

    expect(claude.calls[0].resume).toBe(false);
    expect(claude.calls[1].resume).toBe(true);
    expect(claude.calls[1].sessionId).toBe(claude.calls[0].sessionId);
    expect(codex.calls[0].resume).toBe(false);
    expect(codex.calls[0].sessionId).not.toBe(claude.calls[0].sessionId);
    expect(retry.attempts[0]).toMatchObject({
      provider: 'claude',
      tokenUsage: { input: 20, output: 5 },
    });
    expect(nextStep.attempts[0]).toMatchObject({
      provider: 'codex',
      tokenUsage: { input: 10, output: 3 },
    });
  });

  it('starts a fresh fallback-provider session and never crosses provider credentials or permissions', async () => {
    const execute = await loadExecuteProviderCandidates();
    const sessionStore = new Map<string, ProviderSessionScope>();
    const codex = scriptedProvider(() => providerUnavailable('codex missing'));
    const claude = scriptedProvider(() => ok('claude fallback'));

    await execute({
      step: 'build',
      executionId: 'fallback-session',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: runtimes(claude.provider, codex.provider),
      sessionStore,
    });

    expect(codex.calls[0].resume).toBe(false);
    expect(claude.calls[0].resume).toBe(false);
    expect(claude.calls[0].sessionId).not.toBe(codex.calls[0].sessionId);
  });
});

describe('ST-927-8 — every production path uses the same routing seam', () => {
  it('wires interactive, daemon, grouped, prelude, judgment, attribution, and recovery paths through provider execution', async () => {
    const callSites = [
      '../../src/index.ts',
      '../../src/daemon-cli.ts',
      '../../src/engine/step-runners.ts',
      '../../src/engine/project-prelude.ts',
      '../../src/engine/group-core.ts',
      '../../src/engine/attribution-lane.ts',
      '../../src/engine/engineer-store.ts',
    ];

    const inspected = await Promise.all(
      callSites.map(async (path) => ({
        path,
        source: await readFile(new URL(path, import.meta.url), 'utf8'),
      })),
    );

    for (const { path, source } of inspected) {
      expect(
        source,
        `${path} must visibly depend on the shared provider-execution seam`,
      ).toMatch(
        /provider-execution|ProviderExecution|providerExecution|beginProviderBranch/,
      );
    }
  });
});
