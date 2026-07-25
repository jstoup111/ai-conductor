import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodexProvider,
  parseCodexJsonl,
} from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

// This is a fake Codex CLI boundary: no test invokes a locally installed Codex.
vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

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

  it('runs a fresh Codex exec with its fixed unattended policy, JSONL, model, cwd, and stdin prompt delivery', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('No-op complete.'), exitCode: 0 } as any);

    const result = await provider.invoke({
      ...baseOptions,
      model: 'gpt-5.4',
      effort: 'high',
      dangerouslySkipPermissions: true,
    });

    const [command, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
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
    expect(result.tokenUsage).toEqual({ input: 12, cacheRead: 4, output: 7 });
  });

  it('resumes the requested Codex session and continues using stdin', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Resumed.'), exitCode: 0 } as any);

    await provider.invoke({ ...baseOptions, resume: true });

    const [, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-123']);
    expect(args).not.toContain('--cd');
    expect(args).toEqual(expect.arrayContaining([
      'sandbox_mode="workspace-write"',
      'approval_policy="on-request"',
      'approvals_reviewer="auto_review"',
      'shell_environment_policy.ignore_default_excludes=false',
    ]));
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).toContain('-');
    expect(options.cwd).toBe('/workspace/project');
  });

  it('enforces the same policy for automatic streaming while keeping API keys in the Codex client environment', async () => {
    const key = 'sk-905-scoped-client-key';
    const priorKey = process.env.CODEX_API_KEY;
    process.env.CODEX_API_KEY = key;
    mockExeca.mockResolvedValue({ stdout: 'Streamed.', exitCode: 0 } as any);

    try {
      await provider.invokeInteractive({
        ...baseOptions,
        interactive: false,
        dangerouslySkipPermissions: true,
      });

      const [, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
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

  it('keeps a >128 KiB prompt out of argv', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Done.'), exitCode: 0 } as any);
    const prompt = 'x'.repeat(200_000);

    await provider.invoke({ ...baseOptions, prompt });

    const [, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
    expect(options.input).toContain(prompt);
    for (const arg of args) expect(arg.length).toBeLessThan(1024);
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

      try {
        const result = await provider.invoke(baseOptions);
        const [, , options] = mockExeca.mock.calls[0] as [string, string[], any];

        expect({
          authentication: result.authentication,
          output: result.output,
          childKey: options.env?.CODEX_API_KEY,
        }).toEqual({
          authentication: {
            provider: 'codex',
            source,
            state: 'unusable',
            remediation: 'Update the selected Codex authentication source and retry.',
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

    try {
      const result = await provider.invoke(baseOptions);

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

    try {
      const result = await provider.invoke(baseOptions);

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

      const [command, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
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
  });

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
  ])('classifies %s from fake CLI output', async (_name, response, expectedFlag) => {
    mockExeca.mockResolvedValue(response as any);

    const result = await provider.invoke({ ...baseOptions, resume: true });

    expect(result.success).toBe(false);
    if (expectedFlag === 'output') {
      expect(result.output).toMatch(/codex.*not found/i);
    } else {
      expect(result[expectedFlag as keyof typeof result]).toBe(true);
    }
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

  it('streams a one-shot exec for interface-compatible interactive calls', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0 } as any);

    await provider.invokeInteractive(baseOptions);

    const [, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
    expect(args).toEqual(expect.arrayContaining(['exec', '-']));
    expect(args).not.toContain('--json');
    expect(options).toMatchObject({
      stdin: 'pipe',
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
      const [, , execaOptions] = mockExeca.mock.calls.at(-1) as [
        string,
        string[],
        any,
      ];
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
        stdout: ['pipe', 'inherit'],
        stderr: ['pipe', 'inherit'],
      })),
    );
  });
});

describe('parseCodexJsonl', () => {
  it('uses the final agent message instead of returning raw event JSON', () => {
    expect(parseCodexJsonl(jsonlMessage('Final answer.')).output).toBe('Final answer.');
  });

  it('falls back to plain output when Codex emits a non-JSON diagnostic', () => {
    expect(parseCodexJsonl('plain diagnostic').output).toBe('plain diagnostic');
  });
});
