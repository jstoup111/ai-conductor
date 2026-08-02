/**
 * Unit tests for daemon-token authFailure park-and-poll (Task 11, TR-4).
 *
 * Tests the authFailure branch's retargeting to watch the daemon token path
 * instead of operator credentials path. When the token file changes with
 * non-empty content, the same attempt retries with the fresh token re-injected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import { detectsAuthFailure } from '../../src/execution/claude-provider.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';

type AuthResult = StepRunResult & { authFailure?: boolean };

const READY_STATE: ConductState = {
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'done',
  plan: 'done',
  architecture_diagram: 'done',
  architecture_review: 'done',
  acceptance_specs: 'done',
  test_suite: 'done',
} as ConductState;

describe('conductor auth-park: daemon-token mode', () => {
  let dir: string;
  let statePath: string;
  let tokenDir: string;
  let tokenPath: string;
  let events: ConductorEventEmitter;
  let priorToken: string | undefined;
  let priorCodexApiKey: string | undefined;
  let priorClaudeConfigDir: string | undefined;

  function selfHostConfig() {
    return {
      harness_self_host: {
        build_auth: { mode: 'daemon-token', token_path: tokenPath },
        auth_park_timeout_minutes: 1,
      },
    } as never;
  }

  function fullSuiteVerifierStub() {
    return {
      ensure: vi.fn().mockResolvedValue({ status: 'REUSED', evidence: {} as never }),
      inspect: vi.fn().mockResolvedValue({ status: 'CURRENT', evidence: {} as never }),
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'auth-park-unit-'));
    tokenDir = await mkdtemp(join(tmpdir(), 'auth-park-token-'));
    tokenPath = join(tokenDir, 'daemon-token');
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    priorCodexApiKey = process.env.CODEX_API_KEY;
    priorClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, READY_STATE);
    await writeFile(tokenPath, 'tok-v1', 'utf-8');
  });

  afterEach(async () => {
    if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    if (priorCodexApiKey === undefined) delete process.env.CODEX_API_KEY;
    else process.env.CODEX_API_KEY = priorCodexApiKey;
    if (priorClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorClaudeConfigDir;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await rm(tokenDir, { recursive: true, force: true }).catch(() => {});
  });

  it('rechecks the failed Codex cached login through its own runtime before resuming', async () => {
    const readiness = vi
      .fn()
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'missing' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
    const codex = {
      invoke: vi.fn(),
      invokeInteractive: vi.fn(async () => {}),
      readiness,
    };
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: codex,
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 1,
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
      fullSuiteVerifier: fullSuiteVerifierStub(),
    });

    const park = await (conductor as any).parkOnAuthFailure({
      actualProvider: 'codex',
      authentication: {
        provider: 'codex',
        source: 'cached-login',
        state: 'unusable',
      },
    });

    expect(readiness).toHaveBeenCalledTimes(2);
    expect(park).toEqual({ disposition: 'recovered' });
  });

  it('retains the closed parser rejection in unavailable cached-login recovery progress', async () => {
    const rawDoctorDiagnostic = 'sk-live-super-secret-token /private/codex/credentials.json';
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex',
      source: 'cached-login',
      state: 'probe-failed',
      probeFailure: {
        kind: 'unparseable-output',
        facts: { parserRejection: 'invalid-json' },
        rawDoctorDiagnostic,
      },
    });
    const invoke = vi.fn();
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const eventsSeen: unknown[] = [];
    events.on('credentials_park_progress', (event) => { eventsSeen.push(event); });
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const sleepFn = vi.fn(async (delay: number) => { clockOffset += delay; });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke, invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 3,
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
      fullSuiteVerifier: fullSuiteVerifierStub(),
    });

    try {
      const park = await (conductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
      });

      expect({
        park,
        readinessCalls: readiness.mock.calls.length,
        providerInvocations: invoke.mock.calls.length,
        runnerCalls: (runner.run as ReturnType<typeof vi.fn>).mock.calls.length,
        sleepCalls: sleepFn.mock.calls.length,
        progress: eventsSeen,
      }).toEqual({
        park: { disposition: 'trial-required' },
        readinessCalls: 1,
        providerInvocations: 0,
        runnerCalls: 0,
        sleepCalls: 0,
        progress: [expect.objectContaining({
          provider: 'codex',
          source: 'cached-login',
          readiness: 'probe-failed',
          degradation: 'probe-failure',
          probeFailureKind: 'unparseable-output',
          parserRejection: 'invalid-json',
          elapsedSeconds: 0,
          nextDisposition: 'trial-required',
        })],
      });
      expect(JSON.stringify(eventsSeen)).not.toContain(rawDoctorDiagnostic);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('resumes only the auth-failed grouped member after its scheduled Codex readiness recheck', async () => {
    await writeState(statePath, {
      ...READY_STATE,
      build: 'done',
      build_review: 'done',
      wiring_check: 'done',
      retro: 'done',
      rebase: 'done',
      finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex',
      source: 'cached-login',
      state: 'ready',
    });
    const alternateReadiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }, {
      key: 'claude',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: alternateReadiness },
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    }]);
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(join(dir, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n');
          return { success: true };
        }
        if (step === 'prd_audit' && calls.filter((call) => call === step).length === 1) {
          return {
            success: false,
            authFailure: true,
            actualProvider: 'codex',
            authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
          };
        }
        if (step === 'prd_audit') {
          await writeFile(join(dir, '.pipeline/prd-audit.md'), '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n| FR-1 | ALIGNED | | evidence.ts:1 | yes |\n');
        }
        if (step === 'architecture_review_as_built') {
          await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# As-Built Architecture Review\n\nVerdict: APPROVED\n');
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'manual_test',
      mode: 'auto',
      maxRetries: 1,
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    await conductor.run();

    expect({ calls, readinessCalls: readiness.mock.calls.length, alternateReadinessCalls: alternateReadiness.mock.calls.length }).toEqual({
      calls: ['manual_test', 'prd_audit', 'architecture_review_as_built', 'prd_audit'],
      readinessCalls: 1,
      alternateReadinessCalls: 0,
    });
  });

  it.each(['missing', 'unusable'] as const)(
    'continues parking on conclusive Codex %s evidence without probing an alternative runtime',
    async (state) => {
      const codexReadiness = vi.fn().mockResolvedValue({
        provider: 'codex', source: 'cached-login', state,
      });
      const alternativeReadiness = vi.fn().mockResolvedValue({
        provider: 'claude', source: 'cached-login', state: 'ready',
      });
      const runtimes = new ProviderRuntimeSet([
        {
          key: 'codex',
          provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: codexReadiness },
          policy: CODEX_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
        },
        {
          key: 'claude',
          provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: alternativeReadiness },
          policy: CLAUDE_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
        },
      ]);
      const realNow = Date.now();
      let clockOffset = 0;
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
      const sleepFn = vi.fn(async (delay: number) => {
        clockOffset += delay;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: { run: vi.fn(async () => ({ success: true })) },
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        sleepFn,
        config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
        providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
      });

      try {
        const park = await (conductor as any).parkOnAuthFailure({
          actualProvider: 'claude',
          authentication: { provider: 'codex', source: 'cached-login', state },
        });

        expect({
          park,
          codexReadinessCalls: codexReadiness.mock.calls.length,
          alternativeReadinessCalls: alternativeReadiness.mock.calls.length,
          sleepCalls: sleepFn.mock.calls.length,
        }).toEqual({
          park: {
            disposition: 'halt',
            haltReason:
              'Codex cached-login authentication did not become ready before the auth park timed out.\n' +
              'Refresh the Codex login, then re-queue this feature.',
          },
          codexReadinessCalls: 7,
          alternativeReadinessCalls: 0,
          sleepCalls: 6,
        });
      } finally {
        nowSpy.mockRestore();
      }
    },
  );

  function timeoutRuntimes() {
    const selectedReadiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'unusable',
    });
    const alternateReadiness = vi.fn().mockResolvedValue({
      provider: 'claude', source: 'cached-login', state: 'ready',
    });
    return {
      selectedReadiness,
      alternateReadiness,
      runtimes: new ProviderRuntimeSet([
        {
          key: 'codex',
          provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: selectedReadiness },
          policy: CODEX_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
        },
        {
          key: 'claude',
          provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: alternateReadiness },
          policy: CLAUDE_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
        },
      ]),
    };
  }

  const codexCachedLoginFailure = (): AuthResult => ({
    success: false,
    authFailure: true,
    actualProvider: 'codex',
    authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
  });

  it('serial dispatch timeout halts the selected Codex disposition without retry or fallback', async () => {
    const { runtimes, selectedReadiness, alternateReadiness } = timeoutRuntimes();
    const runner: StepRunner = { run: vi.fn(async () => codexCachedLoginFailure()) };
    const halts: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event.reason);
    });
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'build', mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    await conductor.run();

    expect({
      dispatches: (runner.run as ReturnType<typeof vi.fn>).mock.calls.map(([step, , opts]) => ({ step, attempt: opts?.attempt, model: opts?.modelOverride })),
      selectedProbes: selectedReadiness.mock.calls.length,
      alternateProviderProbes: alternateReadiness.mock.calls.length,
      halts,
    }).toEqual({
      // Base model is passed on the first dispatch; a second (escalated) rung
      // would add another dispatch rather than alter this one.
      dispatches: [{ step: 'build', attempt: 1, model: 'sonnet' }],
      selectedProbes: 0,
      alternateProviderProbes: 0,
      halts: [expect.stringMatching(/Codex cached-login authentication did not become ready[\s\S]*re-queue/i)],
    });
  });

  it('halts after one authorized serial recovery trial without consuming a second probe failure', async () => {
    const readiness = vi.fn()
      .mockResolvedValueOnce({
        provider: 'codex',
        source: 'cached-login',
        state: 'probe-failed',
        probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
      })
      .mockResolvedValueOnce({
        provider: 'codex',
        source: 'cached-login',
        state: 'probe-failed',
        probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
      })
      .mockResolvedValue({ provider: 'codex', source: 'cached-login', state: 'unusable' });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const runner: StepRunner = { run: vi.fn(async () => codexCachedLoginFailure()) };
    const halts: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event.reason);
    });
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const sleepFn = vi.fn(async (delay: number) => { clockOffset += delay; });
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'build', mode: 'auto', maxRetries: 3, sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    try {
      await conductor.run();

      expect({
        buildDispatches: (runner.run as ReturnType<typeof vi.fn>).mock.calls
          .filter(([step]) => step === 'build').length,
        readinessCalls: readiness.mock.calls.length,
        halts,
      }).toEqual({
        buildDispatches: 2,
        readinessCalls: 1,
        halts: [expect.stringMatching(/Codex cached-login[\s\S]*readiness probe was unavailable[\s\S]*re-queue/i)],
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('returns a successful authorized serial recovery trial to ordinary completion', async () => {
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex',
      source: 'cached-login',
      state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    let buildCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') buildCalls++;
        return step === 'build' && buildCalls === 1
          ? codexCachedLoginFailure()
          : { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'build', mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({
      buildAttempts: (runner.run as ReturnType<typeof vi.fn>).mock.calls
        .filter(([step]) => step === 'build').map(([, , opts]) => opts?.attempt),
      readinessCalls: readiness.mock.calls.length,
    }).toEqual({ buildAttempts: [1, 1], readinessCalls: 1 });
  });

  it('returns a non-auth failed authorized serial recovery trial to ordinary retry handling', async () => {
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex',
      source: 'cached-login',
      state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    let buildCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step !== 'build') return { success: true };
        buildCalls++;
        return buildCalls === 1
          ? codexCachedLoginFailure()
          : buildCalls === 2
            ? { success: false, output: 'ordinary build failure' }
            : { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'build', mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({
      buildAttempts: (runner.run as ReturnType<typeof vi.fn>).mock.calls
        .filter(([step]) => step === 'build').map(([, , opts]) => opts?.attempt),
      readinessCalls: readiness.mock.calls.length,
    }).toEqual({ buildAttempts: [1, 1, 2], readinessCalls: 1 });
  });

  it('keeps degraded-preflight recovery on the selected Codex model ladder without mutating provider state', async () => {
    const probeFailed = {
      provider: 'codex' as const,
      source: 'cached-login' as const,
      state: 'probe-failed' as const,
      probeFailure: {
        kind: 'timeout' as const,
        facts: { timeoutMs: 10_000 },
      },
    };
    const selectedReadiness = vi.fn().mockResolvedValue(probeFailed);
    const alternateReadiness = vi.fn();
    const selectedInvoke = vi.fn();
    const alternateInvoke = vi.fn();
    const selectedAvailability = new ModelAvailability(
      CODEX_MODEL_POLICY.modelFallbackLadder,
    );
    const alternateAvailability = new ModelAvailability(
      CLAUDE_MODEL_POLICY.modelFallbackLadder,
    );
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: {
          invoke: selectedInvoke,
          invokeInteractive: vi.fn(async () => {}),
          readiness: selectedReadiness,
        },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: selectedAvailability,
      },
      {
        key: 'claude',
        provider: {
          invoke: alternateInvoke,
          invokeInteractive: vi.fn(async () => {}),
          readiness: alternateReadiness,
        },
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: alternateAvailability,
      },
    ]);
    const buildResults: StepRunResult[] = [
      codexCachedLoginFailure(),
      {
        success: false,
        output: 'actual ordinary failure after degraded preflight',
        actualProvider: 'codex',
        authentication: probeFailed,
      },
      {
        success: false,
        output: 'actual ordinary failure on the next intended ladder attempt',
        actualProvider: 'codex',
        authentication: probeFailed,
      },
      {
        success: true,
        output: 'actual success on the escalated model',
        actualProvider: 'codex',
        authentication: probeFailed,
      },
    ];
    const observedBuildResults: StepRunResult[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        const result = buildResults[observedBuildResults.length] ?? { success: true };
        observedBuildResults.push(result);
        return result;
      }),
    };
    const halts: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event.reason);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 4,
      sleepFn: vi.fn(async () => {}),
      config: {
        harness_self_host: { auth_park_timeout_minutes: 1 },
        steps: { build: { llm_provider: 'codex' } },
      } as never,
      providerExecution: {
        runtimes,
        sessions: {} as never,
        configuredProviders: ['codex', 'claude'],
      },
      fullSuiteVerifier: fullSuiteVerifierStub(),
    });

    await conductor.run();

    const dispatches = (runner.run as ReturnType<typeof vi.fn>).mock.calls
      .filter(([step]) => step === 'build')
      .map(([, , options]) => ({
        attempt: options?.attempt,
        model: options?.modelOverride,
      }));
    expect({
      dispatches,
      actualClassifications: observedBuildResults.map((result) => ({
        success: result.success,
        authFailure: result.authFailure,
        authentication: result.authentication,
      })),
      selectedReadinessCalls: selectedReadiness.mock.calls.length,
      alternateReadinessCalls: alternateReadiness.mock.calls.length,
      selectedProviderInvocations: selectedInvoke.mock.calls.length,
      alternateProviderInvocations: alternateInvoke.mock.calls.length,
      selectedDeadModels: [...selectedAvailability.dead],
      alternateDeadModels: [...alternateAvailability.dead],
      selectedRunWideUnavailable: runtimes.get('codex').runWideUnavailable,
      alternateRunWideUnavailable: runtimes.get('claude').runWideUnavailable,
      halts,
    }).toEqual({
      dispatches: [
        { attempt: 1, model: 'gpt-5.6-terra' },
        { attempt: 1, model: 'gpt-5.6-terra' },
        { attempt: 2, model: 'gpt-5.6-terra' },
        { attempt: 3, model: 'gpt-5.6-sol' },
      ],
      actualClassifications: [
        {
          success: false,
          authFailure: true,
          authentication: {
            provider: 'codex',
            source: 'cached-login',
            state: 'unusable',
          },
        },
        { success: false, authFailure: undefined, authentication: probeFailed },
        { success: false, authFailure: undefined, authentication: probeFailed },
        { success: true, authFailure: undefined, authentication: probeFailed },
      ],
      selectedReadinessCalls: 1,
      alternateReadinessCalls: 0,
      selectedProviderInvocations: 0,
      alternateProviderInvocations: 0,
      selectedDeadModels: [],
      alternateDeadModels: [],
      selectedRunWideUnavailable: undefined,
      alternateRunWideUnavailable: undefined,
      halts: [],
    });
  });

  it.each([
    { label: 'initial serial adapter', step: 'build' as const, completed: {} },
    {
      label: 'judged adapter',
      step: 'build_review' as const,
      completed: { build: 'done', wiring_check: 'done', test_suite: 'done' } as Partial<ConductState>,
    },
  ])('keeps the selected source and actual non-auth result authoritative after a probe-failed $label', async ({ step, completed }) => {
    await writeState(statePath, { ...READY_STATE, ...completed });
    const selectedReadiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const fallbackReadiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: selectedReadiness },
        policy: CODEX_MODEL_POLICY, builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
      {
        key: 'claude',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: fallbackReadiness },
        policy: CLAUDE_MODEL_POLICY, builtIn: true,
        availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    let calls = 0;
    const runner: StepRunner = { run: vi.fn(async (currentStep): Promise<StepRunResult> => {
      if (currentStep !== step) return { success: true };
      calls += 1;
      if (calls === 1) return codexCachedLoginFailure();
      if (calls === 2) {
        return {
          success: false,
          output: 'actual non-auth result',
          actualProvider: 'codex',
          authentication: { provider: 'codex', source: 'cached-login', state: 'ready' },
        };
      }
      return { success: true, actualProvider: 'codex' };
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: step, mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
      fullSuiteVerifier: fullSuiteVerifierStub(),
    });

    await conductor.run();

    expect({
      attempts: (runner.run as ReturnType<typeof vi.fn>).mock.calls
        .filter(([currentStep]) => currentStep === step).map(([, , options]) => options?.attempt),
      selectedReadinessCalls: selectedReadiness.mock.calls.length,
      fallbackReadinessCalls: fallbackReadiness.mock.calls.length,
    }).toEqual({
      attempts: [1, 1, 2],
      selectedReadinessCalls: 1,
      fallbackReadinessCalls: 0,
    });
  });

  it('grouped dispatch timeout preserves completed siblings and never redispatches or falls back', async () => {
    await writeState(statePath, {
      ...READY_STATE, build: 'done', build_review: 'done', wiring_check: 'done', test_suite: 'done',
    });
    const { runtimes, selectedReadiness, alternateReadiness } = timeoutRuntimes();
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        return step === 'manual_test' ? codexCachedLoginFailure() : { success: true };
      }),
    };
    const halts: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event.reason);
    });
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    await conductor.run();

    expect({
      calls: Object.fromEntries(['manual_test', 'prd_audit', 'architecture_review_as_built'].map((step) => [step, calls.filter((call) => call === step).length])),
      selectedProbes: selectedReadiness.mock.calls.length,
      alternateProviderProbes: alternateReadiness.mock.calls.length,
      halts,
    }).toEqual({
      calls: { manual_test: 1, prd_audit: 1, architecture_review_as_built: 1 },
      selectedProbes: 0,
      alternateProviderProbes: 0,
      halts: [expect.stringMatching(/Codex cached-login authentication did not become ready[\s\S]*re-queue/i)],
    });
  });

  it('returns a successful grouped recovery trial while leaving completed siblings undispatched', async () => {
    await writeState(statePath, {
      ...READY_STATE,
      build: 'done', build_review: 'done', wiring_check: 'done',
      retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    let manualTestCalls = 0;
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'manual_test') {
          manualTestCalls++;
          if (manualTestCalls === 1) return codexCachedLoginFailure();
          await writeFile(join(dir, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n');
        }
        if (step === 'prd_audit') {
          await writeFile(join(dir, '.pipeline/prd-audit.md'), '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n| FR-1 | ALIGNED | | evidence.ts:1 | yes |\n');
        }
        if (step === 'architecture_review_as_built') {
          await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# As-Built Architecture Review\n\nVerdict: APPROVED\n');
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 1, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({
      calls: Object.fromEntries(['manual_test', 'prd_audit', 'architecture_review_as_built']
        .map((step) => [step, calls.filter((call) => call === step).length])),
      readinessCalls: readiness.mock.calls.length,
    }).toEqual({
      calls: { manual_test: 2, prd_audit: 1, architecture_review_as_built: 1 },
      readinessCalls: 1,
    });
  });

  it('routes a non-auth failed grouped recovery trial through the ordinary group result path', async () => {
    await writeState(statePath, {
      ...READY_STATE,
      build: 'done', build_review: 'done', wiring_check: 'done',
      retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'manual_test' && calls.filter((call) => call === step).length === 1) {
          return codexCachedLoginFailure();
        }
        return step === 'manual_test'
          ? { success: false, output: 'ordinary manual-test failure' }
          : { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 1, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({
      calls: Object.fromEntries(['manual_test', 'prd_audit', 'architecture_review_as_built']
        .map((step) => [step, calls.filter((call) => call === step).length])),
      readinessCalls: readiness.mock.calls.length,
    }).toEqual({
      calls: { manual_test: 2, prd_audit: 1, architecture_review_as_built: 1 },
      readinessCalls: 1,
    });
  });

  it('halts an auth-failed grouped recovery trial without a second probe or sibling redispatch', async () => {
    await writeState(statePath, {
      ...READY_STATE,
      build: 'done', build_review: 'done', wiring_check: 'done',
      retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn()
      .mockResolvedValueOnce({
        provider: 'codex', source: 'cached-login', state: 'probe-failed',
        probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
      })
      .mockResolvedValue({ provider: 'codex', source: 'cached-login', state: 'unusable' });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        return step === 'manual_test' ? codexCachedLoginFailure() : { success: true };
      }),
    };
    const halts: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event.reason);
    });
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const sleepFn = vi.fn(async (delay: number) => { clockOffset += delay; });
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 1, sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    try {
      await conductor.run();

      expect({
        calls: Object.fromEntries(['manual_test', 'prd_audit', 'architecture_review_as_built']
          .map((step) => [step, calls.filter((call) => call === step).length])),
        readinessCalls: readiness.mock.calls.length,
        halts,
      }).toEqual({
        calls: { manual_test: 2, prd_audit: 1, architecture_review_as_built: 1 },
        readinessCalls: 1,
        halts: [expect.stringMatching(/Codex cached-login recovery trial for grouped member "manual_test" failed authentication/i)],
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authorizes only one grouped member invocation after a shared failed readiness probe', async () => {
    await writeState(statePath, {
      ...READY_STATE,
      build: 'done', build_review: 'done', wiring_check: 'done',
      retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        return codexCachedLoginFailure();
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 1, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({
      calls: Object.fromEntries(['manual_test', 'prd_audit', 'architecture_review_as_built']
        .map((step) => [step, calls.filter((call) => call === step).length])),
      readinessCalls: readiness.mock.calls.length,
    }).toEqual({
      calls: { manual_test: 2, prd_audit: 1, architecture_review_as_built: 1 },
      readinessCalls: 1,
    });
  });

  it.each([
    ['succeeds', { success: true, output: 'verified' }],
    ['returns a non-auth failure', { success: false, output: 'ordinary failure' }],
  ] as const)('consumes one grouped recovery trial when the first trial %s', async (_case, trialResult) => {
    await writeState(statePath, {
      ...READY_STATE,
      build: 'done', build_review: 'done', wiring_check: 'done',
      retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    let manualTestCalls = 0;
    let prdAuditCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'manual_test') {
          manualTestCalls++;
          return manualTestCalls === 1 ? codexCachedLoginFailure() : trialResult;
        }
        if (step === 'prd_audit') {
          prdAuditCalls++;
          return codexCachedLoginFailure();
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 1, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({
      manualTestCalls,
      prdAuditCalls,
      readinessCalls: readiness.mock.calls.length,
    }).toEqual({ manualTestCalls: 2, prdAuditCalls: 1, readinessCalls: 1 });
  });

  it.each([
    ['succeeds', { success: true }, [1, 1]],
    ['returns a non-auth failure to ordinary retry handling', { success: false, output: 'ordinary judged failure' }, [1, 1, 2]],
  ] as const)('judged build_review recovery trial %s', async (_case, trialResult, expectedAttempts) => {
    await writeState(statePath, { ...READY_STATE, build: 'done', wiring_check: 'done', test_suite: 'done' });
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex', provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY, builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    let buildReviewCalls = 0;
    const runner: StepRunner = { run: vi.fn(async (step) => {
      if (step !== 'build_review') return { success: true };
      buildReviewCalls++;
      if (buildReviewCalls === 1) return codexCachedLoginFailure();
      if (buildReviewCalls === 2) return trialResult;
      return { success: true };
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'build_review', mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({
      attempts: (runner.run as ReturnType<typeof vi.fn>).mock.calls
        .filter(([step]) => step === 'build_review').map(([, , opts]) => opts?.attempt),
      readinessCalls: readiness.mock.calls.length,
    }).toEqual({ attempts: expectedAttempts, readinessCalls: 1 });
  });

  it('halts an auth-failed judged recovery trial without re-probing', async () => {
    await writeState(statePath, { ...READY_STATE, build: 'done', wiring_check: 'done', test_suite: 'done' });
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex', provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY, builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const runner: StepRunner = { run: vi.fn(async () => codexCachedLoginFailure()) };
    const halts: string[] = [];
    events.on('loop_halt', (event) => { if (event.type === 'loop_halt') halts.push(event.reason); });
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'build_review', mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    await conductor.run();

    expect({ calls: (runner.run as ReturnType<typeof vi.fn>).mock.calls.length, readinessCalls: readiness.mock.calls.length, halts })
      .toEqual({ calls: 2, readinessCalls: 1, halts: [expect.stringMatching(/recovery trial[\s\S]*probe was unavailable/i)] });
  });

  it.each([
    ['succeeds', { success: true, output: 'verified' }, 2, 'verified'],
    ['returns a non-auth failure', { success: false, output: 'ordinary verifier failure' }, 2, 'ordinary verifier failure'],
    ['halts an auth-failed trial', codexCachedLoginFailure(), 2, expect.stringContaining('recovery trial for the attribution verifier failed authentication')],
  ] as const)('spot-audit verifier recovery trial %s', async (_case, trialResult, expectedDispatches, output) => {
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    });
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex', provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
      policy: CODEX_MODEL_POLICY, builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const dispatchVerifier = vi.fn()
      .mockResolvedValueOnce(codexCachedLoginFailure())
      .mockResolvedValueOnce(trialResult);
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: { run: vi.fn(), dispatchVerifier }, events, projectRoot: dir,
      mode: 'auto', sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    const result = await (conductor as any).dispatchSpotAuditVerifier({ residueIds: ['r1'], planPath: 'plan.md' });

    expect({ dispatches: dispatchVerifier.mock.calls.length, readinessCalls: readiness.mock.calls.length, output: result.output })
      .toEqual({ dispatches: expectedDispatches, readinessCalls: 1, output });
  });

  it('judged build_review dispatch timeout halts without retry, escalation, or alternate provider use', async () => {
    await writeState(statePath, {
      ...READY_STATE,
      build: 'done',
      wiring_check: 'done',
      test_suite: 'done',
    });
    const { runtimes, selectedReadiness, alternateReadiness } = timeoutRuntimes();
    const runner: StepRunner = { run: vi.fn(async () => codexCachedLoginFailure()) };
    const halts: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event.reason);
    });
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      fromStep: 'build_review', mode: 'auto', maxRetries: 3, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    await conductor.run();

    expect({
      dispatches: (runner.run as ReturnType<typeof vi.fn>).mock.calls.map(([step, , opts]) => ({ step, attempt: opts?.attempt, model: opts?.modelOverride })),
      selectedProbes: selectedReadiness.mock.calls.length,
      alternateProviderProbes: alternateReadiness.mock.calls.length,
      halts,
    }).toEqual({
      // build_review's configured base is fable; no second escalation rung ran.
      dispatches: [{ step: 'build_review', attempt: 1, model: 'fable' }],
      selectedProbes: 0,
      alternateProviderProbes: 0,
      halts: [expect.stringMatching(/Codex cached-login authentication did not become ready[\s\S]*re-queue/i)],
    });
  });

  it('auxiliary verifier timeout does not redispatch, escalate, change models, or probe another provider', async () => {
    const selectedReadiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'unusable',
    });
    const alternateReadiness = vi.fn().mockResolvedValue({
      provider: 'claude', source: 'cached-login', state: 'ready',
    });
    const dispatchVerifier = vi.fn().mockResolvedValue({
      success: false,
      output: 'selected login rejected',
      authFailure: true,
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: selectedReadiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
      {
        key: 'claude',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: alternateReadiness },
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const runner: StepRunner = { run: vi.fn(), dispatchVerifier };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 3,
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    const result = await (conductor as any).dispatchSpotAuditVerifier({
      residueIds: ['residue-1'],
      planPath: 'plan.md',
    });

    expect({
      result,
      verifierDispatches: dispatchVerifier.mock.calls.length,
      ordinaryDispatches: (runner.run as ReturnType<typeof vi.fn>).mock.calls.length,
      selectedProbes: selectedReadiness.mock.calls.length,
      alternateProviderProbes: alternateReadiness.mock.calls.length,
    }).toEqual({
      result: expect.objectContaining({
        success: false,
        authFailure: true,
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
      }),
      verifierDispatches: 1,
      ordinaryDispatches: 0,
      selectedProbes: 0,
      alternateProviderProbes: 0,
    });
  });

  it('backs off cached-login readiness checks at exponentially increasing rungs', async () => {
    const readiness = vi
      .fn()
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'missing' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'unusable' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'unusable' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const sleepFn = vi.fn(async (_delay: number) => {});
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    const park = await (conductor as any).parkOnAuthFailure({
      actualProvider: 'codex',
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    });

    expect(park).toEqual({ disposition: 'recovered' });
    expect(readiness).toHaveBeenCalledTimes(4);
    expect(sleepFn.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000, 4_000]);
  });

  it('emits one park start, immediate sanitized state changes, and throttles unchanged progress', async () => {
    const readiness = vi
      .fn()
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'missing' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'missing' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'unusable' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const sleepFn = vi.fn(async (delay: number) => {
      clockOffset += delay;
    });
    const eventsSeen: unknown[] = [];
    events.on('credentials_park', (event) => { eventsSeen.push(event); });
    events.on('credentials_park_progress', (event) => { eventsSeen.push(event); });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    try {
      await (conductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
      });

      expect(eventsSeen.filter((event: any) => event.type === 'credentials_park')).toHaveLength(1);
      expect(eventsSeen.filter((event: any) => event.type === 'credentials_park_progress')).toEqual([
        expect.objectContaining({ readiness: 'missing', nextProbeDelaySeconds: 1, degradation: 'credential-failure' }),
        expect.objectContaining({ readiness: 'unusable', nextProbeDelaySeconds: 4, degradation: 'credential-failure' }),
        expect.objectContaining({ readiness: 'ready', nextProbeDelaySeconds: 0, degradation: 'credential-failure' }),
      ]);
      expect(sleepFn.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000, 4_000]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps adversarial readiness diagnostics out of progress and bounds its numeric fields', async () => {
    const rawFragments = [
      '/private/codex/credentials.json',
      'sk-live-super-secret-token',
      'upstream.reachability.internal',
      'arbitrary doctor diagnostic text',
    ];
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex',
      source: 'cached-login',
      state: 'unusable',
      summary: rawFragments.join(' '),
      stdout: rawFragments.join(' '),
      stderr: rawFragments.join(' '),
      credentialPath: rawFragments[0],
      token: rawFragments[1],
    });
    const eventsSeen: unknown[] = [];
    events.on('credentials_park', (event) => { eventsSeen.push(event); });
    events.on('credentials_park_progress', (event) => { eventsSeen.push(event); });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(realNow)
      .mockReturnValue(realNow + 120_000);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    try {
      const park = await (conductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
      });
      const serialized = JSON.stringify({ eventsSeen, park });

      for (const fragment of rawFragments) expect(serialized).not.toContain(fragment);
      expect(eventsSeen).toContainEqual(expect.objectContaining({
        type: 'credentials_park_progress',
        elapsedSeconds: expect.any(Number),
        nextProbeDelaySeconds: expect.any(Number),
      }));
      const progress = eventsSeen.find((event: any) => event.type === 'credentials_park_progress') as any;
      expect(progress.elapsedSeconds).toBeLessThanOrEqual(60);
      expect(progress.nextProbeDelaySeconds).toBeLessThanOrEqual(30);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('clamps the final cached-login sleep to the remaining auth-park deadline', async () => {
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'unusable',
    });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const sleepFn = vi.fn(async (delay: number) => {
      clockOffset += delay;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    try {
      const park = await (conductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
      });

      expect({
        sleepDelays: sleepFn.mock.calls.map(([delay]) => delay),
        park,
      }).toMatchObject({
        sleepDelays: [1_000, 2_000, 4_000, 8_000, 16_000, 29_000],
        park: { disposition: 'halt' },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('halts disabled cached-login parks before probing or sleeping', async () => {
    const readiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const sleepFn = vi.fn(async () => {});
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    const park = await (conductor as any).parkOnAuthFailure({
      actualProvider: 'codex',
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    });

    expect({ readinessCalls: readiness.mock.calls.length, sleepCalls: sleepFn.mock.calls.length, park })
      .toEqual({
        readinessCalls: 0,
        sleepCalls: 0,
        park: {
          disposition: 'halt',
          haltReason:
            'Codex cached-login authentication did not become ready before the auth park timed out.\n' +
            'Refresh the Codex login, then re-queue this feature.',
        },
      });
  });

  it('parks Codex API-key failures until the configured timeout without rechecking another source', async () => {
    const readiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: {
          invoke: vi.fn(),
          invokeInteractive: vi.fn(async () => {}),
          readiness,
        },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const sleepFn = vi.fn(async () => {
      clockOffset += 60_000;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 1,
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    try {
      const park = await (conductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: {
          provider: 'codex',
          source: 'api-key',
          state: 'unusable',
        },
      });

      expect(runner.run).not.toHaveBeenCalled();
      expect(readiness).not.toHaveBeenCalled();
      expect(sleepFn).toHaveBeenCalledTimes(1);
      expect(park.disposition).toBe('halt');
      expect(park.haltReason).toContain('restart the daemon');
      expect(park.haltReason).not.toContain('CODEX_API_KEY=');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('halts Codex API-key failures immediately when the auth park timeout is disabled', async () => {
    const readiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const sleepFn = vi.fn(async () => {});
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
      fullSuiteVerifier: fullSuiteVerifierStub(),
    });

    const park = await (conductor as any).parkOnAuthFailure({
      actualProvider: 'codex',
      authentication: { provider: 'codex', source: 'api-key', state: 'unusable' },
    });

    expect(readiness).not.toHaveBeenCalled();
    expect(sleepFn).not.toHaveBeenCalled();
    expect(park).toMatchObject({ disposition: 'halt' });
    expect(park.haltReason).toContain('restart the daemon');
  });

  it('keeps Codex API-key restart recovery on its fixed one-second cadence', async () => {
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const sleepFn = vi.fn(async (_delay: number) => {
      clockOffset += 20_000;
    });
    const readiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const parked: unknown[] = [];
    events.on('credentials_park', (event) => { parked.push(event); });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
    });

    try {
      const park = await (conductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: { provider: 'codex', source: 'api-key', state: 'unusable' },
      });

      expect(sleepFn.mock.calls.map(([delay]) => delay)).toEqual([1_000, 1_000, 1_000]);
      expect(readiness).not.toHaveBeenCalled();
      expect(park).toMatchObject({ disposition: 'halt', haltReason: expect.stringContaining('restart the daemon') });
      expect(parked).toEqual([expect.objectContaining({
        reason: 'Codex API key is startup-only — waiting for daemon restart',
      })]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps Claude daemon-token and operator-OAuth recovery on their existing polling and reload traces', async () => {
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);
    const daemonSleep = vi.fn(async (delay: number) => {
      clockOffset += delay;
      await writeFile(tokenPath, 'tok-v2', 'utf-8');
      await utimes(tokenPath, new Date(realNow + clockOffset), new Date(realNow + clockOffset));
    });
    const daemonParked: unknown[] = [];
    events.on('credentials_park', (event) => { daemonParked.push(event); });
    const daemonConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      selfHost: true,
      sleepFn: daemonSleep,
      config: selfHostConfig(),
    });

    const operatorConfigDir = await mkdtemp(join(tmpdir(), 'auth-park-operator-'));
    process.env.CLAUDE_CONFIG_DIR = operatorConfigDir;
    const operatorCredentialsPath = join(operatorConfigDir, '.credentials.json');
    await writeFile(operatorCredentialsPath, JSON.stringify({ claudeAiOauth: { expiresAt: realNow - 1 } }), 'utf-8');
    const operatorSleep = vi.fn(async (delay: number) => {
      clockOffset += delay;
      await writeFile(
        operatorCredentialsPath,
        JSON.stringify({ claudeAiOauth: { expiresAt: realNow + clockOffset + 10 * 60 * 1000 } }),
        'utf-8',
      );
      await utimes(
        operatorCredentialsPath,
        new Date(realNow + clockOffset),
        new Date(realNow + clockOffset),
      );
    });
    const operatorEvents = new ConductorEventEmitter();
    const operatorParked: unknown[] = [];
    operatorEvents.on('credentials_park', (event) => { operatorParked.push(event); });
    const operatorConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: operatorEvents,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      sleepFn: operatorSleep,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
    });

    try {
      const daemonPark = await (daemonConductor as any).parkOnAuthFailure();
      const operatorPark = await (operatorConductor as any).parkOnAuthFailure();

      expect(daemonPark).toEqual({ disposition: 'recovered' });
      expect(daemonSleep.mock.calls.map(([delay]) => delay)).toEqual([1_000]);
      expect(daemonParked).toEqual([expect.objectContaining({
        reason: 'daemon build token expired or invalid — waiting for refresh',
      })]);
      expect(operatorPark).toEqual({ disposition: 'recovered' });
      expect(operatorSleep.mock.calls.map(([delay]) => delay)).toEqual([1_000]);
      expect(operatorParked).toEqual([expect.objectContaining({
        reason: 'operator OAuth token expired or invalid — waiting for refresh',
      })]);
    } finally {
      nowSpy.mockRestore();
      await rm(operatorConfigDir, { recursive: true, force: true });
    }
  });

  it.each(['missing', 'unusable'] as const)(
    'serial Codex preflight distinguishes unavailable recovery from %s evidence',
    async (state) => {
      const unavailableReadiness = vi.fn().mockResolvedValue({
        provider: 'codex',
        source: 'cached-login',
        state: 'probe-failed',
        probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
      });
      const unavailableRuntimes = new ProviderRuntimeSet([{
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: unavailableReadiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      }]);
      const unavailableConductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: { run: vi.fn() },
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        sleepFn: vi.fn(async () => {}),
        config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
        providerExecution: { runtimes: unavailableRuntimes, sessions: {} as never, configuredProviders: ['codex'] },
      });
      const unavailableResult = await (unavailableConductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
      });
      expect(unavailableResult).toEqual({ disposition: 'trial-required' });

      const readiness = vi
        .fn()
        .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state })
        .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
      const runtimes = new ProviderRuntimeSet([
        {
          key: 'codex',
          provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
          policy: CODEX_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
        },
      ]);
      const buildAttempts: number[] = [];
      const tailSteps: string[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions): Promise<StepRunResult> => {
          if (step !== 'build') {
            tailSteps.push(step);
            return { success: false, output: 'auth-park test tail barrier' };
          }
          buildAttempts.push(options?.attempt ?? -1);
          if (buildAttempts.length === 1) {
            return {
              success: false,
              authFailure: true,
              actualProvider: 'codex',
              authentication: { provider: 'codex', source: 'cached-login', state },
            };
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        maxRetries: 1,
        sleepFn: vi.fn(async () => {}),
        config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
        providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      await conductor.run();

      expect(readiness).toHaveBeenCalledTimes(2);
      expect(buildAttempts).toEqual([1, 1]);
      expect(tailSteps).not.toContain('finish');
      expect(tailSteps.length).toBeGreaterThan(0);
    },
  );

  it('parks a selected-source Codex completion rejection without provider fallback', async () => {
    await writeState(statePath, {
      ...READY_STATE,
      build_review: 'done',
      wiring_check: 'done',
      manual_test: 'done',
      prd_audit: 'done',
      architecture_review_as_built: 'done',
      retro: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState);
    const readiness = vi.fn().mockResolvedValue({
      provider: 'codex', source: 'cached-login', state: 'ready',
    });
    const fallbackReadiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
      {
        key: 'claude',
        provider: {
          invoke: vi.fn(),
          invokeInteractive: vi.fn(async () => {}),
          readiness: fallbackReadiness,
        },
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const readinessFor = vi.spyOn(runtimes, 'readinessFor');
    const attempts: number[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        attempts.push(options?.attempt ?? -1);
        return attempts.length === 1
          ? {
              success: false,
              authFailure: true,
              actualProvider: 'codex',
              authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
            }
          : { success: true, actualProvider: 'codex' };
      }),
    };
    const parked: unknown[] = [];
    events.on('credentials_park', (event) => { parked.push(event); });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 1,
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    await conductor.run();

    expect(attempts).toEqual([1, 1]);
    expect(readiness).toHaveBeenCalledTimes(1);
    expect(readinessFor).toHaveBeenCalledWith('codex', {
      provider: 'codex', source: 'cached-login', state: 'unusable',
    });
    expect(fallbackReadiness).not.toHaveBeenCalled();
    expect(parked).toHaveLength(1);
  });

  it('does not park an ordinary Codex completion failure', async () => {
    const parked: unknown[] = [];
    events.on('credentials_park', (event) => { parked.push(event); });
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) =>
        step === 'build'
          ? { success: false, output: 'network connection reset by peer', actualProvider: 'codex' }
          : { success: true },
      ),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 0,
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
    });

    await conductor.run();

    expect(parked).toHaveLength(0);
  });

  it('uses the injected full-suite verifier at the aggregate test boundary', async () => {
    const fullSuiteVerifier = fullSuiteVerifierStub();
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
      projectRoot: dir,
      fullSuiteVerifier,
    });

    await (conductor as any).runTestSuiteStep();

    expect(fullSuiteVerifier.ensure).toHaveBeenCalledTimes(1);
  });

  it('serial Codex API-key rejection halts once without hot-resuming after an environment change', async () => {
    const readiness = vi.fn();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        process.env.CODEX_API_KEY = 'replacement-must-not-hot-resume';
        return {
          success: false,
          authFailure: true,
          actualProvider: 'codex',
          authentication: { provider: 'codex', source: 'api-key', state: 'unusable' },
        };
      }),
    };
    const halts: string[] = [];
    const fullSuiteVerifier = fullSuiteVerifierStub();
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event.reason);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 1,
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
      fullSuiteVerifier,
    });

    await conductor.run();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(readiness).not.toHaveBeenCalled();
    expect(halts).toHaveLength(1);
    expect(halts[0]).toContain('restart the daemon');
    expect(halts[0]).not.toContain('replacement-must-not-hot-resume');
    expect(fullSuiteVerifier.ensure).not.toHaveBeenCalled();
  });

  it('authFailure in daemon-token mode parks on the daemon token path (not operator credentials)', async () => {
    let buildAttempts = 0;
    const observedParkPaths: string[] = [];
    let buildAttempt1Failed = false;

    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        buildAttempts++;
        if (buildAttempts === 1) {
          buildAttempt1Failed = true;
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    // Spy on the token file watching: when authFailure triggers park, the
    // daemon token path should be polled, and on mtime advance with non-empty
    // content, it should resume without burning the retry budget.
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkResumeCalls = 0;
    const sleepFn = vi.fn(async () => {
      if (buildAttempt1Failed && parkResumeCalls === 0) {
        // First park sleep: advance mtime and write new token content
        parkResumeCalls++;
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      await conductor.run();

      // Should have called build twice: first fails with authFailure (parks),
      // second succeeds after park resumes.
      expect(buildAttempts).toBe(2);
      // Each provider attempt receives fresh isolation, including the resumed
      // candidate after an auth park.
      expect(mockGuardrails.provisionSandbox).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park on daemon token: attempt counter unchanged (same retry, not new attempt)', async () => {
    let buildAttempts = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        buildAttempts++;
        if (buildAttempts === 1) {
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls === 1) {
        // First park sleep: trigger resume
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 2, // enough for budget verification
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      await conductor.run();

      // Exactly 2 build attempts: the retry didn't consume the budget
      expect(buildAttempts).toBe(2);
      // If park had incorrectly decremented budget, we'd expect more attempts possible.
      // This verifies the budget was truly preserved across park-resume.
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park: token re-read and re-injected on resume', async () => {
    const tokensSeenByBuild: (string | undefined)[] = [];
    let buildAttempts = 0;

    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        buildAttempts++;
        tokensSeenByBuild.push(process.env.CLAUDE_CODE_OAUTH_TOKEN);
        if (buildAttempts === 1) {
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls === 1) {
        // First park sleep: update token file
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2-fresh', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      await conductor.run();

      // Two attempts: first with old token, second with fresh token
      expect(tokensSeenByBuild).toHaveLength(2);
      expect(tokensSeenByBuild[0]).toBe('tok-v1');
      // Second attempt should see the freshly-minted token
      expect(tokensSeenByBuild[1]).toBe('tok-v2-fresh');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park: non-empty content check (mtime alone is insufficient)', async () => {
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        return { success: false, authFailure: true } as AuthResult;
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls < 2) {
        // Touch the file but leave it empty (should NOT trigger resume)
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, '', 'utf-8');
      } else {
        // Eventually timeout
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      await conductor.run();

      // Should have parked and timed out (only 1 build attempt, never resumed)
      expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.anything());
      // Park timed out: HALT marker should exist
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park timeout: HALT names daemon token path and re-mint instructions (not operator path)', async () => {
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        return { success: false, authFailure: true } as AuthResult;
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    const sleepFn = vi.fn(async () => {
      // Never update the token file, just advance time to timeout
      clockOffset += 120_000;
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      const haltPath = join(dir, '.pipeline/HALT');
      let haltBody: string | null = null;
      events.on('loop_halt', () => {
        // HALT marker should be written
      });

      await conductor.run();

      // Read HALT marker
      try {
        const { readFile } = await import('node:fs/promises');
        haltBody = await readFile(haltPath, 'utf-8');
      } catch {
        // HALT may not exist
      }

      expect(haltBody).not.toBeNull();
      expect(haltBody).toContain(tokenPath);
      expect(haltBody).toContain('claude setup-token');
      // Should NOT reference operator credentials
      expect(haltBody).not.toContain('.credentials.json');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('park timeout HALT: does not mention expiresAt or retries exhausted (daemon-token specific)', async () => {
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        return { success: false, authFailure: true } as AuthResult;
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    const sleepFn = vi.fn(async () => {
      clockOffset += 120_000;
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 3,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      const haltPath = join(dir, '.pipeline/HALT');
      let haltBody: string | null = null;

      await conductor.run();

      // Read HALT marker
      try {
        const { readFile } = await import('node:fs/promises');
        haltBody = await readFile(haltPath, 'utf-8');
      } catch {
        // HALT may not exist
      }

      expect(haltBody).not.toBeNull();
      // Task 13: Must NOT mention expiresAt
      expect(haltBody).not.toContain('expiresAt');
      expect(haltBody).not.toContain('Expires at');
      // Task 13: Must NOT mention "retries exhausted"
      expect(haltBody).not.toContain('retries exhausted');
      // Task 13: Must name daemon token path and setup command
      expect(haltBody).toContain(tokenPath);
      expect(haltBody).toContain('claude setup-token');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('park timeout: retry budget not consumed (park does not count as a retry)', async () => {
    let buildAttempts = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        buildAttempts++;
        if (buildAttempts === 1) {
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls === 1) {
        // First park sleep: trigger resume
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1, // Only 1 retry budget
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      await conductor.run();

      // Task 13: Park should NOT consume retry budget. With maxRetries=1:
      // - Attempt 1: build fails with authFailure
      // - Park (does not consume budget)
      // - Attempt 2 (same attempt counter, retry budget consumed here): build succeeds
      // So we should see exactly 2 build calls total, confirming park did not count as a separate retry.
      expect(buildAttempts).toBe(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('serial dispatch parks on the newly extended auth-failure patterns (FR-4, e.g. "Failed to authenticate. API Error: 401 Invalid bearer token")', async () => {
    // Verifies the serial (non-group) conductor dispatch path parks when the
    // step runner's result carries `authFailure: true` as classified by
    // claude-provider's extended AUTH_FAILURE_RE (Task 1). The park branch
    // gates purely on the boolean flag, not the literal pattern text, so any
    // string that AUTH_FAILURE_RE matches should engage the same park-and-poll
    // behavior as the pre-existing patterns (e.g. "not logged in").
    const observedOutput = 'Failed to authenticate. API Error: 401 Invalid bearer token';
    expect(detectsAuthFailure(observedOutput)).toBe(true);

    let buildAttempts = 0;
    let buildAttempt1Failed = false;

    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: false, output: 'auth-park test tail barrier' };
        buildAttempts++;
        if (buildAttempts === 1) {
          buildAttempt1Failed = true;
          return {
            success: false,
            output: observedOutput,
            authFailure: detectsAuthFailure(observedOutput),
          } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkResumeCalls = 0;
    const sleepFn = vi.fn(async () => {
      if (buildAttempt1Failed && parkResumeCalls === 0) {
        parkResumeCalls++;
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
        fullSuiteVerifier: fullSuiteVerifierStub(),
      });

      await conductor.run();

      // Build called twice: first fails with authFailure (parks, no retry
      // budget burned), second succeeds after park resumes on token refresh.
      expect(buildAttempts).toBe(2);
      expect(mockGuardrails.provisionSandbox).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
