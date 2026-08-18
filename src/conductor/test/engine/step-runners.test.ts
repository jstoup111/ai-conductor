import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access, mkdir, lstat, realpath } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { execa } from 'execa';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepRunnerOptions } from '../../src/engine/step-runners.js';
import {
  extractJudgedResultCandidate,
  DefaultStepRunner,
  parseTierFromOutput,
  parseSignalCountsFromOutput,
  scoreComplexityFromCounts,
  RUBRIC_FAILURE_DETAIL_CAP_BYTES,
} from '../../src/engine/step-runners.js';
import {
  CLAUDE_MODEL_POLICY as CLAUDE_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import type { ExecuteProviderCandidatesInput, ProviderExecutionResult } from '../../src/engine/provider-execution.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import type { ProviderLifecycleEpisodeStore } from '../../src/engine/provider-lifecycle-store.js';
import { evaluateScopeContainment } from '../../src/engine/plan-scope-containment.js';
import { readKickbackLedger, writeKickbackLedger } from '../../src/engine/kickback-ledger.js';

function createMockProvider(): LLMProvider {
  return {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      exitCode: 0,
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
}

function interactiveRuntime(
  key: 'claude' | 'codex',
  invokeInteractive: LLMProvider['invokeInteractive'],
) {
  const policy =
    key === 'claude' ? CLAUDE_POLICY : CODEX_MODEL_POLICY;
  const lifecycleCapability = { synchronousSpawnPermit: true } as const;
  return {
    key,
    provider: {
      supportsSessionResume: key === 'claude',
      lifecycleCapability,
      invoke: vi.fn(async (): Promise<InvokeResult> => ({
        success: true,
        output: 'wrong captured path',
        exitCode: 0,
      })),
      invokeInteractive,
    },
    lifecycleCapability,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

const emptyState: ConductState = {};

// Session reuse was removed by design: every provider invocation mints its
// own fresh UUID (never a store-derived id) and never resumes. Tests assert
// uniqueness + UUID shape instead of pinning store-supplied session names.
const FRESH_SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectUniqueFreshSessionIds(sessionIds: ReadonlyArray<string | undefined>): void {
  expect(sessionIds.length).toBeGreaterThan(0);
  expect(new Set(sessionIds).size).toBe(sessionIds.length);
  for (const id of sessionIds) expect(id).toMatch(FRESH_SESSION_ID_RE);
}

describe('DefaultStepRunner', () => {
  async function exhaustLifecycle(projectDir: string) {
    let now = 0;
    const episodeStore: ProviderLifecycleEpisodeStore = {
      readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
      writeProviderLifecycleEpisode: vi.fn(),
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
      configuredProviders: ['codex'],
      providerLifecycleTimer: {
        now: () => now,
        schedule: (callback) => {
          queueMicrotask(() => { now += 1; callback(); });
          return {};
        },
        cancel: () => undefined,
      },
      providerLifecycleEpisodeStore: episodeStore,
    });
    const dispatch = (runner as unknown as {
      dispatchProviderWithLifecycleSupervision: (
        step: StepName,
        options: ExecuteProviderCandidatesInput['options'],
        run: () => Promise<never>,
      ) => Promise<ProviderExecutionResult>;
    }).dispatchProviderWithLifecycleSupervision.bind(runner);
    return dispatch('build', { prompt: 'prepare provider', cwd: projectDir }, () => new Promise<never>(() => undefined));
  }

  it('preserves a failed lifecycle halt-marker write for the provider caller', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'lifecycle-halt-failure-'));
    const projectFile = join(temporaryDirectory, 'not-a-directory');
    await writeFile(projectFile, 'not a directory');
    try {
      const result = await exhaustLifecycle(projectFile);
      const expectedMarkerPath = join(projectFile, '.pipeline/HALT');
      const expectedReason = /ENOTDIR|not a directory/i;
      expect(result).toMatchObject({
        success: false,
        haltMarkerWrite: {
          status: 'failed',
          path: expectedMarkerPath,
          reason: expect.stringMatching(expectedReason),
        },
      });
      expect(result.output).toContain(`Halt marker write failed at ${expectedMarkerPath}:`);
      expect(result.output).toMatch(expectedReason);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('keeps the successful lifecycle halt-marker message unchanged', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'lifecycle-halt-success-'));
    try {
      expect(await exhaustLifecycle(projectDir)).toMatchObject({
        output: 'Provider preparation timed out twice. See .pipeline/HALT.',
        haltMarkerWrite: { status: 'written' },
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'autonomous scalar conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 100, durationMs: 25 }];
        const provider: LLMProvider = {
          invoke: vi.fn(async (): Promise<InvokeResult> => ({
            success: true,
            output: 'done',
            exitCode: 0,
            observedIntervals,
          })),
          invokeInteractive: vi.fn(async () => undefined),
        };
        const runner = new DefaultStepRunner(provider, 'session', '/tmp/project');

        return { observedIntervals, result: await runner.run('build', emptyState) };
      },
    },
    {
      name: 'provider-aware success conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 200, durationMs: 30 }];
        const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
          success: true,
          output: 'done',
          exitCode: 0,
          observedIntervals,
          preferredProvider: 'codex',
          actualProvider: 'codex',
          attempts: [],
        }));
        const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
          providerExecution: {
            configuredProviders: ['codex'],
            runtimes: new ProviderRuntimeSet([
              interactiveRuntime('codex', vi.fn(async () => undefined)),
            ]),
            sessions: new ProviderSessionStore(),
            executor: providerExecutor,
          },
        });

        return { observedIntervals, result: await runner.run('build', emptyState) };
      },
    },
    {
      name: 'provider-aware failure conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 300, durationMs: 35 }];
        const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
          success: false,
          output: 'failed',
          exitCode: 1,
          observedIntervals,
          preferredProvider: 'claude',
          attempts: [],
        }));
        const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
          providerExecution: {
            configuredProviders: ['claude'],
            runtimes: new ProviderRuntimeSet([
              interactiveRuntime('claude', vi.fn(async () => undefined)),
            ]),
            sessions: new ProviderSessionStore(),
            executor: providerExecutor,
          },
        });

        return { observedIntervals, result: await runner.run('build', emptyState) };
      },
    },
    {
      name: 'streaming conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 400, durationMs: 40 }];
        const runtime = interactiveRuntime(
          'claude',
          vi.fn(async (): Promise<InvokeResult> => ({
            success: true,
            output: 'streamed',
            exitCode: 0,
            observedIntervals,
          })),
        );
        const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
          providerExecution: {
            configuredProviders: ['claude'],
            runtimes: new ProviderRuntimeSet([runtime]),
            sessions: new ProviderSessionStore(),
          },
        });
        await runner.resetSession('explore');

        return { observedIntervals, result: await runner.run('explore', emptyState) };
      },
    },
  ])('preserves observed intervals through $name', async ({ run }) => {
    const { observedIntervals, result } = await run();

    expect(result.observedIntervals?.[0]).toBe(observedIntervals[0]);
  });

  it('forwards task-local attribution to provider-aware normal dispatch', async () => {
    const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
      success: true,
      output: 'done',
      exitCode: 0,
      preferredProvider: 'codex',
      actualProvider: 'codex',
      attempts: [],
    }));
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('codex', vi.fn(async () => undefined))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
        taskAttribution: {
          taskId: '2',
          seededTaskIds: ['1', '2'],
          expectedTaskId: '2',
        },
      },
    });

    await runner.run('build', emptyState);

    expect(providerExecutor.mock.calls[0]?.[0].taskAttribution).toEqual({
      taskId: '2',
      seededTaskIds: ['1', '2'],
      expectedTaskId: '2',
    });
  });

  it('forwards provider-aware lifecycle transitions to the provider-attempt sink before settlement', async () => {
    const providerAttempt = vi.fn();
    const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
      input.options.spawnPermit?.();
      return {
        success: true,
        output: 'done',
        exitCode: 0,
        preferredProvider: 'claude' as const,
        actualProvider: 'claude' as const,
        attempts: [],
      };
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
      providerAttempt,
    });

    const result = await runner.run('build', emptyState);
    const lifecyclePhases = providerAttempt.mock.calls.flatMap(([, metadata]) => {
      const lifecycle = (metadata as { lifecycle?: { phase?: string } }).lifecycle;
      return lifecycle?.phase ? [lifecycle.phase] : [];
    });

    expect({ lifecyclePhases, settled: result.success }).toEqual({
      lifecyclePhases: ['preparing', 'running', 'settled'],
      settled: true,
    });
  });

  it('forwards the daemon feature diagnostic logger to a streaming provider invocation', async () => {
    const featureLog = vi.fn();
    const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
      success: true,
      output: 'done',
      exitCode: 0,
      preferredProvider: 'claude',
      actualProvider: 'claude',
      attempts: [],
    }));
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
        diagnosticLog: featureLog,
      },
    });

    await runner.run('build', emptyState);

    expect(providerExecutor.mock.calls[0]?.[0].options.diagnosticLog).toBe(featureLog);
  });

  it('forwards the daemon feature diagnostic logger to a one-shot skill provider invocation', async () => {
    const featureLog = vi.fn();
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      // Stand in for the provider subprocess diagnostics that claude-provider
      // and codex-provider route to `options.diagnosticLog`.
      options.diagnosticLog?.('claude: subprocess diagnostic');
      return { success: true, output: 'remediated', exitCode: 0 };
    });
    const policy = CLAUDE_POLICY;
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        // The real executeProviderCandidates runs here on purpose: the
        // scoped-options -> candidate-options precedence is the behavior
        // under test, so it must not be stubbed out by an injected executor.
        runtimes: new ProviderRuntimeSet([
          {
            key: 'claude',
            provider: {
              lifecycleCapability: { synchronousSpawnPermit: true },
              invoke,
              invokeInteractive: vi.fn(async () => undefined),
            },
            policy,
            builtIn: true,
            availability: new ModelAvailability(policy.modelFallbackLadder),
          },
        ]),
        sessions: new ProviderSessionStore(),
        diagnosticLog: featureLog,
      },
    });

    await runner.run('remediate', emptyState);

    const candidatePrompt = invoke.mock.calls[0]?.[0].prompt;
    expect({
      // Proves the candidate-specific (skill-rendered) options were the ones
      // delivered, and that the feature-scoped logger survived into them.
      renderedSkillInvocation: candidatePrompt?.startsWith('/remediate') ?? false,
      diagnosticLogForwarded: invoke.mock.calls[0]?.[0].diagnosticLog === featureLog,
      scopedLogLines: featureLog.mock.calls.map(([line]) => line),
    }).toEqual({
      renderedSkillInvocation: true,
      diagnosticLogForwarded: true,
      scopedLogLines: ['claude: subprocess diagnostic'],
    });
  });

  describe('step-heartbeat telemetry wiring', () => {
    let projectDir: string;

    beforeEach(async () => {
      projectDir = await mkdtemp(join(tmpdir(), 'step-runner-heartbeat-'));
    });
    afterEach(async () => {
      await rm(projectDir, { recursive: true, force: true });
    });

    it('touches .pipeline/step-heartbeat when the provider dispatch reports activity', async () => {
      const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        // Simulate a streamed provider event boundary firing onActivity.
        (input.options as InvokeOptions & { onActivity?: () => void }).onActivity?.();
        return {
          success: true,
          output: 'done',
          exitCode: 0,
          preferredProvider: 'claude',
          actualProvider: 'claude',
          attempts: [],
        };
      });
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor,
        },
      });

      await runner.run('build', emptyState);
      // The activity pulse writes fire-and-forget; give the IO queue a tick.
      await new Promise((r) => setTimeout(r, 20));

      const raw = await readFile(join(projectDir, '.pipeline', 'step-heartbeat'), 'utf-8');
      const heartbeat = JSON.parse(raw);
      expect(heartbeat.step).toBe('build');
      expect(Number.isFinite(Date.parse(heartbeat.ts))).toBe(true);
    });

    it('allows a quiet spawned provider to succeed beyond the former heartbeat threshold', async () => {
      const base = Date.now();
      let silent = false;
      const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        input.options.onSpawn?.();
        (input.options as InvokeOptions & { onActivity?: () => void }).onActivity?.();
        // Let the initial pulse settle, then advance the old watchdog's
        // injected clock beyond its threshold and grace period.
        await new Promise((resolve) => setTimeout(resolve, 10));
        silent = true;
        await new Promise((r) => setTimeout(r, 60));
        return {
          success: true,
          output: 'reviewed',
          exitCode: 0,
          preferredProvider: 'claude',
          actualProvider: 'claude',
          attempts: [],
        };
      });
      const config: HarnessConfig = { step_heartbeat_stall_minutes: 1 };
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        config,
        heartbeatWatchdog: {
          pollIntervalMs: 5,
          now: () => (silent ? base + 60 * 60_000 : base),
        },
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor as unknown as typeof executeProviderCandidates,
        },
      });

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(true);
      expect(providerExecutor).toHaveBeenCalledTimes(1);
      await expect(readFile(join(projectDir, '.pipeline', 'HALT'), 'utf-8')).rejects.toThrow();
    });

    it.each([
      {
        name: 'absent',
        setup: async () => {},
      },
      {
        name: 'malformed',
        setup: async () => {
          await mkdir(join(projectDir, '.pipeline'), { recursive: true });
          await writeFile(join(projectDir, '.pipeline', 'step-heartbeat'), 'not json', 'utf-8');
        },
      },
      {
        name: 'prior-dispatch',
        setup: async () => {
          await mkdir(join(projectDir, '.pipeline'), { recursive: true });
          await writeFile(
            join(projectDir, '.pipeline', 'step-heartbeat'),
            JSON.stringify({ step: 'architecture_review_as_built', ts: new Date(0).toISOString() }),
            'utf-8',
          );
        },
      },
    ])('keeps $name heartbeat data observational for a quiet spawned provider', async ({ setup }) => {
      await setup();
      const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        input.options.onSpawn?.();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          success: true,
          output: 'reviewed',
          exitCode: 0,
          preferredProvider: 'claude',
          actualProvider: 'claude',
          attempts: [],
        };
      });
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        config: { step_heartbeat_stall_minutes: 1 },
        heartbeatWatchdog: { pollIntervalMs: 5, now: () => Date.now() + 60 * 60_000 },
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor as unknown as typeof executeProviderCandidates,
        },
      });

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(true);
      expect(providerExecutor).toHaveBeenCalledTimes(1);
      await expect(readFile(join(projectDir, '.pipeline', 'HALT'), 'utf-8')).rejects.toThrow();
    });

    it('treats a disabled heartbeat threshold as telemetry configuration without halting', async () => {
      const providerExecutor = vi.fn(async () => ({
        success: true,
        output: 'done',
        exitCode: 0,
        preferredProvider: 'claude',
        actualProvider: 'claude',
        attempts: [],
      }));
      const config: HarnessConfig = { step_heartbeat_stall_minutes: 0 };
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        config,
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor,
        },
      });

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(true);
      await expect(readFile(join(projectDir, '.pipeline', 'HALT'), 'utf-8')).rejects.toThrow();
    });
  });

  it('routes representative DECIDE, BUILD, and SHIP dispatches through lifecycle supervision', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'step-runner-lifecycle-'));
    const permits: Array<ReturnType<NonNullable<InvokeOptions['spawnPermit']>> | undefined> = [];
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      permits.push(options.spawnPermit?.());
      return {
        success: true,
        output: 'MODELS: 1\nINTEGRATIONS: 0\nAUTH: 0\nSTATE_MACHINES: 0\nSTORIES: 1\nTIER: S',
        exitCode: 0,
      };
    });
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
      invokeInteractive: invoke,
    };
    const sessions = new ProviderSessionStore();
    const runner = new DefaultStepRunner(provider, 'session', projectDir, {
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([{
          key: 'claude',
          provider,
          lifecycleCapability: provider.lifecycleCapability,
          policy: CLAUDE_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
        }]),
        sessions,
      },
    });

    try {
      await runner.assessComplexity();
      await sessions.beginStep('build');
      await runner.run('build', emptyState);
      await sessions.beginStep('prd_audit');
      const ship = await runner.run('prd_audit', emptyState);

      expect(ship).toMatchObject({ success: true });
      expect(permits).toEqual([
        { permitted: true },
        { permitted: true },
        { permitted: true },
      ]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('reads self-host candidate hooks from the live context after construction', async () => {
    const executor = vi.fn(async (input: any) => {
      const candidate = { step: 'build', providerKey: 'codex', model: 'gpt', effort: 'medium' };
      await input.prepareCandidateSelfHost(candidate, {});
      await input.withCandidateSafety(candidate, async () => ({ success: true, output: 'done', exitCode: 0 }));
      return { success: true, output: 'done', exitCode: 0, preferredProvider: 'codex', actualProvider: 'codex', attempts: [] };
    });
    const context: any = {
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([interactiveRuntime('codex', vi.fn(async () => undefined))]),
      sessions: new ProviderSessionStore(), executor,
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', { providerExecution: context });
    const prepared = vi.fn(async () => undefined);
    const safety = vi.fn(async (_candidate, invoke) => invoke());
    context.prepareCandidateSelfHost = prepared;
    context.withCandidateSafety = safety;

    await runner.run('build', emptyState);

    expect(prepared).toHaveBeenCalledOnce();
    expect(safety).toHaveBeenCalledOnce();
  });

  it('forwards the live self-host preparation hook through build_review one-shot dispatch', async () => {
    const executor = vi.fn(async (input: any) => {
      const candidate = { step: 'build_review', providerKey: 'claude', model: 'sonnet', effort: 'medium' };
      const selfHost = await input.prepareCandidateSelfHost(candidate, {});
      await selfHost.teardown();
      return { success: true, output: 'reviewed', exitCode: 0, preferredProvider: 'claude', actualProvider: 'claude', attempts: [] };
    });
    const teardown = vi.fn(async () => {});
    const prepared = vi.fn(async () => ({ executable: 'claude', env: {}, args: [], teardown }));
    const context: any = {
      configuredProviders: ['claude'],
      runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
      sessions: new ProviderSessionStore(), executor, prepareCandidateSelfHost: prepared,
      withCandidateSafety: async (_candidate: unknown, invoke: () => Promise<InvokeResult>) => invoke(),
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', { providerExecution: context });
    const execute = (runner as any).executeProviderAwareOneShot.bind(runner);

    await execute('build_review', { prompt: 'review', cwd: '/tmp/project', dangerouslySkipPermissions: true });

    expect(prepared).toHaveBeenCalledOnce();
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('routes complexity and recovery dispatches through provider-native fresh one-shot scopes', async () => {
    const capturedInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'captured provider must not run',
      exitCode: 0,
    }));
    const capturedInteractive = vi.fn().mockResolvedValue(undefined);
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'wrong Claude path',
      exitCode: 0,
    }));
    const claudeInteractive = vi.fn().mockResolvedValue(undefined);
    const codexInvoke = vi.fn(
      async (options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: options.prompt.endsWith('conduct complexity')
          ? [
              'MODELS: 6',
              'INTEGRATIONS: 1',
              'AUTH: 0',
              'STATE_MACHINES: 1',
              'STORIES: 8',
              'TIER: M',
            ].join('\n')
          : options.prompt.endsWith('rebase')
            ? '{"resolved": true}'
            : 'done',
        exitCode: 0,
      }),
    );
    const provider = (
      invoke: LLMProvider['invoke'],
      invokeInteractive: LLMProvider['invokeInteractive'] =
        vi.fn().mockResolvedValue(undefined),
    ): LLMProvider => ({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
      invokeInteractive,
    });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: provider(claudeInvoke, claudeInteractive),
        policy: CLAUDE_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
      },
      {
        key: 'codex',
        provider: provider(codexInvoke),
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const ids = [
      'complexity-codex-session',
      'remediate-codex-session',
      'rebase-codex-session',
      'setup-codex-session',
      'ci-codex-session',
      'attribution-codex-session',
      'build-review-codex-session',
    ][Symbol.iterator]();
    const sessions = new ProviderSessionStore({
      createSessionId: () => ids.next().value ?? 'unexpected-session',
    });
    const beginBranch = vi.spyOn(sessions, 'beginBranch');
    const providerExecutor = vi.fn(executeProviderCandidates);
    const runner = new DefaultStepRunner(
      provider(capturedInvoke, capturedInteractive),
      'captured-session',
      '/tmp/project',
      {
        config: {
          llm_provider: ['claude', 'codex'],
          steps: {
            complexity: { llm_provider: 'codex' },
            remediate: { llm_provider: 'codex' },
            rebase: { llm_provider: 'codex' },
            worktree: { llm_provider: 'codex' },
            build: { llm_provider: 'codex' },
            attribution_verify: { llm_provider: 'codex' },
            build_review: { llm_provider: 'codex' },
          },
        },
        sessionStore: sessions,
        providerRuntimes: runtimes,
        configuredProviders: ['claude', 'codex'],
        providerExecutor,
      },
    );

    const complexity = await runner.assessComplexity();
    const remediate = await runner.run('remediate', emptyState, {
      attempt: 3,
      escalate: false,
      modelOverride: 'gpt-5.6-terra',
      effortOverride: 'max',
    });
    const rebase = await runner.resolveRebaseConflict({
      conflicts: ['src/example.ts'],
      projectRoot: '/wt/rebase',
      baseRef: 'origin/main',
    });
    const setup = await runner.resolveSetupFailure({
      worktreePath: '/wt/setup',
      outputTail: 'install failed',
      slug: 'setup-feature',
    });
    const ci = await runner.resolveCiFailure({
      worktreePath: '/wt/ci',
      prUrl: 'https://github.com/org/repo/pull/42',
      hint: 'typecheck failed',
      slug: 'ci-feature',
    });
    const executeOneShot = (runner as unknown as {
      executeProviderAwareOneShot: (
        step: StepName,
        options: ExecuteProviderCandidatesInput['options'],
      ) => Promise<InvokeResult>;
    }).executeProviderAwareOneShot.bind(runner);
    await executeOneShot('attribution_verify', {
      prompt: 'Judge attribution exactly as supplied.\nTask: runtime-07',
      cwd: '/wt/attribution',
    });
    await executeOneShot('build_review', {
      prompt: 'Grade this assembled plan and diff exactly as supplied.',
      cwd: '/wt/build-review',
    });

    const executionInputs = providerExecutor.mock.calls.map(([input]) => input);
    const transportedOptions = codexInvoke.mock.calls.map(([options]) => options);
    const freeFormDispatches = [3, 4, 5, 6].map((index) => ({
      step: executionInputs[index]?.step,
      byteIdentical:
        executionInputs[index]?.options.prompt === transportedOptions[index]?.prompt,
      hasCandidateFactory: executionInputs[index]?.optionsForCandidate !== undefined,
    }));
    const claudeSkillInvoke = vi.fn(
      async (options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: options.prompt.endsWith('conduct complexity')
          ? 'MODELS: 0\nINTEGRATIONS: 0\nAUTH: 0\nSTATE_MACHINES: 0\nSTORIES: 1\nTIER: S'
          : options.prompt.endsWith('rebase')
            ? '{"resolved": true}'
            : 'done',
        exitCode: 0,
      }),
    );
    const claudeSkillRunner = new DefaultStepRunner(
      provider(claudeSkillInvoke),
      'claude-session',
      '/tmp/project',
      {
        config: {
          llm_provider: 'claude',
          steps: {
            complexity: { llm_provider: 'claude' },
            remediate: { llm_provider: 'claude' },
            rebase: { llm_provider: 'claude' },
          },
        },
        providerRuntimes: new ProviderRuntimeSet([{
          key: 'claude',
          provider: provider(claudeSkillInvoke),
          policy: CLAUDE_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
        }]),
        sessionStore: new ProviderSessionStore(),
        configuredProviders: ['claude'],
      },
    );
    await claudeSkillRunner.assessComplexity();
    await claudeSkillRunner.run('remediate', emptyState);
    await claudeSkillRunner.resolveRebaseConflict({
      conflicts: ['src/example.ts'],
      projectRoot: '/wt/rebase',
      baseRef: 'origin/main',
    });
    const claudeSkillPrompts = claudeSkillInvoke.mock.calls.map(
      ([options]) => options.prompt,
    );
    const codexSessionIds = codexInvoke.mock.calls.map(
      ([options]) => options.sessionId,
    );
    expectUniqueFreshSessionIds(codexSessionIds);

    expect({
      capturedCalls: {
        invoke: capturedInvoke.mock.calls,
        interactive: capturedInteractive.mock.calls,
      },
      claudeRuntimeCalls: {
        invoke: claudeInvoke.mock.calls,
        interactive: claudeInteractive.mock.calls,
      },
      beginBranchCalls: beginBranch.mock.calls,
      remediateRetryInput: providerExecutor.mock.calls
        .map(([input]) => input)
        .find(({ step }) => step === 'remediate'),
      codexCalls: codexInvoke.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        cwd: options.cwd,
        model: options.model,
        effort: options.effort,
      })),
      complexity,
      remediate,
      rebase,
      setup,
      ci,
      freeFormDispatches,
      claudeSkillPrompts,
    }).toEqual({
      capturedCalls: { invoke: [], interactive: [] },
      claudeRuntimeCalls: { invoke: [], interactive: [] },
      claudeSkillPrompts: ['/conduct complexity', '/remediate', '/rebase'],
      beginBranchCalls: [
        ['complexity'],
        ['remediate'],
        ['rebase'],
        ['worktree'],
        ['build'],
        ['attribution_verify'],
        ['build_review'],
      ],
      remediateRetryInput: expect.objectContaining({
        attempt: 3,
        escalate: false,
        modelOverride: 'gpt-5.6-terra',
        effortOverride: 'max',
      }),
      codexCalls: [
        {
          prompt: '$conduct complexity',
          sessionId: codexSessionIds[0],
          resume: false,
          cwd: '/tmp/project',
          model: 'gpt-5.6-terra',
          effort: 'low',
        },
        {
          prompt: '$remediate',
          sessionId: codexSessionIds[1],
          resume: false,
          cwd: '/tmp/project',
          model: 'gpt-5.6-terra',
          effort: 'max',
        },
        {
          prompt: '$rebase',
          sessionId: codexSessionIds[2],
          resume: false,
          cwd: '/wt/rebase',
          model: 'gpt-5.6-terra',
          effort: 'high',
        },
        {
          prompt: expect.stringContaining('install failed'),
          sessionId: codexSessionIds[3],
          resume: false,
          cwd: '/wt/setup',
          model: 'gpt-5.6-luna',
          effort: 'low',
        },
        {
          prompt: expect.stringContaining('typecheck failed'),
          sessionId: codexSessionIds[4],
          resume: false,
          cwd: '/wt/ci',
          model: 'gpt-5.6-terra',
          effort: 'medium',
        },
        {
          prompt: 'Judge attribution exactly as supplied.\nTask: runtime-07',
          sessionId: codexSessionIds[5],
          resume: false,
          cwd: '/wt/attribution',
          model: 'gpt-5.6-sol',
          effort: 'high',
        },
        {
          prompt: 'Grade this assembled plan and diff exactly as supplied.',
          sessionId: codexSessionIds[6],
          resume: false,
          cwd: '/wt/build-review',
          model: 'gpt-5.6-sol',
          effort: 'high',
        },
      ],
      freeFormDispatches: [
        {
          step: 'worktree',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
        {
          step: 'build',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
        {
          step: 'attribution_verify',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
        {
          step: 'build_review',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
      ],
      complexity: expect.objectContaining({
        tier: 'M',
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      remediate: expect.objectContaining({
        success: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      rebase: expect.objectContaining({
        resolved: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      setup: expect.objectContaining({
        attempted: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      ci: expect.objectContaining({
        attempted: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
    });
  });

  it('dispatches consecutive normal steps through their preferred provider with fresh provider sessions', async () => {
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'codex built',
      exitCode: 0,
      tokenUsage: { input: 11, output: 4 },
    }));
    const claudeInteractive = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'claude explored',
      exitCode: 0,
      tokenUsage: { input: 7, output: 3 },
    }));
    const legacyInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'legacy provider must not run',
      exitCode: 0,
    }));
    const legacyInteractive = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'legacy provider must not run',
      exitCode: 0,
    }));
    const provider = (
      invoke: LLMProvider['invoke'],
      invokeInteractive: LLMProvider['invokeInteractive'],
    ): LLMProvider => ({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
      invokeInteractive,
    });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: provider(
          vi.fn(async (): Promise<InvokeResult> => ({
            success: true,
            output: 'wrong Claude path',
            exitCode: 0,
          })),
          claudeInteractive,
        ),
        policy: CLAUDE_POLICY,
        builtIn: true,
        availability: new ModelAvailability(
          CLAUDE_POLICY.modelFallbackLadder,
        ),
      },
      {
        key: 'codex',
        provider: provider(
          codexInvoke,
          vi.fn(async (): Promise<InvokeResult> => ({
            success: true,
            output: 'wrong Codex path',
            exitCode: 0,
          })),
        ),
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(
          CODEX_MODEL_POLICY.modelFallbackLadder,
        ),
      },
    ]);
    const sessionIds = [
      'build-codex-session',
      'explore-claude-session',
    ][Symbol.iterator]();
    const sessions = new ProviderSessionStore({
      createSessionId: () => sessionIds.next().value ?? 'unexpected-session',
    });
    const beginStep = vi.spyOn(sessions, 'beginStep');
    const runner = new DefaultStepRunner(
      provider(legacyInvoke, legacyInteractive),
      'legacy-session',
      '/tmp/project',
      {
        config: {
          llm_provider: ['claude', 'codex'],
          steps: {
            build: { llm_provider: 'codex' },
            explore: { llm_provider: 'claude' },
          },
        },
        sessionStore: sessions,
        providerRuntimes: runtimes,
        configuredProviders: ['claude', 'codex'],
      } satisfies StepRunnerOptions,
    );

    await runner.resetSession('build');
    const build = await runner.run('build', emptyState);
    const buildSession = sessions.current('codex');
    await runner.resetSession('explore');
    const explore = await runner.run('explore', emptyState);

    // Each dispatch mints its own fresh session id; the store's ids are never
    // consulted and the step scope records nothing. The zero-arg mock typing
    // hides the real (options) call shape, so recover it explicitly.
    const buildSessionId = (
      codexInvoke.mock.calls as unknown as Array<[InvokeOptions]>
    )[0]?.[0]?.sessionId;
    const exploreSessionId = (
      claudeInteractive.mock.calls as unknown as Array<[InvokeOptions]>
    )[0]?.[0]?.sessionId;
    expectUniqueFreshSessionIds([buildSessionId, exploreSessionId]);

    expect({
      legacyCalls: {
        invoke: legacyInvoke.mock.calls,
        interactive: legacyInteractive.mock.calls,
      },
      codexCalls: codexInvoke.mock.calls,
      claudeInteractiveCalls: claudeInteractive.mock.calls,
      beginStepCalls: beginStep.mock.calls,
      buildSession,
      exploreSession: sessions.current('claude'),
      build,
      explore,
    }).toEqual({
      legacyCalls: { invoke: [], interactive: [] },
      beginStepCalls: [['build'], ['explore']],
      codexCalls: [
        [
          expect.objectContaining({
            cwd: '/tmp/project',
            dangerouslySkipPermissions: true,
            sessionId: buildSessionId,
            resume: false,
            model: 'gpt-5.6-terra',
            effort: 'medium',
          }),
        ],
      ],
      claudeInteractiveCalls: [
        [
          expect.objectContaining({
            cwd: '/tmp/project',
            dangerouslySkipPermissions: false,
            sessionId: exploreSessionId,
            resume: false,
            interactive: true,
            model: 'opus',
            effort: 'high',
          }),
        ],
      ],
      buildSession: undefined,
      exploreSession: undefined,
      build: {
        success: true,
        output: 'codex built',
        tokenUsage: { input: 11, output: 4 },
        model: 'gpt-5.6-terra',
        preferredProvider: 'codex',
        actualProvider: 'codex',
        attempts: [
          {
            provider: 'codex',
            model: 'gpt-5.6-terra',
            tokenUsage: { input: 11, output: 4 },
            outcome: 'success',
            invoked: true,
          },
        ],
      },
      explore: {
        success: true,
        output: 'claude explored',
        tokenUsage: { input: 7, output: 3 },
        model: 'opus',
        preferredProvider: 'claude',
        actualProvider: 'claude',
        attempts: [
          {
            provider: 'claude',
            model: 'opus',
            tokenUsage: { input: 7, output: 3 },
            outcome: 'success',
            invoked: true,
          },
        ],
      },
    });
  });

  it('persists interactive run-wide unavailability across step scopes without marking the cached skip invoked', async () => {
    const unavailableCodex = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'codex executable missing',
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: 'codex executable missing',
    }));
    const claudeFallback = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'claude fallback',
      exitCode: 0,
    }));
    const cachedSessions = new ProviderSessionStore({
      createSessionId: (() => {
        let id = 0;
        return () => `cached-${++id}`;
      })(),
    });
    const cachedRunner = new DefaultStepRunner(
      createMockProvider(),
      'legacy-cache-session',
      '/tmp/project',
      {
        mode: 'interactive',
        config: {
          llm_provider: ['codex', 'claude'],
          steps: {
            explore: { llm_provider: 'codex' },
            stories: { llm_provider: 'codex' },
          },
        },
        sessionStore: cachedSessions,
        providerRuntimes: new ProviderRuntimeSet([
          interactiveRuntime('codex', unavailableCodex),
          interactiveRuntime('claude', claudeFallback),
        ]),
        configuredProviders: ['codex', 'claude'],
        providerWarn: vi.fn(),
      },
    );

    await cachedRunner.resetSession('explore');
    await cachedRunner.run('explore', emptyState);
    await cachedRunner.resetSession('stories');
    const cachedResult = await cachedRunner.run('stories', emptyState);

    expect({
      unavailableCodexCalls: unavailableCodex.mock.calls.length,
      cachedActualProvider: cachedResult.actualProvider,
      cachedAttempt: cachedResult.attempts?.[0],
      cachedSession: cachedSessions.current('codex'),
    }).toEqual({
      unavailableCodexCalls: 1,
      cachedActualProvider: 'claude',
      cachedAttempt: {
        provider: 'codex',
        outcome: 'unavailable',
        reason: 'codex executable missing',
        fallbackReason: 'codex executable missing',
        invoked: false,
      },
      // The store is never consulted: no session is recorded for the scope.
      cachedSession: undefined,
    });
  });

  it('cold-starts after a rejected interactive attempt without created bookkeeping', async () => {
    const throwingInteractive = vi
      .fn<LLMProvider['invokeInteractive']>()
      .mockRejectedValueOnce(new Error('interactive process rejected'))
      .mockResolvedValueOnce({
        success: true,
        output: 'retry completed',
        exitCode: 0,
      });
    const retrySessions = new ProviderSessionStore({
      createSessionId: () => 'retry-claude-session',
    });
    const retryRunner = new DefaultStepRunner(
      createMockProvider(),
      'legacy-retry-session',
      '/tmp/project',
      {
        mode: 'interactive',
        config: {
          llm_provider: 'claude',
          steps: { explore: { llm_provider: 'claude' } },
        },
        sessionStore: retrySessions,
        providerRuntimes: new ProviderRuntimeSet([
          interactiveRuntime('claude', throwingInteractive),
        ]),
        configuredProviders: ['claude'],
      },
    );

    await retryRunner.resetSession('explore');
    const failed = await retryRunner.run('explore', emptyState);
    const afterFailure = retrySessions.current('claude');
    const retried = await retryRunner.run('explore', emptyState);

    expect({
      failed,
      afterFailure,
      retriedActualProvider: retried.actualProvider,
    }).toEqual({
      failed: {
        success: false,
        output: 'Session for explore exited with error: interactive process rejected',
      },
      // The store is never consulted: no session is recorded for the scope.
      afterFailure: undefined,
      retriedActualProvider: 'claude',
    });
    // The retry cold-starts with its OWN fresh session id — never the store's
    // 'retry-claude-session' and never the first attempt's id.
    const retryInvocations = throwingInteractive.mock.calls.map(([options]) => ({
      sessionId: options.sessionId,
      resume: options.resume,
    }));
    expect(retryInvocations.map(({ resume }) => resume)).toEqual([false, false]);
    expectUniqueFreshSessionIds(retryInvocations.map(({ sessionId }) => sessionId));
  });

  it('routes interactive recovery through the selected provider candidates', async () => {
    const failureReason = 'explore artifact review rejected the generated stories';
    const capturedInteractive = vi.fn().mockResolvedValue(undefined);
    const unavailableCodex = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: false,
      output: 'codex executable missing',
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: 'codex executable missing',
    }));
    const claudeFallback = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: true,
      output: 'claude recovered',
      exitCode: 0,
    }));
    const sessions = new ProviderSessionStore({
      createSessionId: (() => {
        let id = 0;
        return () => `recovery-${++id}`;
      })(),
    });
    const attempts = vi.fn();
    const runner = new DefaultStepRunner(
      {
        invoke: vi.fn(),
        invokeInteractive: capturedInteractive,
      },
      'captured-session',
      '/tmp/project',
      {
        mode: 'interactive',
        config: {
          llm_provider: ['claude', 'codex'],
          steps: { explore: { llm_provider: 'codex' } },
        },
        sessionStore: sessions,
        providerRuntimes: new ProviderRuntimeSet([
          interactiveRuntime('claude', claudeFallback),
          interactiveRuntime('codex', unavailableCodex),
        ]),
        configuredProviders: ['claude', 'codex'],
        providerAttempt: attempts,
        providerWarn: vi.fn(),
      },
    );

    await runner.resetSession('explore');
    await (
      runner.runInteractive as unknown as (
        step: StepName,
        context: { step: StepName; reason: string },
      ) => Promise<void>
    )('explore', { step: 'explore', reason: failureReason });

    // Each recovery candidate mints its own fresh session id; the store's
    // 'recovery-N' ids never reach a provider.
    const recoverySessionIds = [
      ...unavailableCodex.mock.calls,
      ...claudeFallback.mock.calls,
    ].map(([options]) => options.sessionId);
    expectUniqueFreshSessionIds(recoverySessionIds);
    expect({
      capturedCalls: capturedInteractive.mock.calls,
      codexCalls: unavailableCodex.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        interactive: options.interactive,
      })),
      claudeCalls: claudeFallback.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        interactive: options.interactive,
      })),
      attempts: attempts.mock.calls
        .filter(([, attempt]) => !('lifecycle' in attempt))
        .map(([step, attempt]) => ({ step, ...attempt })),
    }).toEqual({
      capturedCalls: [],
      codexCalls: [
        {
          prompt: expect.stringContaining(failureReason),
          sessionId: recoverySessionIds[0],
          resume: false,
          interactive: true,
        },
      ],
      claudeCalls: [
        {
          prompt: expect.stringContaining(failureReason),
          sessionId: recoverySessionIds[1],
          resume: false,
          interactive: true,
        },
      ],
      attempts: [
        expect.objectContaining({
          step: 'explore',
          provider: 'codex',
          outcome: 'unavailable',
          invoked: true,
        }),
        expect.objectContaining({
          step: 'explore',
          provider: 'claude',
          outcome: 'success',
          invoked: true,
        }),
      ],
    });
  });

  it('cold-starts legacy interactive recovery with the failed step and reason', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'legacy-session', '/tmp/project');
    const failureReason = 'manual test returned a failing acceptance scenario';

    await (
      runner.runInteractive as unknown as (
        step: StepName,
        context: { step: StepName; reason: string },
      ) => Promise<void>
    )('manual_test', { step: 'manual_test', reason: failureReason });

    const options = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect({
      prompt: options.prompt,
      resume: options.resume,
    }).toEqual({
      prompt: expect.stringMatching(new RegExp(`manual_test.*${failureReason}`, 's')),
      resume: false,
    });
  });

  it('states explicitly when interactive recovery captured no failure reason', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'legacy-session', '/tmp/project');

    await (
      runner.runInteractive as unknown as (
        step: StepName,
        context: { step: StepName; reason: string },
      ) => Promise<void>
    )('build', { step: 'build', reason: '  ' });

    const options = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect({
      prompt: options.prompt,
      resume: options.resume,
    }).toEqual({
      prompt: expect.stringMatching(/build.*no (failure )?reason (was )?captured/is),
      resume: false,
    });
  });

  it('dispatches the Codex policy default model and effort for the memory step', async () => {
    const provider = createMockProvider();
    const options = {
      modelPolicy: CODEX_MODEL_POLICY,
    } satisfies StepRunnerOptions;
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', options);

    await runner.run('memory', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts).toMatchObject({ model: 'gpt-5.6-luna', effort: 'low' });
  });

  it('all steps use invokeInteractive (stdio: inherit)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('explore', emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledOnce();
    expect(provider.invoke).not.toHaveBeenCalled();
  });

  it('passes correct prompt for explore', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('explore', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/explore');
  });

  it('renders provider-native skill syntax from the scalar provider key without changing interactive invocation semantics', async () => {
    const invocations = [] as Array<{
      providerKey: 'claude' | 'codex';
      invokeCalls: number;
      interactiveCalls: number;
      options: InvokeOptions;
    }>;

    for (const providerKey of ['claude', 'codex'] as const) {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(
        provider,
        'shared-session',
        '/wt/feature-x',
        {
          mode: 'interactive',
          featureDesc: 'Provider-native skill invocation',
          totalSteps: 14,
          config: { llm_provider: providerKey },
          providerKey,
        },
      );

      await runner.run('stories', emptyState);

      invocations.push({
        providerKey,
        invokeCalls: (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.length,
        interactiveCalls: (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls.length,
        options: (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions,
      });
    }

    const [claude, codex] = invocations;
    const invocationFields = ({
      systemPrompt,
      model,
      effort,
      cwd,
      sessionId,
      resume,
      dangerouslySkipPermissions,
      interactive,
    }: InvokeOptions) => ({
      systemPrompt,
      model,
      effort,
      cwd,
      sessionId,
      resume,
      dangerouslySkipPermissions,
      interactive,
    });
    const claudeInvocation = invocationFields(claude.options);
    const codexInvocation = invocationFields(codex.options);

    expect({
      prompts: invocations.map(({ providerKey, options }) => ({ providerKey, prompt: options.prompt })),
      routes: invocations.map(({ providerKey, invokeCalls, interactiveCalls }) => ({
        providerKey,
        invokeCalls,
        interactiveCalls,
      })),
      claudeInvocation,
      differingInvocationFields: Object.entries(claudeInvocation)
        .filter(([key, value]) => codexInvocation[key as keyof typeof codexInvocation] !== value)
        .map(([key]) => key),
    }).toEqual({
      prompts: [
        { providerKey: 'claude', prompt: '/stories' },
        { providerKey: 'codex', prompt: '$stories' },
      ],
      routes: [
        { providerKey: 'claude', invokeCalls: 0, interactiveCalls: 1 },
        { providerKey: 'codex', invokeCalls: 0, interactiveCalls: 1 },
      ],
      claudeInvocation: {
        systemPrompt: expect.stringContaining('Stories'),
        model: expect.any(String),
        effort: expect.any(String),
        cwd: '/wt/feature-x',
        sessionId: expect.any(String),
        resume: false,
        dangerouslySkipPermissions: false,
        interactive: true,
      },
      differingInvocationFields: ['sessionId'],
    });
  });

  it('renders Codex-native skill syntax for every eligible normal dispatch selected through provider candidates', async () => {
    const cases = [
      { step: 'bootstrap', prompt: '$bootstrap' },
      { step: 'memory', prompt: '$memory' },
      { step: 'assess', prompt: '$assess' },
      { step: 'explore', prompt: '$explore' },
      { step: 'prd', prompt: '$prd' },
      { step: 'stories', prompt: '$stories' },
      { step: 'conflict_check', prompt: '$conflict-check' },
      { step: 'plan', prompt: '$plan' },
      { step: 'coherence_check', prompt: '$coherence-check' },
      { step: 'architecture_diagram', prompt: '$architecture-diagram' },
      { step: 'architecture_review', prompt: '$architecture-review' },
      { step: 'worktree', prompt: '$conduct worktree' },
      { step: 'acceptance_specs', prompt: '$writing-system-tests' },
      { step: 'build', prompt: '$pipeline' },
      { step: 'manual_test', prompt: '$manual-test' },
      { step: 'prd_audit', prompt: '$prd-audit' },
      { step: 'architecture_review_as_built', prompt: '$architecture-review --as-built' },
      { step: 'retro', prompt: '$retro' },
      { step: 'finish', prompt: '$finish' },
    ] satisfies ReadonlyArray<{ step: StepName; prompt: string }>;
    const codexBoundary = vi.fn(
      async (_options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: 'done',
        exitCode: 0,
      }),
    );
    const codexProvider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: codexBoundary,
      invokeInteractive: codexBoundary,
    };
    const claudeProvider = createMockProvider();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: claudeProvider,
        policy: CLAUDE_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
      },
      {
        key: 'codex',
        provider: codexProvider,
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    let sessionSequence = 0;
    const sessions = new ProviderSessionStore({
      createSessionId: () => `codex-normal-${++sessionSequence}`,
    });
    const runner = new DefaultStepRunner(
      createMockProvider(),
      'legacy-session',
      '/tmp/project',
      {
        config: {
          llm_provider: ['claude', 'codex'],
          steps: Object.fromEntries(
            cases.map(({ step }) => [step, { llm_provider: 'codex' }]),
          ),
        } as HarnessConfig,
        sessionStore: sessions,
        providerRuntimes: runtimes,
        configuredProviders: ['claude', 'codex'],
      },
    );
    const observed: Array<{ step: StepName; prompt: string }> = [];

    for (const { step } of cases) {
      await runner.resetSession(step);
      await runner.run(step, emptyState);
      const options = codexBoundary.mock.calls.at(-1)?.[0] as InvokeOptions;
      observed.push({ step, prompt: options.prompt });
    }

    expect(observed).toEqual(cases);
  });

  // Worktree isolation: the spawned claude must run in the runner's projectDir,
  // not the daemon's cwd. Without this, daemon feature builds committed to the
  // main checkout's branch instead of the per-feature worktree branch.
  it('passes projectDir as cwd to the provider (collaborative path)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');
    await runner.run('explore', emptyState);
    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe('/wt/feature-x');
  });

  it('passes projectDir as cwd to the provider (autonomous path)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');
    await runner.run('build', emptyState); // build is autonomous → invoke()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe('/wt/feature-x');
  });

  // Task 3 (per-feature token accounting): the autonomous dispatch path must
  // forward the provider's tokenUsage and the resolved model string onto the
  // StepRunResult so downstream cost accounting can attribute usage per step.
  it('forwards tokenUsage and resolved model on successful autonomous run', async () => {
    const tokenUsage = {
      input: 100,
      output: 50,
      cacheCreation: 0,
      cacheRead: 0,
      costUsd: 0.0123,
    };
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
        tokenUsage,
      } satisfies InvokeResult),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('build', emptyState); // build is autonomous → invoke()

    expect(result.tokenUsage).toEqual(tokenUsage);
    expect(result.model).toBeTruthy();
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(result.model).toBe(opts.model);
  });

  it('passes correct prompt for build (pipeline)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    // Autonomous steps use invoke() (captured output) not invokeInteractive()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toMatch(/\/pipeline|\/tdd/);
  });

  // Regression: `remediate` is dispatched out-of-band when a prd_audit blocks
  // (conductor.ts). It's deliberately absent from the linear ALL_STEPS sequence,
  // so resolving its config/index/label threw "Unknown step: remediate" — which
  // the daemon caught and wrote to .pipeline/HALT, blocking autonomous SHIP
  // remediation entirely. run() must dispatch it like any other autonomous step.
  it('dispatches the out-of-band remediate step without throwing', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('remediate', emptyState);

    expect(result.success).toBe(true);
    // Autonomous → invoke(), and the prompt carries the /remediate command.
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/remediate');
    // No linear index → labelled header instead of "N/total".
    expect(opts.systemPrompt).toContain('Remediate');
  });

  it('dispatches a configured custom step skill command to the provider', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      config: {
        steps: {
          'maintain-documentation': {
            after: 'rebase',
            skill: '.agents/skills/maintain-documentation/SKILL.md',
            enforcement: 'gating',
            completion_artifact: '.pipeline/maintain-documentation-complete',
          },
        },
      } as unknown as HarnessConfig,
    });

    await runner.run('maintain-documentation' as StepName, emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '/maintain-documentation' }),
    );
  });

  it('preserves the raw slash prompt for a configured constructor custom step', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      config: {
        steps: {
          constructor: {
            after: 'rebase',
            skill: '.agents/skills/maintain-documentation/SKILL.md',
            enforcement: 'gating',
            completion_artifact: '.pipeline/constructor-complete',
          },
        },
      } as unknown as HarnessConfig,
    });

    await runner.run('constructor' as StepName, emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '/constructor' }),
    );
  });

  it('autonomous steps use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('collaborative steps do NOT use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('explore', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('in auto mode, collaborative steps DO skip permissions (no human to approve)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

    await runner.run('explore', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    // Otherwise the spawned claude launches in the user's default permission
    // mode (possibly `plan`), blocking the PRD write and looping the step.
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  describe('CONDUCT_DAEMON_AUTO_FINISH env marker', () => {
    const previousEnv = process.env.CONDUCT_DAEMON_AUTO_FINISH;

    afterEach(() => {
      if (previousEnv === undefined) delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      else process.env.CONDUCT_DAEMON_AUTO_FINISH = previousEnv;
    });

    it('sets CONDUCT_DAEMON_AUTO_FINISH=1 for the duration of an auto-mode finish dispatch, then clears it', async () => {
      delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      const provider = createMockProvider();
      let seenDuringDispatch: string | undefined;
      (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        seenDuringDispatch = process.env.CONDUCT_DAEMON_AUTO_FINISH;
        return { success: true, output: '', exitCode: 0 };
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

      await runner.run('finish', emptyState);

      expect(seenDuringDispatch).toBe('1');
      expect(process.env.CONDUCT_DAEMON_AUTO_FINISH).toBeUndefined();
    });

    it('does not set CONDUCT_DAEMON_AUTO_FINISH for other steps in auto mode', async () => {
      delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      const provider = createMockProvider();
      let seenDuringDispatch: string | undefined;
      (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        seenDuringDispatch = process.env.CONDUCT_DAEMON_AUTO_FINISH;
        return { success: true, output: '', exitCode: 0 };
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

      await runner.run('explore', emptyState);

      expect(seenDuringDispatch).toBeUndefined();
    });

    it('does not set CONDUCT_DAEMON_AUTO_FINISH for the finish step outside auto mode', async () => {
      delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      const provider = createMockProvider();
      let seenDuringDispatch: string | undefined;
      (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        seenDuringDispatch = process.env.CONDUCT_DAEMON_AUTO_FINISH;
        return { success: true, output: '', exitCode: 0 };
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.run('finish', emptyState);

      expect(seenDuringDispatch).toBeUndefined();
    });

    it('restores a pre-existing CONDUCT_DAEMON_AUTO_FINISH value after an auto-mode finish dispatch', async () => {
      process.env.CONDUCT_DAEMON_AUTO_FINISH = 'preexisting';
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

      await runner.run('finish', emptyState);

      expect(process.env.CONDUCT_DAEMON_AUTO_FINISH).toBe('preexisting');
    });
  });

  it('worktree is autonomous', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState);

    // Autonomous → invoke()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('stories is collaborative', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('stories', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('returns success on normal completion', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('explore', emptyState);

    expect(result.success).toBe(true);
  });

  it('returns failure when session throws', async () => {
    const provider = createMockProvider();
    (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('explore', emptyState);

    expect(result.success).toBe(false);
  });

  it('logs and surfaces the real thrown error instead of swallowing it (interactive dispatch)', async () => {
    const provider = createMockProvider();
    (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ECONNRESET: provider process died'),
    );
    const log = vi.fn();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { log });

    const result = await runner.run('explore', emptyState);

    expect(result).toEqual({
      success: false,
      output: 'Session for explore exited with error: ECONNRESET: provider process died',
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('ECONNRESET: provider process died'),
    );
  });

  it('logs and surfaces the real thrown error instead of swallowing it (provider-aware normal dispatch)', async () => {
    const log = vi.fn();
    const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => {
      throw new Error('candidate ladder exhausted: no live model');
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      log,
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async () => undefined))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
    });

    const result = await runner.run('build', emptyState);

    expect(result).toEqual({
      success: false,
      output: 'Session for build exited with error: candidate ladder exhausted: no live model',
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('candidate ladder exhausted: no live model'),
    );
  });

  it('does not resume legacy scalar steps', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState); // autonomous → invoke
    await runner.run('memory', emptyState);   // autonomous → invoke

    const call1 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    const call2 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[1][0] as InvokeOptions;
    expect(call1.resume).toBe(false);
    expect(call2.resume).toBe(false);
  });

  // --- Feature 1: Step-scoped system prompts ---

  it('step runner passes system prompt with step context', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    await runner.run('explore', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('[Conduct step 3/14]');
    expect(opts.systemPrompt).toContain('Feature: Add user auth');
  });

  it('collaborative step system prompt includes "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // explore is collaborative (not autonomous)
    await runner.run('explore', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Complete ONLY this step');
    expect(opts.systemPrompt).toContain('Explore');
  });

  it('autonomous step system prompt does NOT include "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // build is autonomous → invoke() path
    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Feature: Add user auth');
    expect(opts.systemPrompt).not.toContain('Complete ONLY this step');
  });

  // FINISH mechanics are coordinator-owned. The provider boundary is limited
  // to the one reader-facing PR-prose judgment, so no prompt can authorize
  // git/GitHub mutation or completion-marker writes.
  it('auto-mode finish prompt limits the provider to PR prose and excludes mechanics', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('PR title and body');
    expect(opts.systemPrompt).not.toContain('finish-record');
    expect(opts.systemPrompt).not.toContain('gh pr create');
    expect(opts.systemPrompt).not.toContain('git push');
  });

  // The authoring pass is the fix for a PR that reached FINISH with an
  // unauthored body: the provider is told to WRITE the prose from the diff,
  // and is given the authoring contract instead of a grading rubric.
  it('finish authoring pass mandates writing the body from the diff and names both hosts', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState, { finishProsePass: 'author' });

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('FINISH PR PROSE AUTHORING');
    expect(opts.systemPrompt).toContain('full diff');
    expect(opts.systemPrompt).toContain('base branch');
    expect(opts.systemPrompt).toContain('`/pr`');
    expect(opts.systemPrompt).toContain('`$pr`');
    // It authors; it does not grade, and it makes no publication mechanics.
    expect(opts.systemPrompt).not.toContain('revision_required');
    expect(opts.systemPrompt).not.toContain('gh pr create');
    expect(opts.systemPrompt).not.toContain('git push');
    expect(opts.systemPrompt).not.toContain('finish-record');
  });

  it('finish judgment pass keeps the bounded verdict contract and defers unauthored bodies', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState, { finishProsePass: 'judge' });

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).not.toContain('FINISH PR PROSE AUTHORING');
    expect(opts.systemPrompt).toContain('revision_required');
    expect(opts.systemPrompt).toContain('separate authoring pass');
  });

  it('auto-mode finish prompt has no pipeline-path-dependent mechanical instruction', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('PR title and body');
    expect(opts.systemPrompt).not.toContain('--pipeline-dir');
  });

  it('auto-mode finish prompt does not restore the retired finish-record command', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).not.toContain('conduct-ts finish-record');
  });

  it('auto-mode finish prompt still excludes hand-written terminal markers', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).not.toContain('write the single word');
  });

  it('auto-mode finish prompt remains mechanical-path-independent without pipelineDir', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).not.toContain('finish-record');
    expect(opts.systemPrompt).not.toContain('--pipeline-dir');
  });

  it('non-auto finish prompts retain operator intent but exclude mechanical commands', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      totalSteps: 14,
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    // finish, but not auto mode (collaborative path)
    await runner.run('finish', emptyState);
    const finishOpts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(finishOpts.systemPrompt).toContain('operator publication intent');
    expect(finishOpts.systemPrompt).not.toContain('finish-record');
    expect(finishOpts.systemPrompt).not.toContain('gh pr create');
    expect(finishOpts.systemPrompt).toContain('repair only that retained PR title/body once');
    expect(finishOpts.systemPrompt).toContain('exactly one JSON object');

    vi.clearAllMocks();

    const autoRunner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      totalSteps: 14,
    });
    await autoRunner.run('build', emptyState);
    const buildOpts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(buildOpts.systemPrompt).not.toContain('operator publication intent');
  });

  it('limits auto FINISH judgment authority to retained title/body repair with a typed result', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', { mode: 'auto' });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('may repair only that title/body');
    expect(opts.systemPrompt).toContain('"revision_required"');
    expect(opts.systemPrompt).toContain('Do not create, push, merge, or ready a PR');
    expect(opts.systemPrompt).toContain('do not alter labels, shipment evidence, or completion files');
  });

  // --- Feature 2: Session creation marker ---

  describe('session marker persistence', () => {
    let pipeDir: string;

    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'step-runner-'));
    });

    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('persists session-created marker after first success', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      // Marker file should exist
      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(true);
    });

    it('cold-starts a legacy scalar retry with a fresh session id', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);
      await runner.run('worktree', emptyState);

      const attempts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.map(
        ([options]) => options as InvokeOptions,
      );
      expect({
        resumes: attempts.map(({ resume }) => resume),
        sessionIdChanged: attempts[0].sessionId !== attempts[1].sessionId,
      }).toEqual({
        resumes: [false, false],
        sessionIdChanged: true,
      });
    });

    it('does not resume from an inherited session-created marker', async () => {
      // Pre-create the marker file
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');

      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('explore', emptyState);

      const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(false);
    });

    it('resetSession() overrides an inherited stale marker so the next step CREATES (no --resume)', async () => {
      // Reproduces the daemon worktree-reuse bug: a KEPT worktree carries a
      // stale `session-created` marker from the prior run, so a fresh runner's
      // lazy-init would set sessionStarted=true and `--resume` a brand-new
      // session id that was never created → "No conversation found" → "session
      // unavailable (expired or in use)". The conductor calls resetSession()
      // before every step (unconditional fresh-per-step); it must win over the stale
      // marker and force a create.
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');
      await writeFile(join(pipeDir, 'conduct-session-id'), 'stale-id', 'utf-8');

      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'fresh-id', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.resetSession();
      await runner.run('acceptance_specs', emptyState); // autonomous → invoke()

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(false);
    });

    it('does not replace the feature run id with a provider invocation id', async () => {
      await writeFile(join(pipeDir, 'conduct-session-id'), 'feature-run-id', 'utf-8');
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'my-session-id', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const sessionIdPath = join(pipeDir, 'conduct-session-id');
      const content = await readFile(sessionIdPath, 'utf-8');
      const invoked = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect({
        runId: content.trim(),
        providerIdIsSeparate: invoked.sessionId !== content.trim(),
      }).toEqual({
        runId: 'feature-run-id',
        providerIdIsSeparate: true,
      });
    });

    it('does not write marker when step fails', async () => {
      const provider = createMockProvider();
      // worktree is autonomous → invoke() path. Mock it to return failure.
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'step exited nonzero',
        exitCode: 1,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(false);
    });
  });

  // --- Feature 3: Step cooldown ---

  describe('step cooldown', () => {
    it('tracks call count across steps', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);
      await runner.run('memory', emptyState);

      expect(runner.callCount).toBe(2);
    });

    it('skips cooldown for the very first step', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);

      // No sleep before the first step
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it('applies cooldown after the first step', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);
      await runner.run('memory', emptyState);

      // Sleep called once before the second step
      expect(sleepSpy).toHaveBeenCalledOnce();
      expect(sleepSpy).toHaveBeenCalledWith(10000); // 10 seconds in ms
    });

    it('cooldown escalates after 10 calls', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 11 steps (first has no cooldown, steps 2-10 use base, step 11 uses 2x).
      // complexity is engine-managed, so it is excluded from runner.run paths.
      const steps: StepName[] = [
        'worktree', 'memory', 'explore', 'stories', 'conflict_check',
        'plan', 'architecture_diagram', 'architecture_review',
        'acceptance_specs', 'build', 'manual_test',
      ];
      for (const step of steps) {
        await runner.run(step, emptyState);
      }

      // 10 sleep calls (steps 2-11)
      expect(sleepSpy).toHaveBeenCalledTimes(10);
      // Last call (11th step, callCount=10 at that point) should use 2x cooldown
      expect(sleepSpy).toHaveBeenLastCalledWith(20000); // 2x base
    });

    it('cooldown escalates to 3x after 20 calls', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 5,
        sleepFn: sleepSpy,
      });

      // Simulate 21 calls by running same step repeatedly
      for (let i = 0; i < 21; i++) {
        await runner.run('worktree', emptyState);
      }

      // Last call (21st step, callCount=20 at that point) should use 3x cooldown
      expect(sleepSpy).toHaveBeenLastCalledWith(15000); // 3x * 5s
    });

    it('pins cooldown multiplier at callCount == 9 (still 1x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 10 steps: step 1 has no cooldown, steps 2-10 have cooldown
      // When step 10 runs, callCount == 9 (last value of 1x tier)
      for (let i = 0; i < 10; i++) {
        await runner.run('worktree', emptyState);
      }

      // 9 sleep calls (steps 2-10)
      expect(sleepSpy).toHaveBeenCalledTimes(9);
      // 10th step (callCount=9) should still use 1x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(10000); // 1x base
    });

    it('pins cooldown multiplier at callCount == 10 (escalates to 2x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 11 steps: when step 11 runs, callCount == 10 (first value of 2x tier)
      for (let i = 0; i < 11; i++) {
        await runner.run('worktree', emptyState);
      }

      // 10 sleep calls (steps 2-11)
      expect(sleepSpy).toHaveBeenCalledTimes(10);
      // 11th step (callCount=10) should use 2x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(20000); // 2x base
    });

    it('pins cooldown multiplier at callCount == 19 (still 2x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 20 steps: when step 20 runs, callCount == 19 (last value of 2x tier)
      for (let i = 0; i < 20; i++) {
        await runner.run('worktree', emptyState);
      }

      // 19 sleep calls (steps 2-20)
      expect(sleepSpy).toHaveBeenCalledTimes(19);
      // 20th step (callCount=19) should still use 2x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(20000); // 2x base
    });

    it('pins cooldown multiplier at callCount == 20 (escalates to 3x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 21 steps: when step 21 runs, callCount == 20 (first value of 3x tier)
      for (let i = 0; i < 21; i++) {
        await runner.run('worktree', emptyState);
      }

      // 20 sleep calls (steps 2-21)
      expect(sleepSpy).toHaveBeenCalledTimes(20);
      // 21st step (callCount=20) should use 3x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(30000); // 3x base
    });

    it('cooldown disabled (stepCooldown == 0) → no sleep regardless of call count', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 0,
        sleepFn: sleepSpy,
      });

      // Run 21 steps to exercise all boundary crossings.
      // With stepCooldown: 0, sleep should never be called regardless.
      for (let i = 0; i < 21; i++) {
        await runner.run('worktree', emptyState);
      }

      // No sleep calls at all when cooldown is disabled
      expect(sleepSpy).not.toHaveBeenCalled();
    });
  });

  describe('complexity assessment', () => {
    it('refuses to run() the complexity step (engine-managed)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await expect(runner.run('complexity' as StepName, emptyState)).rejects.toThrow(
        /engine/i,
      );
    });

    it('refuses to run() the rebase step (engine-managed)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await expect(runner.run('rebase' as StepName, emptyState)).rejects.toThrow(
        /engine/i,
      );
    });

    it('assessComplexity calls provider.invoke in print mode', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'Reasoning...\n\nTIER: M',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      const tier = await runner.assessComplexity();

      expect(provider.invoke).toHaveBeenCalledOnce();
      expect(provider.invokeInteractive).not.toHaveBeenCalled();
      expect(tier).toBe('M');
    });

    it('assessComplexity returns null when provider fails', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      expect(await runner.assessComplexity()).toBeNull();
    });

    it('assessComplexity returns null when output has no tier', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'I could not determine a clear tier from the design exploration.',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      expect(await runner.assessComplexity()).toBeNull();
    });
  });

  describe('parseSignalCountsFromOutput', () => {
    it('extracts all five signals from well-formed output', () => {
      const output = `MODELS: 12
INTEGRATIONS: 3
AUTH: 2
STATE_MACHINES: 4
STORIES: 25
TIER: L`;
      expect(parseSignalCountsFromOutput(output)).toEqual({
        models: 12,
        integrations: 3,
        auth: 2,
        stateMachines: 4,
        stories: 25,
      });
    });

    it('tolerates STATE MACHINES with space or hyphen', () => {
      expect(parseSignalCountsFromOutput('STATE MACHINES: 2').stateMachines).toBe(2);
      expect(parseSignalCountsFromOutput('STATE-MACHINES: 3').stateMachines).toBe(3);
      expect(parseSignalCountsFromOutput('STATEMACHINES: 1').stateMachines).toBe(1);
    });

    it('is case-insensitive and tolerates surrounding prose', () => {
      const output = `Here is my assessment.
models: 5
Some filler.
Integrations: 1
auth: 0
state_machines: 0
stories: 8
tier: m`;
      expect(parseSignalCountsFromOutput(output)).toEqual({
        models: 5,
        integrations: 1,
        auth: 0,
        stateMachines: 0,
        stories: 8,
      });
    });

    it('returns an empty object when no signals found', () => {
      expect(parseSignalCountsFromOutput('nothing useful')).toEqual({});
      expect(parseSignalCountsFromOutput('TIER: S')).toEqual({});
    });

    it('omits signals whose value is not a non-negative integer', () => {
      const output = `MODELS: abc
INTEGRATIONS: 2
AUTH: 1
STORIES: 10`;
      const parsed = parseSignalCountsFromOutput(output);
      expect(parsed.models).toBeUndefined();
      expect(parsed.integrations).toBe(2);
      expect(parsed.auth).toBe(1);
      expect(parsed.stories).toBe(10);
    });
  });

  describe('scoreComplexityFromCounts', () => {
    it('scores a Large project (many models + integrations)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 12,     // L
          integrations: 3, // L
          auth: 2,         // L
          stateMachines: 2, // L
          stories: 25,     // L
        }),
      ).toBe('L');
    });

    it('scores a Small project (trivial across the board)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 2,
          integrations: 0,
          auth: 0,
          stateMachines: 0,
          stories: 3,
        }),
      ).toBe('S');
    });

    it('breaks ties toward the higher tier (2S + 2L + 1M → L)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 2,        // S
          integrations: 0,  // S
          auth: 1,          // M
          stateMachines: 2, // L
          stories: 50,      // L
        }),
      ).toBe('L');
    });

    it('returns null when fewer than 3 signals are available', () => {
      expect(scoreComplexityFromCounts({})).toBeNull();
      expect(scoreComplexityFromCounts({ models: 5 })).toBeNull();
      expect(
        scoreComplexityFromCounts({ models: 5, integrations: 1 }),
      ).toBeNull();
    });

    it('scores with exactly 3 signals (borderline)', () => {
      // 3 signals: 1S + 1M + 1L → tie break toward L per assessTier
      expect(
        scoreComplexityFromCounts({ models: 2, integrations: 2, stories: 20 }),
      ).toBe('L');
    });
  });

  describe('assessComplexity deterministic scoring', () => {
    it('cold-starts legacy complexity assessment despite an inherited session marker', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'complexity-cold-start-'));
      const pipelineDir = join(dir, '.pipeline');
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(join(pipelineDir, 'session-created'), '1', 'utf-8');
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'MODELS: 2\nINTEGRATIONS: 0\nAUTH: 0\nTIER: S',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'legacy-session', dir, {
        pipelineDir,
      });

      try {
        await runner.assessComplexity();
        const options = (provider.invoke as ReturnType<typeof vi.fn>).mock
          .calls[0][0] as InvokeOptions;
        expect({
          resume: options.resume,
          freshSessionId: options.sessionId !== 'legacy-session',
        }).toEqual({ resume: false, freshSessionId: true });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('prefers count-based scoring over Claude letter (L despite TIER: S)', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: `MODELS: 15
INTEGRATIONS: 5
AUTH: 2
STATE_MACHINES: 3
STORIES: 40
TIER: S`,
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');
      expect(await runner.assessComplexity()).toBe('L');
    });

    it('falls back to Claude letter when <3 counts extracted', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: `MODELS: 2
TIER: M`,
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');
      expect(await runner.assessComplexity()).toBe('M');
    });
  });

  describe('parseTierFromOutput', () => {
    it.each([
      ['TIER: S', 'S'],
      ['TIER: M', 'M'],
      ['TIER: L', 'L'],
      ['tier: s', 'S'],
      ['Reasoning about scope...\n\nFinal answer\n\nTIER: L', 'L'],
      ['TIER: M\nsome trailing text\nTIER: L', 'L'], // last match wins
    ])('extracts tier from %j → %s', (output, expected) => {
      expect(parseTierFromOutput(output)).toBe(expected);
    });

    it('falls back to trailing standalone letter', () => {
      expect(parseTierFromOutput('Analysis done.\n\nM.')).toBe('M');
      expect(parseTierFromOutput('Analysis done.\n\nL')).toBe('L');
    });

    it('returns null when no tier is present', () => {
      expect(parseTierFromOutput('')).toBeNull();
      expect(parseTierFromOutput('no tier here')).toBeNull();
      expect(parseTierFromOutput('TIER: X')).toBeNull();
    });
  });

  describe('auth-failure detection', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-authfail-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('surfaces preflight non-ready authentication metadata when provider reports authFailure', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'Not logged in — operator OAuth token is expired',
        exitCode: 1,
        authFailure: true,
        authentication: {
          provider: 'codex',
          source: 'api-key',
          state: 'missing',
        },
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.authFailure).toBe(true);
      expect(result.authentication).toEqual({
        provider: 'codex',
        source: 'api-key',
        state: 'missing',
      });
    });

    it('preserves a provider permission denial for conductor-owned terminal handling', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'Codex permission review denied the required action.',
        exitCode: 1,
        permissionDenied: true,
        authentication: {
          provider: 'codex',
          source: 'cached-login',
          state: 'ready',
        },
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result).toMatchObject({
        success: false,
        permissionDenied: true,
        authentication: {
          provider: 'codex',
          source: 'cached-login',
          state: 'ready',
        },
      });
    });
  });

  describe('rate-limit detection', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-ratelimit-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('surfaces rateLimited=true when provider reports it', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limit hit, try again',
        exitCode: 1,
        rateLimited: true,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.rateLimited).toBe(true);
      // No marker file → default wait
      expect(result.waitSeconds).toBe(300);
    });

    it('sources wait seconds from provider result', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
        rateLimited: true,
        waitSeconds: 450,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.waitSeconds).toBe(450);
    });

    it('falls back to 300 seconds when provider omits waitSeconds', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
        rateLimited: true,
        // waitSeconds: undefined
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.waitSeconds).toBe(300);
    });

    it('surfaces sessionExpired=true when provider reports it', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'No conversation found with id abc',
        exitCode: 1,
        sessionExpired: true,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.sessionExpired).toBe(true);
    });
  });

  describe('resetSession', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-reset-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('deletes the marker and preserves the feature run id while the provider cold-starts', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // Simulate a prior successful autonomous run that wrote the marker.
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');
      await writeFile(join(pipeDir, 'conduct-session-id'), 'session-1', 'utf-8');

      await runner.resetSession();

      // Marker gone
      const stillExists = await access(join(pipeDir, 'session-created'))
        .then(() => true, () => false);
      expect(stillExists).toBe(false);

      await runner.run('worktree', emptyState);
      const invocation = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect({
        runId: (await readFile(join(pipeDir, 'conduct-session-id'), 'utf-8')).trim(),
        providerSessionChanged: invocation.sessionId !== 'session-1',
        resume: invocation.resume,
      }).toEqual({
        runId: 'session-1',
        providerSessionChanged: true,
        resume: false,
      });
    });

    it('tolerates resetSession when the marker never existed', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });
      await expect(runner.resetSession()).resolves.toBeUndefined();
    });

    it('after reset, next autonomous run uses --session-id (not --resume)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // First run — creates session
      await runner.run('worktree', emptyState);
      // Second run also cold-starts.
      await runner.run('memory', emptyState);

      // Reset and run again — should go back to resume=false. Use a
      // per-feature step (bootstrap/assess are project-level preludes, not in
      // ALL_STEPS — see runProjectPrelude).
      await runner.resetSession();
      await runner.run('acceptance_specs', emptyState);

      const calls = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0].resume).toBe(false);  // first
      expect(calls[1][0].resume).toBe(false);  // second
      expect(calls[2][0].resume).toBe(false);  // post-reset
    });
  });

  describe('interactive REPL dispatch for conversational steps', () => {
    const replSteps: StepName[] = [
      'explore',
      'stories',
      'plan',
      'architecture_review',
      'manual_test',
      'finish',
    ];

    for (const step of replSteps) {
      it(`${step}: passes interactive: true when mode is 'default'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'default',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(true);
      });

      it(`${step}: does NOT pass interactive: true when mode is 'auto'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'auto',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      });

      it(`${step}: passes interactive: true when mode is 'interactive'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'interactive',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(true);
      });
    }

    // FR-1-2: Test conversational steps NOT in INTERACTIVE_STEPS (like prd_audit)
    // should dispatch with interactive: true in mode='interactive' and
    // interactive: false in mode='default'
    it('prd_audit: passes interactive: false in mode default (not in INTERACTIVE_STEPS)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        mode: 'default',
      });

      await runner.run('prd_audit', emptyState);

      const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.interactive).toBe(false);
    });

    it('prd_audit: passes interactive: true in mode interactive (conversational, not one-shot)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        mode: 'interactive',
      });

      await runner.run('prd_audit', emptyState);

      const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.interactive).toBe(true);
    });

    // FR-2: Verify that steps in interactive mode continue to the next step normally
    it('after a conversational step completes in mode interactive, run advances to next step with same flow', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        mode: 'interactive',
      });

      const result1 = await runner.run('explore', emptyState);
      const result2 = await runner.run('stories', emptyState);

      // Both steps should complete successfully
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      // Both should have been dispatched with interactive: true
      const opts1 = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      const opts2 = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[1][0] as InvokeOptions;
      expect(opts1.interactive).toBe(true);
      expect(opts2.interactive).toBe(true);
    });

    it('complexity-adjacent one-shot steps stay print-mode even in default mode', async () => {
      const oneShotSteps: StepName[] = [
        'conflict_check',
        'architecture_diagram',
        'retro',
      ];
      for (const step of oneShotSteps) {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'default',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      }
    });

    // Verify that one-shot steps stay print-mode even in interactive mode
    it('one-shot steps stay print-mode even in interactive mode', async () => {
      const oneShotSteps: StepName[] = [
        'conflict_check',
        'architecture_diagram',
        'retro',
      ];
      for (const step of oneShotSteps) {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'interactive',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      }
    });

    it('default mode is the default when options.mode is absent', async () => {
      const provider = createMockProvider();
      // No options → mode defaults to 'default'
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.run('explore', emptyState);

      const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.interactive).toBe(true);
    });
  });

  describe('model fallback ladder (autonomous steps)', () => {
    it('falls back to opus when fable is marked dead, one attempt total', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
        invokeInteractive: vi.fn().mockResolvedValue(undefined),
      };
      // Force the step's configured model to 'fable' so we can exercise the
      // ladder's fallback-to-opus path deterministically.
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        modelOverride: 'fable',
      });
      // Simulate fable already known-dead from a prior invocation in this process.
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('fable');

      const result = await runner.run('build', emptyState); // build is autonomous → invoke()

      expect(result.success).toBe(true);
      expect(invoke).toHaveBeenCalledOnce();
      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.model).toBe('opus');
    });

    it('returns ordinary success:false when all ladder models are dead', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: false,
        output: 'no models available',
        exitCode: 1,
        modelUnavailable: true,
      });
      const provider: LLMProvider = {
        invoke,
        invokeInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        modelOverride: 'fable',
      });
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('fable');
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('opus');
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('sonnet');

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(false);
    });

    it('interactive dispatch substitutes a live model when the configured one is dead', async () => {
      const invokeInteractive = vi.fn().mockResolvedValue(undefined);
      const provider: LLMProvider = {
        invoke: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
        invokeInteractive,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        modelOverride: 'fable',
        mode: 'auto',
      });
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('fable');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // explore is collaborative (not in AUTONOMOUS_STEPS) → invokeInteractive()
      await runner.run('explore', emptyState);

      expect(invokeInteractive).toHaveBeenCalledOnce();
      const opts = invokeInteractive.mock.calls[0][0] as InvokeOptions;
      expect(opts.model).toBe('opus');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Downgraded from fable to opus'),
      );
      warnSpy.mockRestore();
    });
  });

  // ── build_review one-shot grader dispatch (jstoup111/ai-conductor#324, Task 11) ──
  // build_review is a fresh, isolated grader session — never resumes the
  // conductor's own session (constructor sessionId 'session-1'). Follows the
  // resolveRebaseConflict one-shot pattern (step-runners.ts:594-610).
  describe('build_review one-shot dispatch', () => {
    let dir: string;
    let planPath: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-runner-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan\n\nDo the thing.\n', 'utf-8');
    });

    it('has no provider runner for the retired wiring_check step', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
      });

      const result = await runner.run('wiring_check', emptyState);

      expect(result.success).toBe(false);
      expect(provider.invoke).not.toHaveBeenCalled();
      expect(provider.invokeInteractive).not.toHaveBeenCalled();
    });

    it('retains one public build_review step while delegating fan-out orchestration without a legacy provider call', async () => {
      const provider = createMockProvider();
      const coordinate = vi.fn(async () => ({ success: true, output: 'five rubric branches settled' }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(), planPath,
        buildReviewCoordinator: coordinate,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
          } as never),
        },
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true, output: 'five rubric branches settled',
      });
      expect(coordinate).toHaveBeenCalledOnce();
      expect(provider.invoke).not.toHaveBeenCalled();
    });

    it('materializes checkout-local dependencies before uuid- and execa-importing counterfactual selectors run', async () => {
      const repository = await mkdtemp(join(tmpdir(), 'build-review-checkout-dependencies-'));
      const featureRoot = join(repository, '.worktrees', 'feature');
      const selector = 'src/conductor/spec/example_spec.mjs';
      const sourceDependencies = join(featureRoot, 'src/conductor/node_modules');
      const selectorMarker = join(repository, 'counterfactual-selector-ran');
      const selectorMarkerEnv = 'BUILD_REVIEW_COUNTERFACTUAL_SELECTOR_MARKER';
      const priorSelectorMarker = process.env[selectorMarkerEnv];
      let checkoutRoot: string | undefined;
      const observedProjections: Array<{ preflightEvidence: { scopedRun?: { failureExcerpt?: string } } }> = [];
      try {
        await execa('git', ['init', '-q', '-b', 'main'], { cwd: repository });
        await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
        await execa('git', ['config', 'user.name', 'Test'], { cwd: repository });
        await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: repository });
        await writeFile(join(repository, '.gitignore'), '.pipeline/\nnode_modules/\n');
        await mkdir(join(repository, 'src/conductor/src'), { recursive: true });
        await mkdir(join(repository, 'src/conductor/spec'), { recursive: true });
        await mkdir(join(repository, '.docs/plans'), { recursive: true });
        await writeFile(join(repository, '.docs/plans/feature.md'), `### Task 1: distinguish the selector\n- Update ${selector}.\n`);
        await writeFile(join(repository, 'src/conductor/src/example.mjs'), 'export const answer = 1;\n');
        await writeFile(join(repository, selector), "import { v4 as uuidv4 } from 'uuid';\nimport { answer } from '../src/example.mjs';\nif (!uuidv4() || answer !== 1) process.exit(1);\n");
        await execa('git', ['add', '.'], { cwd: repository });
        await execa('git', ['commit', '-q', '-m', 'base behavior'], { cwd: repository });
        await execa('git', ['remote', 'add', 'origin', repository], { cwd: repository });
        await execa('git', ['update-ref', 'refs/remotes/origin/main', 'refs/heads/main'], { cwd: repository });
        await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: repository });
        await mkdir(join(repository, '.worktrees'), { recursive: true });
        await execa('git', ['worktree', 'add', '-q', '-b', 'feature/proof', featureRoot], { cwd: repository });
        await writeFile(join(featureRoot, 'src/conductor/src/example.mjs'), 'export const answer = 2;\n');
        await writeFile(join(featureRoot, selector), "import { writeFile } from 'node:fs/promises';\nimport { v4 as uuidv4 } from 'uuid';\nimport { execa } from 'execa';\nimport { answer } from '../src/example.mjs';\nif (!uuidv4() || !execa || answer !== 2) { await writeFile(process.env.BUILD_REVIEW_COUNTERFACTUAL_SELECTOR_MARKER, 'selector-loaded-checkout-dependencies'); process.exit(1); }\n");
        await execa('git', ['add', 'src/conductor'], { cwd: featureRoot });
        await execa('git', ['commit', '-q', '-m', 'change behavior and selector'], { cwd: featureRoot });
        await mkdir(join(sourceDependencies, 'uuid'), { recursive: true });
        await writeFile(join(sourceDependencies, 'uuid/package.json'), '{"name":"uuid","type":"module","exports":"./index.mjs"}\n');
        await writeFile(join(sourceDependencies, 'uuid/index.mjs'), "export function v4() { return 'fixture-uuid'; }\n");
        await mkdir(join(sourceDependencies, 'execa'), { recursive: true });
        await writeFile(join(sourceDependencies, 'execa/package.json'), '{"name":"execa","type":"module","exports":"./index.mjs"}\n');
        await writeFile(join(sourceDependencies, 'execa/index.mjs'), 'export function execa() {}\n');

        const provider: LLMProvider = {
          invoke: vi.fn(async (options) => {
            const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!) as typeof observedProjections[number];
            observedProjections.push(projection);
            return { success: true, exitCode: 0, output: JSON.stringify({
              kind: 'judged', rubric: 'tautology', lapId: (projection as any).lapId,
              snapshotDigest: (projection as any).snapshotDigest, contractVersion: 'v1', findings: [],
            }) };
          }),
          invokeInteractive: vi.fn().mockResolvedValue(undefined),
        };
        const gitRunner = async (args: string[]) => {
          if (args[0] === 'worktree' && args[1] === 'add') checkoutRoot = args[3];
          if (args[0] === 'worktree' && args[1] === 'remove') return { exitCode: 0, stdout: '', stderr: '' };
          const result = await execa('git', args, { cwd: featureRoot, reject: false });
          return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
        };
        const head = (await execa('git', ['rev-parse', 'HEAD'], { cwd: featureRoot })).stdout;
        process.env[selectorMarkerEnv] = selectorMarker;
        const runner = new DefaultStepRunner(provider, 'checkout-proof', featureRoot, {
          gitRunner,
          planPath: join(featureRoot, '.docs/plans/feature.md'),
          pipelineDir: join(featureRoot, '.pipeline'),
          config: { test_suite: { scoped_command: 'node {selectors}' }, build_review: {
            enabled: true, perTaskFloor: false,
            rubrics: { tautology: { enabled: true }, scope: { enabled: false }, rootCause: { enabled: false }, completeness: { enabled: false } },
          } } as HarnessConfig,
          buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS', fingerprint: 'proof' } } as never) },
        });

        await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({ success: true });
        expect(checkoutRoot).toBe(join(featureRoot, '.pipeline', 'build-review-preflight', head));
        const checkoutDependencies = join(checkoutRoot!, 'src/conductor/node_modules');
        expect((await lstat(checkoutDependencies)).isSymbolicLink()).toBe(true);
        expect(await realpath(checkoutDependencies)).toBe(await realpath(sourceDependencies));
        const checkoutCommandDependencies = join(checkoutRoot!, 'node_modules');
        expect((await lstat(checkoutCommandDependencies)).isSymbolicLink()).toBe(true);
        expect(await realpath(checkoutCommandDependencies)).toBe(await realpath(sourceDependencies));
        expect(await readFile(selectorMarker, 'utf8')).toBe('selector-loaded-checkout-dependencies');
        expect(observedProjections[0]).toMatchObject({
          preflightEvidence: {
            classification: 'red',
            scopedRun: {
              exitCode: 1,
              runKind: 'nonzero-exit',
            },
          },
        });
      } finally {
        if (priorSelectorMarker === undefined) delete process.env[selectorMarkerEnv];
        else process.env[selectorMarkerEnv] = priorSelectorMarker;
        await rm(repository, { recursive: true, force: true });
      }
    });

    it('writes the raw aggregate but returns and emits the shared effective verdict', async () => {
      const provider = createMockProvider();
      const events = { emit: vi.fn(async () => undefined) } as any;
      let rawAggregate: unknown;
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(), planPath, events,
        buildReviewEffectiveResolver: vi.fn(async (_projectRoot, aggregate) => {
          rawAggregate = aggregate;
          return {
            ok: true as const,
            feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
            effective: {
              rawVerdict: 'FAIL' as const, verdict: 'PASS' as const, acceptedFindingIds: ['accepted'], unresolvedFindingIds: [],
              skippedRubrics: [], infrastructureFailureRubrics: [],
            },
          };
        }),
        ...currentBuildReviewProof(),
      });
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (branch: any, projection: any) => ({
        kind: 'judged', rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: 'v3',
        findings: branch.rubric === 'scope' ? [{
          concernKind: 'out-of-plan-change', summary: 'The changed path is outside the approved plan.',
          evidenceLocations: ['src/example.ts:1'],
          anchor: { rubric: 'scope', path: 'src/example.ts', relation: 'out-of-plan-change' },
        }] : [],
      }));

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({ success: true });
      expect(JSON.parse(await readFile(join(dir, '.pipeline/build-review.json'), 'utf8'))).toMatchObject(rawAggregate as object);
      expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'build_review_outer_verdict', rawVerdict: 'FAIL', effectiveVerdict: 'PASS',
      }));
    });

    it('settles missing current-lap branch artifacts as a blocking infrastructure failure', async () => {
      const provider = createMockProvider();
      const events = { emit: vi.fn(async () => undefined) } as any;
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(), planPath, events,
        buildReviewArtifactReader: async () => undefined,
        ...currentBuildReviewProof(),
      });
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (branch: any, projection: any) => ({
        kind: 'judged', rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      }));

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({ success: false });
      expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'build_review_outer_verdict', rawVerdict: 'FAIL', effectiveVerdict: 'FAIL',
      }));
      expect(JSON.parse(await readFile(join(dir, '.pipeline/build-review.json'), 'utf8'))).toMatchObject({
        results: { scope: { kind: 'infrastructure-failure', reason: 'artifact-read-failed' } },
      });
    });

    it.each([
      {
        // #1682: tautology defaults to disabled; only the other three rubrics dispatch.
        name: 'build_review is absent and defaults to the three enabled rubrics (tautology off, #1682)',
        config: { wiring: { entry_points: ['src/index.ts'] } } as HarnessConfig,
        expectedInvokeCalls: 6, // 3 rubrics x (1 dispatch + 1 bounded shape-repair)
        expectTautology: false,
      },
      {
        name: 'a partial rubric override inherits the remaining enabled rubrics',
        config: {
          build_review: {
            rubrics: { scope: { model: 'opus' }, tautology: { enabled: true } },
          },
          wiring: { entry_points: ['src/index.ts'] },
        } as HarnessConfig,
        expectedInvokeCalls: 8, // 4 rubrics x (1 dispatch + 1 bounded shape-repair)
        expectTautology: true,
      },
    ])('uses the production rubric coordinator when $name', async ({ config, expectedInvokeCalls, expectTautology }) => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        config,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
          } as never),
        },
      });

      await runner.run('build_review', emptyState);

      expect(provider.invoke).toHaveBeenCalledTimes(expectedInvokeCalls);
      const prompts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.map(([options]) => options.prompt);
      expect(prompts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Build Review Scope rubric'),
          expect.stringContaining('Build Review Root Cause rubric'),
          expect.stringContaining('Build Review Completeness rubric'),
        ]),
      );
      if (expectTautology) {
        expect(prompts).toEqual(expect.arrayContaining([expect.stringContaining('Build Review Tautology rubric')]));
      } else {
        expect(prompts.join('\n')).not.toContain('Build Review Tautology rubric');
      }
    });

    it('does not dispatch the coordinator or legacy scalar grader when the whole gate is disabled', async () => {
      const provider = createMockProvider();
      const coordinate = vi.fn(async () => ({ success: true, output: 'unexpected coordinator dispatch' }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        config: { build_review: { enabled: false } } as HarnessConfig,
        buildReviewCoordinator: coordinate,
        ...currentBuildReviewProof(),
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
        output: 'build_review disabled',
      });
      expect(coordinate).not.toHaveBeenCalled();
      expect(provider.invoke).not.toHaveBeenCalled();
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    function scriptedGit() {
      const git = async (args: string[]) => {
        if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
        if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
        if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/x b/x\n', stderr: '' };
        return { exitCode: 1, stdout: '', stderr: '' };
      };
      return git;
    }

    // #1682: tautology defaults off; these tests exercise four-rubric fan-out mechanics.
    function tautologyOptIn() {
      return {
        config: { build_review: { rubrics: { tautology: { enabled: true } } } } as HarnessConfig,
      };
    }

    function currentBuildReviewProof() {
      return {
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
          } as never),
        },
      };
    }

    async function prepareContainmentRepo(
      changedPaths: string[],
      commitMessage: string,
      declaredPath = 'config.ts',
    ): Promise<string> {
      await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
      writeFileSync(planPath, `### Task 3: Config only\n**Files:** ${declaredPath}\n`);
      const declaredDirectory = declaredPath.slice(0, declaredPath.lastIndexOf('/'));
      if (declaredDirectory !== '') await mkdir(join(dir, declaredDirectory), { recursive: true });
      writeFileSync(join(dir, declaredPath), 'base\n');
      await execa('git', ['add', declaredPath], { cwd: dir });
      await execa('git', ['commit', '-q', '-m', 'base'], { cwd: dir });
      await execa('git', ['remote', 'add', 'origin', dir], { cwd: dir });
      await execa('git', ['update-ref', 'refs/remotes/origin/main', 'refs/heads/main'], { cwd: dir });
      await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: dir });
      await execa('git', ['checkout', '-q', '-b', 'feature/containment'], { cwd: dir });
      for (const path of changedPaths) {
        const directory = path.slice(0, path.lastIndexOf('/'));
        if (directory !== '') await mkdir(join(dir, directory), { recursive: true });
        writeFileSync(join(dir, path), `${path}\n`);
      }
      await execa('git', ['add', '--', ...changedPaths], { cwd: dir });
      await execa('git', ['commit', '-q', '-m', commitMessage], { cwd: dir });
      return (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    }

    it('passes accepted scope-widening evidence into the isolated grader prompt', async () => {
      const sha = await prepareContainmentRepo(
        ['shared.ts'],
        'widen shared parser\n\nTask: 3\nScope: shared.ts — shared parser changes atomically',
        'engine/config.ts',
      );
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: '{"verdict":"PASS"}',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(
        { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) },
        'session-1',
        dir,
        {
          gitRunner: makeGitRunner(dir),
          planPath,
          pipelineDir: join(dir, '.pipeline'),
          config: { build_review: { scopeContainmentEnforced: true, rubrics: { tautology: { enabled: true } } } } as HarnessConfig,
          ...currentBuildReviewProof(),
        },
      );

      await runner.run('build_review', emptyState);

      const prompts = invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt).join('\n');
      // 4 rubrics x (1 dispatch + 1 bounded shape-repair turn for the unparseable output)
      expect(invoke).toHaveBeenCalledTimes(8);
      expect(prompts).toContain('shared.ts');
      expect(prompts).toContain('shared parser changes atomically');
      expect(prompts).toContain('Task 3');
      expect(prompts).toContain(sha);
      const scopePrompt = invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt)
        .find((prompt) => prompt.includes('"rubric":"scope"')) ?? '';
      expect(scopePrompt).toContain('shared parser changes atomically');
      expect(invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt)
        .filter((prompt) => !prompt.includes('"rubric":"scope"')).join('\n'))
        .not.toContain('shared parser changes atomically');
    });

    it('passes derived scope-widening evidence into the isolated grader prompt with provenance', async () => {
      const sha = await prepareContainmentRepo(
        ['other/artifacts.ts', 'other/changelog-pr-finalizer-cli.ts'],
        'out of scope\n\nTask: 3',
      );
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: '{"verdict":"PASS"}',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(
        { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) },
        'session-1',
        dir,
        {
          gitRunner: makeGitRunner(dir),
          planPath,
          pipelineDir: join(dir, '.pipeline'),
          log: (message) => console.warn(message),
          config: { build_review: { scopeContainmentEnforced: true, rubrics: { tautology: { enabled: true } } } } as HarnessConfig,
          ...currentBuildReviewProof(),
        },
      );

      await runner.run('build_review', emptyState);

      const scopePrompt = invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt)
        .find((prompt) => prompt.includes('"rubric":"scope"')) ?? '';
      expect(scopePrompt).toContain('other/artifacts.ts');
      expect(scopePrompt).toContain('other/changelog-pr-finalizer-cli.ts');
      expect(scopePrompt).toContain('out of scope');
      expect(scopePrompt).toContain('"taskId":"3"');
      expect(scopePrompt).toContain(sha);
      // Commit-message-derived widenings must carry their derived provenance
      // flag into the grader prompt, not just path/rationale/task/sha.
      expect(scopePrompt).toContain('"derived":true');
    });

    it('keeps grader failure output separate from derived scope-widening evidence', async () => {
      const sha = await prepareContainmentRepo(
        ['other/artifacts.ts', 'other/changelog-pr-finalizer-cli.ts'],
        'out of scope\n\nTask: 3',
      );
      const invoke = vi.fn().mockResolvedValue({
        success: false,
        output: 'grader exited before writing a verdict',
        exitCode: 1,
      });
      const runner = new DefaultStepRunner(
        { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) },
        'session-1',
        dir,
        {
          gitRunner: makeGitRunner(dir),
          planPath,
          pipelineDir: join(dir, '.pipeline'),
          ...currentBuildReviewProof(),
          config: { build_review: { scopeContainmentEnforced: true } },
        },
      );

      const result = await runner.run('build_review', emptyState);
      const output = result.output ?? '';
      const scopePrompt = invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt)
        .find((prompt) => prompt.includes('"rubric":"scope"')) ?? '';

      expect(result.success).toBe(false);
      expect(output).not.toContain('out of scope');
      expect(output).toContain('containment-floor: hook-events ledger is unrecorded');
      expect(scopePrompt).toContain('other/artifacts.ts');
      expect(scopePrompt).toContain('other/changelog-pr-finalizer-cli.ts');
      expect(scopePrompt).toContain('out of scope');
      expect(scopePrompt).toContain('"taskId":"3"');
      expect(scopePrompt).toContain(sha);
    });

    it('keeps the widened floor active while containment evidence is disabled', async () => {
      await prepareContainmentRepo(['src/engine/config.test.ts'], 'test sibling\n\nTask: 3', 'src/engine/config.ts');
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const runner = new DefaultStepRunner(
        { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) },
        'session-1',
        dir,
        {
          gitRunner: makeGitRunner(dir),
          planPath,
          pipelineDir: join(dir, '.pipeline'),
          ...currentBuildReviewProof(),
          config: { build_review: { scopeContainmentEnforced: false } },
        },
      );

      await runner.run('build_review', emptyState);

      const prompts = invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt).join('\n');
      const floor = JSON.parse(await readFile(join(dir, '.pipeline', 'containment-floor.json'), 'utf8'));
      expect(floor.acceptedWidenings).toEqual([]);
      expect(floor.skipNotes).toEqual([]);
      expect(prompts).not.toContain('test sibling');
      expect(evaluateScopeContainment({
        stagedPaths: ['src/engine/config.test.ts'],
        task: { id: '3', status: 'in_progress', files: ['src/engine/config.ts'] },
      })).toEqual({ allowed: true });
    });

    it('leaves no verdict artifact after a vocabulary rejection survives its repair turn', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          kind: 'judged', rubric: 'scope', contractVersion: 'v2', lapId: 'lap-head',
          snapshotDigest: 'sha256:source', findings: [{
            concernKind: 'other', summary: 'A rejected catch-all.',
            evidenceLocations: ['src/example.ts:1'],
            anchor: { rubric: 'scope', path: 'src/example.ts', relation: 'other' },
          }],
        }),
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(
        { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) },
        'session-1',
        dir,
        { gitRunner: scriptedGit(), planPath, ...tautologyOptIn(), ...currentBuildReviewProof() },
      );

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      await expect(access(join(dir, '.pipeline/build-review.json'))).rejects.toThrow();
      expect(invoke).toHaveBeenCalledTimes(8);
      const ledger = await readKickbackLedger(dir);
      expect(ledger.gates.build_review?.count ?? 0).toBe(0);
      expect(ledger.gates.build_review?.cumulative ?? 0).toBe(0);
    });

    it('dispatches every rubric with a fresh uuid and resume:false, never the constructor session', async () => {
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        ...tautologyOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      // 4 rubrics x (1 dispatch + 1 bounded shape-repair turn for the unparseable output)
      expect(invoke).toHaveBeenCalledTimes(8);
      for (const [options] of invoke.mock.calls) {
        const opts = options as InvokeOptions;
        expect(opts.resume).toBe(false);
        expect(opts.sessionId).not.toBe('session-1');
        expect(opts.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('resolves the feature\'s own plan by featureDesc stem, not the alphabetically-last plan file (#788)', async () => {
      const { mkdir } = await import('node:fs/promises');
      const plansDir = join(dir, '.docs', 'plans');
      await mkdir(plansDir, { recursive: true });
      // Unrelated plan that sorts AFTER the feature's own plan alphabetically.
      await writeFile(
        join(plansDir, 'writing-system-tests-red-exit-gate.md'),
        '# Unrelated Plan\n\nWrong plan.\n',
        'utf-8',
      );
      await writeFile(
        join(plansDir, 'block-edits-to-docs-spec-artifacts-during-build-an.md'),
        '# Correct Plan\n\nGrade against this one.\n',
        'utf-8',
      );

      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        featureDesc: 'block-edits-to-docs-spec-artifacts-during-build-an',
        ...tautologyOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      const prompts = invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt).join('\n');
      // 4 rubrics x (1 dispatch + 1 bounded shape-repair turn for the unparseable output)
      expect(invoke).toHaveBeenCalledTimes(8);
      expect(prompts).toContain('Grade against this one.');
      expect(prompts).not.toContain('Wrong plan.');
    });

    // Task 4 (build-review-grades-plan-vs-diff-against-a-stale-o): base-
    // freshness telemetry, carried on StepRunResult so the conductor can
    // emit a `build_review_base` event without step-runners.ts owning event
    // emission itself.
    it('attaches baseFreshness from assembleBuildReviewInputs when the verdict is invalid', async () => {
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        ...tautologyOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      // 4 rubrics x (1 dispatch + 1 bounded shape-repair turn for the unparseable output)
      expect(invoke).toHaveBeenCalledTimes(8);
      expect(result.baseFreshness).toEqual({
        mergeBase: 'abc123',
        trackingRefSha: null,
        remoteHeadSha: null,
        fresh: false,
      });
    });

    // Task 24 (rebase-invalidated-test-failures-never-reach-build): the
    // middle leg of grading provenance — whatever assembly classified must
    // reach the conductor on StepRunResult, or the event is never emitted.
    it('carries the assembled grading provenance through to the conductor', async () => {
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        ...tautologyOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.repairProvenance).toEqual({ disposition: 'none_warranted' });
      // 4 rubrics x (1 dispatch + 1 bounded shape-repair turn for the unparseable output)
      expect(invoke).toHaveBeenCalledTimes(8);
    });

    it('attaches baseFreshness even on a ladder-exhausted failure (fire-and-forget telemetry)', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: false,
        output: 'no models available',
        exitCode: 1,
        modelUnavailable: true,
      });
      const provider: LLMProvider = { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        ...tautologyOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(4);
      expect(result.baseFreshness).toEqual({
        mergeBase: 'abc123',
        trackingRefSha: null,
        remoteHeadSha: null,
        fresh: false,
      });
    });

    it('does not set baseFreshness when input assembly itself fails', async () => {
      const invoke = vi.fn();
      const provider: LLMProvider = { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) };
      const failingGit = async () => ({ exitCode: 1, stdout: '', stderr: 'no merge base' });
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: failingGit,
        planPath,
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      expect(result.baseFreshness).toBeUndefined();
      expect(invoke).not.toHaveBeenCalled();
    });

    it('ladder-exhausted (all retries fail) reports step failure, never PASS', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: false,
        output: 'no models available',
        exitCode: 1,
        modelUnavailable: true,
      });
      const provider: LLMProvider = { invoke, invokeInteractive: vi.fn().mockResolvedValue(undefined) };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
    });

  });

  describe('resolveSetupFailure one-shot dispatch', () => {
    it('assembles a fresh session with uuid and calls provider with output tail in prompt', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
        invokeInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      const result = await runner.resolveSetupFailure({
        worktreePath: '/wt/feature-x',
        outputTail: 'npm ERR! Something went wrong',
        slug: 'my-feature',
      });

      expect(result.attempted).toBe(true);
      expect(invoke).toHaveBeenCalledOnce();

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      // Must be a fresh session, not the constructor's session
      expect(opts.sessionId).not.toBe('session-1');
      expect(opts.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      // Must use resume:false for fresh session
      expect(opts.resume).toBe(false);
      // Prompt must contain the output tail
      expect(opts.prompt).toContain('npm ERR! Something went wrong');
      // System prompt must be present
      expect(opts.systemPrompt).toBeTruthy();
      expect(opts.systemPrompt).toContain('docker compose up -d --no-recreate');
      expect(opts.systemPrompt).toContain('Do not stop, restart, or tear down Docker');
    });

    it('respects the AI_CONDUCTOR_NO_REAL_EXEC kill-switch in tests', async () => {
      const originalEnv = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      try {
        process.env.AI_CONDUCTOR_NO_REAL_EXEC = '1';
        const invoke = vi.fn().mockResolvedValue({
          success: true,
          output: 'done',
          exitCode: 0,
        });
        const provider: LLMProvider = {
          invoke,
          invokeInteractive: vi.fn().mockResolvedValue(undefined),
        };
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

        const result = await runner.resolveSetupFailure({
          worktreePath: '/wt/feature-x',
          outputTail: 'error output',
          slug: 'my-feature',
        });

        expect(result.attempted).toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.AI_CONDUCTOR_NO_REAL_EXEC = originalEnv;
        } else {
          delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        }
      }
    });

    it('passes dangerouslySkipPermissions=true like other one-shot fix-session patterns', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
        invokeInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.resolveSetupFailure({
        worktreePath: '/wt/feature-x',
        outputTail: 'error',
        slug: 'my-feature',
      });

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.dangerouslySkipPermissions).toBe(true);
    });

    it('sets cwd to the worktreePath', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
        invokeInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.resolveSetupFailure({
        worktreePath: '/wt/feature-x',
        outputTail: 'error',
        slug: 'my-feature',
      });

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.cwd).toBe('/wt/feature-x');
    });
  });

  describe('resolveCiFailure one-shot dispatch', () => {
    it('invokes the model ladder once with resume:false, dangerouslySkipPermissions:true, cwd=worktreePath, and the hint in the prompt', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
        invokeInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.resolveCiFailure({
        worktreePath: '/wt/feature-x',
        prUrl: 'https://github.com/org/repo/pull/42',
        hint: 'TypeError: Cannot read properties of undefined (reading \'foo\')',
        slug: 'my-feature',
      });

      expect(invoke).toHaveBeenCalledOnce();

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(false);
      expect(opts.dangerouslySkipPermissions).toBe(true);
      expect(opts.cwd).toBe('/wt/feature-x');
      expect(opts.prompt).toContain("TypeError: Cannot read properties of undefined (reading 'foo')");
    });
  });
});

describe('extractJudgedResultCandidate', () => {
  const judged = { kind: 'judged', rubric: 'scope', contractVersion: 'v1', findings: [] };

  it('parses raw JSON output', () => {
    expect(extractJudgedResultCandidate(JSON.stringify(judged))).toEqual(judged);
  });

  it('parses JSON wrapped in a markdown fence', () => {
    expect(extractJudgedResultCandidate('Here is the verdict:\n```json\n' + JSON.stringify(judged) + '\n```\n')).toEqual(judged);
  });

  it('parses JSON surrounded by prose', () => {
    expect(extractJudgedResultCandidate('The scope review found no issues.\n' + JSON.stringify(judged) + '\nLet me know if you need anything else.')).toEqual(judged);
  });

  it('returns undefined when no candidate parses', () => {
    expect(extractJudgedResultCandidate('no json here at all')).toBeUndefined();
  });
});

describe('build_review rubric dispatch: validate-and-repair loop', () => {
  const lapId = 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8';
  const snapshotDigest = 'sha256:434fa33612c7d7188d5ba5398a748b54a28400bcb534988863610f64a70896f8';
  const projection = {
    rubric: 'tautology', contractVersion: 'v3', projectionVersion: 'v2',
    lapId, snapshotDigest, digest: 'sha256:projection',
    mergeBase: 'base', headSha: 'head', changedFiles: [{ path: 'test/engine/event-sinks.test.ts', changeKind: 'modified', hunks: [] }], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    changedTestSelectors: ['test/engine/event-sinks.test.ts'], testSuiteProof: {}, revertedProductionManifest: [], preflightEvidence: {}, repairContext: [],
  } as unknown as import('../../src/engine/build-review-projections.js').BuildReviewRubricProjection;
  const policy = {
    enabled: true, llm_provider: 'claude' as const, model: 'opus', effort: 'high' as const,
    model_fallback_ladder: ['opus'], max_retries: 1, escalate: false,
  };
  const branch = { rubric: 'tautology' as const, skillName: 'build-review-tautology', policy };

  // The 2026-08-15 lap-a237011e failure verbatim in miniature: a semantically
  // complete judgement whose finding flattens the anchor into structured
  // top-level objects — the shape the strict parser rejects.
  const incidentShapedOutput = [
    'I read the referenced diff and measured each changed test.',
    '```json',
    JSON.stringify({
      kind: 'judged', rubric: 'tautology', contractVersion: 'v3', lapId, snapshotDigest,
      findings: [{
        concernKind: 'assertion-insensitive-to-production',
        changedTest: { path: 'test/engine/event-sinks.test.ts', suite: 'event sink subscriptions', name: 'rejects an unrelated sink' },
        exercisedBehavior: { productionSymbol: 'EVENT_SINKS', productionPath: 'src/engine/event-sinks.ts' },
        violationKind: 'assertion-insensitive-to-production',
        summary: 'The assertion compares a test-local mutated copy and can never fail.',
        evidenceLocations: ['src/conductor/test/engine/event-sinks.test.ts:519'],
      }],
    }),
    '```',
  ].join('\n');
  const validOutput = JSON.stringify({
    kind: 'judged', rubric: 'tautology', contractVersion: 'v3', lapId, snapshotDigest,
    findings: [{
      concernKind: 'assertion-insensitive-to-production',
      summary: 'The assertion compares a test-local mutated copy and can never fail.',
      evidenceLocations: ['src/conductor/test/engine/event-sinks.test.ts:519'],
      anchor: {
        rubric: 'tautology',
        changedTest: {
          path: 'test/engine/event-sinks.test.ts',
          contentHash: 'sha256:7849045d0fc1c72a360be630bf414918ecda92a8f0fcd56b79ec0a1bd93c92ca',
          display: 'test/engine/event-sinks.test.ts changed test',
        },
        exercisedBehavior: 'EVENT_SINKS persisted routing',
        violationKind: 'assertion-insensitive-to-production',
      },
    }],
  });

  function dispatch(runner: DefaultStepRunner) {
    return (runner as unknown as {
      dispatchBuildReviewRubric: (branch: unknown, projection: unknown) => Promise<unknown>;
    }).dispatchBuildReviewRubric(branch, projection);
  }

  it('repairs an unparseable-then-valid sequence within the same dispatch (legacy provider path)', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ success: true, output: incidentShapedOutput, exitCode: 0 })
      .mockResolvedValueOnce({ success: true, output: validOutput, exitCode: 0 });
    const runner = new DefaultStepRunner({ invoke, invokeInteractive: vi.fn() }, 'session-1', '/tmp/project');

    const result = await dispatch(runner);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ kind: 'judged', rubric: 'tautology', lapId, snapshotDigest, verdict: 'FAIL' });
    const repairPrompt = (invoke.mock.calls[1][0] as InvokeOptions).prompt;
    expect(repairPrompt).toContain('ONLY one JSON object');
    expect(repairPrompt).toContain('did not satisfy the judged-result contract');
    expect(repairPrompt).toContain('anchor');
    expect(repairPrompt).toContain(`"lapId": "<echo the projection lapId verbatim>"`);
    expect(repairPrompt).toContain(
      'Your previous response (bounded excerpt):\nI read the referenced diff and measured each changed test.',
    );
  });

  it('embeds the exact per-rubric anchor schema in the initial dispatch prompt', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true, output: validOutput, exitCode: 0 });
    const runner = new DefaultStepRunner({ invoke, invokeInteractive: vi.fn() }, 'session-1', '/tmp/project');

    await dispatch(runner);

    expect(invoke).toHaveBeenCalledTimes(1);
    const prompt = (invoke.mock.calls[0][0] as InvokeOptions).prompt;
    expect(prompt).toContain('"anchor": {"rubric": "tautology", "changedTest": {"path": "<repository-relative path>", "contentHash": "sha256:<normalized-test-title>", "display": "<human-readable non-coordinate label>", "occurrence": <0-based ordinal among equal-content regions in this path; omit when unique>}, "exercisedBehavior": "<canonical projection reference or report string>", "violationKind": "<one of: assertion-insensitive-to-production | test-does-not-exercise-changed-behavior | assertion-derived-from-test-data | source-text-mirror>"}');
    expect(prompt).toContain('never flattened');
  });

  it('instructs graders with the current v3 structured-anchor contract, not the retired v2 plain-string one', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true, output: validOutput, exitCode: 0 });
    const runner = new DefaultStepRunner({ invoke, invokeInteractive: vi.fn() }, 'session-1', '/tmp/project');

    await dispatch(runner);

    const prompt = (invoke.mock.calls[0][0] as InvokeOptions).prompt;
    expect(prompt).toContain('`contractVersion` is "v3"');
    expect(prompt).not.toContain('`contractVersion` is "v2"');
    expect(prompt).not.toContain('every anchor value is a plain string');
    expect(prompt).toContain('content-region');
  });

  it('yields a bounded dispatch-failure report with the raw output excerpt when the repair turn is still bad', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ success: true, output: incidentShapedOutput, exitCode: 0 })
      .mockResolvedValueOnce({ success: true, output: `still prose ${'x'.repeat(10_000)} tail-marker`, exitCode: 0 });
    const runner = new DefaultStepRunner({ invoke, invokeInteractive: vi.fn() }, 'session-1', '/tmp/project');

    const result = await dispatch(runner);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ kind: 'dispatch-failure' });
    const detail = (result as { detail: string }).detail;
    expect(Buffer.byteLength(detail, 'utf8')).toBeLessThanOrEqual(RUBRIC_FAILURE_DETAIL_CAP_BYTES);
    expect(detail).toContain('Raw output excerpt: still prose');
    expect(detail).toContain('tail-marker');
    expect(detail).toContain('[...truncated');
  });

  it('returns undefined (not a failure report) when the provider invocation itself fails', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: false, output: 'crashed', exitCode: 1 });
    const runner = new DefaultStepRunner({ invoke, invokeInteractive: vi.fn() }, 'session-1', '/tmp/project');

    await expect(dispatch(runner)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each(['claude', 'codex'] as const)('repairs within the same dispatch on the %s runtime-candidates path', async (providerKey) => {
    const runtimeIncidentShapedOutput = incidentShapedOutput.replace(
      'I read the referenced diff and measured each changed test.',
      'Runtime-candidates repair output marker.',
    );
    const invoke = vi.fn()
      .mockResolvedValueOnce({ success: true, output: runtimeIncidentShapedOutput, exitCode: 0 })
      .mockResolvedValueOnce({ success: true, output: validOutput, exitCode: 0 });
    const policyForKey = providerKey === 'claude' ? CLAUDE_POLICY : CODEX_MODEL_POLICY;
    const runtime = {
      key: providerKey,
      provider: { lifecycleCapability: { synchronousSpawnPermit: true } as const, invoke, invokeInteractive: vi.fn() },
      policy: policyForKey,
      builtIn: true,
      availability: new ModelAvailability(policyForKey.modelFallbackLadder),
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session-1', '/tmp/project', {
      config: { llm_provider: [providerKey] },
      providerRuntimes: new ProviderRuntimeSet([runtime]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: [providerKey],
    });

    const result = await (runner as unknown as {
      dispatchBuildReviewRubric: (branch: unknown, projection: unknown) => Promise<unknown>;
    }).dispatchBuildReviewRubric({ ...branch, policy: { ...policy, llm_provider: providerKey } }, projection);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ kind: 'judged', rubric: 'tautology', lapId, snapshotDigest });
    const repairPrompt = (invoke.mock.calls[1][0] as InvokeOptions).prompt;
    expect(repairPrompt).toContain('ONLY one JSON object');
    expect(repairPrompt).toContain(
      'Your previous response (bounded excerpt):\nRuntime-candidates repair output marker.',
    );
  });
});
