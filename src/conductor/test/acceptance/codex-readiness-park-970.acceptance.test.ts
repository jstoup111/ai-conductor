/**
 * RED acceptance specs for #970. They drive the production Codex provider and
 * shared authentication-park coordinator; only the external Codex CLI process
 * boundary is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { AuthenticationReadiness, InvokeOptions } from '../../src/execution/llm-provider.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import { execa } from 'execa';

vi.mock('execa', () => ({ execa: vi.fn() }));

const mockExeca = vi.mocked(execa);
const base: InvokeOptions = {
  prompt: 'Perform one bounded Codex operation.',
  sessionId: 'codex-970-session',
  resume: false,
  cwd: '/workspace/feature-970',
};

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

const probeFailedReadiness = () => ({
  provider: 'codex' as const,
  source: 'cached-login' as const,
  state: 'probe-failed' as const,
  probeFailure: { kind: 'timeout' as const, facts: { timeoutMs: 10_000 } },
});

const cachedLoginAuthFailure = (): StepRunResult => ({
  success: false,
  authFailure: true,
  actualProvider: 'codex',
  authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
});

function documentedDoctor(
  authStatus: 'ok' | 'fail',
  overallStatus: 'ok' | 'fail',
  summary = authStatus === 'ok' ? 'credentials available' : 'invalid credentials',
) {
  return JSON.stringify({
    schemaVersion: 1,
    overallStatus,
    checks: { 'auth.credentials': { status: authStatus, summary } },
  });
}

function cachedLoginConductor(
  readiness: () => Promise<{ provider: 'codex'; source: 'cached-login'; state: 'ready' | 'unusable' }>,
  events: ConductorEventEmitter,
  sleepFn: (ms: number) => Promise<void>,
) {
  const runtimes = new ProviderRuntimeSet([{
    key: 'codex',
    provider: { invoke: vi.fn(), invokeInteractive: vi.fn(), readiness },
    policy: CODEX_MODEL_POLICY,
    builtIn: true,
    availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
  }]);

  return new Conductor({
    stateFilePath: '/tmp/codex-970-conduct-state.json',
    stepRunner: { run: vi.fn() },
    events,
    projectRoot: '/tmp',
    fromStep: 'build',
    mode: 'auto',
    sleepFn,
    config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
    providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
  });
}

describe('acceptance: Codex readiness park #970', () => {
  let flowDir: string;
  let flowStatePath: string;

  beforeEach(async () => {
    mockExeca.mockReset();
    delete process.env.CODEX_API_KEY;
    flowDir = await mkdtemp(join(tmpdir(), 'codex-readiness-970-'));
    flowStatePath = join(flowDir, 'conduct-state.json');
    await mkdir(join(flowDir, '.pipeline'), { recursive: true });
    await writeState(flowStatePath, READY_STATE);
  });

  afterEach(async () => {
    delete process.env.CODEX_API_KEY;
    vi.restoreAllMocks();
    await rm(flowDir, { recursive: true, force: true });
  });

  function recoveryRuntimes(readiness: () => Promise<AuthenticationReadiness>) {
    const fallbackReadiness = vi.fn<() => Promise<AuthenticationReadiness>>();
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
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness: fallbackReadiness },
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    return { runtimes, fallbackReadiness };
  }

  function clockedSleep() {
    const startedAt = Date.now();
    let elapsedMs = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => startedAt + elapsedMs);
    const sleepFn = vi.fn(async (delay: number) => { elapsedMs += delay; });
    return { nowSpy, sleepFn };
  }

  async function expectUnavailableProbeTrial(): Promise<void> {
    const readiness = vi.fn().mockResolvedValue(probeFailedReadiness());
    const conductor = cachedLoginConductor(readiness as never, new ConductorEventEmitter(), async () => {});

    const result = await (conductor as any).parkOnAuthFailure(cachedLoginAuthFailure());

    expect(result).toMatchObject({ disposition: 'trial-required', probeFailure: { kind: 'timeout' } });
    expect(readiness).toHaveBeenCalledOnce();
  }

  async function writeSuccessfulGroupEvidence(step: StepName) {
    if (step === 'manual_test') {
      await writeFile(join(flowDir, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n');
    } else if (step === 'prd_audit') {
      await writeFile(join(flowDir, '.pipeline/prd-audit.md'), '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n| FR-1 | ALIGNED | | evidence.ts:1 | yes |\n');
    } else if (step === 'architecture_review_as_built') {
      await writeFile(join(flowDir, '.pipeline/architecture-review-as-built.md'), '# As-Built Architecture Review\n\nVerdict: APPROVED\n');
    }
  }

  it('proceeds through the public Codex invocation boundary when auth is ok but unrelated doctor health fails', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: documentedDoctor('ok', 'fail'), stderr: '', exitCode: 1 } as never)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as never);

    const result = await new CodexProvider().invoke(base);

    expect(result).toMatchObject({ success: true, authentication: { source: 'cached-login', state: 'ready' } });
    expect(mockExeca).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing', documentedDoctor('fail', 'fail', 'no Codex credentials were found'), 'missing'],
    ['rejected', documentedDoctor('fail', 'fail', 'credentials unauthorized'), 'unusable'],
    ['ambiguous green envelope', documentedDoctor('ok', 'ok', 42 as never), 'unverifiable'],
  ] as const)('contrasts unavailable doctor evidence with %s auth evidence', async (_case, stdout, state) => {
    mockExeca
      .mockResolvedValueOnce({ stdout: '{not-json', stderr: '', exitCode: 0 } as never)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as never);
    const degraded = await new CodexProvider().invoke(base);
    expect(degraded).toMatchObject({
      success: true,
      authentication: { state: 'probe-failed', probeFailure: { kind: 'unparseable-output' } },
    });
    mockExeca.mockReset();

    mockExeca.mockResolvedValueOnce({ stdout, stderr: 'raw doctor diagnostic', exitCode: 1 } as never);
    if (state === 'unverifiable') {
      mockExeca.mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as never);
    }

    const result = await new CodexProvider().invoke(base);

    expect(result).toMatchObject(
      state === 'unverifiable'
        ? { success: true, authentication: { source: 'cached-login', state: 'probe-failed' } }
        : { success: false, authentication: { source: 'cached-login', state } },
    );
    expect(mockExeca).toHaveBeenCalledTimes(state === 'unverifiable' ? 2 : 1);
    expect(JSON.stringify(result)).not.toContain('raw doctor diagnostic');
  });

  it('backs off shared cached-login recovery at 1/2/4 seconds before resuming the same source', async () => {
    const readiness = vi
      .fn<() => Promise<{ provider: 'codex'; source: 'cached-login'; state: 'ready' | 'unusable' }>>()
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'unusable' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'unusable' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'unusable' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
    const delays: number[] = [];
    const events = new ConductorEventEmitter();
    const conductor = cachedLoginConductor(readiness, events, async (delay) => { delays.push(delay); });

    const result = await (conductor as any).parkOnAuthFailure({
      actualProvider: 'codex',
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    });

    expect(result).toEqual({ disposition: 'recovered' });
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(readiness).toHaveBeenCalledTimes(4);
  });

  it('emits one lifecycle start plus typed, sanitized durable progress while parked', async () => {
    const readiness = vi
      .fn<() => Promise<{ provider: 'codex'; source: 'cached-login'; state: 'ready' | 'unusable' }>>()
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'unusable' })
      .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
    const seen: ConductorEvent[] = [];
    const events = new ConductorEventEmitter();
    const emit = events.emit.bind(events);
    events.emit = async (event) => {
      seen.push(event);
      await emit(event);
    };
    const conductor = cachedLoginConductor(readiness, events, async () => {});

    await (conductor as any).parkOnAuthFailure({
      actualProvider: 'codex',
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    });

    expect(seen.filter((event) => event.type === 'credentials_park')).toHaveLength(1);
    expect(seen).toContainEqual(expect.objectContaining({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
    }));
    expect(JSON.stringify(seen)).not.toMatch(/token|credential path|raw doctor/i);
  });

  it.each([
    ['authorizes exactly one trial when the readiness probe fails', 'probe-failed', { disposition: 'trial-required', probeFailure: { kind: 'timeout' } }],
    ['halts on conclusive non-ready evidence after the bounded park', 'unusable', { disposition: 'halt' }],
  ] as const)('bounded recovery %s', async (_case, state, expected) => {
    const readiness = vi.fn().mockResolvedValue(
      state === 'probe-failed'
        ? { provider: 'codex' as const, source: 'cached-login' as const, state, probeFailure: { kind: 'timeout' as const, facts: { timeoutMs: 10_000 } } }
        : { provider: 'codex' as const, source: 'cached-login' as const, state },
    );
    const events = new ConductorEventEmitter();
    const now = Date.now();
    let elapsed = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now + elapsed);
    const conductor = cachedLoginConductor(readiness as never, events, async (delay) => { elapsed += delay; });
    try {
      const result = await (conductor as any).parkOnAuthFailure({
        actualProvider: 'codex',
        authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
      });
      expect(result).toMatchObject(expected);
      expect(readiness).toHaveBeenCalledTimes(state === 'probe-failed' ? 1 : 7);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.each([
    ['successful trial continues', 'success', [1, 1]],
    ['non-auth trial returns to the ordinary retry budget', 'non-auth', [1, 1, 2]],
    ['auth-failed trial halts without recursive recovery', 'auth', [1, 1]],
  ] as const)('serial recovery: %s', async (_case, trialKind, expectedAttempts) => {
    await writeState(flowStatePath, {
      ...READY_STATE,
      build_review: 'done',
      wiring_check: 'done',
      manual_test: 'done',
      prd_audit: 'done',
      architecture_review_as_built: 'done',
      retro: 'done',
      rebase: 'done',
      finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue(probeFailedReadiness());
    const { runtimes, fallbackReadiness } = recoveryRuntimes(readiness);
    const attempts: number[] = [];
    const halts: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('loop_halt', (event) => { if (event.type === 'loop_halt') halts.push(event.reason); });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        attempts.push(options?.attempt ?? -1);
        if (attempts.length === 1) return cachedLoginAuthFailure();
        if (attempts.length === 2) {
          if (trialKind === 'success') return { success: true, actualProvider: 'codex' };
          if (trialKind === 'non-auth') return { success: false, output: 'ordinary build failure', actualProvider: 'codex' };
          return cachedLoginAuthFailure();
        }
        return { success: true, actualProvider: 'codex' };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: flowStatePath,
      stepRunner: runner,
      events,
      projectRoot: flowDir,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 3,
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    await conductor.run();

    expect({ attempts, readinessCalls: readiness.mock.calls.length, fallbackCalls: fallbackReadiness.mock.calls.length })
      .toEqual({ attempts: [...expectedAttempts], readinessCalls: 1, fallbackCalls: 0 });
    if (trialKind === 'auth') {
      expect(halts).toEqual([expect.stringMatching(/recovery trial failed authentication[\s\S]*probe was unavailable/i)]);
    } else {
      expect(halts).toEqual([]);
    }
  });

  it.each(['missing', 'unusable'] as const)(
    'serial recovery times out on conclusive %s evidence without another dispatch',
    async (nonReadyState) => {
    await expectUnavailableProbeTrial();
    await writeState(flowStatePath, {
      ...READY_STATE,
      build_review: 'done', wiring_check: 'done', manual_test: 'done', prd_audit: 'done',
      architecture_review_as_built: 'done', retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue({ provider: 'codex', source: 'cached-login', state: nonReadyState });
    const { runtimes, fallbackReadiness } = recoveryRuntimes(readiness);
    const runner: StepRunner = { run: vi.fn(async () => cachedLoginAuthFailure()) };
    const halts: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('loop_halt', (event) => { if (event.type === 'loop_halt') halts.push(event.reason); });
    const { nowSpy, sleepFn } = clockedSleep();
    const conductor = new Conductor({
      stateFilePath: flowStatePath, stepRunner: runner, events, projectRoot: flowDir,
      fromStep: 'build', mode: 'auto', maxRetries: 3, sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    try {
      await conductor.run();
      expect({ dispatches: (runner.run as ReturnType<typeof vi.fn>).mock.calls.length, fallbackCalls: fallbackReadiness.mock.calls.length })
        .toEqual({ dispatches: 1, fallbackCalls: 0 });
      expect(readiness.mock.calls.length).toBeGreaterThan(1);
      expect(halts).toEqual([expect.stringMatching(/did not become ready before the auth park timed out/i)]);
    } finally {
      nowSpy.mockRestore();
    }
    },
  );

  it.each([
    ['successful trial continues', 'success'],
    ['non-auth trial returns to the ordinary group result path', 'non-auth'],
    ['auth-failed trial halts without recursive recovery', 'auth'],
  ] as const)('grouped recovery: %s and preserves completed siblings', async (_case, trialKind) => {
    await writeState(flowStatePath, {
      ...READY_STATE,
      build: 'done', build_review: 'done', wiring_check: 'done', retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue(probeFailedReadiness());
    const { runtimes, fallbackReadiness } = recoveryRuntimes(readiness);
    const calls: StepName[] = [];
    const halts: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('loop_halt', (event) => { if (event.type === 'loop_halt') halts.push(event.reason); });
    const runner: StepRunner = {
      run: vi.fn(async (step): Promise<StepRunResult> => {
        calls.push(step);
        if (step !== 'manual_test') {
          await writeSuccessfulGroupEvidence(step);
          return { success: true };
        }
        const manualCalls = calls.filter((call) => call === 'manual_test').length;
        if (manualCalls === 1) return cachedLoginAuthFailure();
        if (trialKind === 'success') {
          await writeSuccessfulGroupEvidence(step);
          return { success: true, actualProvider: 'codex' };
        }
        if (trialKind === 'non-auth') return { success: false, output: 'ordinary manual-test failure', actualProvider: 'codex' };
        return cachedLoginAuthFailure();
      }),
    };
    const conductor = new Conductor({
      stateFilePath: flowStatePath, stepRunner: runner, events, projectRoot: flowDir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 1, sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    await conductor.run();

    expect(Object.fromEntries(['manual_test', 'prd_audit', 'architecture_review_as_built']
      .map((step) => [step, calls.filter((call) => call === step).length])))
      .toEqual({ manual_test: 2, prd_audit: 1, architecture_review_as_built: 1 });
    expect({ readinessCalls: readiness.mock.calls.length, fallbackCalls: fallbackReadiness.mock.calls.length })
      .toEqual({ readinessCalls: 1, fallbackCalls: 0 });
    if (trialKind === 'auth') {
      expect(halts).toEqual([expect.stringMatching(/recovery trial for grouped member "manual_test" failed authentication/i)]);
    } else {
      const persisted = await readState(flowStatePath);
      expect(persisted.ok).toBe(true);
      if (persisted.ok) {
        expect(persisted.value.manual_test).toBe(trialKind === 'success' ? 'done' : 'failed');
      }
      if (trialKind === 'success') {
        expect(halts).toEqual([]);
      } else {
        expect(halts).toEqual([
          expect.stringMatching(/branch "manual_test" produced no-verdict[\s\S]*ordinary manual-test failure/i),
        ]);
        expect(halts.join('\n')).not.toMatch(/cached-login|recovery trial|readiness probe|probe-bypass/i);
      }
    }
  });

  it.each(['missing', 'unusable'] as const)(
    'grouped recovery times out on conclusive %s evidence without redispatching completed siblings',
    async (nonReadyState) => {
    await expectUnavailableProbeTrial();
    await writeState(flowStatePath, {
      ...READY_STATE,
      build: 'done', build_review: 'done', wiring_check: 'done', retro: 'done', rebase: 'done', finish: 'done',
    });
    const readiness = vi.fn().mockResolvedValue({ provider: 'codex', source: 'cached-login', state: nonReadyState });
    const { runtimes, fallbackReadiness } = recoveryRuntimes(readiness);
    const calls: StepName[] = [];
    const events = new ConductorEventEmitter();
    const runner: StepRunner = { run: vi.fn(async (step): Promise<StepRunResult> => {
      calls.push(step);
      if (step === 'manual_test') return cachedLoginAuthFailure();
      await writeSuccessfulGroupEvidence(step);
      return { success: true };
    }) };
    const { nowSpy, sleepFn } = clockedSleep();
    const conductor = new Conductor({
      stateFilePath: flowStatePath, stepRunner: runner, events, projectRoot: flowDir,
      fromStep: 'manual_test', mode: 'auto', maxRetries: 1, sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    try {
      await conductor.run();
      expect(Object.fromEntries(['manual_test', 'prd_audit', 'architecture_review_as_built']
        .map((step) => [step, calls.filter((call) => call === step).length])))
        .toEqual({ manual_test: 1, prd_audit: 1, architecture_review_as_built: 1 });
      expect(readiness.mock.calls.length).toBeGreaterThan(1);
      expect(fallbackReadiness).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
    },
  );

  it.each([
    ['successful trial continues', 'success', 'verified'],
    ['non-auth trial preserves its real result', 'non-auth', 'ordinary verifier failure'],
    ['auth-failed trial halts without recursive recovery', 'auth', 'recovery trial for the attribution verifier failed authentication'],
  ] as const)('auxiliary recovery: %s', async (_case, trialKind, expectedOutput) => {
    const readiness = vi.fn().mockResolvedValue(probeFailedReadiness());
    const { runtimes, fallbackReadiness } = recoveryRuntimes(readiness);
    const trialAuthentication = probeFailedReadiness();
    const trialResult = trialKind === 'success'
      ? { success: true, output: 'verified', actualProvider: 'codex', authentication: trialAuthentication }
      : trialKind === 'non-auth'
        ? { success: false, output: 'ordinary verifier failure', actualProvider: 'codex', authentication: trialAuthentication }
        : cachedLoginAuthFailure();
    const dispatchVerifier = vi.fn()
      .mockResolvedValueOnce(cachedLoginAuthFailure())
      .mockResolvedValueOnce(trialResult);
    const conductor = new Conductor({
      stateFilePath: flowStatePath,
      stepRunner: { run: vi.fn(), dispatchVerifier },
      events: new ConductorEventEmitter(),
      projectRoot: flowDir,
      mode: 'auto',
      sleepFn: vi.fn(async () => {}),
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    const result = await (conductor as any).dispatchSpotAuditVerifier({ residueIds: ['r1'], planPath: 'plan.md' });

    expect({ dispatches: dispatchVerifier.mock.calls.length, readinessCalls: readiness.mock.calls.length, fallbackCalls: fallbackReadiness.mock.calls.length })
      .toEqual({ dispatches: 2, readinessCalls: 1, fallbackCalls: 0 });
    expect(result.output).toContain(expectedOutput);
    if (trialKind !== 'auth') {
      expect(result).not.toHaveProperty('authFailure');
      expect(result).toMatchObject({
        authentication: trialAuthentication,
      });
    }
  });

  it.each(['missing', 'unusable'] as const)(
    'auxiliary recovery times out on conclusive %s evidence without redispatch',
    async (nonReadyState) => {
    await expectUnavailableProbeTrial();
    const readiness = vi.fn().mockResolvedValue({ provider: 'codex', source: 'cached-login', state: nonReadyState });
    const { runtimes, fallbackReadiness } = recoveryRuntimes(readiness);
    const dispatchVerifier = vi.fn().mockResolvedValue(cachedLoginAuthFailure());
    const { nowSpy, sleepFn } = clockedSleep();
    const conductor = new Conductor({
      stateFilePath: flowStatePath,
      stepRunner: { run: vi.fn(), dispatchVerifier },
      events: new ConductorEventEmitter(),
      projectRoot: flowDir,
      mode: 'auto',
      sleepFn,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
      providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] },
    });

    try {
      const result = await (conductor as any).dispatchSpotAuditVerifier({ residueIds: ['r1'], planPath: 'plan.md' });
      expect(result).toMatchObject({ success: false, authFailure: true });
      expect(dispatchVerifier).toHaveBeenCalledTimes(1);
      expect(readiness.mock.calls.length).toBeGreaterThan(1);
      expect(fallbackReadiness).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
    },
  );
});
