// Covers: task:2, task:4, task:5, task:14
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { ProviderSessionScope, ProviderSessionStore } from '../../src/engine/provider-session.js';
import { createProviderLifecycleSupervisor } from '../../src/engine/provider-lifecycle.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { ConductState } from '../../src/types/index.js';
import type { ProviderLifecycleEpisodeStore } from '../../src/engine/provider-lifecycle-store.js';
import type { HarnessConfig } from '../../src/types/config.js';
import {
  createCandidateSafetyBoundary,
  executeAuxiliaryProviderCandidates,
  executeProviderCandidates,
  formatProviderCapabilityGapMessages,
  type ProviderAttemptMetadata,
} from '../../src/engine/provider-execution.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Provider session reuse was removed by design: every invocation attempt —
 * across branches, providers, retries, and model-fallback-ladder rungs — must
 * carry a freshly minted, previously-unused session id with resume: false,
 * never a store-derived id. (2026-08-14 incident: store-derived ids resumed a
 * shared ~1.28M-token conversation across all four build_review branches.)
 * The seen-set is module-level so uniqueness holds across every test in this
 * file, not merely within one invocation list.
 */
const seenSessionIds = new Set<string>();
function expectFreshSessions(
  invocations: ReadonlyArray<Pick<InvokeOptions, 'sessionId' | 'resume'>>,
): void {
  expect(invocations.length).toBeGreaterThan(0);
  for (const { sessionId, resume } of invocations) {
    expect(sessionId).toMatch(UUID_RE);
    expect(seenSessionIds.has(sessionId)).toBe(false);
    seenSessionIds.add(sessionId);
    expect(resume).toBe(false);
  }
}

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
  it.each(['hit', 'rung-hit', 'cancel', 'timeout'] as const)('keeps a prepared %s distinct from cached setup failure without allocating schema scratch', async (outcome) => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'prepared-result-'));
    const controller = new AbortController();
    const invoke = vi.fn();
    const candidate = runtime('codex', { nativeSchemaCapability: { nativeOutputSchema: true }, invoke });
    candidate.runWideUnavailable = { reason: 'previous provider failure' };
    const prepare = vi.fn(async () => undefined);
    const isHit = outcome === 'hit' || outcome === 'rung-hit';
    const operation = vi.fn(async (context: import('../../src/engine/provider-execution.js').PreparedCandidateOperationContext) => {
      await expect(access(join(worktreeRoot, '.daemon', 'scratch'))).rejects.toMatchObject({ code: 'ENOENT' });
      const hit = { success: true, output: 'cached judgment', exitCode: 0, providerInvocationSkipped: true };
      if (outcome === 'rung-hit') {
        const result = await context.invoke(undefined, async () => {
          await expect(access(join(worktreeRoot, '.daemon', 'scratch'))).rejects.toMatchObject({ code: 'ENOENT' });
          return hit;
        });
        return { kind: 'hit' as const, result };
      }
      return { kind: 'hit' as const, result: hit };
    });
    if (outcome === 'cancel') controller.abort();
    try {
      const result = await executeAuxiliaryProviderCandidates({
        step: 'build_review', memberId: 'scope',
        policy: { enabled: true, max_projection_bytes: 1_048_576, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'high', model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 3, escalate: false, min_confidence: 0 },
        runtimes: new ProviderRuntimeSet([candidate]), sessions: new ProviderSessionScope(vi.fn()),
        options: { prompt: 'review', cwd: worktreeRoot, nativeSchema: { type: 'object' } },
        nativeSchemaScratch: { worktreeRoot, repository: 'acme/repo', featureSlug: 'feature' },
        abortSignal: controller.signal, deadlineAt: outcome === 'timeout' ? 0 : undefined,
        prepareCandidateSelfHost: prepare, preparedCandidateOperation: operation,
      });
      expect(result.success).toBe(isHit);
      expect(result.providerSetupExhaustion).toBeUndefined();
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]).toMatchObject({ invoked: false, outcome: isHit ? 'success' : 'failure' });
      expect(result.attempts[0].skipReason).toBeUndefined();
      expect(result.attempts[0].setupCapability).toBeUndefined();
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(operation).toHaveBeenCalledTimes(isHit ? 1 : 0);
      expect(invoke).not.toHaveBeenCalled();
      await expect(access(join(worktreeRoot, '.daemon', 'scratch'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('skips a typed setup-unavailable candidate and returns setup-only exhaustion without invocation', async () => {
    const codexInvoke = vi.fn();
    const claudeInvoke = vi.fn();
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    const unavailable = (provider: string) => new ProviderSetupUnavailableError({
      provider,
      reason: `${provider} lacks isolated setup`,
      recoveryAction: `install ${provider}`,
    });

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke: codexInvoke }),
        runtime('claude', { invoke: claudeInvoke }),
      ]),
      sessions: new ProviderSessionScope(vi.fn()),
      prepareCandidateSelfHost: async (candidate) => { throw unavailable(candidate.providerKey); },
      options: { prompt: 'build', cwd: '/workspace' },
    });

    expect(result).toMatchObject({
      success: false,
      providerSetupExhaustion: { candidates: [
        { provider: 'codex', reason: 'codex lacks isolated setup' },
        { provider: 'claude', reason: 'claude lacks isolated setup' },
      ] },
      attempts: [
        { provider: 'codex', invoked: false, skipReason: 'setup-unavailable' },
        { provider: 'claude', invoked: false, skipReason: 'setup-unavailable' },
      ],
    });
    expect(codexInvoke).not.toHaveBeenCalled();
    expect(claudeInvoke).not.toHaveBeenCalled();
  });

  it('falls through a typed setup-unavailable candidate without treating ordinary errors as fallback authority', async () => {
    const codexInvoke = vi.fn();
    const claudeInvoke = vi.fn(async () => ({ success: true, output: 'done', exitCode: 0 }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    const result = await executeProviderCandidates({
      step: 'build', configuredProviders: ['codex', 'claude'],
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke: codexInvoke }), runtime('claude', { invoke: claudeInvoke })]),
      sessions: new ProviderSessionScope(vi.fn()),
      prepareCandidateSelfHost: async (candidate) => {
        if (candidate.providerKey === 'codex') throw new ProviderSetupUnavailableError({ provider: 'codex', reason: 'missing setup', recoveryAction: 'install' });
        return undefined;
      },
      options: { prompt: 'build', cwd: '/workspace' },
    });
    expect(result).toMatchObject({ success: true, actualProvider: 'claude' });
    expect(codexInvoke).not.toHaveBeenCalled();
    expect(claudeInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not advance after cleanup or safety failure, but does preserve typed setup exhaustion for auxiliary callers', async () => {
    const codexInvoke = vi.fn();
    const claudeInvoke = vi.fn(async () => ({ success: true, output: 'must not run', exitCode: 0 }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    await expect(executeProviderCandidates({
      step: 'build', configuredProviders: ['codex', 'claude'],
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke: codexInvoke }), runtime('claude', { invoke: claudeInvoke })]),
      sessions: new ProviderSessionScope(vi.fn()),
      prepareCandidateSelfHost: async () => ({ executable: 'fake', env: {}, args: [], teardown: async () => { throw new Error('cleanup failed'); } }),
      options: { prompt: 'build', cwd: '/workspace' },
    })).rejects.toThrow('cleanup failed');
    expect(claudeInvoke).not.toHaveBeenCalled();

    const skipped = vi.fn();
    const exhausted = await executeAuxiliaryProviderCandidates({
      step: 'build_review', memberId: 'scope',
      policy: { enabled: true, max_projection_bytes: 1_048_576, llm_provider: ['codex', 'claude'], model: 'gpt-5.6-sol', effort: 'high', model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 3, escalate: false, min_confidence: 0 },
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke: skipped }), runtime('claude', { invoke: skipped })]),
      sessions: new ProviderSessionScope(vi.fn()),
      prepareCandidateSelfHost: async (candidate) => { throw new ProviderSetupUnavailableError({ provider: candidate.providerKey, capability: 'isolation', reason: 'missing setup', recoveryAction: 'update provider' }); },
      options: { prompt: 'review', cwd: '/workspace' },
    });
    expect(exhausted.providerSetupExhaustion?.candidates).toHaveLength(2);
    expect(skipped).not.toHaveBeenCalled();
  });

  it('attributes a setup skip as not invoked with its actionable capability details', async () => {
    const { buildProviderAttemptMetadata } = await import('../../src/engine/provider-execution.js');
    expect(buildProviderAttemptMetadata({
      providerKey: 'codex',
      result: { success: false, output: 'missing isolation', exitCode: 1, providerInvocationSkipped: true },
      resolvedModel: 'gpt-5.6-sol',
      unavailable: { scope: 'step', reason: 'missing isolation' },
      setupUnavailable: { provider: 'codex', capability: 'isolated-home', reason: 'missing isolation', recoveryAction: 'update Codex' },
    })).toMatchObject({
      provider: 'codex', outcome: 'unavailable', invoked: false,
      skipReason: 'setup-unavailable', setupCapability: 'isolated-home', setupRecoveryAction: 'update Codex',
    });
  });

  it('keeps a cached setup skip distinct from a newly observed capability failure', async () => {
    const { buildProviderAttemptMetadata } = await import('../../src/engine/provider-execution.js');
    expect(buildProviderAttemptMetadata({
      providerKey: 'codex',
      result: { success: false, output: 'cached unavailable', exitCode: 127, providerInvocationSkipped: true },
      resolvedModel: 'gpt-5.6-sol',
      unavailable: { scope: 'step', reason: 'cached unavailable' },
      cachedUnavailable: true,
      setupUnavailable: {
        provider: 'codex',
        capability: 'cached-provider-availability',
        reason: 'cached unavailable',
        recoveryAction: 'restore provider',
      },
    })).toMatchObject({ invoked: false, skipReason: 'cached-unavailable' });
  });

  it('keeps interleaved execution context on unavailable, fallback, and successful candidates', async () => {
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const observed: Array<{
      executionContext?: unknown;
      provider: string;
      outcome: string;
      invoked: boolean;
      fallbackReason?: string;
      model?: string;
      effort?: string;
      tier?: string;
    }> = [];
    const codex = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      if (options.prompt === 'first') {
        markFirstStarted();
        await firstRelease;
        return {
          success: false,
          output: 'codex unavailable',
          exitCode: 127,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: 'codex unavailable',
          providerInvocationSkipped: true,
        };
      }
      return { success: true, output: 'codex settled', exitCode: 0 };
    });
    const claude = vi.fn(async (): Promise<InvokeResult> => (
      { success: true, output: 'claude fallback settled', exitCode: 0 }
    ));
    const firstContext = {
      executionId: 'execution-first',
      subject: { kind: 'configured-member' as const, parentGroup: 'quality', member: 'audit' },
    };
    const secondContext = {
      executionId: 'execution-second',
      subject: { kind: 'configured-member' as const, parentGroup: 'security', member: 'audit' },
    };
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', { invoke: codex }),
      runtime('claude', { invoke: claude }),
    ]);
    const invoke = (prompt: string, executionContext?: typeof firstContext) =>
      executeProviderCandidates({
        step: 'build',
        configuredProviders: ['codex', 'claude'],
        preferredProvider: 'codex',
        runtimes,
        sessions: new ProviderSessionScope(vi.fn().mockReturnValue(`session-${prompt}`)),
        tier: 'M',
        effortOverride: 'high',
        executionContext,
        options: { prompt, cwd: '/workspace' },
        onAttempt: (_step, metadata) => { observed.push(metadata); },
      });

    const first = invoke('first', firstContext);
    await firstStarted;
    const second = await invoke('second', secondContext);
    releaseFirst();
    const firstResult = await first;
    const legacy = await invoke('legacy');

    expect({
      results: [firstResult.actualProvider, second.actualProvider, legacy.actualProvider],
      attempts: observed.map(({ executionContext, provider, outcome, invoked, fallbackReason, model, effort, tier }) => ({
        executionContext, provider, outcome, invoked, fallbackReason, model, effort, tier,
      })),
    }).toEqual({
      results: ['claude', 'codex', 'claude'],
      attempts: [
        {
          executionContext: secondContext,
          provider: 'codex', outcome: 'success', invoked: true,
          fallbackReason: undefined, model: CODEX_MODEL_POLICY.stepModels.build, effort: 'high', tier: 'M',
        },
        {
          executionContext: firstContext,
          provider: 'codex', outcome: 'unavailable', invoked: false,
          fallbackReason: 'codex unavailable', model: undefined, effort: undefined, tier: undefined,
        },
        {
          executionContext: firstContext,
          provider: 'claude', outcome: 'success', invoked: true,
          fallbackReason: undefined, model: CLAUDE_MODEL_POLICY.stepModels.build, effort: 'medium', tier: 'M',
        },
        {
          executionContext: undefined,
          provider: 'codex', outcome: 'unavailable', invoked: false,
          fallbackReason: 'codex unavailable', model: undefined, effort: undefined, tier: undefined,
        },
        {
          executionContext: undefined,
          provider: 'claude', outcome: 'success', invoked: true,
          fallbackReason: undefined, model: CLAUDE_MODEL_POLICY.stepModels.build, effort: 'medium', tier: 'M',
        },
      ],
    });
  });

  it('keeps each runner invocation context beside its verdict run and lifecycle attempt IDs', async () => {
    const events: Array<{
      provider: string;
      executionContext?: unknown;
      lifecycle?: { attemptId: string };
    }> = [];
    const firstContext = {
      executionId: 'execution-first',
      subject: { kind: 'configured-member' as const, parentGroup: 'quality', member: 'audit' },
    };
    const retryContext = {
      executionId: 'execution-retry',
      subject: { kind: 'configured-member' as const, parentGroup: 'quality', member: 'audit' },
    };
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async (): Promise<InvokeResult> => (
        { success: true, output: 'settled', exitCode: 0 }
      )),
    };
    const runner = new DefaultStepRunner(provider, 'runner-session', '/workspace', {
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([runtime('codex', provider)]),
        sessions: new ProviderSessionStore(),
        onAttempt: (_step, attempt) => { events.push(attempt); },
      },
    });
    const state: ConductState = { complexity_tier: 'M' };

    await runner.run('build', state, {
      attempt: 1,
      runId: 'verdict-run-1',
      executionContext: firstContext,
    });
    await runner.run('build', state, {
      attempt: 2,
      runId: 'verdict-run-2',
      executionContext: retryContext,
    });

    expect({
      candidateContexts: events
        .filter(({ provider }) => provider === 'codex')
        .map(({ executionContext }) => executionContext),
      lifecycle: events
        .filter(({ provider }) => provider === 'provider-lifecycle')
        .map(({ executionContext, lifecycle }) => ({ executionContext, attemptId: lifecycle?.attemptId })),
    }).toEqual({
      candidateContexts: [firstContext, retryContext],
      lifecycle: [
        { executionContext: firstContext, attemptId: 'verdict-run-1' },
        { executionContext: firstContext, attemptId: 'verdict-run-1' },
        { executionContext: retryContext, attemptId: 'verdict-run-2' },
        { executionContext: retryContext, attemptId: 'verdict-run-2' },
      ],
    });
  });

  it('emits scalar invocation metadata with its caller-owned execution context', async () => {
    const attempts: ProviderAttemptMetadata[] = [];
    const context = {
      executionId: 'scalar-execution',
      subject: { kind: 'configured-member' as const, parentGroup: 'quality', member: 'audit' },
    };
    const provider: LLMProvider = {
      invoke: vi.fn(async (): Promise<InvokeResult> => (
        { success: true, output: 'scalar settled', exitCode: 0 }
      )),
    };
    const runner = new DefaultStepRunner(provider, 'scalar-session', '/workspace', {
      modelPolicy: CODEX_MODEL_POLICY,
      providerKey: 'codex',
      providerAttempt: (_step, attempt) => { attempts.push(attempt); },
    });

    await runner.run('build', { complexity_tier: 'M' }, { executionContext: context });

    expect(attempts).toEqual([{
      executionContext: context,
      provider: 'codex',
      preferredProvider: 'codex',
      model: CODEX_MODEL_POLICY.stepModels.build,
      effort: CODEX_MODEL_POLICY.stepEfforts.build,
      tier: 'M',
      outcome: 'success',
      invoked: true,
    }]);
  });

  it('runs an auxiliary prepared-candidate cache hit after preparation and before invocation, then tears it down once', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const invoke = vi.fn(async (): Promise<InvokeResult> => {
      events.push('invoke');
      return { success: true, output: 'provider result', exitCode: 0 };
    });
    const preparedCandidateOperation = vi.fn(async (context: {
      candidate: { providerKey: string; model: string; effort: string };
      prepared: { env: NodeJS.ProcessEnv } | undefined;
      abortSignal?: AbortSignal;
      deadlineAt?: number;
      invoke: () => Promise<InvokeResult>;
    }) => {
      events.push('operation');
      expect(context).toMatchObject({
        candidate: { providerKey: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
        prepared: { env: { CODEX_HOME: '/tmp/candidate-home' } },
        abortSignal: controller.signal,
        deadlineAt: 9_999_999_999_999,
      });
      return {
        kind: 'hit' as const,
        result: {
          success: true,
          output: 'warm candidate result',
          exitCode: 0,
          providerInvocationSkipped: true,
        },
      };
    });

    const result = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, max_projection_bytes: 1_048_576, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'high',
        model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
      abortSignal: controller.signal,
      deadlineAt: 9_999_999_999_999,
      preparedCandidateOperation,
      prepareCandidateSelfHost: async () => {
        events.push('prepare');
        return {
          executable: 'codex', env: { CODEX_HOME: '/tmp/candidate-home' }, args: [],
          teardown: async () => { events.push('cleanup'); },
        };
      },
    });

    expect({ output: result.output, invoked: result.attempts[0]?.invoked, events, providerCalls: invoke.mock.calls.length }).toEqual({
      output: 'warm candidate result',
      invoked: false,
      events: ['prepare', 'operation', 'cleanup'],
      providerCalls: 0,
    });
  });

  it('classifies a cancelled prepared candidate without claiming a judgment or cache hit', async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'must not run', exitCode: 0 }));
    const operation = vi.fn();
    const teardown = vi.fn(async () => {});

    const result = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, max_projection_bytes: 1_048_576, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'high',
        model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
      abortSignal: controller.signal,
      preparedCandidateOperation: operation,
      prepareCandidateSelfHost: async () => ({ executable: 'codex', env: {}, args: [], teardown }),
    });

    expect({ success: result.success, invoked: result.attempts[0]?.invoked, operationCalls: operation.mock.calls.length, providerCalls: invoke.mock.calls.length, teardownCalls: teardown.mock.calls.length }).toEqual({
      success: false,
      invoked: false,
      operationCalls: 0,
      providerCalls: 0,
      teardownCalls: 1,
    });
  });

  it('refuses a cache hit if cancellation arrives while the prepared operation is running', async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      controller.abort();
      return {
        kind: 'hit' as const,
        result: { success: true, output: 'stale cache hit', exitCode: 0 },
      };
    });
    const teardown = vi.fn(async () => {});

    const result = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, max_projection_bytes: 1_048_576, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'high',
        model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke: vi.fn() })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
      abortSignal: controller.signal,
      preparedCandidateOperation: operation,
      prepareCandidateSelfHost: async () => ({ executable: 'codex', env: {}, args: [], teardown }),
    });

    expect({ success: result.success, output: result.output, invoked: result.attempts[0]?.invoked, operationCalls: operation.mock.calls.length, teardownCalls: teardown.mock.calls.length }).toEqual({
      success: false,
      output: 'Prepared candidate operation cancelled before judgment.',
      invoked: false,
      operationCalls: 1,
      teardownCalls: 1,
    });
  });

  it.each([
    ['a judged invocation', { success: true, output: 'judged', exitCode: 0 }],
    ['an authentication failure', { success: false, output: 'authentication failed', exitCode: 1, authFailure: true }],
    ['a malformed provider result', { success: false, output: 'malformed result', exitCode: 1 }],
  ] as const)('keeps one prepared candidate cleanup around %s', async (_label, providerResult) => {
    const events: string[] = [];
    const invoke = vi.fn(async (): Promise<InvokeResult> => {
      events.push('invoke');
      return providerResult;
    });
    const operation = vi.fn(async (context: { invoke: () => Promise<InvokeResult> }) => {
      events.push('operation');
      return { kind: 'judged' as const, result: await context.invoke() };
    });

    const result = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, max_projection_bytes: 1_048_576, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'high',
        model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
      preparedCandidateOperation: operation,
      prepareCandidateSelfHost: async () => ({
        executable: 'codex', env: {}, args: [], teardown: async () => { events.push('cleanup'); },
      }),
    });

    expect({ result: result.output, events, operationCalls: operation.mock.calls.length, providerCalls: invoke.mock.calls.length }).toEqual({
      result: providerResult.output,
      events: ['operation', 'invoke', 'cleanup'],
      operationCalls: 1,
      providerCalls: 1,
    });
  });

  it('classifies a timed-out prepared candidate without invoking its operation', async () => {
    const operation = vi.fn();
    const invoke = vi.fn();
    const teardown = vi.fn(async () => {});

    const result = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, max_projection_bytes: 1_048_576, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'high',
        model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
      deadlineAt: 0,
      preparedCandidateOperation: operation,
      prepareCandidateSelfHost: async () => ({ executable: 'codex', env: {}, args: [], teardown }),
    });

    expect({ success: result.success, invoked: result.attempts[0]?.invoked, operationCalls: operation.mock.calls.length, providerCalls: invoke.mock.calls.length, teardownCalls: teardown.mock.calls.length }).toEqual({
      success: false,
      invoked: false,
      operationCalls: 0,
      providerCalls: 0,
      teardownCalls: 1,
    });
  });

  it('executes an auxiliary rubric through its own provider, fallback ladder, retries, and attribution label', async () => {
    const codexInvoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> =>
      options.model === 'gpt-5.6-sol'
        ? { success: false, output: 'sol unavailable', exitCode: 1, modelUnavailable: true }
        : { success: true, output: 'terra settled', exitCode: 0 },
    );
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'must not run', exitCode: 0 }));
    const attempts = vi.fn();
    const result = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh',
        model_fallback_ladder: ['gpt-5.6-sol', 'gpt-5.6-terra'], max_projection_bytes: 1_048_576, max_retries: 2, escalate: true, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: codexInvoke, }),
        runtime('claude', { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: claudeInvoke, }),
      ]),
      sessions: new ProviderSessionScope((() => { let id = 0; return () => `scope-${++id}`; })()),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
      onAttempt: attempts,
    });

    expect({
      result: { success: result.success, actualProvider: result.actualProvider, model: result.resolvedModel },
      models: codexInvoke.mock.calls.map(([options]) => options.model),
      claudeCalls: claudeInvoke.mock.calls.length,
      attribution: attempts.mock.calls.map(([, metadata]) => metadata.auxiliaryMember),
    }).toEqual({
      result: { success: true, actualProvider: 'codex', model: 'gpt-5.6-terra' },
      models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
      claudeCalls: 0,
      attribution: ['scope'],
    });
    // Fresh session per ladder attempt, never the injected store's ids.
    expectFreshSessions(codexInvoke.mock.calls.map(([options]) => options));
  });

  it('stops auxiliary retries and provider walking for an unresolved command while retaining ordinary retries', async () => {
    const unresolvedInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'unknown skill command',
      exitCode: 1,
      commandUnresolved: true,
      commandUnresolvedName: '$build-review-scope',
    }));
    const secondCandidateInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'must not run',
      exitCode: 0,
    }));
    const unresolvedResult = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, llm_provider: ['codex', 'claude'], model: 'gpt-5.6-sol', effort: 'high',
        model_fallback_ladder: ['gpt-5.6-sol'], max_projection_bytes: 1_048_576, max_retries: 3, escalate: false, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke: unresolvedInvoke }),
        runtime('claude', { invoke: secondCandidateInvoke }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('unresolved-session')),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
    });

    const ordinaryInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'ordinary failure',
      exitCode: 1,
    }));
    const ordinaryResult = await executeAuxiliaryProviderCandidates({
      step: 'build_review',
      memberId: 'scope',
      policy: {
        enabled: true, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'high',
        model_fallback_ladder: ['gpt-5.6-sol'], max_projection_bytes: 1_048_576, max_retries: 3, escalate: false, min_confidence: 0,
      },
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke: ordinaryInvoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('ordinary-session')),
      options: { prompt: '$build-review-scope', cwd: '/workspace' },
    });

    expect({
      unresolvedCalls: unresolvedInvoke.mock.calls.length,
      secondCandidateCalls: secondCandidateInvoke.mock.calls.length,
      unresolvedResult: {
        success: unresolvedResult.success,
        commandUnresolved: unresolvedResult.commandUnresolved,
        commandUnresolvedName: unresolvedResult.commandUnresolvedName,
      },
      ordinaryCalls: ordinaryInvoke.mock.calls.length,
      ordinaryResult: {
        success: ordinaryResult.success,
        commandUnresolved: ordinaryResult.commandUnresolved,
        commandUnresolvedName: ordinaryResult.commandUnresolvedName,
      },
    }).toEqual({
      unresolvedCalls: 1,
      secondCandidateCalls: 0,
      unresolvedResult: {
        success: false,
        commandUnresolved: true,
        commandUnresolvedName: '$build-review-scope',
      },
      ordinaryCalls: 3,
      ordinaryResult: {
        success: false,
        commandUnresolved: undefined,
        commandUnresolvedName: undefined,
      },
    });
  });

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
          { ...runtime('claude', { invoke: unsupportedInvoke, }), key: 'custom', builtIn: false },
          runtime('claude', {
            lifecycleCapability: { synchronousSpawnPermit: true },
            invoke: supportedInvoke,
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

    expect(result).toMatchObject({
      success: false,
      executionDisposition: 'not-started',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('marks cached provider unavailability as not started without invoking the provider', async () => {
    const cachedInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'cached provider must not invoke',
      exitCode: 0,
    }));
    const cachedRuntime = runtime('codex', { invoke: cachedInvoke });
    cachedRuntime.runWideUnavailable = { reason: 'Codex is unavailable from an earlier attempt.' };
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([cachedRuntime]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('cached-session')),
      options: { prompt: 'Build.', cwd: '/workspace/feature' },
    });

    expect(result).toMatchObject({
      success: false,
      executionDisposition: 'not-started',
    });
    expect(cachedInvoke).not.toHaveBeenCalled();
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
    expect(result).not.toHaveProperty('executionDisposition');
  });

  it('marks required safety-boundary refusal as not started before invoking the candidate', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'provider must not run after safety refusal',
      exitCode: 0,
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('safety-refusal-session')),
      options: { prompt: 'Build safely.', cwd: '/workspace/feature' },
      withCandidateSafety: createCandidateSafetyBoundary({
        protections: () => [{
          name: 'workspace-isolation',
          criticality: 'required',
          classification: 'required',
          applicability: 'applicable',
          state: 'missing',
        }],
      }),
    });

    expect({ calls: invoke.mock.calls, result }).toMatchObject({
      calls: [],
      result: {
        success: false,
        permissionDenied: true,
        executionDisposition: 'not-started',
      },
    });
  });

  it('applies and tears down an isolated self-host context only for the resolved Codex candidate', async () => {
    const codex = {
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: options.selfHost?.env.CODEX_HOME ?? 'missing-home',
        exitCode: 0,
      })),
    };
    const claude = { invoke: vi.fn(), };
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
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ providerKey: 'codex' }),
      expect.anything(),
      expect.objectContaining({ attempt: 0 }),
    );
    expect(claude.invoke).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('closes a candidate stream observer when self-host preparation rejects', async () => {
    const close = vi.fn();
    const provider = {
      invoke: vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'must not run', exitCode: 0 })),
    };
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    await expect(executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([runtime('codex', provider)]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('session')),
      options: {
        prompt: 'build',
        cwd: '/workspace',
        providerStreamObserverForCandidate: () => ({ onProviderStream: vi.fn(), close }),
      },
      prepareCandidateSelfHost: async () => { throw new Error('self-host preparation failed'); },
    })).rejects.toThrow('self-host preparation failed');

    expect({ close: close.mock.calls.length, providerCalls: provider.invoke.mock.calls.length }).toEqual({
      close: 1,
      providerCalls: 0,
    });
  });

  it('keeps an ambiguous self-host preparation outcome conservative', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'provider ran after ambiguous preparation',
      exitCode: 0,
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('ambiguous-preparation-session')),
      options: { prompt: 'build', cwd: '/workspace' },
      prepareCandidateSelfHost: async () => undefined,
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(result).not.toHaveProperty('executionDisposition');
  });

  it('strips contradictory no-start evidence from a successful provider result', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'provider completed',
      exitCode: 0,
      executionDisposition: 'not-started',
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('contradictory-success-session')),
      options: { prompt: 'build', cwd: '/workspace' },
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'codex' });
    expect(result).not.toHaveProperty('executionDisposition');
  });

  it('passes the candidate stream observer to the normal provider invocation', async () => {
    const observer = { onProviderStream: vi.fn(), close: vi.fn() };
    const invoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: true,
      output: 'streaming build completed',
      exitCode: 0,
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('session')),
      options: {
        prompt: 'build',
        cwd: '/workspace',
        providerStreamObserverForCandidate: () => observer,
      },
    });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ streamConsumer: observer }));
    expect(result).not.toHaveProperty('executionDisposition');
  });

  it('forwards an engine-owned native schema and preserves the provider terminal structured result', async () => {
    const nativeSchema = {
      type: 'object',
      properties: { version: { const: 1 } },
      required: ['version'],
      additionalProperties: false,
    };
    const finalStructuredResult = { version: 1 };
    const observer = { onProviderStream: vi.fn(), close: vi.fn() };
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      options.onProviderStream?.({
        childObservability: 'unsupported',
        uncachedInputTokens: 3,
        outputTokens: 2,
      });
      return {
        success: true,
        output: 'native-schema result',
        exitCode: 0,
        finalStructuredResult,
        tokenUsage: { input: 3, output: 2 },
      };
    });
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', {
          nativeSchemaCapability: { nativeOutputSchema: true },
          invoke,
        }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('stored-session')),
      options: {
        prompt: 'Return the constrained result.',
        cwd: '/workspace/feature',
        nativeSchema,
        providerStreamObserverForCandidate: () => observer,
      },
    });

    expect(invoke).toHaveBeenCalledOnce();
    const invocation = invoke.mock.calls[0]?.[0];
    expect(invocation).toEqual(expect.objectContaining({
      nativeSchema,
      streamConsumer: observer,
      onProviderStream: observer.onProviderStream,
    }));
    expectFreshSessions([invocation!]);
    expect(result).toMatchObject({
      success: true,
      output: 'native-schema result',
      finalStructuredResult,
      tokenUsage: { input: 3, output: 2 },
    });
    // The execution result is the StepRunner boundary: it must retain the
    // adapter's terminal value itself, rather than reconstructing it from
    // prose or dropping it while adding provider attribution.
    expect(result.finalStructuredResult).toBe(finalStructuredResult);
    expect(observer.onProviderStream).toHaveBeenCalledOnce();
    expect(observer.close).toHaveBeenCalledOnce();
  });

  it('owns and removes worktree scratch for a non-self-host Codex schema invocation', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-schema-scratch-'));
    let scratchHome: string | undefined;
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      scratchHome = options.nativeSchemaScratchHome;
      return { success: true, output: 'constrained result', exitCode: 0, finalStructuredResult: { version: 'v1' } };
    });
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
    try {
      await expect(executeProviderCandidates({
        step: 'remediate', configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([runtime('codex', { nativeSchemaCapability: { nativeOutputSchema: true }, invoke })]),
        sessions: new ProviderSessionScope(vi.fn().mockReturnValue('stored-session')),
        runId: 'feature-run', attempt: 2,
        nativeSchemaScratch: { worktreeRoot, repository: 'acme/repo', featureSlug: 'feature' },
        options: { prompt: 'Return the constrained result.', cwd: worktreeRoot, nativeSchema: { type: 'object' } },
      })).resolves.toMatchObject({ success: true, finalStructuredResult: { version: 'v1' } });
      expect(scratchHome).toBe(join(worktreeRoot, '.daemon', 'scratch', 'feature-run', '2-codex'));
      await expect(access(scratchHome!)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(invoke.mock.calls[0]?.[0]).not.toHaveProperty('selfHost');
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('retains an engine-owned native schema when candidate options attempt to clear it', async () => {
    const nativeSchema = { type: 'object', properties: { result: { type: 'string' } } };
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'constrained result',
      exitCode: 0,
      finalStructuredResult: { result: 'accepted' },
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', {
          nativeSchemaCapability: { nativeOutputSchema: true },
          invoke,
        }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('stored-session')),
      options: {
        prompt: 'Return the constrained result.',
        cwd: '/workspace/feature',
        nativeSchema,
      },
      optionsForCandidate: () => ({
        prompt: 'Candidate-local constrained prompt.',
        cwd: '/workspace/feature',
        nativeSchema: undefined,
      }),
    });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      nativeSchema,
      prompt: 'Candidate-local constrained prompt.',
    }));
  });

  it('fails mechanically before dispatch when a native schema is requested from an unsupported provider', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'must not run unconstrained',
      exitCode: 0,
    }));
    const fallback = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'must not run as a schema fallback',
      exitCode: 0,
    }));
    const observerForCandidate = vi.fn();
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke }),
        runtime('claude', { invoke: fallback }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('stored-session')),
      options: {
        prompt: 'Return the constrained result.',
        cwd: '/workspace/feature',
        nativeSchema: { type: 'object' },
        providerStreamObserverForCandidate: observerForCandidate,
      },
    });

    expect(result).toMatchObject({
      success: false,
      nativeSchemaUnsupported: true,
      providerInvocationSkipped: true,
    });
    expect(result.output).toContain('native output schema capability');
    expect(invoke).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(observerForCandidate).not.toHaveBeenCalled();
  });

  it('keeps no-schema invocation behavior on the existing single dispatch path', async () => {
    const observer = { onProviderStream: vi.fn(), close: vi.fn() };
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      options.onProviderStream?.({
        childObservability: 'unsupported',
        uncachedInputTokens: 5,
        outputTokens: 3,
      });
      return {
        success: true,
        output: 'ordinary result',
        exitCode: 0,
        tokenUsage: { input: 5, output: 3 },
      };
    });
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('stored-session')),
      options: {
        prompt: 'Run the ordinary step.',
        cwd: '/workspace/feature',
        providerStreamObserverForCandidate: () => observer,
      },
    });

    expect(invoke).toHaveBeenCalledOnce();
    const invocation = invoke.mock.calls[0]?.[0];
    expect(invocation).not.toHaveProperty('nativeSchema');
    expect(invocation).toEqual(expect.objectContaining({
      streamConsumer: observer,
      onProviderStream: observer.onProviderStream,
    }));
    expectFreshSessions([invocation!]);
    expect(result).toMatchObject({
      success: true,
      output: 'ordinary result',
      tokenUsage: { input: 5, output: 3 },
    });
    expect(result).not.toHaveProperty('finalStructuredResult');
    expect(observer.onProviderStream).toHaveBeenCalledOnce();
    expect(observer.close).toHaveBeenCalledOnce();
  });

  it('supplies no stream consumer to an interactive dispatch', async () => {
    // adr-2026-08-24-one-dispatch-member-on-the-provider-contract: the REPL
    // path supplies no consumer. Its output goes to the operator's terminal,
    // never as machine envelopes an observer could read.
    const observerForCandidate = vi.fn();
    const invoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: true,
      output: 'operator recovery session',
      exitCode: 0,
    }));
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('session')),
      options: {
        prompt: 'build',
        cwd: '/workspace',
        interactive: true,
        providerStreamObserverForCandidate: observerForCandidate,
      },
    });

    expect(observerForCandidate).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      expect.not.objectContaining({ streamConsumer: expect.anything() }),
    );
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
    const codex = { invoke: vi.fn(async (): Promise<InvokeResult> => ({ success: false, output: 'missing', exitCode: 127, providerUnavailable: true, providerUnavailableScope: 'run' })), };
    const claude = { invoke: vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'ok', exitCode: 0 })), };
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
    const provider = { invoke: vi.fn(async (): Promise<InvokeResult> => ({ success: false, output: 'terminal', exitCode: 1 })), };
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

  it('carries resolved dispatch dimensions in attempt metadata and omits absent values', async () => {
    const { buildProviderAttemptMetadata } = await import('../../src/engine/provider-execution.js');
    const result: InvokeResult = { success: true, exitCode: 0, output: 'completed' };
    const selected = buildProviderAttemptMetadata({
      providerKey: 'claude',
      result,
      resolvedModel: 'sonnet',
      preferredProvider: 'codex',
      resolvedEffort: 'high',
      tier: 'M',
    });
    const absent = buildProviderAttemptMetadata({
      providerKey: 'claude',
      result,
      resolvedModel: 'sonnet',
      preferredProvider: '',
    });

    expect({
      selected: (selected as { preferredProvider?: string }).preferredProvider,
      absent: (absent as { preferredProvider?: string }).preferredProvider,
      effort: (selected as { effort?: string }).effort,
      tier: (selected as { tier?: string }).tier,
    }).toEqual({ selected: 'codex', absent: undefined, effort: 'high', tier: 'M' });
  });

  it('emits resolved dispatch dimensions on a real provider attempt', async () => {
    const attempts: Array<Record<string, unknown>> = [];
    const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

    await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex'],
      preferredProvider: 'codex',
      tier: 'M',
      effortOverride: 'high',
      runtimes: new ProviderRuntimeSet([
        runtime('codex', {
          invoke: vi.fn(async (): Promise<InvokeResult> => ({
            success: true, exitCode: 0, output: 'completed',
          })),
        }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('attempt-session')),
      options: { prompt: 'Build.', cwd: '/workspace' },
      onAttempt: (_step, attempt) => { attempts.push({ ...attempt }); },
    });

    expect(attempts as unknown as Record<string, unknown>[]).toMatchObject([
      { provider: 'codex', preferredProvider: 'codex', effort: 'high', tier: 'M' },
    ]);
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
      }),
      runtime('claude', {
        invoke: vi.fn(async () => {
          transcript.push('invoke:claude');
          return { success: true, output: 'done', exitCode: 0 };
        }),
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
      runtime('codex', { invoke: vi.fn(async () => first === 'codex' ? unavailable('codex') : ({ success: true, output: 'ok', exitCode: 0 })), }),
      runtime('claude', { invoke: vi.fn(async () => first === 'claude' ? unavailable('claude') : ({ success: true, output: 'ok', exitCode: 0 })), }),
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
      runtime('codex', { invoke: vi.fn(async () => first === 'codex' ? unavailable('codex') : ({ success: true, output: 'shipped', exitCode: 0 })), }),
      runtime('claude', { invoke: vi.fn(async () => first === 'claude' ? unavailable('claude') : ({ success: true, output: 'shipped', exitCode: 0 })), }),
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
      runtime('codex', { invoke: codexInvoke, }),
      runtime('claude', { invoke: claudeInvoke, }),
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
      runtime('codex', { invoke: codexInvoke, }),
      runtime('claude', { invoke: claudeInvoke, }),
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
      runtime('codex', { invoke: codexInvoke, }),
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
        runtime('codex', { invoke: codexInvoke, }),
        runtime('claude', { invoke: claudeInvoke, }),
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
      runtime('codex', { invoke: codexInvoke, }),
      runtime('claude', { invoke: claudeInvoke, }),
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
      runtime('codex', { invoke, }),
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
    };
    const codex: LLMProvider = {
      invoke: codexInvoke,
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

    // The store's ids are never consulted: the invocation mints a fresh UUID
    // and the scope records no session for either provider.
    expectFreshSessions(codexInvoke.mock.calls.map(([options]) => options));
    const codexSessionId = codexInvoke.mock.calls[0]?.[0]?.sessionId;
    expect(codexSessionId).not.toBe('review-codex-session');
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
            sessionId: codexSessionId,
            resume: false,
            model: 'gpt-step/verbatim',
            effort: 'high',
          },
        ],
      ],
      sessions: {
        claude: undefined,
        codex: undefined,
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
            preferredProvider: 'codex',
            model: 'gpt-step/verbatim',
            effort: 'high',
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

    // Fresh, unique session ids per invocation; the injected stores are never
    // consulted and record nothing. The zero-arg mock typing hides the real
    // (options) call shape, so recover it explicitly.
    const codexOptions = (codexInvoke.mock.calls as unknown as Array<[InvokeOptions]>)
      .map(([options]) => options);
    const claudeOptions = (claudeInvoke.mock.calls as unknown as Array<[InvokeOptions]>)
      .map(([options]) => options);
    expectFreshSessions([...codexOptions, ...claudeOptions]);
    const codexSessionId = codexOptions[0]?.sessionId;
    const [liveClaudeSessionId, cachedClaudeSessionId] =
      claudeOptions.map((options) => options.sessionId);
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
            sessionId: codexSessionId,
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
            sessionId: liveClaudeSessionId,
            resume: false,
            model: 'opus',
            effort: 'high',
          },
        ],
        [
          {
            prompt: 'Build the feature.',
            cwd: '/workspace/feature',
            sessionId: cachedClaudeSessionId,
            resume: false,
            model: 'opus',
            effort: 'high',
          },
        ],
      ],
      thirdCalls: [],
      firstSessions: {
        codex: undefined,
        claude: undefined,
        third: undefined,
      },
      cachedSessions: {
        codex: undefined,
        claude: undefined,
        third: undefined,
      },
      noNextCodex: undefined,
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
            recoveryAction: 'Restore the provider availability, then re-queue this feature.',
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
            preferredProvider: 'codex',
            model: 'gpt-cli-primary',
            effort: 'max',
            outcome: 'unavailable',
            reason: missingReason,
            fallbackReason: missingReason,
            invoked: true,
          },
          {
            provider: 'claude',
            preferredProvider: 'codex',
            model: 'opus',
            effort: 'high',
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
            skipReason: 'cached-unavailable',
            setupCapability: 'cached-provider-availability',
            setupRecoveryAction: 'Restore the provider availability, then re-queue this feature.',
            invoked: false,
          },
          {
            provider: 'claude',
            preferredProvider: 'codex',
            model: 'opus',
            effort: 'high',
            outcome: 'success',
            invoked: true,
          },
        ],
      },
      noNext: {
        success: false,
        output:
          `All configured providers are unavailable for step build: codex (${missingReason}, cached unavailable).`,
        exitCode: 127,
        executionDisposition: 'not-started',
        preferredProvider: 'codex',
        attempts: [
          {
            provider: 'codex',
            reason: missingReason,
            outcome: 'unavailable',
            skipReason: 'cached-unavailable',
            setupCapability: 'cached-provider-availability',
            setupRecoveryAction: 'Restore the provider availability, then re-queue this feature.',
            invoked: false,
          },
        ],
        providerSetupExhaustion: { candidates: [{ provider: 'codex', capability: 'cached-provider-availability', reason: missingReason, recoveryAction: 'Restore the provider availability, then re-queue this feature.' }] },
      },
    });
  });

  it('retains no-start proof only when every unavailable provider and model result is affirmative', async () => {
    const unavailable = (executionDisposition?: 'not-started'): InvokeResult => ({
      success: false,
      output: 'unavailable',
      exitCode: 1,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: 'unavailable',
      ...(executionDisposition ? { executionDisposition } : {}),
    });
    const refused = (): InvokeResult => unavailable('not-started');
    const run = async (first: InvokeResult, second: InvokeResult, refuseFirst = false) => {
      const firstInvoke = vi.fn(async (): Promise<InvokeResult> => first);
      const secondInvoke = vi.fn(async (): Promise<InvokeResult> => second);
      const telemetryError = vi.fn(async (): Promise<void> => {
        throw new Error('telemetry is observational');
      });
      const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');

      const result = await executeProviderCandidates({
        step: 'build',
        configuredProviders: ['codex', 'claude'],
        preferredProvider: 'codex',
        runtimes: new ProviderRuntimeSet([
          runtime('codex', { invoke: firstInvoke }),
          runtime('claude', { invoke: secondInvoke }),
        ]),
        sessions: new ProviderSessionScope(vi.fn().mockReturnValue('fallback-session')),
        options: { prompt: 'Build.', cwd: '/workspace' },
        onAttempt: async () => {
          throw new Error('attempt telemetry is observational');
        },
        onTelemetryError: telemetryError,
        withCandidateSafety: async ({ providerKey }, invoke) =>
          refuseFirst || providerKey === 'claude' ? refused() : invoke(),
      });

      return { result, firstInvoke, secondInvoke, telemetryError };
    };

    const allRefused = await run(unavailable(), unavailable(), true);
    const unknownThenRefused = await run(unavailable(), unavailable());

    expect({
      allRefused: {
        calls: [allRefused.firstInvoke, allRefused.secondInvoke].map((invoke) => invoke.mock.calls.length),
        executionDisposition: allRefused.result.executionDisposition,
        attempts: allRefused.result.attempts?.map(({ provider }) => provider),
      },
      unknownThenRefused: {
        calls: [unknownThenRefused.firstInvoke, unknownThenRefused.secondInvoke].map((invoke) => invoke.mock.calls.length),
        executionDisposition: unknownThenRefused.result.executionDisposition,
        attempts: unknownThenRefused.result.attempts?.map(({ provider }) => provider),
      },
      telemetryErrors: [allRefused.telemetryError, unknownThenRefused.telemetryError]
        .map((handler) => handler.mock.calls.length),
    }).toEqual({
      allRefused: {
        calls: [0, 0],
        executionDisposition: 'not-started',
        attempts: ['codex', 'claude'],
      },
      unknownThenRefused: {
        calls: [1, 0],
        executionDisposition: undefined,
        attempts: ['codex', 'claude'],
      },
      telemetryErrors: [2, 2],
    });
  });

  it('retains no-start proof across native model fallback only when every unavailable model is affirmative', async () => {
    const unavailableModel = (executionDisposition?: 'not-started'): InvokeResult => ({
      success: false,
      output: 'model unavailable',
      exitCode: 1,
      modelUnavailable: true,
      ...(executionDisposition ? { executionDisposition } : {}),
    });
    const run = async (first: InvokeResult, second: InvokeResult) => {
      const invoke = vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const { executeProviderCandidates } = await import('../../src/engine/provider-execution.js');
      const result = await executeProviderCandidates({
        step: 'build',
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([runtime('codex', { invoke })]),
        sessions: new ProviderSessionScope(vi.fn().mockReturnValue('model-fallback-session')),
        modelOverride: 'primary',
        modelFallbackLadder: ['primary', 'fallback'],
        options: { prompt: 'Build.', cwd: '/workspace' },
      });
      return { result, models: invoke.mock.calls.map(([options]) => options.model) };
    };

    const allRefused = await run(unavailableModel('not-started'), unavailableModel('not-started'));
    const attemptedThenRefused = await run(unavailableModel(), unavailableModel('not-started'));

    expect(allRefused.models).toEqual(['primary', 'fallback']);
    expect(allRefused.result).toMatchObject({ executionDisposition: 'not-started' });
    expect(attemptedThenRefused.models).toEqual(['primary', 'fallback']);
    expect(attemptedThenRefused.result).not.toHaveProperty('executionDisposition');
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

    // Every attempt — ladder rungs, cross-provider fallback, later step —
    // mints its own fresh session; the injected stores are never consulted.
    expectFreshSessions([
      ...partialCodex.calls,
      ...fullCodex.calls,
      ...fullClaude.calls,
    ]);
    const [solSessionId, terraSessionId, lunaSessionId, laterSessionId] =
      fullCodex.calls.map(({ sessionId }) => sessionId);
    const claudeSessionId = fullClaude.calls[0]?.sessionId;
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
              preferredProvider: 'codex',
              model: 'gpt-5.6-terra',
              effort: 'medium',
              tokenUsage: { input: 22, output: 11 },
              outcome: 'success',
              invoked: true,
            },
          ],
        },
      },
      exhausted: {
        codexCalls: [
          { model: 'gpt-5.6-sol', sessionId: solSessionId, resume: false },
          { model: 'gpt-5.6-terra', sessionId: terraSessionId, resume: false },
          { model: 'gpt-5.6-luna', sessionId: lunaSessionId, resume: false },
        ],
        claudeCalls: [
          {
            prompt: 'Execute the step.',
            cwd: '/workspace/feature',
            sessionId: claudeSessionId,
            resume: false,
            model: 'sonnet',
            effort: 'high',
          },
        ],
        sessions: {
          codex: undefined,
          claude: undefined,
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
              preferredProvider: 'codex',
              model: 'gpt-5.6-luna',
              effort: 'medium',
              tokenUsage: { input: 3, output: 0 },
              outcome: 'unavailable',
              reason: 'model unavailable: gpt-5.6-luna',
              fallbackReason: 'model unavailable: gpt-5.6-luna',
              invoked: true,
            },
            {
              provider: 'claude',
              preferredProvider: 'codex',
              model: 'sonnet',
              effort: 'high',
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
          sessionId: laterSessionId,
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
              preferredProvider: 'codex',
              model: 'gpt-5.6-sol',
              effort: 'high',
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
              preferredProvider: 'codex',
              model: 'gpt-5.6-terra',
              effort: 'medium',
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
          preferredProvider: 'codex',
          model: 'gpt-5.6-terra',
          effort: 'medium',
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
          preferredProvider: 'codex',
          effort: 'medium',
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
        runtime('codex', { invoke, }),
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

    // Both the initial attempt and the Fable->Opus ladder fallback mint their
    // own fresh session ids; the injected store's ids never reach the provider.
    expectFreshSessions(calls);
    expect(calls.map(({ model }) => model)).toEqual(['fable', 'opus']);
    expect(calls[0]!.sessionId).not.toBe(calls[1]!.sessionId);
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
      runtime('codex', { invoke, }),
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
              recoveryAction: 'Restore the provider availability, then re-queue this feature.',
              nextProvider: 'third',
            },
          },
        ],
        result: {
          success: false,
          output:
            'All configured providers are unavailable for step build: codex (codex binary missing); claude (claude cached missing, cached unavailable); third (third integration missing).',
          exitCode: 127,
          preferredProvider: 'codex',
          attempts: [
            {
              provider: 'codex',
              preferredProvider: 'codex',
              model: 'gpt-5.6-terra',
              effort: 'medium',
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
              skipReason: 'cached-unavailable',
              setupCapability: 'cached-provider-availability',
              setupRecoveryAction: 'Restore the provider availability, then re-queue this feature.',
              invoked: false,
            },
            {
              provider: 'third',
              preferredProvider: 'codex',
              model: 'sonnet',
              effort: 'medium',
              outcome: 'unavailable',
              reason: 'third integration missing',
              invoked: true,
            },
          ],
        },
      });
  });
});
