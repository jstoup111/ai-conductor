/**
 * RED acceptance specs for #1039.
 *
 * These specs drive the production Codex invocation boundary and the shared
 * authentication-recovery coordinator. The external Codex process is replaced
 * by a deterministic fake; no real provider, network, or credential store is
 * reachable.
 *
 * Critical production call sites covered by the degraded-readiness derivation:
 *   - src/execution/codex-provider.ts#CodexProvider.invoke
 *   - src/execution/codex-provider.ts#CodexProvider.invokeInteractive
 *   - src/engine/conductor.ts#Conductor.parkOnAuthFailure
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from 'execa';
import { CodexProvider, type CodexDoctorRunner } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';

type ExecaLongCall = (
  file: string,
  args: readonly string[],
  options?: Options,
) => ReturnType<typeof execa>;

const mockExeca = vi.mocked(execa as unknown as ExecaLongCall);
const secret = 'sk-1039-secret-never-retain';
const base: InvokeOptions = {
  prompt: 'Perform one bounded Codex operation.',
  sessionId: 'codex-1039-session',
  resume: false,
  cwd: '/workspace/feature-1039',
};

function successfulCodexResult(output = 'completed') {
  return {
    stdout: JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: output },
    }),
    stderr: '',
    exitCode: 0,
  };
}

function doctorResult(stdout: unknown, exitCode = 0) {
  return { stdout, stderr: `raw doctor ${secret}`, exitCode };
}

function providerWithDoctor(runDoctor: CodexDoctorRunner): CodexProvider {
  return new CodexProvider(runDoctor);
}

type FutureProbeFailure = {
  provider: 'codex';
  source: 'cached-login';
  state: 'probe-failed';
  failure: { kind: 'exec-error' | 'timeout' | 'unparseable-output' };
};

function recoveryConductor(
  readiness: () => Promise<FutureProbeFailure>,
  events: ConductorEventEmitter,
): Conductor {
  const runtimes = new ProviderRuntimeSet([{
    key: 'codex',
    provider: {
      invoke: vi.fn(),
      invokeInteractive: vi.fn(),
      readiness,
    } as never,
    policy: CODEX_MODEL_POLICY,
    builtIn: true,
    availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
  }]);

  return new Conductor({
    stateFilePath: '/tmp/codex-1039-conduct-state.json',
    stepRunner: { run: vi.fn() },
    events,
    projectRoot: '/tmp',
    fromStep: 'build',
    mode: 'auto',
    sleepFn: async () => {},
    config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
    providerExecution: {
      runtimes,
      sessions: {} as never,
      configuredProviders: ['codex'],
    },
  });
}

describe('acceptance: Codex readiness probe failure separation (#1039)', () => {
  beforeEach(() => {
    mockExeca.mockReset();
    delete process.env.CODEX_API_KEY;
  });

  afterEach(() => {
    delete process.env.CODEX_API_KEY;
    vi.restoreAllMocks();
  });

  // Covers: FR-1, FR-2, FR-3, FR-6, FR-7, FR-13, FR-14
  it.each([
    [
      'execution error',
      'exec-error',
      vi.fn(async () => { throw Object.assign(new Error(`spawn failed ${secret}`), { code: 'EIO' }); }),
    ],
    [
      'timeout',
      'timeout',
      vi.fn(async () => { throw Object.assign(new Error(`timed out ${secret}`), { timedOut: true }); }),
    ],
    ['invalid JSON', 'unparseable-output', vi.fn(async () => doctorResult(`{not-json-${secret}`))],
    ['unsupported schema', 'unparseable-output', vi.fn(async () => doctorResult(JSON.stringify({ schemaVersion: 999, secret })))],
    ['unrecognized envelope', 'unparseable-output', vi.fn(async () => doctorResult(JSON.stringify({ schemaVersion: 1, status: 'mystery', secret })))],
    [
      'conflicting selected-source evidence',
      'unparseable-output',
      vi.fn(async () => doctorResult(JSON.stringify({
        schemaVersion: 1,
        checks: { 'auth.credentials': { status: 'ok', summary: 'credentials available' } },
        auth: { selectedMode: 'api-key', configured: true },
        transport: { authenticated: true },
        secret,
      }))),
    ],
    [
      'ambiguous credential evidence',
      'unparseable-output',
      vi.fn(async () => doctorResult(JSON.stringify({
        schemaVersion: 1,
        checks: { 'auth.credentials': { status: 'warning', summary: `maybe ${secret}` } },
      }))),
    ],
  ] as Array<[string, FutureProbeFailure['failure']['kind'], CodexDoctorRunner]>) (
    'continues real dispatch after %s and retains only the closed %s diagnostic',
    async (_case, failureKind, runDoctor) => {
      mockExeca.mockResolvedValueOnce(successfulCodexResult() as never);
      const diagnostics: string[] = [];

      const result = await providerWithDoctor(runDoctor).invoke({
        ...base,
        diagnosticLog: (line) => diagnostics.push(line),
      });

      expect(result).toMatchObject({ success: true, authFailure: undefined });
      expect(mockExeca).toHaveBeenCalledTimes(1);
      expect(diagnostics.join('\n')).toContain(failureKind);
      expect(JSON.stringify({ result, diagnostics })).not.toContain(secret);
      expect(result.rateLimited).toBeUndefined();
      expect(result.modelUnavailable).toBeUndefined();
      expect(result.providerUnavailable).toBeUndefined();
    },
  );

  // Covers: FR-4, FR-5
  it.each([
    ['missing', 'no Codex credentials were found'],
    ['unusable', 'credentials unauthorized'],
  ] as const)('keeps affirmative %s evidence blocking and never starts model work', async (_state, summary) => {
    const runDoctor = vi.fn(async () => doctorResult(JSON.stringify({
      schemaVersion: 1,
      overallStatus: 'fail',
      checks: { 'auth.credentials': { status: 'fail', summary } },
    }), 1));

    const result = await providerWithDoctor(runDoctor).invoke(base);

    expect(result).toMatchObject({ success: false, authFailure: true });
    expect(mockExeca).not.toHaveBeenCalled();
  });

  // Covers: FR-5, FR-13, FR-14
  it.each([
    ['authentication', 'Authentication required. Please run codex login.', 'authFailure'],
    ['provider unavailable', 'spawn codex ENOENT', 'providerUnavailable'],
    ['rate limit', 'Error 429: rate limit exceeded', 'rateLimited'],
    ['permission', 'automatic approval review timed out', 'permissionDenied'],
    ['model unavailable', 'Requested model gpt-nope is unavailable', 'modelUnavailable'],
    ['session', 'Thread not found; cannot resume this session', 'sessionExpired'],
    ['ordinary', 'network connection reset by peer', undefined],
  ] as const)(
    'preserves the real %s result after a degraded preflight',
    async (_case, stderr, expectedFlag) => {
      const runDoctor = vi.fn(async () => doctorResult('{not-json'));
      mockExeca.mockResolvedValueOnce({ stdout: '', stderr, exitCode: 1 } as never);

      const result = await providerWithDoctor(runDoctor).invoke(base);

      expect(mockExeca).toHaveBeenCalledTimes(1);
      if (expectedFlag) {
        expect(result[expectedFlag]).toBe(true);
      } else {
        expect(result).toMatchObject({
          success: false,
          authFailure: undefined,
          providerUnavailable: undefined,
          rateLimited: undefined,
          permissionDenied: undefined,
          modelUnavailable: undefined,
          sessionExpired: undefined,
        });
      }
    },
  );

  // Covers: FR-8, FR-9, FR-10, FR-11, FR-13, FR-15
  it('authorizes one explicit recovery trial and emits secret-safe progress when the recovery probe fails', async () => {
    const readiness = vi.fn(async (): Promise<FutureProbeFailure> => ({
      provider: 'codex',
      source: 'cached-login',
      state: 'probe-failed',
      failure: { kind: 'timeout' },
    }));
    const seen: ConductorEvent[] = [];
    const events = new ConductorEventEmitter();
    const emit = events.emit.bind(events);
    events.emit = async (event) => {
      seen.push(event);
      await emit(event);
    };
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => { now += 61_000; return now; });
    const conductor = recoveryConductor(readiness, events);

    const result = await (conductor as unknown as {
      parkOnAuthFailure(failed: unknown): Promise<{
        disposition: 'recovered' | 'trial-required' | 'halt';
        probeFailure?: FutureProbeFailure['failure'];
      }>;
    }).parkOnAuthFailure({
      actualProvider: 'codex',
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    });

    expect(result).toEqual({
      disposition: 'trial-required',
      probeFailure: { kind: 'timeout' },
    });
    expect(readiness).toHaveBeenCalledTimes(1);
    expect(seen).toContainEqual(expect.objectContaining({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      degradation: 'probe-failure',
      probeFailureKind: 'timeout',
      nextDisposition: 'trial-required',
    }));
    expect(JSON.stringify(seen)).not.toContain(secret);
  });
});
