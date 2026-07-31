/**
 * RED acceptance specs for #970. They drive the production Codex provider and
 * shared authentication-park coordinator; only the external Codex CLI process
 * boundary is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { execa } from 'execa';

vi.mock('execa', () => ({ execa: vi.fn() }));

const mockExeca = vi.mocked(execa);
const base: InvokeOptions = {
  prompt: 'Perform one bounded Codex operation.',
  sessionId: 'codex-970-session',
  resume: false,
  cwd: '/workspace/feature-970',
};

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
  beforeEach(() => {
    mockExeca.mockReset();
    delete process.env.CODEX_API_KEY;
  });

  afterEach(() => {
    delete process.env.CODEX_API_KEY;
    vi.restoreAllMocks();
  });

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
  ] as const)('classifies %s auth evidence without leaking doctor diagnostics', async (_case, stdout, state) => {
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
    ['authorizes exactly one trial when the readiness probe fails', 'probe-failed', { disposition: 'trial-required' }],
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
});
