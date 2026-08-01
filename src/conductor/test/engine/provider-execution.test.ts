import { describe, expect, it, vi } from 'vitest';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
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
import { createProviderLifecycleSupervisor } from '../../src/engine/provider-lifecycle.js';
import type { ProviderLifecycleEpisodeStore } from '../../src/engine/provider-lifecycle-store.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { createCandidateSafetyBoundary, formatProviderCapabilityGapMessages } from '../../src/engine/provider-execution.js';

interface PreferredExecutionResult extends InvokeResult {
  preferredProvider: string;
  actualProvider?: string;
  resolvedModel?: string;
  resolvedEffort?: string;
  attempts?: Array<{
    provider: string;
    model?: string;
    tokenUsage?: {
      input: number;
      output: number;
    };
    observedIntervals?: Array<{
      startedAtMs: number;
      durationMs: number;
    }>;
    outcome?: 'success' | 'failure' | 'unavailable';
    reason?: string;
    fallbackReason?: string;
    invoked: boolean;
  }>;
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
  optionsForCandidate?: (
    candidateKey: ProviderRuntime['key'],
  ) => Omit<
    InvokeOptions,
    'sessionId' | 'resume' | 'model' | 'effort'
  >;
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
  it('keeps native model fallback on the active lifecycle permit without using a replacement', async () => {
    const fallbackPermit = vi.fn(() => ({ permitted: false as const, reason: 'revoked' as const }));
    const consumedPermits: InvokeOptions['spawnPermit'][] = [];
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async (options) => {
        consumedPermits.push(options.spawnPermit);
        if (!options.spawnPermit?.().permitted) {
          return { success: false, output: 'wrong lifecycle permit', exitCode: 1 };
        }
        return consumedPermits.length === 1
          ? { success: false, output: 'primary model unavailable', exitCode: 1, modelUnavailable: true }
          : { success: true, output: 'fallback model completed', exitCode: 0 };
      }),
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    };
    const writeRecovery = vi.fn();
    const episodeStore: ProviderLifecycleEpisodeStore = {
      readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
      writeProviderLifecycleEpisode: writeRecovery,
    };
    const createReplacementAttempt = vi.fn(() => ({ logicalStep: 'build', id: 'replacement' }));
    const supervisor = createProviderLifecycleSupervisor({
      attempt: { logicalStep: 'build', id: 'active' },
      recoveryCount: 0,
      preparationTimeoutMinutes: 5,
      timer: { now: () => 0, schedule: vi.fn(), cancel: vi.fn() },
      recovery: { projectRoot: '/workspace', episodeStore, createReplacementAttempt },
    });
    let activePermit: InvokeOptions['spawnPermit'];
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await supervisor.supervise((lease) => {
      activePermit = lease.spawnPermit;
      return executeProviderCandidates({
        step: 'build',
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([runtime('codex', provider)]),
        sessions: new ProviderSessionScope(vi.fn().mockReturnValue('model-fallback-session')),
        modelOverride: CODEX_MODEL_POLICY.modelFallbackLadder[0],
        options: { prompt: 'Build.', cwd: '/workspace', spawnPermit: lease.spawnPermit },
        optionsForCandidate: () => ({ prompt: 'Codex build.', cwd: '/workspace', spawnPermit: fallbackPermit }),
      });
    });

    expect({
      result,
      consumedPermits,
      activePermit,
      replacements: createReplacementAttempt.mock.calls,
      recoveries: writeRecovery.mock.calls,
    }).toMatchObject({
      result: { success: true, output: 'fallback model completed' },
      consumedPermits: [activePermit, activePermit],
      replacements: [],
      recoveries: [],
    });
  });

  it('keeps cross-provider fallback on the active lifecycle permit without using a replacement', async () => {
    const fallbackPermit = vi.fn(() => ({ permitted: false as const, reason: 'revoked' as const }));
    const consumedPermits: InvokeOptions['spawnPermit'][] = [];
    const provider = (result: InvokeResult): LLMProvider => ({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async (options) => {
        consumedPermits.push(options.spawnPermit);
        return options.spawnPermit?.().permitted
          ? result
          : { success: false, output: 'wrong lifecycle permit', exitCode: 1 };
      }),
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    });
    const writeRecovery = vi.fn();
    const episodeStore: ProviderLifecycleEpisodeStore = {
      readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
      writeProviderLifecycleEpisode: writeRecovery,
    };
    const createReplacementAttempt = vi.fn(() => ({ logicalStep: 'build', id: 'replacement' }));
    const supervisor = createProviderLifecycleSupervisor({
      attempt: { logicalStep: 'build', id: 'active' },
      recoveryCount: 0,
      preparationTimeoutMinutes: 5,
      timer: { now: () => 0, schedule: vi.fn(), cancel: vi.fn() },
      recovery: { projectRoot: '/workspace', episodeStore, createReplacementAttempt },
    });
    let activePermit: InvokeOptions['spawnPermit'];
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await supervisor.supervise((lease) => {
      activePermit = lease.spawnPermit;
      return executeProviderCandidates({
        step: 'build',
        configuredProviders: ['codex', 'claude'],
        runtimes: new ProviderRuntimeSet([
          runtime('codex', provider({ success: false, output: 'Codex unavailable', exitCode: 127, providerUnavailable: true, providerUnavailableScope: 'run' })),
          runtime('claude', provider({ success: true, output: 'Claude fallback completed', exitCode: 0 })),
        ]),
        sessions: new ProviderSessionScope(vi.fn().mockReturnValue('provider-fallback-session')),
        options: { prompt: 'Build.', cwd: '/workspace', spawnPermit: lease.spawnPermit },
        optionsForCandidate: () => ({ prompt: 'Candidate build.', cwd: '/workspace', spawnPermit: fallbackPermit }),
      });
    });

    expect({
      result,
      consumedPermits,
      activePermit,
      replacements: createReplacementAttempt.mock.calls,
      recoveries: writeRecovery.mock.calls,
    }).toMatchObject({
      result: { success: true, output: 'Claude fallback completed', actualProvider: 'claude' },
      consumedPermits: [activePermit, activePermit],
      replacements: [],
      recoveries: [],
    });
  });

  it('carries the active lifecycle permit to a supported candidate after an unsupported candidate', async () => {
    const fallbackPermit = vi.fn(() => ({ permitted: false as const, reason: 'revoked' as const }));
    const supportedInvoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> =>
      options.spawnPermit?.().permitted
        ? { success: true, output: 'supported fallback completed', exitCode: 0 }
        : { success: false, output: 'wrong lifecycle permit', exitCode: 1 },
    );
    const unsupportedInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'must not invoke unsupported provider',
      exitCode: 0,
    }));
    const writeRecovery = vi.fn();
    const episodeStore: ProviderLifecycleEpisodeStore = {
      readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
      writeProviderLifecycleEpisode: writeRecovery,
    };
    const createReplacementAttempt = vi.fn(() => ({ logicalStep: 'build', id: 'replacement' }));
    const supervisor = createProviderLifecycleSupervisor({
      attempt: { logicalStep: 'build', id: 'active' },
      recoveryCount: 0,
      preparationTimeoutMinutes: 5,
      timer: { now: () => 0, schedule: vi.fn(), cancel: vi.fn() },
      recovery: { projectRoot: '/workspace', episodeStore, createReplacementAttempt },
    });
    let activePermit: InvokeOptions['spawnPermit'];
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await supervisor.supervise((lease) => {
      activePermit = lease.spawnPermit;
      return executeProviderCandidates({
        step: 'build',
        configuredProviders: ['custom', 'claude'],
        preferredProvider: 'custom',
        runtimes: new ProviderRuntimeSet([
          { ...runtime('claude', { invoke: unsupportedInvoke, invokeInteractive: vi.fn(async (): Promise<void> => {}) }), key: 'custom', builtIn: false },
          runtime('claude', {
            lifecycleCapability: { synchronousSpawnPermit: true },
            invoke: supportedInvoke,
            invokeInteractive: vi.fn(async (): Promise<void> => {}),
          }),
        ]),
        sessions: new ProviderSessionScope(vi.fn().mockReturnValue('unsupported-fallback-session')),
        options: { prompt: 'Build.', cwd: '/workspace', spawnPermit: lease.spawnPermit },
        optionsForCandidate: () => ({ prompt: 'Candidate build.', cwd: '/workspace', spawnPermit: fallbackPermit }),
      });
    });

    expect({
      result,
      unsupportedCalls: unsupportedInvoke.mock.calls,
      supportedPermit: supportedInvoke.mock.calls[0]?.[0].spawnPermit,
      activePermit,
      replacements: createReplacementAttempt.mock.calls,
      recoveries: writeRecovery.mock.calls,
    }).toMatchObject({
      result: { success: true, output: 'supported fallback completed', actualProvider: 'claude' },
      unsupportedCalls: [],
      supportedPermit: activePermit,
      replacements: [],
      recoveries: [],
    });
  });

  it('rejects an unfenced custom provider before daemon lifecycle invocation', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'custom provider should not run',
      exitCode: 0,
    }));
    const custom = {
      invoke,
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    };
    const runtimes = new ProviderRuntimeSet([
      { ...runtime('claude', custom), key: 'custom', builtIn: false },
    ]);
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['custom'],
      preferredProvider: 'custom',
      runtimes,
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('custom-session')),
      options: {
        prompt: 'Build with lifecycle supervision.',
        cwd: '/workspace/feature',
        spawnPermit: () => ({ permitted: true }),
      },
    });

    expect({
      calls: invoke.mock.calls,
      success: result.success,
      output: result.output,
      attempt: result.attempts[0],
    }).toMatchObject({
      calls: [],
      success: false,
      output: expect.stringMatching(
        /Provider custom.*synchronous spawn-permit capability.*Recovery action/i,
      ),
      attempt: {
        provider: 'custom',
        invoked: false,
        reason: expect.stringMatching(
          /synchronous spawn-permit capability.*Recovery action/i,
        ),
      },
    });
  });

  it('invokes a custom provider that synchronously consumes its declared lifecycle spawn permit', async () => {
    const spawnPermit = vi.fn(() => ({ permitted: true as const }));
    const invoke = vi.fn((options: InvokeOptions): Promise<InvokeResult> => {
      const permit = options.spawnPermit?.();
      return Promise.resolve(
        permit?.permitted
          ? {
              success: true,
              output: 'custom provider completed',
              exitCode: 0,
            }
          : {
              success: false,
              output: 'custom provider denied before spawn',
              exitCode: 1,
            },
      );
    });
    const custom = {
      lifecycleCapability: { synchronousSpawnPermit: true as const },
      invoke,
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    };
    const runtimes = new ProviderRuntimeSet([
      { ...runtime('claude', custom), key: 'custom', builtIn: false },
    ]);
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['custom'],
      preferredProvider: 'custom',
      runtimes,
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('custom-session')),
      options: {
        prompt: 'Build with lifecycle supervision.',
        cwd: '/workspace/feature',
        spawnPermit,
      },
    });

    expect({
      calls: invoke.mock.calls,
      result: {
        success: result.success,
        output: result.output,
        actualProvider: result.actualProvider,
        attempt: result.attempts[0],
      },
    }).toMatchObject({
      calls: [[expect.objectContaining({ spawnPermit })]],
      result: {
        success: true,
        output: 'custom provider completed',
        actualProvider: 'custom',
        attempt: { provider: 'custom', invoked: true },
      },
    });
    expect(spawnPermit).toHaveBeenCalledOnce();
  });

  it('applies and tears down an isolated self-host context only for the resolved Codex candidate', async () => {
    const codex = {
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: options.selfHost?.env.CODEX_HOME ?? 'missing-home',
        exitCode: 0,
      })),
      invokeInteractive: vi.fn(async () => {}),
    };
    const claude = { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}) };
    const runtimes = new ProviderRuntimeSet([runtime('codex', codex), runtime('claude', claude)]);
    const teardown = vi.fn(async () => {});
    const prepare = vi.fn(async () => ({
      executable: '/resolved/codex', env: { CODEX_HOME: '/tmp/isolated-codex' }, args: [], teardown,
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build', configuredProviders: ['codex', 'claude'], runtimes,
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('session')),
      options: { prompt: 'build', cwd: '/workspace' }, prepareCandidateSelfHost: prepare,
    });

    expect(result.output).toBe('/tmp/isolated-codex');
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'codex' }), expect.anything());
    expect(claude.invoke).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('never resumes into a freshly provisioned self-host home, even after the session was created earlier in the step', async () => {
    // Each self-host dispatch provisions its own throwaway provider home and
    // tears it down afterwards, so no rollout/session state survives into the
    // next one. Resuming there fails with Codex's `no rollout found for thread
    // id <id>`, which previously burned every build retry.
    const seen: Array<{ home?: string; resume?: boolean }> = [];
    const codex = {
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        seen.push({ home: options.selfHost?.env.CODEX_HOME, resume: options.resume });
        return { success: true, output: 'ok', exitCode: 0 };
      }),
      invokeInteractive: vi.fn(async () => {}),
    };
    const runtimes = new ProviderRuntimeSet([runtime('codex', codex)]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('harness-minted-uuid'));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    let homes = 0;
    const dispatch = async (): Promise<void> => {
      await executeProviderCandidates({
        step: 'build',
        configuredProviders: ['codex'],
        runtimes,
        sessions,
        options: { prompt: 'build', cwd: '/workspace' },
        prepareCandidateSelfHost: async () => {
          homes += 1;
          return {
            executable: '/resolved/codex',
            env: { CODEX_HOME: `/tmp/self-host-codex-${homes}` },
            args: [],
            teardown: async () => {},
          };
        },
      });
    };

    await dispatch();
    await dispatch();

    // Second dispatch runs against a different, empty home — so it must start a
    // new thread rather than resume the first one.
    expect(seen).toEqual([
      { home: '/tmp/self-host-codex-1', resume: false },
      { home: '/tmp/self-host-codex-2', resume: false },
    ]);
  });

  it('cold-starts a resume-capable provider on every invocation within a step', async () => {
    const seen: boolean[] = [];
    const claude = {
      supportsSessionResume: true,
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        seen.push(options.resume === true);
        return { success: true, output: 'ok', exitCode: 0 };
      }),
      invokeInteractive: vi.fn(async () => {}),
    };
    const runtimes = new ProviderRuntimeSet([runtime('claude', claude)]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('session'));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    for (let i = 0; i < 2; i += 1) {
      await executeProviderCandidates({
        step: 'build',
        configuredProviders: ['claude'],
        runtimes,
        sessions,
        options: { prompt: 'build', cwd: '/workspace' },
      });
    }

    expect(seen).toEqual([false, false]);
  });

  it('does not resume the second Claude attempt', async () => {
    const seen: Array<boolean | undefined> = [];
    const claude = new ClaudeProvider();
    vi.spyOn(claude, 'invoke').mockImplementation(async (options) => {
      seen.push(options.resume);
      return { success: true, output: 'ok', exitCode: 0 };
    });
    const runtimes = new ProviderRuntimeSet([runtime('claude', claude)]);
    const sessions = new ProviderSessionScope(() => 'claude-session');
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await executeProviderCandidates({
        step: 'build',
        configuredProviders: ['claude'],
        runtimes,
        sessions,
        options: { prompt: 'build', cwd: '/workspace' },
      });
    }

    expect(seen).toEqual([false, false]);
  });

  it('tears down a failed candidate home before provisioning its fallback', async () => {
    const events: string[] = [];
    const codex = { invoke: vi.fn(async (): Promise<InvokeResult> => ({ success: false, output: 'missing', exitCode: 127, providerUnavailable: true, providerUnavailableScope: 'run' })), invokeInteractive: vi.fn(async () => {}) };
    const claude = { invoke: vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'ok', exitCode: 0 })), invokeInteractive: vi.fn(async () => {}) };
    const runtimes = new ProviderRuntimeSet([runtime('codex', codex), runtime('claude', claude)]);
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    await executeProviderCandidates({
      step: 'build', configuredProviders: ['codex', 'claude'], runtimes,
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('session')), options: { prompt: 'build', cwd: '/workspace' },
      prepareCandidateSelfHost: async candidate => ({ executable: candidate.providerKey, env: {}, args: [], teardown: async () => { events.push(`cleanup:${candidate.providerKey}`); } }),
    });
    expect(events).toEqual(['cleanup:codex', 'cleanup:claude']);
  });

  it.each(['success', 'failure', 'cancellation', 'timeout', 'interruption', 'retry exhaustion', 'replacement'])('cleans the candidate home on %s terminal result', async (_terminal) => {
    const teardown = vi.fn(async () => {});
    const provider = { invoke: vi.fn(async (): Promise<InvokeResult> => ({ success: false, output: 'terminal', exitCode: 1 })), invokeInteractive: vi.fn(async () => {}) };
    const runtimes = new ProviderRuntimeSet([runtime('codex', provider)]);
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    await executeProviderCandidates({ step: 'build', configuredProviders: ['codex'], runtimes, sessions: new ProviderSessionScope(vi.fn().mockReturnValue('session')), options: { prompt: 'build', cwd: '/workspace' }, prepareCandidateSelfHost: async () => ({ executable: 'codex', env: {}, args: [], teardown }) });
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('redacts a safety canary from attempt metadata, fallback warnings, and the terminal provider error', async () => {
    const canary = 'CANARY_SECRET_907';
    const provider = {
      invoke: vi.fn(async (): Promise<InvokeResult> => ({
        success: false,
        output: `raw body: Authorization: Bearer ${canary}`,
        exitCode: 127,
        providerUnavailable: true,
        providerUnavailableScope: 'run',
      })),
      invokeInteractive: vi.fn(async () => {}),
    };
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', provider),
      runtime('claude', provider),
    ]);
    const metadata: unknown[] = [];
    const warnings: unknown[] = [];
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      runtimes,
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('session')),
      options: { prompt: 'build', cwd: '/workspace' },
      onAttempt: async (_step, attempt) => { metadata.push(attempt); },
      warn: async (message, transition) => { warnings.push(message, transition); },
    });

    expect(JSON.stringify({ result, metadata, warnings })).not.toContain(canary);
  });

  it('keeps declared diagnostic-only provider-gap messages stable across retry and resume', () => {
    const gap = {
      provider: 'codex',
      name: 'native-observability',
      classification: 'diagnostic-only' as const,
      applicability: 'applicable' as const,
      state: 'missing' as const,
    };

    expect([
      formatProviderCapabilityGapMessages('codex', [gap]),
      formatProviderCapabilityGapMessages('codex', [gap]),
    ]).toEqual([
      ['Provider codex: diagnostic-only capability gap native-observability (missing).'],
      ['Provider codex: diagnostic-only capability gap native-observability (missing).'],
    ]);
  });

  it('carries diagnostic-only boundary notices into the result and attempt metadata', async () => {
    const boundary = createCandidateSafetyBoundary({
      protections: () => [{
        name: 'native-observability', criticality: 'diagnostic',
        classification: 'diagnostic-only', applicability: 'applicable', state: 'missing',
      }],
    });
    const result = await boundary(
      { step: 'build', providerKey: 'codex', model: 'gpt-5.6', effort: 'medium' },
      async () => ({ success: true, exitCode: 0, output: 'completed' }),
    );
    const { buildProviderAttemptMetadata } = await import('../../src/engine/provider-execution.js');
    const metadata = buildProviderAttemptMetadata({ providerKey: 'codex', result, resolvedModel: 'gpt-5.6' });
    expect({ output: result.output, safetyDiagnostics: metadata.safetyDiagnostics }).toEqual({
      output: 'Provider codex: diagnostic-only capability gap native-observability (missing).\ncompleted',
      safetyDiagnostics: ['Provider codex: diagnostic-only capability gap native-observability (missing).'],
    });
  });

  it('wraps each resolved candidate through safety before fallback advances', async () => {
    const transcript: string[] = [];
    const unavailable = (): InvokeResult => ({
      success: false,
      output: 'Codex unavailable.',
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
    });
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', {
        invoke: vi.fn(async () => {
          transcript.push('invoke:codex');
          return unavailable();
        }),
        invokeInteractive: vi.fn(async () => {}),
      }),
      runtime('claude', {
        invoke: vi.fn(async () => {
          transcript.push('invoke:claude');
          return { success: true, output: 'done', exitCode: 0 };
        }),
        invokeInteractive: vi.fn(async () => {}),
      }),
    ]);
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    await (executeProviderCandidates as unknown as (input: {
      step: 'build';
      configuredProviders: readonly string[];
      runtimes: ProviderRuntimeSet;
      sessions: ProviderSessionScope;
      options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
      withCandidateSafety: (candidate: { providerKey: string }, invoke: () => Promise<InvokeResult>) => Promise<InvokeResult>;
    }) => Promise<InvokeResult>)({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      runtimes,
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      options: { prompt: 'Build it.', cwd: '/workspace/feature' },
      withCandidateSafety: async (candidate, invoke) => {
        transcript.push(`preflight:${candidate.providerKey}`);
        try {
          return await invoke();
        } finally {
          transcript.push(`verify-and-teardown:${candidate.providerKey}`);
        }
      },
    });

    expect(transcript).toEqual([
      'preflight:codex',
      'invoke:codex',
      'verify-and-teardown:codex',
      'preflight:claude',
      'invoke:claude',
      'verify-and-teardown:claude',
    ]);
  });

  it.each([
    ['codex', 'claude'],
    ['claude', 'codex'],
  ] as const)('prepares, verifies, and tears down every actual fallback candidate (%s -> %s)', async (first, second) => {
    const transcript: string[] = [];
    const unavailable = (provider: string): InvokeResult => ({
      success: false, output: `${provider} unavailable`, exitCode: 127,
      providerUnavailable: true, providerUnavailableScope: 'run',
    });
    const providers = new ProviderRuntimeSet([
      runtime('codex', { invoke: vi.fn(async () => first === 'codex' ? unavailable('codex') : ({ success: true, output: 'ok', exitCode: 0 })), invokeInteractive: vi.fn(async () => {}) }),
      runtime('claude', { invoke: vi.fn(async () => first === 'claude' ? unavailable('claude') : ({ success: true, output: 'ok', exitCode: 0 })), invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    await executeProviderCandidates({
      step: 'build', configuredProviders: [first, second], preferredProvider: first,
      runtimes: providers, sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      config: { llm_provider: [first, second] }, options: { prompt: 'Build it.', cwd: '/workspace/feature' },
      prepareCandidateSelfHost: async (candidate) => {
        transcript.push(`prepare:${candidate.providerKey}`);
        return { executable: candidate.providerKey, env: {}, args: [], teardown: async () => { transcript.push(`verify-and-teardown:${candidate.providerKey}`); } };
      },
    });

    expect(transcript).toEqual([
      `prepare:${first}`, `verify-and-teardown:${first}`,
      `prepare:${second}`, `verify-and-teardown:${second}`,
    ]);
  });

  it.each([
    ['codex', 'claude'],
    ['claude', 'codex'],
  ] as const)('keeps the candidate lifecycle around SHIP fallback (%s -> %s)', async (first, second) => {
    const transcript: string[] = [];
    const unavailable = (provider: string): InvokeResult => ({
      success: false, output: `${provider} unavailable`, exitCode: 127,
      providerUnavailable: true, providerUnavailableScope: 'run',
    });
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke: vi.fn(async () => first === 'codex' ? unavailable('codex') : ({ success: true, output: 'shipped', exitCode: 0 })), invokeInteractive: vi.fn(async () => {}) }),
      runtime('claude', { invoke: vi.fn(async () => first === 'claude' ? unavailable('claude') : ({ success: true, output: 'shipped', exitCode: 0 })), invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    await executeProviderCandidates({
      step: 'finish', configuredProviders: [first, second], preferredProvider: first,
      runtimes, sessions: new ProviderSessionScope(vi.fn().mockReturnValue('ship-session')),
      config: { llm_provider: [first, second] }, options: { prompt: 'Ship it.', cwd: '/workspace/feature' },
      prepareCandidateSelfHost: async (candidate) => {
        transcript.push(`prepare:${candidate.providerKey}`);
        return { executable: candidate.providerKey, env: {}, args: [], teardown: async () => { transcript.push(`verify-and-teardown:${candidate.providerKey}`); } };
      },
    });
    expect(transcript).toEqual([
      `prepare:${first}`, `verify-and-teardown:${first}`,
      `prepare:${second}`, `verify-and-teardown:${second}`,
    ]);
  });

  it('carries one validated task id through Codex fallback to Claude', async () => {
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'Codex is unavailable.',
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
    }));
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'Claude completed the task.',
      exitCode: 0,
    }));
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke: codexInvoke, invokeInteractive: vi.fn(async () => {}) }),
      runtime('claude', { invoke: claudeInvoke, invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('provider-session'));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      preferredProvider: 'codex',
      runtimes,
      sessions,
      taskAttribution: {
        taskId: '2',
        seededTaskIds: ['1', '2'],
        expectedTaskId: '2',
      },
      options: { prompt: 'Build it.', cwd: '/workspace/feature' },
    });

    expect(result.attempts.map(({ provider, taskId }) => ({ provider, taskId }))).toEqual([
      { provider: 'codex', taskId: '2' },
      { provider: 'claude', taskId: '2' },
    ]);
  });

  it('discards malformed task attribution without blocking provider invocation', async () => {
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'Codex completed independently of telemetry.',
      exitCode: 0,
    }));
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'Claude must not be invoked.',
      exitCode: 0,
    }));
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke: codexInvoke, invokeInteractive: vi.fn(async () => {}) }),
      runtime('claude', { invoke: claudeInvoke, invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('provider-session'));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      preferredProvider: 'codex',
      runtimes,
      sessions,
      taskAttribution: { taskId: 'not an id', seededTaskIds: ['1', '2'] },
      options: { prompt: 'Build it.', cwd: '/workspace/feature' },
    });

    expect(result).toMatchObject({
      success: true,
      actualProvider: 'codex',
      attempts: [{ provider: 'codex', taskAttributionDiagnostic: 'malformed' }],
    });
    expect(codexInvoke).toHaveBeenCalledOnce();
    expect(claudeInvoke).not.toHaveBeenCalled();
  });

  it('reports a telemetry-write failure without changing the provider completion verdict', async () => {
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'Codex completed the independently adjudicated work.',
      exitCode: 0,
    }));
    const telemetryError = new Error('telemetry storage unavailable');
    const onTelemetryError = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke: codexInvoke, invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('provider-session'));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      preferredProvider: 'codex',
      runtimes,
      sessions,
      onAttempt: async () => { throw telemetryError; },
      onTelemetryError,
      options: { prompt: 'Build it.', cwd: '/workspace/feature' },
    });

    expect({
      result: { success: result.success, actualProvider: result.actualProvider },
      providerCalls: codexInvoke.mock.calls.length,
      telemetryReport: onTelemetryError.mock.calls,
    }).toEqual({
      result: { success: true, actualProvider: 'codex' },
      providerCalls: 1,
      telemetryReport: [[telemetryError, expect.objectContaining({ provider: 'codex', outcome: 'success' })]],
    });
  });

  it.each([
    { label: 'absent', taskAttribution: undefined },
    { label: 'stale', taskAttribution: { taskId: '2', seededTaskIds: ['1'], knownTaskIds: ['1', '2'] } },
    { label: 'mismatched', taskAttribution: { taskId: '2', seededTaskIds: ['1', '2'], expectedTaskId: '1' } },
  ])('keeps $label attribution advisory when a provider must fall back', async ({ taskAttribution }) => {
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'Codex unavailable.',
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
    }));
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'Claude completed the independently adjudicated work.',
      exitCode: 0,
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke: codexInvoke, invokeInteractive: vi.fn(async () => {}) }),
        runtime('claude', { invoke: claudeInvoke, invokeInteractive: vi.fn(async () => {}) }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('provider-session')),
      taskAttribution,
      options: { prompt: 'Build it.', cwd: '/workspace/feature' },
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'claude' });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every(({ taskId }) => taskId === undefined)).toBe(true);
    if (taskAttribution) {
      expect(result.attempts.every(({ taskAttributionDiagnostic }) => taskAttributionDiagnostic)).toBe(true);
    }
    expect(codexInvoke).toHaveBeenCalledOnce();
    expect(claudeInvoke).toHaveBeenCalledOnce();
  });

  it('returns a permission denial from the selected provider without falling back', async () => {
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'Codex permission review denied the required action.',
      exitCode: 1,
      permissionDenied: true,
    }));
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'must not run',
      exitCode: 0,
    }));
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke: codexInvoke, invokeInteractive: vi.fn(async () => {}) }),
      runtime('claude', { invoke: claudeInvoke, invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('provider-session'));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      preferredProvider: 'codex',
      runtimes,
      sessions,
      options: { prompt: 'Build it.', cwd: '/workspace/feature' },
    });

    expect({ result, claudeCalls: claudeInvoke.mock.calls }).toEqual({
      result: expect.objectContaining({
        success: false,
        permissionDenied: true,
        actualProvider: 'codex',
      }),
      claudeCalls: [],
    });
  });

  it('emits only the selected Codex authentication source for successful and failed attempts', async () => {
    const captured: unknown[] = [];
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        success: true, output: 'completed', exitCode: 0,
        authentication: { provider: 'codex', source: 'api-key', state: 'ready', remediation: 'sk-secret' },
      })
      .mockResolvedValueOnce({
        success: false, output: 'authentication rejected', exitCode: 1,
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable', remediation: 'sk-secret' },
      });
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke, invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('codex-session'));
    const module = await import('../../src/engine/provider-execution.js');

    for (const prompt of ['successful', 'failed']) {
      await module.executeProviderCandidates({
        step: 'build', configuredProviders: ['codex'], preferredProvider: 'codex', runtimes, sessions,
        options: { prompt, cwd: '/workspace/feature' },
        onAttempt: (_step, attempt) => { captured.push(attempt); },
      });
    }

    expect(captured.map((attempt) => ({
      source: (attempt as { authenticationSource?: string }).authenticationSource,
      includesCredentialMaterial: JSON.stringify(attempt).includes('sk-secret'),
    }))).toEqual([
      { source: 'api-key', includesCredentialMaterial: false },
      { source: 'cached-login', includesCredentialMaterial: false },
    ]);
  });

  it('exposes bounded helpers for native config, invocation/session handling, and attempt metadata', async () => {
    const module = await import('../../src/engine/provider-execution.js');

    expect({
      resolveNativeConfig: typeof module.resolveProviderCandidateNativeConfig,
      invokeWithSession: typeof module.invokeProviderCandidate,
      buildAttempt: typeof module.buildProviderAttemptMetadata,
    }).toEqual({
      resolveNativeConfig: 'function',
      invokeWithSession: 'function',
      buildAttempt: 'function',
    });
  });

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
        authentication: {
          provider: 'codex',
          source: 'api-key',
          state: 'ready',
        },
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
        codex: { id: 'review-codex-session' },
      },
      result: {
        success: true,
        output: 'review complete',
        exitCode: 0,
        tokenUsage: { input: 13, output: 8 },
        authentication: {
          provider: 'codex',
          source: 'api-key',
          state: 'ready',
        },
        preferredProvider: 'codex',
        actualProvider: 'codex',
        resolvedModel: 'gpt-step/verbatim',
        resolvedEffort: 'high',
        attempts: [
          {
            provider: 'codex',
            authenticationSource: 'api-key',
            model: 'gpt-step/verbatim',
            tokenUsage: { input: 13, output: 8 },
            outcome: 'success',
            invoked: true,
          },
        ],
      },
    });
  });

  it('resolves invocation options for the actual provider candidate', async () => {
    const candidateKeys: Array<ProviderRuntime['key']> = [];
    const codexInvoke = vi.fn(
      async (_options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: 'candidate-local prompt used',
        exitCode: 0,
      }),
    );
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;

    await execute?.({
      step: 'build',
      configuredProviders: ['claude', 'codex'],
      preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([
        runtime('codex', {
          invoke: codexInvoke,
          invokeInteractive: vi.fn(async (): Promise<void> => {}),
        }),
      ]),
      sessions: new ProviderSessionScope(
        vi.fn().mockReturnValue('candidate-local-session'),
      ),
      config: {
        llm_provider: ['claude', 'codex'],
        steps: { build: { llm_provider: 'codex' } },
      },
      options: {
        prompt: 'Static prompt.',
        cwd: '/workspace/feature',
      },
      optionsForCandidate: (candidateKey) => {
        candidateKeys.push(candidateKey);
        return {
          prompt: `Prompt for ${candidateKey}.`,
          cwd: '/workspace/feature',
        };
      },
    });

    expect({
      candidateKeys,
      prompts: codexInvoke.mock.calls.map(([options]) => options.prompt),
    }).toEqual({
      candidateKeys: ['codex'],
      prompts: ['Prompt for codex.'],
    });
  });

  it('resolves candidate-local prompts in callback order across live and cached fallbacks', async () => {
    const cases: Array<{
      name: string;
      candidates: Array<'claude' | 'codex'>;
      cachedFirst: boolean;
    }> = [
      {
        name: 'Codex to Claude fallback',
        candidates: ['codex', 'claude'],
        cachedFirst: false,
      },
      {
        name: 'Claude to Codex fallback',
        candidates: ['claude', 'codex'],
        cachedFirst: false,
      },
      {
        name: 'cached-unavailable Codex to Claude fallback',
        candidates: ['codex', 'claude'],
        cachedFirst: true,
      },
    ];
    const candidatePrompts = {
      claude: 'Exact candidate-local prompt for Claude.',
      codex: 'Exact candidate-local prompt for Codex.',
    } as const;
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;
    const observed = [];

    for (const fixture of cases) {
      const [first, second] = fixture.candidates;
      const callbackOrder: Array<ProviderRuntime['key']> = [];
      const invocations: Array<{ provider: string; prompt: string }> = [];
      const unavailableReason = `${first} unavailable for ${fixture.name}`;
      const provider = (candidate: 'claude' | 'codex'): LLMProvider => ({
        invoke: vi.fn(async (options): Promise<InvokeResult> => {
          invocations.push({
            provider: candidate,
            prompt: options.prompt,
          });
          return candidate === first
            ? {
                success: false,
                output: unavailableReason,
                exitCode: 127,
                providerUnavailable: true,
                providerUnavailableScope: 'run',
                providerUnavailableReason: unavailableReason,
              }
            : {
                success: true,
                output: `${second} completed fallback`,
                exitCode: 0,
              };
        }),
        invokeInteractive: vi.fn(async (): Promise<void> => {}),
      });
      const firstRuntime = runtime(first, provider(first));
      if (fixture.cachedFirst) {
        firstRuntime.runWideUnavailable = { reason: unavailableReason };
      }

      await execute?.({
        step: 'build',
        configuredProviders: fixture.candidates,
        preferredProvider: first,
        runtimes: new ProviderRuntimeSet([
          firstRuntime,
          runtime(second, provider(second)),
        ]),
        sessions: new ProviderSessionScope(
          vi.fn(() => `${fixture.name}-session`),
        ),
        config: {
          llm_provider: fixture.candidates,
          steps: { build: { llm_provider: first } },
        },
        options: {
          prompt: 'STATIC SENTINEL PROMPT MUST NOT BE DELIVERED.',
          cwd: '/workspace/static-sentinel',
        },
        optionsForCandidate: (candidateKey) => {
          callbackOrder.push(candidateKey);
          return {
            prompt:
              candidatePrompts[
                candidateKey as keyof typeof candidatePrompts
              ],
            cwd: '/workspace/candidate-local',
          };
        },
      });

      observed.push({
        name: fixture.name,
        callbackOrder,
        invocations,
      });
    }

    expect(observed).toEqual([
      {
        name: 'Codex to Claude fallback',
        callbackOrder: ['codex', 'claude'],
        invocations: [
          {
            provider: 'codex',
            prompt: 'Exact candidate-local prompt for Codex.',
          },
          {
            provider: 'claude',
            prompt: 'Exact candidate-local prompt for Claude.',
          },
        ],
      },
      {
        name: 'Claude to Codex fallback',
        callbackOrder: ['claude', 'codex'],
        invocations: [
          {
            provider: 'claude',
            prompt: 'Exact candidate-local prompt for Claude.',
          },
          {
            provider: 'codex',
            prompt: 'Exact candidate-local prompt for Codex.',
          },
        ],
      },
      {
        name: 'cached-unavailable Codex to Claude fallback',
        callbackOrder: ['codex', 'claude'],
        invocations: [
          {
            provider: 'claude',
            prompt: 'Exact candidate-local prompt for Claude.',
          },
        ],
      },
    ]);
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
      if ((transition as { type: string }).type !== 'session_policy') {
        warnings.push({ message, transition });
      }
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
      effortOverride: 'max' as const,
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
        codex: cachedSessions.current('codex'),
        claude: cachedSessions.current('claude'),
        third: cachedSessions.current('third'),
      },
      noNextCodex: noNextSessions.current('codex'),
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
            effort: 'high',
          },
        ],
        [
          {
            prompt: 'Build the feature.',
            cwd: '/workspace/feature',
            sessionId: 'cached-claude-session',
            resume: false,
            model: 'opus',
            effort: 'high',
          },
        ],
      ],
      thirdCalls: [],
      firstSessions: {
        codex: { id: 'live-codex-session' },
        claude: { id: 'live-claude-session' },
        third: undefined,
      },
      cachedSessions: {
        codex: { id: 'cached-codex-session' },
        claude: { id: 'cached-claude-session' },
        third: undefined,
      },
      noNextCodex: { id: 'no-next-codex-session' },
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
        resolvedEffort: 'high',
        attempts: [
          {
            provider: 'codex',
            model: 'gpt-cli-primary',
            outcome: 'unavailable',
            reason: missingReason,
            fallbackReason: missingReason,
            invoked: true,
          },
          {
            provider: 'claude',
            model: 'opus',
            outcome: 'success',
            invoked: true,
          },
        ],
      },
      cached: {
        success: true,
        output: 'fallback complete',
        exitCode: 0,
        preferredProvider: 'codex',
        actualProvider: 'claude',
        resolvedModel: 'opus',
        resolvedEffort: 'high',
        attempts: [
          {
            provider: 'codex',
            outcome: 'unavailable',
            reason: missingReason,
            fallbackReason: missingReason,
            invoked: false,
          },
          {
            provider: 'claude',
            model: 'opus',
            outcome: 'success',
            invoked: true,
          },
        ],
      },
      noNext: {
        success: false,
        output:
          `All configured providers are unavailable for step build: codex (${missingReason}, cached skip).`,
        exitCode: 127,
        preferredProvider: 'codex',
        attempts: [
          {
            provider: 'codex',
            reason: missingReason,
            outcome: 'unavailable',
            invoked: false,
          },
        ],
      },
    });
  });

  it('advances only after complete native model exhaustion and retries that provider on a later step', async () => {
    const unavailableModel = (model: string): InvokeResult => ({
      success: false,
      output: `model unavailable: ${model}`,
      exitCode: 1,
      modelUnavailable: true,
      tokenUsage: {
        input:
          CODEX_MODEL_POLICY.modelFallbackLadder.indexOf(model) + 1,
        output: 0,
      },
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
            tokenUsage: { input: 22, output: 11 },
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
      if ((transition as { type: string }).type !== 'session_policy') {
        warnings.push({ message, transition });
      }
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
        .mockReturnValueOnce('full-codex-sol-session')
        .mockReturnValueOnce('full-codex-terra-session')
        .mockReturnValueOnce('full-codex-luna-session')
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
        codexCalls: fullCodex.calls
          .slice(0, CODEX_MODEL_POLICY.modelFallbackLadder.length)
          .map(({ model, sessionId, resume }) => ({ model, sessionId, resume })),
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
          tokenUsage: { input: 22, output: 11 },
          preferredProvider: 'codex',
          actualProvider: 'codex',
          resolvedModel: 'gpt-5.6-terra',
          resolvedEffort: 'medium',
          attempts: [
            {
              provider: 'codex',
              model: 'gpt-5.6-terra',
              tokenUsage: { input: 22, output: 11 },
              outcome: 'success',
              invoked: true,
            },
          ],
        },
      },
      exhausted: {
        codexCalls: [
          { model: 'gpt-5.6-sol', sessionId: 'full-codex-sol-session', resume: false },
          { model: 'gpt-5.6-terra', sessionId: 'full-codex-terra-session', resume: false },
          { model: 'gpt-5.6-luna', sessionId: 'full-codex-luna-session', resume: false },
        ],
        claudeCalls: [
          {
            prompt: 'Execute the step.',
            cwd: '/workspace/feature',
            sessionId: 'full-claude-session',
            resume: false,
            model: 'sonnet',
            effort: 'high',
          },
        ],
        sessions: {
          codex: { id: 'full-codex-luna-session' },
          claude: { id: 'full-claude-session' },
        },
        result: {
          success: true,
          output: 'cross-provider fallback',
          exitCode: 0,
          preferredProvider: 'codex',
          actualProvider: 'claude',
          resolvedModel: 'sonnet',
          resolvedEffort: 'high',
          attempts: [
            {
              provider: 'codex',
              model: 'gpt-5.6-luna',
              tokenUsage: { input: 3, output: 0 },
              outcome: 'unavailable',
              reason: 'model unavailable: gpt-5.6-luna',
              fallbackReason: 'model unavailable: gpt-5.6-luna',
              invoked: true,
            },
            {
              provider: 'claude',
              model: 'sonnet',
              outcome: 'success',
              invoked: true,
            },
          ],
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
          attempts: [
            {
              provider: 'codex',
              model: 'gpt-5.6-sol',
              outcome: 'success',
              invoked: true,
            },
          ],
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
          output: 'not logged in, but 429 retry later',
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
        warn: (_message, transition) => {
          if ((transition as { type: string }).type !== 'session_policy') {
            warnings.push(transition);
          }
        },
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
          resolvedEffort: 'medium',
          attempts: [
            {
              provider: 'codex',
              model: 'gpt-5.6-terra',
              outcome: 'failure',
              reason: failure.output,
              invoked: true,
            },
          ],
        },
      })),
    );
  });

  it('attributes failed preferred-provider and successful fallback usage to their own ordered attempts', async () => {
    const failedInterval = { startedAtMs: 100, durationMs: 10 };
    const fallbackInterval = { startedAtMs: 120, durationMs: 20 };
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'codex executable missing',
      exitCode: 127,
      tokenUsage: { input: 3, output: 1 },
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: 'codex executable missing',
      observedIntervals: [failedInterval],
    }));
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'fallback completed',
      exitCode: 0,
      tokenUsage: { input: 20, output: 8 },
      observedIntervals: [fallbackInterval],
    }));
    const provider = (
      invoke: (options: InvokeOptions) => Promise<InvokeResult>,
    ): LLMProvider => ({
      invoke,
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    });
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;
    const result = await execute?.({
      step: 'build',
      configuredProviders: ['claude', 'codex'],
      preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([
        runtime('claude', provider(claudeInvoke)),
        runtime('codex', provider(codexInvoke)),
      ]),
      sessions: new ProviderSessionScope(
        vi.fn()
          .mockReturnValueOnce('codex-attribution-session')
          .mockReturnValueOnce('claude-attribution-session'),
      ),
      config: {
        llm_provider: ['claude', 'codex'],
        steps: { build: { llm_provider: 'codex' } },
      },
      options: {
        prompt: 'Execute the step.',
        cwd: '/workspace/feature',
      },
    });

    expect(result).toEqual({
      success: true,
      output: 'fallback completed',
      exitCode: 0,
      tokenUsage: { input: 20, output: 8 },
      observedIntervals: [failedInterval, fallbackInterval],
      preferredProvider: 'codex',
      actualProvider: 'claude',
      resolvedModel: 'sonnet',
      resolvedEffort: 'medium',
      attempts: [
        {
          provider: 'codex',
          model: 'gpt-5.6-terra',
          tokenUsage: { input: 3, output: 1 },
          observedIntervals: [failedInterval],
          outcome: 'unavailable',
          reason: 'codex executable missing',
          fallbackReason: 'codex executable missing',
          invoked: true,
        },
        {
          provider: 'claude',
          model: 'sonnet',
          tokenUsage: { input: 20, output: 8 },
          observedIntervals: [fallbackInterval],
          outcome: 'success',
          invoked: true,
        },
      ],
    });
  });

  it('attributes every model-fallback interval to its single provider attempt', async () => {
    const intervals = [
      { startedAtMs: 200, durationMs: 10 },
      { startedAtMs: 220, durationMs: 20 },
    ];
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        output: 'primary model unavailable',
        exitCode: 1,
        modelUnavailable: true,
        observedIntervals: [intervals[0]],
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'fallback model completed',
        exitCode: 0,
        observedIntervals: [intervals[1]],
      });
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke, invokeInteractive: vi.fn(async () => {}) }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('model-fallback-session')),
      options: { prompt: 'Execute the step.', cwd: '/workspace/feature' },
    });

    expect({
      intervals: result.observedIntervals,
      attemptIntervals: result.attempts[0]?.observedIntervals,
    }).toEqual({
      intervals,
      attemptIntervals: intervals,
    });
  });

  it('mints a new cold-start session when Claude falls back from Fable to Opus', async () => {
    const calls: Array<Pick<InvokeOptions, 'model' | 'sessionId' | 'resume'>> = [];
    const claude: LLMProvider = {
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        calls.push({
          model: options.model,
          sessionId: options.sessionId,
          resume: options.resume,
        });
        return options.model === 'fable'
          ? { success: false, output: 'Fable unavailable', exitCode: 1, modelUnavailable: true }
          : { success: true, output: 'Opus completed', exitCode: 0 };
      }),
      invokeInteractive: vi.fn(async () => {}),
    };
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['claude'],
      runtimes: new ProviderRuntimeSet([runtime('claude', claude)]),
      sessions: new ProviderSessionScope(
        vi.fn()
          .mockReturnValueOnce('fable-session-id')
          .mockReturnValueOnce('opus-session-id'),
      ),
      modelOverride: 'fable',
      options: { prompt: 'Execute the step.', cwd: '/workspace/feature' },
    });

    expect(calls).toEqual([
      { model: 'fable', sessionId: 'fable-session-id', resume: false },
      { model: 'opus', sessionId: 'opus-session-id', resume: false },
    ]);
  });

  it('keeps provider intervals scoped to each retry result', async () => {
    const intervals = [
      { startedAtMs: 300, durationMs: 30 },
      { startedAtMs: 350, durationMs: 40 },
    ];
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        output: 'retryable failure',
        exitCode: 1,
        observedIntervals: [intervals[0]],
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'retry completed',
        exitCode: 0,
        observedIntervals: [intervals[1]],
      });
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke, invokeInteractive: vi.fn(async () => {}) }),
    ]);
    const sessions = new ProviderSessionScope(vi.fn().mockReturnValue('retry-session'));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const first = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes,
      sessions,
      options: { prompt: 'First attempt.', cwd: '/workspace/feature' },
    });
    const retry = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes,
      sessions,
      attempt: 2,
      options: { prompt: 'Retry.', cwd: '/workspace/feature' },
    });

    expect([
      first.attempts[0]?.observedIntervals,
      retry.attempts[0]?.observedIntervals,
    ]).toEqual([[intervals[0]], [intervals[1]]]);
  });

  it('fails with one diagnostic entry per configured provider when every candidate is unavailable', async () => {
    const calls: Array<{ provider: string; model: string | undefined }> = [];
    const unavailableProvider = (
      provider: string,
      reason: string,
    ): LLMProvider => ({
      invoke: vi.fn(async (options): Promise<InvokeResult> => {
        calls.push({ provider, model: options.model });
        return {
          success: false,
          output: reason,
          exitCode: 127,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: reason,
        };
      }),
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    });
    const unlistedInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'must not run',
      exitCode: 0,
    }));
    const cachedClaude = runtime(
      'claude',
      unavailableProvider('claude', 'must not invoke cached provider'),
    );
    cachedClaude.runWideUnavailable = { reason: 'claude cached missing' };
    const runtimes = new ProviderRuntimeSet([
      cachedClaude,
      runtime('codex', unavailableProvider('codex', 'codex binary missing')),
      {
        ...runtime(
          'claude',
          unavailableProvider('third', 'third integration missing'),
        ),
        key: 'third',
        builtIn: false,
      },
      {
        ...runtime('claude', {
          invoke: unlistedInvoke,
          invokeInteractive: vi.fn(async (): Promise<void> => {}),
        }),
        key: 'unlisted',
      },
    ]);
    const warnings: Array<{
      message: string;
      transition: ProviderTransitionWarning;
    }> = [];
    const module = await import('../../src/engine/provider-execution.js');
    const execute = (
      module as { executeProviderCandidates?: ExecuteProviderCandidates }
    ).executeProviderCandidates;
    const result = await execute?.({
      step: 'build',
      configuredProviders: ['claude', 'codex', 'third'],
      preferredProvider: 'codex',
      runtimes,
      sessions: new ProviderSessionScope(
        vi.fn()
          .mockReturnValueOnce('codex-exhaustion-session')
          .mockReturnValueOnce('claude-exhaustion-session')
          .mockReturnValueOnce('third-exhaustion-session'),
      ),
      config: {
        llm_provider: ['claude', 'codex', 'third'],
        steps: { build: { llm_provider: 'codex' } },
      },
      warn: (message, transition) => {
        if ((transition as { type: string }).type !== 'session_policy') {
          warnings.push({ message, transition });
        }
      },
      options: {
        prompt: 'Execute the step.',
        cwd: '/workspace/feature',
      },
    });

    expect(result?.attempts?.[1]).not.toHaveProperty('observedIntervals');
    expect({ calls, unlistedCalls: unlistedInvoke.mock.calls, warnings, result })
      .toEqual({
        calls: [
          { provider: 'codex', model: 'gpt-5.6-terra' },
          { provider: 'third', model: 'sonnet' },
        ],
        unlistedCalls: [],
        warnings: [
          {
            message:
              'Step build: provider codex unavailable (codex binary missing); falling back to claude.',
            transition: {
              type: 'provider_fallback',
              step: 'build',
              failedProvider: 'codex',
              reason: 'codex binary missing',
              nextProvider: 'claude',
            },
          },
          {
            message:
              'Step build: provider claude unavailable (claude cached missing); falling back to third.',
            transition: {
              type: 'provider_fallback',
              step: 'build',
              failedProvider: 'claude',
              reason: 'claude cached missing',
              nextProvider: 'third',
            },
          },
        ],
        result: {
          success: false,
          output:
            'All configured providers are unavailable for step build: codex (codex binary missing); claude (claude cached missing, cached skip); third (third integration missing).',
          exitCode: 127,
          preferredProvider: 'codex',
          attempts: [
            {
              provider: 'codex',
              model: 'gpt-5.6-terra',
              outcome: 'unavailable',
              reason: 'codex binary missing',
              fallbackReason: 'codex binary missing',
              invoked: true,
            },
            {
              provider: 'claude',
              outcome: 'unavailable',
              reason: 'claude cached missing',
              fallbackReason: 'claude cached missing',
              invoked: false,
            },
            {
              provider: 'third',
              model: 'sonnet',
              outcome: 'unavailable',
              reason: 'third integration missing',
              invoked: true,
            },
          ],
        },
      });
  });
});
