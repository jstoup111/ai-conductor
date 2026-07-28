import { describe, expect, it, vi } from 'vitest';
import type {
  AuthenticationReadiness,
  AuthenticationSource,
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { StepName } from '../../src/types/index.js';

type ProviderUnavailableClassification = {
  scope: 'run';
  reason: string;
};

type ClassifyProviderAttempt = (
  result: InvokeResult,
) => ProviderUnavailableClassification | undefined;

async function executeCodexCandidate(
  provider: LLMProvider,
  sessions: ProviderSessionScope,
  transitions: Array<Record<string, unknown>> = [],
  selfHost = false,
): Promise<void> {
  const module = await import('../../src/engine/provider-execution.js');
  const execute = (module as unknown as {
    executeProviderCandidates: (input: Record<string, unknown>) => Promise<unknown>;
  }).executeProviderCandidates;
  const runtimes = new ProviderRuntimeSet([{
    key: 'codex',
    provider,
    policy: CODEX_MODEL_POLICY,
    builtIn: true,
    availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
  }]);

  await execute({
    step: 'build' as StepName,
    configuredProviders: ['codex'],
    preferredProvider: 'codex',
    runtimes,
    sessions,
    options: { prompt: 'contract check' },
    warn: (_message: string, transition: Record<string, unknown>) => {
      transitions.push(transition);
    },
    ...(selfHost
      ? {
          prepareCandidateSelfHost: async () => ({
            executable: '/resolved/codex',
            env: { CODEX_HOME: '/tmp/isolated-codex-home' },
            args: [] as readonly string[],
            teardown: async () => {},
          }),
        }
      : {}),
  });
}

describe('InvokeResult provider-unavailable contract', () => {
  it('exposes the #1069 fail-closed Codex session-resume capability seam', () => {
    const provider: LLMProvider = new CodexProvider();
    const buildArgs = (
      provider as unknown as {
        buildArgs(options: InvokeOptions, json: boolean, unattended: boolean): string[];
      }
    ).buildArgs.bind(provider);
    const args = buildArgs({
      prompt: 'contract check',
      sessionId: 'codex-session',
      resume: true,
    }, true, true);

    expect({
      supportsSessionResume: provider.supportsSessionResume,
      command: args.slice(0, 2),
      canResume: args.includes('resume'),
    }).toEqual({
      supportsSessionResume: false,
      command: ['exec', '--config'],
      canResume: false,
    });
  });

  it('never invokes a provider that declares no session-resume support with resume enabled', async () => {
    const calls: InvokeOptions[] = [];
    const provider: LLMProvider = {
      supportsSessionResume: false,
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        calls.push(options);
        return { success: true, output: 'ok', exitCode: 0 };
      }),
      async invokeInteractive(): Promise<void> {},
    };
    const sessions = new ProviderSessionScope(() => 'harness-session');
    await executeCodexCandidate(provider, sessions);
    await executeCodexCandidate(provider, sessions);

    expect(calls.map(({ resume }) => resume)).toEqual([false, false]);
  });

  it('fails closed when a legacy custom provider leaves resume capability undeclared', async () => {
    const calls: InvokeOptions[] = [];
    const provider = {
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        calls.push(options);
        return { success: true, output: 'ok', exitCode: 0 };
      }),
      async invokeInteractive(): Promise<void> {},
    };
    const sessions = new ProviderSessionScope(() => 'legacy-session');

    await executeCodexCandidate(provider, sessions);
    await executeCodexCandidate(provider, sessions);

    expect(calls.map(({ resume }) => resume)).toEqual([false, false]);
  });

  it('keeps both built-in providers fail-closed for session resume', async () => {
    const codex = new CodexProvider(vi.fn(async () => ({ stdout: '{}', exitCode: 0 })) as never);
    const claude = new ClaudeProvider();
    const calls: InvokeOptions[] = [];
    const resumeCapableProvider: LLMProvider = {
      supportsSessionResume: true,
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        calls.push(options);
        return { success: true, output: 'ok', exitCode: 0 };
      }),
      async invokeInteractive(): Promise<void> {},
    };
    const sessions = new ProviderSessionScope(() => 'claude-session');

    await executeCodexCandidate(resumeCapableProvider, sessions);
    await executeCodexCandidate(resumeCapableProvider, sessions);

    expect({
      codex: codex.supportsSessionResume,
      claude: claude.supportsSessionResume,
      resumeFlags: calls.map(({ resume }) => resume),
    }).toEqual({ codex: false, claude: false, resumeFlags: [false, false] });
  });

  it('deduplicates unsupported-resume diagnostics and composes with a forced fresh session', async () => {
    const calls: InvokeOptions[] = [];
    const provider: LLMProvider = {
      supportsSessionResume: false,
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        calls.push(options);
        return { success: true, output: 'ok', exitCode: 0 };
      }),
      async invokeInteractive(): Promise<void> {},
    };
    const transitions: Array<Record<string, unknown>> = [];
    const sessions = {
      prepare: vi.fn(async () => ({ id: 'diagnostic-session', resume: true })),
      markCreated: vi.fn(async () => {}),
    } as unknown as ProviderSessionScope;

    await executeCodexCandidate(provider, sessions, transitions);
    await executeCodexCandidate(provider, sessions, transitions);
    await executeCodexCandidate(provider, sessions, transitions);

    const forceFreshTransitions: Array<Record<string, unknown>> = [];
    const forceFreshSessions = {
      prepare: vi.fn(async () => ({ id: 'self-host-session', resume: true })),
      markCreated: vi.fn(async () => {}),
    } as unknown as ProviderSessionScope;
    await executeCodexCandidate(provider, forceFreshSessions, forceFreshTransitions, true);
    await executeCodexCandidate(provider, forceFreshSessions, forceFreshTransitions, true);

    expect({
      resumeFlags: calls.map(({ resume }) => resume),
      policies: transitions,
      forceFreshPolicies: forceFreshTransitions,
    }).toEqual({
      resumeFlags: [false, false, false, false, false],
      policies: [{
        type: 'session_policy',
        step: 'build',
        provider: 'codex',
        reason: 'Session resume suppressed: provider does not support session resume.',
      }],
      forceFreshPolicies: [],
    });
  });

  it('lets built-in providers expose a sanitized optional authentication readiness verdict', async () => {
    const readiness: AuthenticationReadiness = {
      provider: 'codex',
      source: 'api-key' satisfies AuthenticationSource,
      state: 'unusable',
      remediation: 'Replace the API key, restart the daemon, and requeue the work.',
    };
    const provider: LLMProvider = {
      async invoke(): Promise<InvokeResult> {
        return {
          success: true,
          output: 'ok',
          exitCode: 0,
          authentication: readiness,
        };
      },
      async invokeInteractive(): Promise<void> {},
      async readiness(): Promise<AuthenticationReadiness> {
        return readiness;
      },
    };

    expect({
      readiness: await provider.readiness?.(),
      result: await provider.invoke({ prompt: 'check', sessionId: 'check', resume: false }),
    }).toEqual({
      readiness,
      result: { success: true, output: 'ok', exitCode: 0, authentication: readiness },
    });
  });

  it('keeps void-returning custom interactive providers valid and non-classifying', async () => {
    const legacyProvider: LLMProvider = {
      async invoke(): Promise<InvokeResult> {
        return { success: true, output: 'ok', exitCode: 0 };
      },
      async invokeInteractive(_options: InvokeOptions): Promise<void> {},
    };

    const completion = await legacyProvider.invokeInteractive({
      prompt: 'legacy custom provider',
      sessionId: 'legacy-session',
      resume: false,
    });

    expect(completion).toBeUndefined();
  });

  it('classifies only explicit run-wide provider unavailability and preserves every existing failure class', async () => {
    const module = await import('../../src/engine/provider-execution.js');
    const classify = (
      module as { classifyProviderAttempt?: ClassifyProviderAttempt }
    ).classifyProviderAttempt;
    const cases: Array<{
      name: string;
      result: InvokeResult;
      expected?: ProviderUnavailableClassification;
    }> = [
      {
        name: 'provider unavailable for run',
        result: {
          success: false,
          output: 'codex executable missing',
          exitCode: 127,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: 'codex executable missing',
        },
        expected: {
          scope: 'run',
          reason: 'codex executable missing',
        },
      },
      {
        name: 'unscoped provider flag',
        result: {
          success: false,
          output: 'provider unavailable for one attempt',
          exitCode: 1,
          providerUnavailable: true,
          providerUnavailableReason: 'provider unavailable for one attempt',
        },
      },
      {
        name: 'run-wide provider flag without explicit reason',
        result: {
          success: false,
          output: 'provider process cannot start',
          exitCode: 127,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
        },
        expected: {
          scope: 'run',
          reason: 'provider process cannot start',
        },
      },
      {
        name: 'model unavailable',
        result: {
          success: false,
          output: 'model unavailable',
          exitCode: 1,
          modelUnavailable: true,
        },
      },
      {
        name: 'authentication',
        result: {
          success: false,
          output: 'not logged in',
          exitCode: 1,
          authFailure: true,
        },
      },
      {
        name: 'rate limit',
        result: {
          success: false,
          output: 'rate limited',
          exitCode: 1,
          rateLimited: true,
        },
      },
      {
        name: 'session expiry',
        result: {
          success: false,
          output: 'session expired',
          exitCode: 1,
          sessionExpired: true,
        },
      },
      {
        name: 'ordinary failure',
        result: {
          success: false,
          output: 'command failed',
          exitCode: 1,
        },
      },
      {
        name: 'misleading provider-unavailable prose',
        result: {
          success: false,
          output: 'provider unavailable because command failed',
          exitCode: 1,
        },
      },
      {
        name: 'legacy custom-provider success',
        result: {
          success: true,
          output: 'ok',
          exitCode: 0,
        },
      },
    ];

    expect({
      classifierDefined: classify !== undefined,
      observed: cases.map(({ name, result }) => ({
        name,
        classification: classify?.(result),
      })),
    }).toEqual({
      classifierDefined: true,
      observed: cases.map(({ name, expected }) => ({
        name,
        classification: expected,
      })),
    });
  });
});
