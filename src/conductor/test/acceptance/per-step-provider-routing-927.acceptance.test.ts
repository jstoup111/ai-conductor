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
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  TokenUsage,
} from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName } from '../../src/types/index.js';

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

interface RuntimeFixture {
  provider: LLMProvider;
  policy: ProviderModelPolicy;
}

interface ExecuteInput {
  step: StepName;
  executionId: string;
  attempt?: number;
  configuredProviders: string[];
  preferredProvider?: string;
  runtimes: Record<string, RuntimeFixture>;
  config?: HarnessConfig;
  modelOverride?: string;
  effortOverride?: string;
  sessionStore?: Map<string, string>;
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
  return (loaded as unknown as { executeProviderCandidates: ExecuteProviderCandidates })
    .executeProviderCandidates;
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
): Record<string, RuntimeFixture> {
  return {
    claude: { provider: claude, policy: CLAUDE_MODEL_POLICY },
    codex: { provider: codex, policy: CODEX_MODEL_POLICY },
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

describe('ST-927-2 and ST-927-3 — per-step choice and native settings', () => {
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
    const codex = scriptedProvider((options) =>
      options.model === 'gpt-custom-verbatim'
        ? providerUnavailable('codex executable missing')
        : ok('codex'),
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
    const claude = make('claude', providerUnavailable('claude missing'));
    const codex = make('codex', providerUnavailable('codex missing'));
    const third = make('third', ok('third success'));

    const result = await execute({
      step: 'build_review',
      executionId: 'ordered-fallback',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex', 'third'],
      runtimes: {
        codex: { provider: codex.provider, policy: CODEX_MODEL_POLICY },
        claude: { provider: claude.provider, policy: CLAUDE_MODEL_POLICY },
        third: { provider: third.provider, policy: CLAUDE_MODEL_POLICY },
        unlisted: {
          provider: scriptedProvider(() => ok('must not run')).provider,
          policy: CLAUDE_MODEL_POLICY,
        },
      },
      warn: (message) => warnings.push(message),
    });

    expect(calls).toEqual(['codex', 'claude', 'third']);
    expect(result.actualProvider).toBe('third');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/build_review.*codex.*codex missing.*claude/i);
    expect(warnings[1]).toMatch(/build_review.*claude.*claude missing.*third/i);
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
      CODEX_MODEL_POLICY.modelFallbackLadder,
    );

    await execute({
      step: 'build_review',
      executionId: 'review-reconsider-codex',
      preferredProvider: 'codex',
      configuredProviders: ['claude', 'codex'],
      runtimes: sharedRuntimes,
    });
    expect(codex.calls.length).toBeGreaterThan(
      CODEX_MODEL_POLICY.modelFallbackLadder.length,
    );
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
  it('starts fresh per step/provider, resumes only a same-step/provider retry, and attributes every attempt', async () => {
    const execute = await loadExecuteProviderCandidates();
    const sessionStore = new Map<string, string>();
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
    const sessionStore = new Map<string, string>();
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
      ).toMatch(/provider-execution|ProviderExecution|providerExecution/);
    }
  });
});
