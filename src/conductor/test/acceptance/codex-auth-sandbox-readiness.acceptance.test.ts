/**
 * RED acceptance specs for #905. These drive the real Codex provider entrypoint
 * and mock only its external Codex CLI process boundary. They deliberately fail
 * until the approved readiness, source, policy, and sanitization contract exists.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { Options } from 'execa';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';

// The `execa` type is an intersection of several call-signature overloads
// (template-literal, bind, 2-arg short, 3-arg long); `Parameters<typeof execa>`
// — which `vi.mocked()` relies on — resolves to only the LAST overload (the
// 2-arg short form), even though the codex-provider under test always calls
// the real 3-arg long form `execa(command, args, options)`. This repoints the
// mock at that actual call shape so `.mock.calls` reflects what is really
// invoked, instead of casting every read site to `any`.
type ExecaLongCall = (
  file: string,
  args: readonly string[],
  options?: Options,
) => ReturnType<typeof execa>;
const mockExeca = vi.mocked(execa as unknown as ExecaLongCall);
const secret = 'sk-905-secret-never-log';
const base: InvokeOptions = {
  prompt: 'Implement the approved change.',
  sessionId: 'codex-905-session',
  resume: false,
  cwd: '/workspace/feature-905',
};

function doctorReady(source: 'cached-login' | 'api-key' = 'cached-login') {
  return JSON.stringify({
    schemaVersion: 1,
    auth: { selectedMode: source, configured: true },
    transport: { authenticated: true },
  });
}

function doctorNonReady(
  source: 'cached-login' | 'api-key',
  state: 'missing' | 'unusable' | 'unverifiable',
) {
  if (state === 'unverifiable') return '{not-json';
  return JSON.stringify({
    schemaVersion: 1,
    auth: {
      selectedMode: source,
      configured: state === 'unusable',
      ...(state === 'unusable' ? { rejected: true } : {}),
    },
    transport: { authenticated: false },
  });
}

function doctorAuthReadyWithUnrelatedHealthFailure() {
  return JSON.stringify({
    schemaVersion: 1,
    overallStatus: 'fail',
    checks: { 'auth.credentials': { status: 'ok', summary: 'credentials available' } },
  });
}

describe('acceptance: Codex auth and bounded unattended execution (#905)', () => {
  let priorKey: string | undefined;

  beforeEach(() => {
    mockExeca.mockReset();
    priorKey = process.env.CODEX_API_KEY;
    delete process.env.CODEX_API_KEY;
  });

  afterEach(() => {
    if (priorKey === undefined) delete process.env.CODEX_API_KEY;
    else process.env.CODEX_API_KEY = priorKey;
  });

  // Covers: FR-1, FR-6, FR-7, FR-8, FR-9
  it('freshly probes cached login before every unattended initial and resumed execution', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'resumed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    await provider.invoke(base);
    await provider.invoke({ ...base, resume: true });

    expect(mockExeca).toHaveBeenCalledTimes(4);
    for (const index of [0, 2]) {
      const [command, args] = mockExeca.mock.calls[index];
      expect(command).toBe('codex');
      expect(args).toEqual(expect.arrayContaining(['doctor', '--json', '--summary']));
    }
  });

  // Covers: FR-2, FR-3, FR-4, FR-5, FR-12
  it('selects a supplied API key for both readiness and execution without exposing it', async () => {
    process.env.CODEX_API_KEY = secret;
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady('api-key'), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    const result = await provider.invoke(base);

    expect(mockExeca).toHaveBeenCalledTimes(2);
    for (const [, args, options] of mockExeca.mock.calls) {
      expect(args).not.toContain(secret);
      expect(options?.env?.CODEX_API_KEY).toBe(secret);
    }
    expect(result.output).not.toContain(secret);
  });

  // Covers: FR-10, FR-11, FR-19, FR-20, FR-22
  it('fails closed on rejected selected authentication without dispatching or falling back', async () => {
    process.env.CODEX_API_KEY = secret;
    mockExeca.mockResolvedValueOnce({
      stdout: doctorNonReady('api-key', 'unusable'),
      stderr: `401 invalid key ${secret}`,
      exitCode: 1,
    } as any);
    const provider = new CodexProvider();

    const result = await provider.invoke(base);

    expect(mockExeca).toHaveBeenCalledTimes(1);
    const [, args] = mockExeca.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['doctor', '--json', '--summary']));
    expect(args).not.toContain('exec');
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/selected Codex authentication source was rejected/i);
    expect(result.output).not.toContain(secret);
    expect(result.output).not.toMatch(/claude|anthropic/i);
  });

  // Covers: FR-13, FR-14, FR-15, FR-16, FR-17, FR-18
  it('applies the same explicit bounded policy on initial and resumed unattended calls', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'resumed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    await provider.invoke(base);
    await provider.invoke({ ...base, resume: true });

    for (const index of [1, 3]) {
      const [, args] = mockExeca.mock.calls[index];
      expect(args).toEqual(expect.arrayContaining([
        'sandbox_mode="workspace-write"',
        'sandbox_workspace_write.network_access=true',
        'approval_policy="on-request"',
        'approvals_reviewer="auto_review"',
        'shell_environment_policy.ignore_default_excludes=false',
      ]));
      expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    }
  });

  // Covers: FR-1 through FR-5. The selected source must agree with the
  // captured doctor evidence; a mismatched source is deliberately unverifiable.
  it.each([
    ['cached-only', undefined, doctorReady('cached-login'), 'ready', 'cached-login'],
    ['api-key-only', secret, doctorReady('api-key'), 'ready', 'api-key'],
    ['both sources', secret, doctorReady('api-key'), 'ready', 'api-key'],
    ['neither source', undefined, doctorNonReady('cached-login', 'missing'), 'missing', 'cached-login'],
  ] as Array<[string, string | undefined, string, 'ready' | 'missing' | 'unusable', string]>)('selects %s deterministically and never falls back', async (_case, apiKey, stdout, state, source) => {
    if (apiKey) process.env.CODEX_API_KEY = apiKey;
    mockExeca.mockResolvedValueOnce({ stdout, stderr: '', exitCode: state === 'unusable' ? 1 : 0 } as any);
    if (state === 'ready') mockExeca.mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any);

    const result = await new CodexProvider().invoke(base);

    expect(result.authentication).toMatchObject({ provider: 'codex', source, state });
    expect(mockExeca).toHaveBeenCalledTimes(state === 'ready' ? 2 : 1);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  // Covers: FR-6 through FR-11. Inconclusive evidence authorizes one real
  // invocation, while affirmative credential evidence remains terminal.
  it.each(['missing', 'unusable'] as const)(
    'distinguishes unavailable doctor evidence from affirmative %s evidence',
    async (state) => {
      mockExeca
        .mockResolvedValueOnce({ stdout: '{not-json', stderr: '', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: 'trial completed', stderr: '', exitCode: 0 } as any);

      const degraded = await new CodexProvider().invoke({ ...base, resume: true });

      expect(degraded).toMatchObject({
        success: true,
        authentication: { state: 'probe-failed', probeFailure: { kind: 'unparseable-output' } },
      });
      expect(mockExeca.mock.calls.map(([, args]) => args.includes('exec'))).toEqual([false, true]);
      mockExeca.mockReset();

      mockExeca.mockResolvedValueOnce({
        stdout: doctorNonReady('cached-login', state), stderr: `diagnostic ${secret}`, exitCode: state === 'missing' ? 0 : 1,
      } as any);

      const result = await new CodexProvider().invoke({ ...base, resume: true });

      expect(mockExeca).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ success: false, authFailure: true });
      expect(result.rateLimited).toBeUndefined();
      expect(result.modelUnavailable).toBeUndefined();
      expect(result.authentication).toMatchObject({ source: 'cached-login', state });
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  // An inconclusive doctor probe is not credential evidence. Every closed
  // probe-failure class still starts exactly one real Codex invocation; its
  // actual result remains authoritative.
  it.each([
    {
      name: 'execution error',
      doctor: Object.assign(new Error(`spawn ${secret}`), { code: 'ENOENT' }),
      kind: 'exec-error',
    },
    {
      name: 'timeout',
      doctor: Object.assign(new Error(`timed out ${secret}`), { timedOut: true }),
      kind: 'timeout',
    },
    {
      name: 'invalid JSON',
      doctor: { stdout: '{not-json', stderr: `diagnostic ${secret}`, exitCode: 0 },
      kind: 'unparseable-output',
    },
    {
      name: 'unsupported schema',
      doctor: { stdout: JSON.stringify({ schemaVersion: 2, raw: secret }), stderr: '', exitCode: 0 },
      kind: 'unparseable-output',
    },
    {
      name: 'unrecognized envelope',
      doctor: { stdout: JSON.stringify({ schemaVersion: 1, response: secret }), stderr: '', exitCode: 0 },
      kind: 'unparseable-output',
    },
    {
      name: 'conflicting selected source',
      doctor: { stdout: doctorReady('api-key'), stderr: '', exitCode: 0 },
      kind: 'unparseable-output',
    },
  ] as const)('dispatches after an inconclusive $name probe', async ({ doctor, kind }) => {
    if (doctor instanceof Error) mockExeca.mockRejectedValueOnce(doctor);
    else mockExeca.mockResolvedValueOnce(doctor as any);
    mockExeca.mockResolvedValueOnce({ stdout: 'real invocation completed', stderr: '', exitCode: 0 } as any);

    const result = await new CodexProvider().invoke({ ...base, resume: true });

    expect(result).toMatchObject({
      success: true,
      authentication: {
        provider: 'codex',
        source: 'cached-login',
        state: 'probe-failed',
        probeFailure: { kind },
      },
    });
    expect(mockExeca.mock.calls.map(([, args]) => args.includes('exec'))).toEqual([false, true]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  // #970: supported credentials evidence may authorize dispatch despite an
  // unrelated doctor-health failure. The completion result still owns its
  // classification: only a selected-source rejection is an auth failure.
  it.each([
    ['selected-source rejection', 'Authentication required. Please run codex login.', true],
    ['ordinary provider/network failure', 'network connection reset by peer', false],
  ] as const)('preserves %s after mixed-health readiness', async (_case, stderr, expectedAuthFailure) => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorAuthReadyWithUnrelatedHealthFailure(), stderr: 'unrelated health check failed', exitCode: 1 } as any)
      .mockResolvedValueOnce({ stdout: '', stderr, exitCode: 1 } as any);

    const result = await new CodexProvider().invoke(base);

    expect(result.authentication).toMatchObject({
      provider: 'codex',
      source: 'cached-login',
      state: expectedAuthFailure ? 'unusable' : 'ready',
    });
    expect(result.authFailure).toBe(expectedAuthFailure || undefined);
    expect(mockExeca).toHaveBeenCalledTimes(2);
  });

  // #970/#254 canary: a preceding BUILD must not taint the adjacent
  // build_review dispatch when the selected cached login remains supported
  // but an unrelated doctor diagnostic is degraded.
  it('keeps the same cached login ready for adjacent BUILD then build_review work', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorAuthReadyWithUnrelatedHealthFailure(), stderr: 'unrelated health check failed', exitCode: 1 } as any)
      .mockResolvedValueOnce({ stdout: 'BUILD completed', stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: doctorAuthReadyWithUnrelatedHealthFailure(), stderr: 'unrelated health check failed', exitCode: 1 } as any)
      .mockResolvedValueOnce({ stdout: 'build_review completed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    const build = await provider.invoke({ ...base, prompt: 'BUILD' });
    const review = await provider.invoke({ ...base, prompt: 'build_review' });

    expect([build, review]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        success: true,
        authentication: expect.objectContaining({
          provider: 'codex', source: 'cached-login', state: 'ready',
        }),
      }),
    ]));
    expect(mockExeca.mock.calls.map(([, args]) => args.includes('exec'))).toEqual([false, true, false, true]);
  });

  // Covers: FR-13 through FR-18 and FR-22. A denied review is still bounded by
  // the exact unattended policy and never causes the old danger-bypass mode.
  it('keeps the bounded policy when a reviewer denies an unattended resume', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'approval denied by reviewer', exitCode: 1 } as any);

    const result = await new CodexProvider().invoke({ ...base, resume: true });
    const [, args] = mockExeca.mock.calls[1];

    expect(result.success).toBe(false);
    expect(args).toEqual(expect.arrayContaining([
      'sandbox_mode="workspace-write"',
      'sandbox_workspace_write.network_access=true',
      'approval_policy="on-request"',
      'approvals_reviewer="auto_review"',
      'shell_environment_policy.ignore_default_excludes=false',
    ]));
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  // Covers: FR-15 through FR-18. The mocked Codex process is the injected
  // runner/reviewer seam: no network or source-control publication occurs here.
  it('auto-reviews an approved lifecycle request that needs network and source-control publication', async () => {
    const lifecycleRequest = 'Download the approved dependency, run the migration, commit the change, and push the branch.';
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'dependency installed; migration committed and branch published', stderr: '', exitCode: 0 } as any);

    const result = await new CodexProvider().invoke({ ...base, prompt: lifecycleRequest });
    const [command, args, options] = mockExeca.mock.calls[1];

    expect(result).toMatchObject({ success: true });
    expect(command).toBe('codex');
    expect(args).toEqual(expect.arrayContaining([
      'sandbox_mode="workspace-write"',
      'sandbox_workspace_write.network_access=true',
      'approval_policy="on-request"',
      'approvals_reviewer="auto_review"',
    ]));
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(options?.input).toContain(lifecycleRequest);
    expect(mockExeca.mock.calls.map(([calledCommand]) => calledCommand)).toEqual(['codex', 'codex']);
  });

  // Covers: FR-21
  it('keeps the Codex readiness and policy boundary self-host compatible without Claude configuration', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    await provider.invoke(base);

    expect(mockExeca).toHaveBeenCalledTimes(2);
    const [doctorCommand, doctorArgs, doctorOptions] = mockExeca.mock.calls[0];
    const [, execArgs, execOptions] = mockExeca.mock.calls[1];
    expect(doctorCommand).toBe('codex');
    expect(doctorArgs).toEqual(expect.arrayContaining(['doctor', '--json', '--summary']));
    expect(execArgs).toEqual(expect.arrayContaining(['approvals_reviewer="auto_review"']));
    expect(doctorOptions?.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(doctorOptions?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(execOptions?.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(execOptions?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});
