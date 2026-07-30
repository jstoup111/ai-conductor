import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CodexProvider,
  parseCodexJsonl,
} from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { IntervalClock } from '../../src/execution/observed-interval.js';
import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';

// This is a fake Codex CLI boundary: no test invokes a locally installed Codex.
//
// execa's real export type is a union of call-signature overloads (template
// tag / `(file, options)` / `(file, args, options)`), and `vi.mocked(execa)`
// collapses that to a single overload, losing the 3-argument `(file, args,
// options)` shape the provider actually calls. Build the mock with its real
// call signature directly (via `vi.hoisted` so it exists before the hoisted
// `vi.mock` factory runs) instead of deriving it from `execa`'s type.
const { mockExeca } = vi.hoisted(() => {
  return {
    mockExeca: vi.fn<
      (file: string, args: readonly string[], options: ExecaOptions) => Promise<ExecaResult>
    >(),
  };
});
vi.mock('execa', () => ({ execa: mockExeca }));

const baseOptions: InvokeOptions = {
  prompt: 'Make the no-op change',
  systemPrompt: 'You are the conductor.',
  sessionId: 'thread-123',
  resume: false,
  cwd: '/workspace/project',
};

function jsonlMessage(text: string): string {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 7 },
    }),
  ].join('\n');
}

function readyDoctorResult(source: 'api-key' | 'cached-login' = 'cached-login') {
  return {
    stdout: JSON.stringify({
      schemaVersion: 1,
      auth: { selectedMode: source, configured: true },
      transport: { authenticated: true },
    }),
    exitCode: 0,
  };
}

describe('CodexProvider', () => {
  let provider: CodexProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    provider = new CodexProvider(
      vi.fn(async (_command, _args, options) =>
        readyDoctorResult(options.env?.CODEX_API_KEY ? 'api-key' : 'cached-login'),
      ),
    );
  });

  it.each([
    {
      name: 'ordinary executable',
      executable: 'codex',
      selfHost: undefined,
    },
    {
      name: 'self-host executable',
      executable: '/isolated/bin/codex',
      selfHost: {
        executable: '/isolated/bin/codex',
        env: { CODEX_HOME: '/isolated/codex-home' },
        args: ['--config', 'project_doc_max_bytes=0'],
        teardown: async () => {},
      },
    },
  ])(
    'returns one successful subprocess interval for the $name without changing JSONL output or usage',
    async ({ executable, selfHost }) => {
      const readings = [2_000, 2_040];
      const clock: IntervalClock = {
        nowMs: () =>
          readings.shift() ??
          (() => {
            throw new Error('scripted clock exhausted');
          })(),
      };
      const runDoctor = vi.fn(async () => {
        expect(readings).toHaveLength(2);
        return readyDoctorResult();
      });
      provider = new CodexProvider(runDoctor, 'codex', clock);
      mockExeca.mockResolvedValue({
        stdout: jsonlMessage('No-op complete.'),
        exitCode: 0,
      } as any);

      const result = await provider.invoke({ ...baseOptions, selfHost });

      expect({
        executable: mockExeca.mock.calls[0][0],
        result,
        remainingClockReadings: readings,
      }).toEqual({
        executable,
        result: expect.objectContaining({
          success: true,
          output: 'No-op complete.',
          exitCode: 0,
          tokenUsage: { input: 12, cacheRead: 4, output: 7, numTurns: 1 },
          observedIntervals: [{ startedAtMs: 2_000, durationMs: 40 }],
          authentication: {
            provider: 'codex',
            source: 'cached-login',
            state: 'ready',
          },
        }),
        remainingClockReadings: [],
      });
    },
  );

  it.each([
    {
      name: 'operator-interactive completion',
      invoke: (subject: CodexProvider) =>
        subject.invokeInteractive({ ...baseOptions, interactive: true }),
      response: { stdout: 'Done!', stderr: '', exitCode: 0 },
      expected: { success: true },
    },
    {
      name: 'ordinary non-zero exit',
      invoke: (subject: CodexProvider) => subject.invoke(baseOptions),
      response: { stdout: '', stderr: 'build failed', exitCode: 1 },
      expected: { success: false },
    },
    {
      name: 'automatic permission rejection',
      invoke: (subject: CodexProvider) =>
        subject.invokeInteractive({ ...baseOptions, interactive: false }),
      response: {
        stdout: '',
        stderr: 'Codex automatic review denied the permission request.',
        exitCode: 1,
      },
      expected: { success: false, permissionDenied: true },
    },
    {
      name: 'authentication rejection',
      invoke: (subject: CodexProvider) => subject.invoke(baseOptions),
      response: {
        stdout: '',
        stderr: 'Authentication required. Please run codex login.',
        exitCode: 1,
      },
      expected: { success: false, authFailure: true },
    },
    {
      name: 'rate-limit rejection',
      invoke: (subject: CodexProvider) => subject.invoke(baseOptions),
      response: {
        stdout: '',
        stderr: 'Error 429: rate limit exceeded; retry after 45 seconds',
        exitCode: 1,
      },
      expected: { success: false, rateLimited: true },
    },
  ])('retains one subprocess interval for $name', async ({ invoke, response, expected }) => {
    const readings = [3_000, 3_075];
    const clock: IntervalClock = {
      nowMs: () =>
        readings.shift() ??
        (() => {
          throw new Error('scripted clock exhausted');
        })(),
    };
    const timedProvider = new CodexProvider(
      vi.fn(async () => readyDoctorResult()),
      'codex',
      clock,
    );
    mockExeca.mockResolvedValue(response as any);

    const result = await invoke(timedProvider);

    expect(result).toMatchObject({
      ...expected,
      observedIntervals: [{ startedAtMs: 3_000, durationMs: 75 }],
    });
  });

  it('prepares only the selected API-key auth for an isolated Codex home', async () => {
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = 'sk-self-host-selected';
    const apiKeyProvider = new CodexProvider(vi.fn(async () => readyDoctorResult('api-key')));
    try {
      const prepared = await apiKeyProvider.prepareSelfHostAuth!({
        provider: 'codex',
        homeDir: '/tmp/isolated-codex-home',
      });
      expect(prepared).toEqual({
        env: { CODEX_API_KEY: 'sk-self-host-selected' },
        args: [],
      });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

  it('keeps cached-login selection opaque while launching only through the supplied isolated home', async () => {
    const priorKey = process.env.CODEX_API_KEY;
    const priorHome = process.env.CODEX_HOME;
    const sourceHome = await mkdtemp(join(tmpdir(), 'codex-provider-source-'));
    const isolatedHome = await mkdtemp(join(tmpdir(), 'codex-provider-isolated-'));
    await writeFile(join(sourceHome, 'auth.json'), 'opaque-selected-login', { mode: 0o600 });
    delete process.env.CODEX_API_KEY;
    process.env.CODEX_HOME = sourceHome;
    const cachedProvider = new CodexProvider(vi.fn(async () => readyDoctorResult('cached-login')), '/resolved/codex');
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('isolated'), exitCode: 0 } as any);
    try {
      expect(await cachedProvider.prepareSelfHostAuth!({ provider: 'codex', homeDir: isolatedHome }))
        .toEqual({ args: [] });
      expect(await readFile(join(isolatedHome, 'auth.json'), 'utf8')).toBe('opaque-selected-login');
      await cachedProvider.invoke({
        ...baseOptions,
        selfHost: {
          executable: '/resolved/codex',
          env: { CODEX_HOME: isolatedHome },
          args: ['--config', 'project_doc_max_bytes=0'],
          teardown: async () => {},
        },
      });
      const [command, args, options] = mockExeca.mock.calls[0];
      expect(command).toBe('/resolved/codex');
      expect(args).toEqual(expect.arrayContaining(['--config', 'project_doc_max_bytes=0']));
      expect(options.env).toEqual({ CODEX_HOME: isolatedHome });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
      if (priorHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = priorHome;
      await Promise.all([
        rm(sourceHome, { recursive: true, force: true }),
        rm(isolatedHome, { recursive: true, force: true }),
      ]);
    }
  });

  it('runs a fresh Codex exec with its fixed unattended policy, JSONL, model, cwd, and stdin prompt delivery', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('No-op complete.'), exitCode: 0 } as any);

    const result = await provider.invoke({
      ...baseOptions,
      model: 'gpt-5.4',
      effort: 'high',
      dangerouslySkipPermissions: true,
    });

    const [command, args, options] = mockExeca.mock.calls[0];
    expect(command).toBe('codex');
    expect(args).toEqual(expect.arrayContaining(['exec', '--json', '--model', 'gpt-5.4', '--cd', '/workspace/project', '-']));
    expect(args).toEqual(expect.arrayContaining(['--config', 'model_reasoning_effort="high"']));
    expect(args).toEqual(expect.arrayContaining([
      '--config', 'sandbox_mode="workspace-write"',
      '--config', 'approval_policy="on-request"',
      '--config', 'approvals_reviewer="auto_review"',
      '--config', 'shell_environment_policy.ignore_default_excludes=false',
    ]));
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain(baseOptions.prompt);
    expect(options.input).toBe('You are the conductor.\n\nMake the no-op change');
    expect(options.cwd).toBe('/workspace/project');
    expect(result).toMatchObject({ success: true, output: 'No-op complete.', exitCode: 0 });
    expect(result.tokenUsage).toEqual({ input: 12, cacheRead: 4, output: 7, numTurns: 1 });
  });

  it('starts a fresh Codex exec and preserves cwd when handed resume: true', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Fresh.'), exitCode: 0 } as any);

    await provider.invoke({ ...baseOptions, resume: true, model: 'gpt-5.4', effort: 'high' });

    const [, args, options] = mockExeca.mock.calls[0];
    expect(args.slice(0, 5)).toEqual([
      'exec',
      '--model',
      'gpt-5.4',
      '--config',
      'model_reasoning_effort="high"',
    ]);
    expect(args).not.toContain('resume');
    expect(args).not.toContain('thread-123');
    expect(args).toEqual(expect.arrayContaining(['--cd', '/workspace/project']));
    expect(args).toEqual(expect.arrayContaining([
      'sandbox_mode="workspace-write"',
      'approval_policy="on-request"',
      'approvals_reviewer="auto_review"',
      'shell_environment_policy.ignore_default_excludes=false',
    ]));
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args.at(-1)).toBe('-');
    expect(options.cwd).toBe('/workspace/project');
  });

  it('enforces the same policy for automatic streaming while keeping API keys in the Codex client environment', async () => {
    const key = 'sk-905-scoped-client-key';
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = key;
    mockExeca.mockResolvedValue({ stdout: 'Streamed.', exitCode: 0 } as any);
    const apiKeyProvider = new CodexProvider(
      vi.fn(async (_command, _args, options) =>
        readyDoctorResult(options.env?.CODEX_API_KEY ? 'api-key' : 'cached-login'),
      ),
    );

    try {
      await apiKeyProvider.invokeInteractive({
        ...baseOptions,
        interactive: false,
        dangerouslySkipPermissions: true,
      });

      const [, args, options] = mockExeca.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining([
        'sandbox_mode="workspace-write"',
        'approval_policy="on-request"',
        'approvals_reviewer="auto_review"',
        'shell_environment_policy.ignore_default_excludes=false',
      ]));
      expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(options.env).toEqual({ CODEX_API_KEY: key });
      expect(args).not.toContain(key);
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

  it('captures every substantive Codex stream before returning sanitized one-shot and automatic-streaming output', async () => {
    const key = 'sk-905-contained-output-key';
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = key;
    const apiKeyProvider = new CodexProvider(vi.fn(async () => readyDoctorResult('api-key')));
    mockExeca
      .mockResolvedValueOnce({ stdout: jsonlMessage(`One-shot leaked ${key.slice(0, 8)}.`), exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: `Automatic stream leaked ${key.slice(-8)}.`, exitCode: 0 } as any);

    try {
      const oneShot = await apiKeyProvider.invoke(baseOptions);
      const automatic = await apiKeyProvider.invokeInteractive({ ...baseOptions, interactive: false });

      expect(mockExeca.mock.calls.map(([, , options]) => ({ stdout: options.stdout, stderr: options.stderr }))).toEqual([
        { stdout: 'pipe', stderr: 'pipe' },
        { stdout: 'pipe', stderr: 'pipe' },
      ]);
      expect(`${oneShot.output}\n${automatic.output}`).not.toContain(key.slice(0, 8));
      expect(`${oneShot.output}\n${automatic.output}`).not.toContain(key.slice(-8));
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

  it('forwards one-shot and automatic-stream subprocess diagnostics through the supplied feature logger', async () => {
    const featureLog = vi.fn();
    mockExeca
      .mockResolvedValueOnce({ stdout: jsonlMessage('one-shot output'), stderr: 'one-shot stderr', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'automatic output', stderr: 'automatic stderr', exitCode: 0 } as any);

    await provider.invoke({ ...baseOptions, diagnosticLog: featureLog });
    await provider.invokeInteractive({ ...baseOptions, interactive: false, diagnosticLog: featureLog });

    // A recognized JSONL machine stream reaches the daemon log as a readable
    // summary; prose stdout and stderr still pass through verbatim so no
    // diagnostic detail is traded away for readability.
    expect(featureLog).toHaveBeenCalledWith('codex: done — 12→7 tok\none-shot output');
    expect(featureLog).toHaveBeenCalledWith('one-shot stderr');
    expect(featureLog).toHaveBeenCalledWith('automatic output');
    expect(featureLog).toHaveBeenCalledWith('automatic stderr');
  });

  it('keeps a >128 KiB prompt out of argv', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Done.'), exitCode: 0 } as any);
    const prompt = 'x'.repeat(200_000);

    await provider.invoke({ ...baseOptions, prompt });

    const [, args, options] = mockExeca.mock.calls[0];
    expect(options.input).toContain(prompt);
    for (const arg of args) expect(arg.length).toBeLessThan(1024);
  });

  it('fails closed with a Codex permission diagnostic when automatic review reports a structured denial or review timeout', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: JSON.stringify({ type: 'error', code: 'approval_denied' }), stderr: '', exitCode: 1 } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'Codex automatic review timed out awaiting approval.', exitCode: 1, timedOut: true } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'Codex automatic review returned an unknown result.', exitCode: 1 } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'Codex automatic review failed to produce a decision.', exitCode: 1 } as any);

    const oneShot = await provider.invoke(baseOptions);
    const automaticStream = await provider.invokeInteractive({ ...baseOptions, interactive: false, resume: true });
    const unknownReview = await provider.invoke(baseOptions);
    const failedReview = await provider.invoke(baseOptions);

    for (const result of [oneShot, automaticStream, unknownReview, failedReview]) {
      expect(result).toMatchObject({
        success: false,
        permissionDenied: true,
        authFailure: undefined,
        rateLimited: undefined,
        modelUnavailable: undefined,
        sessionExpired: undefined,
        authentication: { provider: 'codex', source: 'cached-login', state: 'ready' },
      });
      expect(result.output).toMatch(/Codex.*automatic permission.*(unavailable|denied).*retry/i);
    }
    expect(mockExeca.mock.calls.map(([, args]) => args)).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['approval_policy="on-request"', 'approvals_reviewer="auto_review"']),
        expect.arrayContaining([
          'approval_policy="on-request"',
          'approvals_reviewer="auto_review"',
          '--cd',
          '/workspace/project',
        ]),
      ]),
    );
  });

  it('does not misclassify generic empty, process-timeout, unrelated unknown, or build failures as Codex permission decisions', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'child process timed out', exitCode: 1, timedOut: true } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'model response contained an unknown field', exitCode: 1 } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'build failed', exitCode: 1 } as any);

    const emptyFailure = await provider.invoke(baseOptions);
    const timeoutFailure = await provider.invokeInteractive({ ...baseOptions, interactive: false });
    const unrelatedUnknown = await provider.invoke(baseOptions);
    const buildFailure = await provider.invoke(baseOptions);

    expect(emptyFailure).toMatchObject({ success: false, output: '', permissionDenied: undefined });
    expect(timeoutFailure).toMatchObject({
      success: false,
      output: 'child process timed out',
      permissionDenied: undefined,
    });
    expect(unrelatedUnknown).toMatchObject({
      success: false,
      output: 'model response contained an unknown field',
      permissionDenied: undefined,
    });
    expect(buildFailure).toMatchObject({
      success: false,
      output: 'build failed',
      permissionDenied: undefined,
    });
  });

  it.each([
    { name: 'cached login when no API key is supplied', key: undefined, source: 'cached-login' },
    { name: 'an API key when it is supplied', key: 'sk-905-api-key', source: 'api-key' },
    { name: 'an API key when both sources are available', key: 'sk-905-api-key', source: 'api-key' },
    { name: 'cached login when neither source is known to be available', key: undefined, source: 'cached-login' },
  ] as const)(
    'selects $source for $name and never exposes the supplied credential',
    async ({ key, source }) => {
      const priorKey = process.env.CODEX_API_KEY;
      if (key === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = key;
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: `Invalid API key ${key ?? 'cached-login-path'}`,
        exitCode: 1,
      } as any);
      const selectedProvider = new CodexProvider(
        vi.fn(async (_command, _args, options) =>
          readyDoctorResult(options.env?.CODEX_API_KEY ? 'api-key' : 'cached-login'),
        ),
      );

      try {
        const result = await selectedProvider.invoke(baseOptions);
        const [, , options] = mockExeca.mock.calls[0];

        expect({
          authentication: result.authentication,
          output: result.output,
          childKey: options.env?.CODEX_API_KEY,
        }).toEqual({
          authentication: {
            provider: 'codex',
            source,
            state: 'unusable',
          },
          output: `Codex authentication failed using the selected ${source} source.`,
          childKey: key,
        });
      } finally {
        if (priorKey === undefined) delete process.env.CODEX_API_KEY;
        else process.env.CODEX_API_KEY = priorKey;
      }
    },
  );

  it('redacts an API key and its visible fragments from successful result output', async () => {
    const key = 'sk-905-api-key-fragment';
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = key;
    mockExeca.mockResolvedValue({
      stdout: jsonlMessage(`Completed with ${key}, ${key.slice(0, 8)}, and ${key.slice(-8)}.`),
      exitCode: 0,
    } as any);
    const apiKeyProvider = new CodexProvider(vi.fn(async () => readyDoctorResult('api-key')));

    try {
      const result = await apiKeyProvider.invoke(baseOptions);

      expect(result.output).not.toMatch(new RegExp(`${key}|${key.slice(0, 8)}|${key.slice(-8)}`));
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

  it('redacts even one-character API key prefixes and suffixes without empty matching', async () => {
    const key = 'ABCD';
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = key;
    mockExeca.mockResolvedValue({
      stdout: jsonlMessage(`Visible ${key.slice(0, 1)} ${key.slice(-1)} ${key}.`),
      exitCode: 0,
    } as any);
    const apiKeyProvider = new CodexProvider(vi.fn(async () => readyDoctorResult('api-key')));

    try {
      const result = await apiKeyProvider.invoke(baseOptions);

      expect(result.output).not.toMatch(new RegExp(`${key}|${key.slice(0, 1)}|${key.slice(-1)}`));
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

  it('probes the selected authentication source through a captured bounded doctor command', async () => {
    const key = 'sk-905-readiness-key';
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = key;
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        schemaVersion: 1,
        auth: { selectedMode: 'api-key', configured: true },
        transport: { authenticated: true },
      }),
      stderr: '',
      exitCode: 0,
    } as any);

    try {
      const defaultProvider = new CodexProvider();
      await expect(defaultProvider.readiness()).resolves.toEqual({
        provider: 'codex',
        source: 'api-key',
        state: 'ready',
      });

      const [command, args, options] = mockExeca.mock.calls[0];
      expect(command).toBe('codex');
      expect(args).toEqual(['doctor', '--json', '--summary']);
      expect(options).toMatchObject({
        reject: false,
        timeout: 10_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { CODEX_API_KEY: key },
      });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

  it('accepts an injected captured doctor runner without reaching the exec boundary', async () => {
    const runDoctor = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        schemaVersion: 1,
        auth: { selectedMode: 'cached-login', configured: true },
        transport: { authenticated: true },
      }),
      exitCode: 0,
    });
    const isolatedProvider = new CodexProvider(runDoctor);

    await expect(isolatedProvider.readiness()).resolves.toMatchObject({
      source: 'cached-login', state: 'ready',
    });
    expect(runDoctor).toHaveBeenCalledOnce();
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it.each([
    [
      'cached-login',
      undefined,
      {
        schemaVersion: 1,
        overallStatus: 'ok',
        checks: { 'auth.credentials': { status: 'ok', summary: 'Codex credentials are available' } },
      },
      0,
      'ready',
    ],
    [
      'API key',
      'sk-905-readiness-key',
      {
        schemaVersion: 1,
        overallStatus: 'ok',
        checks: { 'auth.credentials': { status: 'ok', summary: 'Codex credentials are available' } },
      },
      0,
      'ready',
    ],
    [
      'no credentials',
      undefined,
      {
        schemaVersion: 1,
        overallStatus: 'fail',
        checks: { 'auth.credentials': { status: 'fail', summary: 'no Codex credentials were found' } },
      },
      1,
      'missing',
    ],
    [
      'explicitly rejected credentials',
      undefined,
      {
        schemaVersion: 1,
        overallStatus: 'fail',
        checks: { 'auth.credentials': { status: 'fail', summary: 'invalid API key' } },
      },
      1,
      'unusable',
    ],
    [
      'missing credentials despite an unrelated overall-green summary',
      undefined,
      {
        schemaVersion: 1,
        overallStatus: 'ok',
        checks: { 'auth.credentials': { status: 'fail', summary: 'Codex credentials are missing' } },
      },
      0,
      'missing',
    ],
    [
      'expired credentials despite an unrelated overall-green summary',
      undefined,
      {
        schemaVersion: 1,
        overallStatus: 'ok',
        checks: { 'auth.credentials': { status: 'fail', summary: 'cached credentials expired' } },
      },
      0,
      'unusable',
    ],
  ] as const)(
    'classifies the documented doctor envelope for %s without exposing diagnostics',
    async (_name, apiKey, evidence, exitCode, state) => {
      const priorKey = process.env.CODEX_API_KEY;
      if (apiKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = apiKey;

      try {
        const runDoctor = vi.fn().mockResolvedValue({ stdout: JSON.stringify(evidence), exitCode });

        const readiness = await new CodexProvider(runDoctor).readiness();

        expect(readiness).toMatchObject({
          provider: 'codex',
          source: apiKey === undefined ? 'cached-login' : 'api-key',
          state,
        });
        expect(JSON.stringify(readiness)).not.toContain('credentials');
      } finally {
        if (priorKey === undefined) delete process.env.CODEX_API_KEY;
        else process.env.CODEX_API_KEY = priorKey;
      }
    },
  );

  it.each([
    [
      'all-green doctor health',
      'ok',
      { provider: 'codex', source: 'cached-login', state: 'ready' },
    ],
    [
      'unrelated degraded doctor health',
      'fail',
      {
        provider: 'codex',
        source: 'cached-login',
        state: 'ready',
        unrelatedHealth: 'degraded',
      },
    ],
    [
      'unrelated warning doctor health',
      'warning',
      {
        provider: 'codex',
        source: 'cached-login',
        state: 'ready',
        unrelatedHealth: 'degraded',
      },
    ],
  ] as const)(
    'classifies supported ready auth evidence with %s without leaking doctor diagnostics',
    async (_name, overallStatus, expected) => {
      const readiness = await new CodexProvider(
        vi.fn().mockResolvedValue({
          stdout: JSON.stringify({
            schemaVersion: 1,
            overallStatus,
            checks: {
              'auth.credentials': {
                status: 'ok',
                summary: 'credentials available; reachability probe failed at https://internal.example',
              },
            },
          }),
          exitCode: overallStatus === 'ok' ? 0 : 1,
        }),
      ).readiness();

      expect(readiness).toEqual(expected);
    },
  );

  it('stays ready when only a rate-limited update probe degrades the envelope', async () => {
    // Regression: a live daemon parked and then halted every Codex build for
    // the full 60-minute auth-park timeout because `codex doctor` returned
    // `overallStatus: "warning"` (its `updates.status` version probe was
    // HTTP 403 rate-limited) while `auth.credentials` was perfectly healthy.
    const readiness = await new CodexProvider(
      vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          schemaVersion: 1,
          overallStatus: 'warning',
          checks: {
            'auth.credentials': { status: 'ok', summary: 'auth is configured' },
            'updates.status': {
              status: 'warning',
              summary: 'update configuration is locally consistent',
              details: { 'latest version probe': 'curl: (22) The requested URL returned error: 403' },
            },
          },
        }),
        exitCode: 0,
      }),
    ).readiness();

    expect(readiness).toEqual({
      provider: 'codex',
      source: 'cached-login',
      state: 'ready',
      unrelatedHealth: 'degraded',
    });
  });

  it('keeps adversarial doctor diagnostics below the readiness boundary', async () => {
    const rawFragments = [
      '/private/codex/credentials.json',
      'sk-live-super-secret-token',
      'upstream.reachability.internal',
      'arbitrary doctor diagnostic text',
    ];
    const readiness = await new CodexProvider(
      vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          schemaVersion: 1,
          overallStatus: 'fail',
          checks: {
            'auth.credentials': {
              status: 'ok',
              summary: rawFragments.join(' '),
            },
            'upstream.reachability.internal': {
              status: 'fail',
              summary: rawFragments.join(' '),
            },
          },
        }),
        stderr: rawFragments.join(' '),
        exitCode: 1,
      }),
    ).readiness();

    expect(JSON.stringify(readiness)).not.toContain(rawFragments.join(' '));
  });

  it.each([
    [
      'missing auth check',
      { schemaVersion: 1, overallStatus: 'ok', checks: {} },
    ],
    [
      'unknown check status',
      {
        schemaVersion: 1,
        overallStatus: 'ok',
        checks: { 'auth.credentials': { status: 'warning', summary: 'maybe ready' } },
      },
    ],
    [
      'conflicting documented and legacy evidence',
      {
        schemaVersion: 1,
        overallStatus: 'ok',
        checks: { 'auth.credentials': { status: 'ok', summary: 'credentials available' } },
        auth: { selectedMode: 'cached-login', configured: false },
        transport: { authenticated: false },
      },
    ],
  ] as const)('fails closed for %s documented doctor evidence', async (_name, evidence) => {
    const readiness = await new CodexProvider(
      vi.fn().mockResolvedValue({ stdout: JSON.stringify(evidence), exitCode: 0 }),
    ).readiness();

    expect(readiness).toMatchObject({ source: 'cached-login', state: 'unverifiable' });
  });

  it('blocks an unattended invocation when its fresh readiness check is not ready', async () => {
    const runDoctor = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        schemaVersion: 1,
        auth: { selectedMode: 'cached-login', configured: false },
        transport: { authenticated: false },
      }),
      exitCode: 0,
    });
    const gatedProvider = new CodexProvider(runDoctor);

    const result = await gatedProvider.invoke(baseOptions);

    expect({ readiness: result.authentication, execCalls: mockExeca.mock.calls.length }).toEqual({
      readiness: expect.objectContaining({ state: 'missing' }),
      execCalls: 0,
    });
    expect(result).not.toHaveProperty('observedIntervals');
  });

  it.each([
    ['missing', 'no Codex credentials were found', 'missing'],
    ['unusable', 'cached credentials expired', 'unusable'],
  ] as const)(
    'blocks initial and adjacent unattended dispatches for explicit %s documented evidence',
    async (_name, summary, state) => {
      const runDoctor = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          schemaVersion: 1,
          overallStatus: 'ok',
          checks: { 'auth.credentials': { status: 'fail', summary } },
        }),
        exitCode: 0,
      });
      const gatedProvider = new CodexProvider(runDoctor);

      const initial = await gatedProvider.invoke(baseOptions);
      const adjacent = await gatedProvider.invokeInteractive({ ...baseOptions, interactive: false, resume: true });

      expect({
        initial: initial.authentication?.state,
        adjacent: adjacent.authentication?.state,
        doctorCalls: runDoctor.mock.calls.length,
        substantiveCalls: mockExeca.mock.calls.length,
        output: `${initial.output}\n${adjacent.output}`,
      }).toEqual({
        initial: state,
        adjacent: state,
        doctorCalls: 2,
        substantiveCalls: 0,
        output: expect.not.stringContaining(summary),
      });
    },
  );

  it('checks readiness again before a resumed unattended dispatch', async () => {
    const runDoctor = vi.fn().mockResolvedValue(readyDoctorResult());
    const gatedProvider = new CodexProvider(runDoctor);
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Done.'), exitCode: 0 } as any);

    await gatedProvider.invoke(baseOptions);
    await gatedProvider.invoke({ ...baseOptions, resume: true });

    expect({ readinessChecks: runDoctor.mock.calls.length, executions: mockExeca.mock.calls.length }).toEqual({
      readinessChecks: 2,
      executions: 2,
    });
  });

  it('keeps the constructor-bound API key across readiness and resumed exec after environment changes', async () => {
    const key = 'sk-905-bound-at-construction';
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = key;
    const runDoctor = vi.fn(async () => {
      delete process.env.CODEX_API_KEY;
      return readyDoctorResult('api-key');
    });
    const boundProvider = new CodexProvider(runDoctor);
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Done.'), exitCode: 0 } as any);

    try {
      await boundProvider.invoke(baseOptions);
      await boundProvider.invoke({ ...baseOptions, resume: true });

      expect(mockExeca.mock.calls.map(([, , options]) => options.env)).toEqual([
        { CODEX_API_KEY: key },
        { CODEX_API_KEY: key },
      ]);
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

  it('gates automatic streaming but preserves an operator interactive session', async () => {
    const runDoctor = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        schemaVersion: 1,
        auth: { selectedMode: 'cached-login', configured: false },
        transport: { authenticated: false },
      }),
      exitCode: 0,
    });
    const gatedProvider = new CodexProvider(runDoctor);
    mockExeca.mockResolvedValue({ stdout: 'interactive output', exitCode: 0 } as any);

    const automatic = await gatedProvider.invokeInteractive({ ...baseOptions, interactive: false });
    const interactive = await gatedProvider.invokeInteractive({ ...baseOptions, interactive: true });

    expect({
      automaticState: automatic.authentication?.state,
      operatorExecutionCount: mockExeca.mock.calls.length,
      readinessChecks: runDoctor.mock.calls.length,
      interactiveSuccess: interactive.success,
    }).toEqual({
      automaticState: 'missing',
      operatorExecutionCount: 1,
      readinessChecks: 1,
      interactiveSuccess: true,
    });
    expect(mockExeca.mock.calls[0]?.[1]).not.toContain('approval_policy="on-request"');
  });

  it.each([
    [
      'missing selected source',
      { schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: false }, transport: { authenticated: false } },
      { exitCode: 0 },
      'missing',
    ],
    [
      'rejected selected source',
      { schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true, rejected: true }, transport: { authenticated: false } },
      { exitCode: 1 },
      'unusable',
    ],
    [
      'malformed evidence',
      { schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true } },
      { exitCode: 0 },
      'unverifiable',
    ],
    [
      'unsupported evidence schema',
      { schemaVersion: 2, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } },
      { exitCode: 0 },
      'unverifiable',
    ],
    [
      'failed command despite otherwise-ready evidence',
      { schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } },
      { exitCode: 1 },
      'unverifiable',
    ],
    [
      'conflicting selected source evidence',
      { schemaVersion: 1, auth: { selectedMode: 'api-key', configured: true }, transport: { authenticated: true } },
      { exitCode: 0 },
      'unverifiable',
    ],
  ] as const)(
    'fails closed as %s without exposing doctor diagnostics',
    async (_name, evidence, result, state) => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(evidence),
        stderr: 'secret doctor diagnostic /private/token',
        ...result,
      } as any);

      const readiness = await new CodexProvider().readiness();

      expect(readiness).toMatchObject({
        provider: 'codex',
        source: 'cached-login',
        state,
        remediation: expect.any(String),
      });
      expect(JSON.stringify(readiness)).not.toMatch(/secret|private|token/i);
      expect(mockExeca).toHaveBeenCalledTimes(1);
      expect(mockExeca.mock.calls[0]?.[1]).not.toContain('exec');
    },
  );

  it('fails closed as unverifiable when the captured doctor command times out or fails externally', async () => {
    mockExeca.mockRejectedValueOnce(Object.assign(new Error('timed out'), { timedOut: true }));
    mockExeca.mockResolvedValueOnce({
      stdout: '',
      stderr: 'network unavailable with secret doctor diagnostic',
      exitCode: 1,
    } as any);

    const defaultProvider = new CodexProvider();
    await expect(defaultProvider.readiness()).resolves.toMatchObject({
      provider: 'codex', source: 'cached-login', state: 'unverifiable',
    });
    await expect(defaultProvider.readiness()).resolves.toMatchObject({
      provider: 'codex', source: 'cached-login', state: 'unverifiable',
    });
    expect(mockExeca.mock.calls.map(([, args]) => args)).toEqual([
      ['doctor', '--json', '--summary'],
      ['doctor', '--json', '--summary'],
    ]);
  });

  it.each([
    ['missing binary', { stdout: '', stderr: 'spawn codex ENOENT', exitCode: 127 }, 'output'],
    ['authentication failure', { stdout: '', stderr: 'Authentication required. Please run codex login.', exitCode: 1 }, 'authFailure'],
    ['rate limit', { stdout: '', stderr: 'Error 429: rate limit exceeded; retry after 45 seconds', exitCode: 1 }, 'rateLimited'],
    ['model unavailable', { stdout: '', stderr: 'Requested model gpt-nope is not available', exitCode: 1 }, 'modelUnavailable'],
    ['expired session', { stdout: '', stderr: 'Thread not found; cannot resume this session', exitCode: 1 }, 'sessionExpired'],
    ['thread resume failed', { stdout: '', stderr: 'Error: thread/resume failed for thread id c6a57ca5-fe83-47a1-aa23-9c30b9bff882', exitCode: 1 }, 'sessionExpired'],
    // Codex 0.145 reports a resume against a home with no matching rollout this
    // way; it must heal as an expired session rather than burn every retry.
    ['missing rollout', { stdout: '', stderr: 'Error: thread/resume: thread/resume failed: no rollout found for thread id c6a57ca5-fe83-47a1-aa23-9c30b9bff882 (code -32600)', exitCode: 1 }, 'sessionExpired'],
  ])('classifies %s from fake CLI output', async (_name, response, expectedFlag) => {
    mockExeca.mockResolvedValue(response as any);

    const result = await provider.invoke({ ...baseOptions, resume: true });

    expect(result.success).toBe(false);
    if (expectedFlag === 'output') {
      expect(result.output).toMatch(/codex.*not found/i);
    } else {
      expect(result[expectedFlag as keyof typeof result]).toBe(true);
    }
    expect(result.authentication).toMatchObject({
      provider: 'codex',
      source: 'cached-login',
      state: expectedFlag === 'authFailure' ? 'unusable' : 'ready',
    });
    if (expectedFlag === 'rateLimited') expect(result.waitSeconds).toBe(45);
  });

  it('classifies only structural ENOENT and exit 127 as run-wide provider unavailability', async () => {
    const missingOutput =
      "LLM provider 'codex' not found. Install it or check your PATH.";
    const cases = [
      {
        name: 'structured ENOENT',
        response: {
          stdout: '',
          stderr: '',
          exitCode: undefined,
          code: 'ENOENT',
          shortMessage: 'spawn codex ENOENT',
          failed: true,
        },
        expected: {
          output: missingOutput,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: missingOutput,
        },
      },
      {
        name: 'exit 127',
        response: {
          stdout: '',
          stderr: 'shell could not execute command',
          exitCode: 127,
          failed: true,
        },
        expected: {
          output: missingOutput,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: missingOutput,
        },
      },
      {
        name: 'misleading prose',
        response: {
          stdout: '',
          stderr: 'The docs say spawn codex failed but the executable exists',
          exitCode: 1,
          failed: true,
        },
        expected: {
          output: 'The docs say spawn codex failed but the executable exists',
        },
      },
      {
        name: 'authentication',
        response: {
          stdout: '',
          stderr: 'Authentication required. Please run codex login.',
          exitCode: 1,
          failed: true,
        },
        expected: {
          output: 'Codex authentication failed using the selected cached-login source.',
          authFailure: true,
        },
      },
      {
        name: 'model',
        response: {
          stdout: '',
          stderr: 'Requested model gpt-nope is not available',
          exitCode: 1,
          failed: true,
        },
        expected: {
          output: 'Requested model gpt-nope is not available',
          modelUnavailable: true,
        },
      },
      {
        name: 'rate limit',
        response: {
          stdout: '',
          stderr: 'Error 429: rate limit exceeded',
          exitCode: 1,
          failed: true,
        },
        expected: {
          output: 'Error 429: rate limit exceeded',
          rateLimited: true,
        },
      },
      {
        name: 'session',
        response: {
          stdout: '',
          stderr: 'Thread not found; cannot resume this session',
          exitCode: 1,
          failed: true,
        },
        expected: {
          output: 'Thread not found; cannot resume this session',
          sessionExpired: true,
        },
      },
      {
        name: 'ordinary failure',
        response: {
          stdout: '',
          stderr: 'command failed for an ordinary reason',
          exitCode: 1,
          failed: true,
        },
        expected: {
          output: 'command failed for an ordinary reason',
        },
      },
    ] as const;
    const observed = [];

    for (const fixture of cases) {
      mockExeca.mockResolvedValue(fixture.response as any);
      const result = await provider.invoke(baseOptions);
      observed.push({
        name: fixture.name,
        output: result.output,
        providerUnavailable: result.providerUnavailable,
        providerUnavailableScope: result.providerUnavailableScope,
        providerUnavailableReason: result.providerUnavailableReason,
        authFailure: result.authFailure,
        modelUnavailable: result.modelUnavailable,
        rateLimited: result.rateLimited,
        sessionExpired: result.sessionExpired,
      });
    }

    expect(observed).toEqual(
      cases.map(({ name, expected }) => ({
        name,
        output: expected.output,
        providerUnavailable:
          'providerUnavailable' in expected
            ? expected.providerUnavailable
            : undefined,
        providerUnavailableScope:
          'providerUnavailableScope' in expected
            ? expected.providerUnavailableScope
            : undefined,
        providerUnavailableReason:
          'providerUnavailableReason' in expected
            ? expected.providerUnavailableReason
            : undefined,
        authFailure:
          'authFailure' in expected ? expected.authFailure : undefined,
        modelUnavailable:
          'modelUnavailable' in expected
            ? expected.modelUnavailable
            : undefined,
        rateLimited:
          'rateLimited' in expected ? expected.rateLimited : undefined,
        sessionExpired:
          'sessionExpired' in expected ? expected.sessionExpired : undefined,
      })),
    );
  });

  it('captures output for a noninteractive invokeInteractive call', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0 } as any);

    await provider.invokeInteractive({ ...baseOptions, interactive: false });

    const [, args, options] = mockExeca.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['exec', '-']));
    expect(args).not.toContain('--json');
    expect(options).toMatchObject({
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  });

  it('live-inherits captured output for a true operator-interactive call', async () => {
    mockExeca.mockResolvedValue({ stdout: 'visible output', stderr: '', exitCode: 0 } as any);

    await provider.invokeInteractive({ ...baseOptions, interactive: true });

    const [, , options] = mockExeca.mock.calls[0];
    expect({ stdout: options.stdout, stderr: options.stderr }).toEqual({
      stdout: ['pipe', 'inherit'],
      stderr: ['pipe', 'inherit'],
    });
  });

  it('streams interactive output and returns classified completion', async () => {
    const missingOutput =
      "LLM provider 'codex' not found. Install it or check your PATH.";
    const cases = [
      {
        name: 'success',
        response: { stdout: 'Done!', stderr: '', exitCode: 0, failed: false },
        expected: { success: true, output: 'Done!', exitCode: 0 },
      },
      {
        name: 'model unavailable',
        response: {
          stdout: '',
          stderr: 'Requested model gpt-nope is not available',
          exitCode: 1,
          failed: true,
        },
        expected: {
          success: false,
          output: 'Requested model gpt-nope is not available',
          exitCode: 1,
          modelUnavailable: true,
        },
      },
      {
        name: 'missing executable',
        response: {
          stdout: '',
          stderr: '',
          exitCode: undefined,
          code: 'ENOENT',
          failed: true,
        },
        expected: {
          success: false,
          output: missingOutput,
          exitCode: 1,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: missingOutput,
        },
      },
      {
        name: 'authentication',
        response: {
          stdout: '',
          stderr: 'Authentication required. Please run codex login.',
          exitCode: 1,
          failed: true,
        },
        expected: {
          success: false,
          output: 'Codex authentication failed using the selected cached-login source.',
          exitCode: 1,
          authFailure: true,
        },
      },
      {
        name: 'rate limit',
        response: {
          stdout: '',
          stderr: 'Error 429: rate limit exceeded; retry after 45 seconds',
          exitCode: 1,
          failed: true,
        },
        expected: {
          success: false,
          output: 'Error 429: rate limit exceeded; retry after 45 seconds',
          exitCode: 1,
          rateLimited: true,
          waitSeconds: 45,
        },
      },
    ] as const;
    const observed = [];

    for (const fixture of cases) {
      mockExeca.mockResolvedValue(fixture.response as any);
      const result = await provider.invokeInteractive(baseOptions);
      const lastCall = mockExeca.mock.calls.at(-1);
      if (!lastCall) throw new Error('expected execa to have been called');
      const [, , execaOptions] = lastCall;
      observed.push({
        name: fixture.name,
        result:
          result === undefined
            ? undefined
            : {
                success: result.success,
                output: result.output,
                exitCode: result.exitCode,
                modelUnavailable: result.modelUnavailable,
                providerUnavailable: result.providerUnavailable,
                providerUnavailableScope: result.providerUnavailableScope,
                providerUnavailableReason: result.providerUnavailableReason,
                authFailure: result.authFailure,
                rateLimited: result.rateLimited,
                waitSeconds: result.waitSeconds,
              },
        stdout: execaOptions.stdout,
        stderr: execaOptions.stderr,
      });
    }

    expect(observed).toEqual(
      cases.map(({ name, expected }) => ({
        name,
        result: {
          success: expected.success,
          output: expected.output,
          exitCode: expected.exitCode,
          modelUnavailable:
            'modelUnavailable' in expected
              ? expected.modelUnavailable
              : undefined,
          providerUnavailable:
            'providerUnavailable' in expected
              ? expected.providerUnavailable
              : undefined,
          providerUnavailableScope:
            'providerUnavailableScope' in expected
              ? expected.providerUnavailableScope
              : undefined,
          providerUnavailableReason:
            'providerUnavailableReason' in expected
              ? expected.providerUnavailableReason
              : undefined,
          authFailure:
            'authFailure' in expected ? expected.authFailure : undefined,
          rateLimited:
            'rateLimited' in expected ? expected.rateLimited : undefined,
          waitSeconds:
            'waitSeconds' in expected ? expected.waitSeconds : undefined,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })),
    );
  });
});

describe('parseCodexJsonl', () => {
  it('sums usage across every completed turn in a dispatch', () => {
    const stream = [
      { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } },
      { type: 'turn.completed', usage: { input_tokens: 200, output_tokens: 20 } },
      { type: 'turn.completed', usage: { input_tokens: 300, output_tokens: 30 } },
    ].map((event) => JSON.stringify(event)).join('\n');

    expect(parseCodexJsonl(stream).tokenUsage).toEqual({ input: 600, output: 60, numTurns: 3 });
  });

  it('parses the captured Codex exec --json usage values', async () => {
    const fixture = await readFile(
      join(process.cwd(), 'test', 'fixtures', 'codex-exec-json-turn-completed.jsonl'),
      'utf8',
    );

    expect(parseCodexJsonl(fixture).tokenUsage).toEqual({
      input: 18057,
      cacheRead: 0,
      cacheCreation: 0,
      output: 5,
      reasoningOutput: 0,
      numTurns: 1,
    });
  });

  it('ignores a malformed completed turn without producing NaN totals', () => {
    const stream = [
      { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } },
      { type: 'turn.completed', usage: { input_tokens: 'not-a-number', output_tokens: 20 } },
      { type: 'turn.completed', usage: { input_tokens: 300, output_tokens: 30 } },
    ].map((event) => JSON.stringify(event)).join('\n');

    expect(parseCodexJsonl(stream).tokenUsage).toEqual({ input: 400, output: 40, numTurns: 2 });
  });

  it('leaves unreported cache-creation and reasoning totals absent', () => {
    const stream = JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 12, output_tokens: 7 },
    });

    expect(parseCodexJsonl(stream).tokenUsage).toEqual({ input: 12, output: 7, numTurns: 1 });
  });

  it('records numeric cache-creation and reasoning totals', () => {
    const stream = JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 1000,
        output_tokens: 40,
        cache_write_input_tokens: 77,
        reasoning_output_tokens: 15,
      },
    });

    expect(parseCodexJsonl(stream).tokenUsage).toEqual({
      input: 1000,
      output: 40,
      cacheCreation: 77,
      reasoningOutput: 15,
      numTurns: 1,
    });
  });

  it('uses the final agent message instead of returning raw event JSON', () => {
    expect(parseCodexJsonl(jsonlMessage('Final answer.')).output).toBe('Final answer.');
  });

  it('falls back to plain output when Codex emits a non-JSON diagnostic', () => {
    expect(parseCodexJsonl('plain diagnostic').output).toBe('plain diagnostic');
  });
});
