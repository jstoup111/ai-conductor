import { describe, expect, it, vi } from 'vitest';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import {
  ProviderRuntimeSet,
  type ProviderRuntime,
} from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import type { HarnessConfig } from '../../src/types/config.js';

interface PreferredExecutionResult extends InvokeResult {
  preferredProvider: string;
  actualProvider: string;
  resolvedModel: string;
  resolvedEffort: string;
}

interface ProviderTransitionWarning {
  type: 'provider_fallback';
  step: string;
  failedProvider: string;
  reason: string;
  nextProvider: string;
}

type ExecuteProviderCandidates = (input: {
  step: 'build' | 'build_review';
  configuredProviders: readonly string[];
  preferredProvider: string;
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionScope;
  config: HarnessConfig;
  attempt?: number;
  escalate?: boolean;
  modelOverride?: string;
  effortOverride?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  warn?: (
    message: string,
    transition: ProviderTransitionWarning,
  ) => void;
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
}) => Promise<PreferredExecutionResult>;

function runtime(
  key: 'claude' | 'codex',
  provider: LLMProvider,
): ProviderRuntime {
  const policy =
    key === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  return {
    key,
    provider,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

describe('executeProviderCandidates', () => {
  it('executes the explicitly preferred provider with its native settings and scoped session', async () => {
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'wrong provider',
      exitCode: 0,
    }));
    const codexInvoke = vi.fn(
      async (_options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: 'review complete',
        exitCode: 0,
        tokenUsage: { input: 13, output: 8 },
      }),
    );
    const legacyInteractive = vi.fn(async (): Promise<void> => {});
    const claude: LLMProvider = {
      invoke: claudeInvoke,
      invokeInteractive: legacyInteractive,
    };
    const codex: LLMProvider = {
      invoke: codexInvoke,
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    };
    const runtimes = new ProviderRuntimeSet([
      runtime('claude', claude),
      runtime('codex', codex),
    ]);
    const sessions = new ProviderSessionScope(
      vi.fn()
        .mockReturnValueOnce('review-codex-session')
        .mockReturnValueOnce('unexpected-session'),
    );
    const config: HarnessConfig = {
      llm_provider: ['claude', 'codex'],
      defaults: {
        model: 'claude-inherited-default',
        effort: 'low',
      },
      phases: {
        BUILD: {
          model: 'claude-inherited-phase',
          effort: 'medium',
        },
      },
      steps: {
        build_review: {
          llm_provider: 'codex',
          model: 'gpt-step/verbatim',
        },
      },
    };
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;
    const result = await execute?.({
      step: 'build_review',
      configuredProviders: ['claude', 'codex'],
      preferredProvider: 'codex',
      runtimes,
      sessions,
      config,
      options: {
        prompt: 'Judge this implementation.',
        systemPrompt: 'Return a verdict.',
        cwd: '/workspace/feature',
      },
    });

    expect({
      executorDefined: execute !== undefined,
      claudeCalls: claudeInvoke.mock.calls,
      legacyInteractiveCalls: legacyInteractive.mock.calls,
      codexCalls: codexInvoke.mock.calls,
      sessions: {
        claude: sessions.current('claude'),
        codex: sessions.current('codex'),
      },
      result,
    }).toEqual({
      executorDefined: true,
      claudeCalls: [],
      legacyInteractiveCalls: [],
      codexCalls: [
        [
          {
            prompt: 'Judge this implementation.',
            systemPrompt: 'Return a verdict.',
            cwd: '/workspace/feature',
            sessionId: 'review-codex-session',
            resume: false,
            model: 'gpt-step/verbatim',
            effort: 'high',
          },
        ],
      ],
      sessions: {
        claude: undefined,
        codex: { id: 'review-codex-session', created: true },
      },
      result: {
        success: true,
        output: 'review complete',
        exitCode: 0,
        tokenUsage: { input: 13, output: 8 },
        preferredProvider: 'codex',
        actualProvider: 'codex',
        resolvedModel: 'gpt-step/verbatim',
        resolvedEffort: 'high',
      },
    });
  });

  it('falls back in selected-first configured order for live and cached provider unavailability', async () => {
    const missingReason =
      "LLM provider 'codex' not found. Install it or check your PATH.";
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: missingReason,
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: missingReason,
    }));
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'fallback complete',
      exitCode: 0,
    }));
    const thirdInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'unconfigured order leak',
      exitCode: 0,
    }));
    const provider = (invoke: typeof codexInvoke): LLMProvider => ({
      invoke,
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    });
    const runtimes = new ProviderRuntimeSet([
      runtime('claude', provider(claudeInvoke)),
      runtime('codex', provider(codexInvoke)),
      {
        ...runtime('claude', provider(thirdInvoke)),
        key: 'third',
        builtIn: false,
      },
    ]);
    const firstSessions = new ProviderSessionScope(
      vi.fn()
        .mockReturnValueOnce('live-codex-session')
        .mockReturnValueOnce('live-claude-session'),
    );
    const cachedSessions = new ProviderSessionScope(
      vi.fn()
        .mockReturnValueOnce('cached-codex-session')
        .mockReturnValueOnce('cached-claude-session'),
    );
    const noNextSessions = new ProviderSessionScope(
      vi.fn().mockReturnValue('no-next-codex-session'),
    );
    const warnings: Array<{
      message: string;
      transition: ProviderTransitionWarning;
    }> = [];
    const warn = (
      message: string,
      transition: ProviderTransitionWarning,
    ): void => {
      warnings.push({ message, transition });
    };
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;
    const config = {
      llm_provider: ['claude', 'codex', 'third'],
      defaults: { model: 'codex-primary-leak', effort: 'max' },
      steps: {
        build: {
          llm_provider: 'codex',
          model: 'gpt-explicit-primary',
          effort: 'max',
        },
      },
    } as HarnessConfig;
    const common = {
      step: 'build' as const,
      configuredProviders: ['claude', 'codex', 'third'],
      preferredProvider: 'codex',
      runtimes,
      config,
      attempt: 3,
      escalate: true,
      modelOverride: 'gpt-cli-primary',
      effortOverride: 'max',
      warn,
      options: {
        prompt: 'Build the feature.',
        cwd: '/workspace/feature',
      },
    };

    const live = await execute?.({ ...common, sessions: firstSessions });
    const cached = await execute?.({
      ...common,
      sessions: cachedSessions,
    });
    const noNext = await execute?.({
      ...common,
      configuredProviders: ['codex'],
      sessions: noNextSessions,
    });

    expect({
      codexCalls: codexInvoke.mock.calls,
      claudeCalls: claudeInvoke.mock.calls,
      thirdCalls: thirdInvoke.mock.calls,
      firstSessions: {
        codex: firstSessions.current('codex'),
        claude: firstSessions.current('claude'),
        third: firstSessions.current('third'),
      },
      cachedSessions: {
        codexCreated:
          cachedSessions.current('codex')?.created ?? false,
        claude: cachedSessions.current('claude'),
        third: cachedSessions.current('third'),
      },
      noNextCodexCreated:
        noNextSessions.current('codex')?.created ?? false,
      warnings,
      live,
      cached,
      noNext,
    }).toEqual({
      codexCalls: [
        [
          {
            prompt: 'Build the feature.',
            cwd: '/workspace/feature',
            sessionId: 'live-codex-session',
            resume: false,
            model: 'gpt-cli-primary',
            effort: 'max',
          },
        ],
      ],
      claudeCalls: [
        [
          {
            prompt: 'Build the feature.',
            cwd: '/workspace/feature',
            sessionId: 'live-claude-session',
            resume: false,
            model: 'opus',
            effort: 'medium',
          },
        ],
        [
          {
            prompt: 'Build the feature.',
            cwd: '/workspace/feature',
            sessionId: 'cached-claude-session',
            resume: false,
            model: 'opus',
            effort: 'medium',
          },
        ],
      ],
      thirdCalls: [],
      firstSessions: {
        codex: { id: 'live-codex-session', created: true },
        claude: { id: 'live-claude-session', created: true },
        third: undefined,
      },
      cachedSessions: {
        codexCreated: false,
        claude: { id: 'cached-claude-session', created: true },
        third: undefined,
      },
      noNextCodexCreated: false,
      warnings: [
        {
          message:
            "Step build: provider codex unavailable (LLM provider 'codex' not found. Install it or check your PATH.); falling back to claude.",
          transition: {
            type: 'provider_fallback',
            step: 'build',
            failedProvider: 'codex',
            reason: missingReason,
            nextProvider: 'claude',
          },
        },
        {
          message:
            "Step build: provider codex unavailable (LLM provider 'codex' not found. Install it or check your PATH.); falling back to claude.",
          transition: {
            type: 'provider_fallback',
            step: 'build',
            failedProvider: 'codex',
            reason: missingReason,
            nextProvider: 'claude',
          },
        },
      ],
      live: {
        success: true,
        output: 'fallback complete',
        exitCode: 0,
        preferredProvider: 'codex',
        actualProvider: 'claude',
        resolvedModel: 'opus',
        resolvedEffort: 'medium',
      },
      cached: {
        success: true,
        output: 'fallback complete',
        exitCode: 0,
        preferredProvider: 'codex',
        actualProvider: 'claude',
        resolvedModel: 'opus',
        resolvedEffort: 'medium',
      },
      noNext: {
        success: false,
        output: missingReason,
        exitCode: 127,
        providerUnavailable: true,
        providerUnavailableReason: missingReason,
        providerUnavailableScope: 'run',
        providerInvocationSkipped: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
        resolvedModel: 'gpt-cli-primary',
        resolvedEffort: 'max',
      },
    });
  });

  it('advances only after complete native model exhaustion and retries that provider on a later step', async () => {
    const unavailableModel = (model: string): InvokeResult => ({
      success: false,
      output: `model unavailable: ${model}`,
      exitCode: 1,
      modelUnavailable: true,
    });
    const makeProvider = (
      invoke: (options: InvokeOptions, call: number) => InvokeResult,
    ): {
      provider: LLMProvider;
      calls: InvokeOptions[];
    } => {
      const calls: InvokeOptions[] = [];
      return {
        calls,
        provider: {
          invoke: vi.fn(async (options: InvokeOptions) => {
            calls.push(options);
            return invoke(options, calls.length);
          }),
          invokeInteractive: vi.fn(async (): Promise<void> => {}),
        },
      };
    };
    const partialCodex = makeProvider((options, call) =>
      call === 1
        ? unavailableModel(options.model ?? '')
        : {
            success: true,
            output: 'native ladder recovered',
            exitCode: 0,
          },
    );
    const partialClaude = makeProvider(() => ({
      success: true,
      output: 'must not cross providers',
      exitCode: 0,
    }));
    const partialRuntimes = new ProviderRuntimeSet([
      runtime('codex', partialCodex.provider),
      runtime('claude', partialClaude.provider),
    ]);
    const fullCodex = makeProvider((options, call) =>
      call <= CODEX_MODEL_POLICY.modelFallbackLadder.length
        ? unavailableModel(options.model ?? '')
        : {
            success: true,
            output: 'codex eligible on later step',
            exitCode: 0,
          },
    );
    const fullClaude = makeProvider(() => ({
      success: true,
      output: 'cross-provider fallback',
      exitCode: 0,
    }));
    const fullRuntimes = new ProviderRuntimeSet([
      runtime('codex', fullCodex.provider),
      runtime('claude', fullClaude.provider),
    ]);
    const warnings: Array<{
      message: string;
      transition: ProviderTransitionWarning;
    }> = [];
    const warn = (
      message: string,
      transition: ProviderTransitionWarning,
    ): void => {
      warnings.push({ message, transition });
    };
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;
    const config = {
      llm_provider: ['codex', 'claude'],
      steps: {
        build: { llm_provider: 'codex' },
        build_review: { llm_provider: 'codex' },
      },
    } as HarnessConfig;
    const common = {
      step: 'build' as const,
      configuredProviders: ['codex', 'claude'],
      preferredProvider: 'codex',
      config,
      attempt: 2,
      escalate: true,
      modelOverride: CODEX_MODEL_POLICY.modelFallbackLadder[0],
      effortOverride: 'medium' as const,
      warn,
      options: {
        prompt: 'Execute the step.',
        cwd: '/workspace/feature',
      },
    };
    const partial = await execute?.({
      ...common,
      runtimes: partialRuntimes,
      sessions: new ProviderSessionScope(
        vi.fn().mockReturnValue('partial-codex-session'),
      ),
    });
    const fullSessions = new ProviderSessionScope(
      vi.fn()
        .mockReturnValueOnce('full-codex-session')
        .mockReturnValueOnce('full-claude-session'),
    );
    const full = await execute?.({
      ...common,
      runtimes: fullRuntimes,
      sessions: fullSessions,
    });
    const later = await execute?.({
      ...common,
      step: 'build_review',
      effortOverride: undefined,
      runtimes: fullRuntimes,
      sessions: new ProviderSessionScope(
        vi.fn().mockReturnValue('later-codex-session'),
      ),
    });

    expect({
      partial: {
        codexModels: partialCodex.calls.map(({ model }) => model),
        claudeCalls: partialClaude.calls,
        result: partial,
      },
      exhausted: {
        codexModels: fullCodex.calls
          .slice(0, CODEX_MODEL_POLICY.modelFallbackLadder.length)
          .map(({ model }) => model),
        claudeCalls: fullClaude.calls,
        sessions: {
          codex: fullSessions.current('codex'),
          claude: fullSessions.current('claude'),
        },
        result: full,
      },
      later: {
        codexCall: fullCodex.calls.at(-1),
        result: later,
      },
      availability: {
        codexRunWide: fullRuntimes.get('codex').runWideUnavailable,
        codexDead: [
          ...fullRuntimes.get('codex').availability.dead,
        ],
        claudeDead: [
          ...fullRuntimes.get('claude').availability.dead,
        ],
      },
      warnings,
    }).toEqual({
      partial: {
        codexModels: ['gpt-5.6-sol', 'gpt-5.6-terra'],
        claudeCalls: [],
        result: {
          success: true,
          output: 'native ladder recovered',
          exitCode: 0,
          preferredProvider: 'codex',
          actualProvider: 'codex',
          resolvedModel: 'gpt-5.6-sol',
          resolvedEffort: 'medium',
        },
      },
      exhausted: {
        codexModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
        claudeCalls: [
          {
            prompt: 'Execute the step.',
            cwd: '/workspace/feature',
            sessionId: 'full-claude-session',
            resume: false,
            model: 'sonnet',
            effort: 'medium',
          },
        ],
        sessions: {
          codex: { id: 'full-codex-session', created: true },
          claude: { id: 'full-claude-session', created: true },
        },
        result: {
          success: true,
          output: 'cross-provider fallback',
          exitCode: 0,
          preferredProvider: 'codex',
          actualProvider: 'claude',
          resolvedModel: 'sonnet',
          resolvedEffort: 'medium',
        },
      },
      later: {
        codexCall: {
          prompt: 'Execute the step.',
          cwd: '/workspace/feature',
          sessionId: 'later-codex-session',
          resume: false,
          model: 'gpt-5.6-sol',
          effort: 'high',
        },
        result: {
          success: true,
          output: 'codex eligible on later step',
          exitCode: 0,
          preferredProvider: 'codex',
          actualProvider: 'codex',
          resolvedModel: 'gpt-5.6-sol',
          resolvedEffort: 'high',
        },
      },
      availability: {
        codexRunWide: undefined,
        codexDead: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
        claudeDead: [],
      },
      warnings: [
        {
          message:
            'Step build: provider codex unavailable (model unavailable: gpt-5.6-luna); falling back to claude.',
          transition: {
            type: 'provider_fallback',
            step: 'build',
            failedProvider: 'codex',
            reason: 'model unavailable: gpt-5.6-luna',
            nextProvider: 'claude',
          },
        },
      ],
    });
  });

  it('returns recovery and ordinary failures unchanged without provider advancement or cache mutation', async () => {
    const conflictingAvailability = {
      providerUnavailable: true,
      providerUnavailableScope: 'run' as const,
      providerUnavailableReason: 'conflicting unavailable signal',
    };
    const cases: Array<{ name: string; failure: InvokeResult }> = [
      {
        name: 'authentication precedence',
        failure: {
          success: false,
          output: 'not logged in',
          exitCode: 1,
          authFailure: true,
          modelUnavailable: true,
          ...conflictingAvailability,
        },
      },
      {
        name: 'rate-limit precedence',
        failure: {
          success: false,
          output: '429 retry later',
          exitCode: 1,
          rateLimited: true,
          waitSeconds: 45,
          modelUnavailable: true,
          ...conflictingAvailability,
        },
      },
      {
        name: 'session-expiry precedence',
        failure: {
          success: false,
          output: 'session expired',
          exitCode: 1,
          sessionExpired: true,
          modelUnavailable: true,
          ...conflictingAvailability,
        },
      },
      {
        name: 'timeout',
        failure: {
          success: false,
          output: 'provider request timed out',
          exitCode: 1,
        },
      },
      {
        name: 'rejection',
        failure: {
          success: false,
          output: 'provider request rejected',
          exitCode: 1,
        },
      },
      {
        name: 'ordinary exit',
        failure: {
          success: false,
          output: 'command exited for an ordinary reason',
          exitCode: 1,
        },
      },
      {
        name: 'ambiguous prose',
        failure: {
          success: false,
          output:
            'documentation mentions provider unavailable and model unavailable',
          exitCode: 1,
        },
      },
    ];
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;
    const observed = [];

    for (const fixture of cases) {
      const preferredInvoke = vi.fn(
        async (): Promise<InvokeResult> => fixture.failure,
      );
      const nextInvoke = vi.fn(async (): Promise<InvokeResult> => ({
        success: true,
        output: 'must not run',
        exitCode: 0,
      }));
      const provider = (invoke: typeof preferredInvoke): LLMProvider => ({
        invoke,
        invokeInteractive: vi.fn(async (): Promise<void> => {}),
      });
      const runtimes = new ProviderRuntimeSet([
        runtime('codex', provider(preferredInvoke)),
        runtime('claude', provider(nextInvoke)),
      ]);
      const warnings: ProviderTransitionWarning[] = [];
      const result = await execute?.({
        step: 'build',
        configuredProviders: ['codex', 'claude'],
        preferredProvider: 'codex',
        runtimes,
        sessions: new ProviderSessionScope(
          vi.fn().mockReturnValue(`${fixture.name}-session`),
        ),
        config: {
          llm_provider: ['codex', 'claude'],
          steps: { build: { llm_provider: 'codex' } },
        },
        warn: (_message, transition) => warnings.push(transition),
        options: {
          prompt: 'Execute the step.',
          cwd: '/workspace/feature',
        },
      });
      observed.push({
        name: fixture.name,
        preferredCalls: preferredInvoke.mock.calls.length,
        nextCalls: nextInvoke.mock.calls.length,
        warnings,
        runWideUnavailable: runtimes.get('codex').runWideUnavailable,
        preferredDead: [...runtimes.get('codex').availability.dead],
        nextDead: [...runtimes.get('claude').availability.dead],
        result,
      });
    }

    expect(observed).toEqual(
      cases.map(({ name, failure }) => ({
        name,
        preferredCalls: 1,
        nextCalls: 0,
        warnings: [],
        runWideUnavailable: undefined,
        preferredDead: [],
        nextDead: [],
        result: {
          ...failure,
          preferredProvider: 'codex',
          actualProvider: 'codex',
          resolvedModel: 'gpt-5.6-terra',
          resolvedEffort: 'low',
        },
      })),
    );
  });
});
