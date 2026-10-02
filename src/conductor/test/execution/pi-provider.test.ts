// Covers: task:2, task:3, task:4, task:13, task:15, task:16, task:17, task:18
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';
import { classifyMetering } from '../../src/engine/metering.js';
import { parsePiModelId, parsePiModelListing, PiProvider } from '../../src/execution/pi-provider.js';
import { DAEMON_SESSION_MARKER } from '../../src/execution/daemon-session.js';
import { providerDescriptor } from '../../src/execution/provider-catalog.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

type PiSubprocessFactory = (
  file: string,
  args: readonly string[],
  options: ExecaOptions,
) => Promise<ExecaResult>;

const invokeOptions: InvokeOptions = {
  prompt: 'Implement the requested change.',
  sessionId: 'caller-session',
  resume: false,
  cwd: '/workspace/project',
  model: 'anthropic/claude-opus-4-5',
  effort: 'xhigh',
};

const readFixture = (name: string) => readFile(new URL(`../fixtures/pi/${name}`, import.meta.url), 'utf8');

describe('parsePiModelListing', () => {
  it('parses the captured Pi 0.84.3 listing into canonical provider/model ids', async () => {
    const listing = parsePiModelListing(await readFile(
      new URL('../fixtures/pi-list-models-0.84.3.txt', import.meta.url),
      'utf8',
    ));

    expect(listing).toEqual({
      kind: 'parsed',
      modelIds: [
        'anthropic/claude-opus-4-5',
        'cline/google/gemma-4-31b-it:free',
        'openai/gpt-5',
      ],
    });
  });

  it('locates provider and model columns by their header names rather than their positions', () => {
    expect(parsePiModelListing([
      'model                    context  provider',
      'google/gemma-4-31b-it:free  128K     cline',
    ].join('\n'))).toEqual({
      kind: 'parsed',
      modelIds: ['cline/google/gemma-4-31b-it:free'],
    });
  });

  it('returns the first line when no provider and model header is available', () => {
    expect(parsePiModelListing('Pi failed to load models\ntry again later')).toEqual({
      kind: 'unparseable',
      firstLine: 'Pi failed to load models',
    });
  });
});

describe('PiProvider', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  let provider: PiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    spawn.mockResolvedValue({
      stdout: JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Pi completed.' }] },
      }),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);
    provider = new PiProvider('/resolved/pi', spawn);
  });

  it('spawns a resolved Pi executable headlessly with its configured provider, model, and thinking effort', async () => {
    await provider.invoke(invokeOptions);

    expect(spawn).toHaveBeenCalledWith(
      '/resolved/pi',
      [
        '-p', '--no-session', '--mode', 'json',
        '--provider', 'anthropic',
        '--model', 'claude-opus-4-5',
        '--thinking', 'xhigh',
      ],
      expect.objectContaining({
        input: invokeOptions.prompt,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: invokeOptions.cwd,
        reject: false,
      }),
    );
    expect(spawn.mock.calls[0]?.[1]).not.toContain('claude-opus-4-5:xhigh');
  });

  it('stamps the daemon marker and masks tmux targets after the self-host env overlay', async () => {
    await provider.invoke({
      ...invokeOptions,
      selfHost: {
        executable: '/isolated/pi',
        env: {
          PI_HOME: '/isolated/home',
          [DAEMON_SESSION_MARKER]: 'not-a-daemon-session',
          TMUX: '/tmp/tmux-1000/default,1234,0',
          TMUX_PANE: '%7',
        },
        args: [],
        teardown: async () => {},
      },
    });

    expect(spawn.mock.calls[0]?.[2].env).toEqual({
      PI_HOME: '/isolated/home',
      [DAEMON_SESSION_MARKER]: '1',
      TMUX: undefined,
      TMUX_PANE: undefined,
    });
  });

  it('creates a marked and tmux-scrubbed env for an empty self-host overlay', async () => {
    await provider.invoke({
      ...invokeOptions,
      selfHost: {
        executable: '/isolated/pi',
        env: {},
        args: [],
        teardown: async () => {},
      },
    });

    expect(spawn.mock.calls[0]?.[2].env).toEqual({
      [DAEMON_SESSION_MARKER]: '1',
      TMUX: undefined,
      TMUX_PANE: undefined,
    });
  });

  it('keeps retries in fresh no-session invocations and exposes only invoke dispatch', async () => {
    await provider.invoke(invokeOptions);
    await provider.invoke({ ...invokeOptions, resume: true, sessionId: 'retry-session' });

    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
      [
        '-p', '--no-session', '--mode', 'json',
        '--provider', 'anthropic',
        '--model', 'claude-opus-4-5',
        '--thinking', 'xhigh',
      ],
      [
        '-p', '--no-session', '--mode', 'json',
        '--provider', 'anthropic',
        '--model', 'claude-opus-4-5',
        '--thinking', 'xhigh',
      ],
    ]);
    expect(provider.supportsSessionResume).toBe(false);
    expect(provider.lifecycleCapability).toEqual({ synchronousSpawnPermit: true });
    expect(Object.getOwnPropertyNames(PiProvider.prototype)).toEqual(['constructor', 'invoke']);
  });

  it('preserves a nested Pi model suffix and supplies exactly one separate thinking flag', async () => {
    await provider.invoke({
      ...invokeOptions,
      model: 'cline/google/gemma-4-31b-it:free',
      effort: 'high',
    });

    const args = spawn.mock.calls[0]?.[1] ?? [];
    expect(args).toEqual(expect.arrayContaining([
      '--provider', 'cline',
      '--model', 'google/gemma-4-31b-it:free',
      '--thinking', 'high',
    ]));
    expect(args.filter((arg) => arg === '--thinking')).toHaveLength(1);
    expect(args).not.toContain('google/gemma-4-31b-it:free:high');
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'passes Pi thinking effort %s unchanged',
    async (effort) => {
      await provider.invoke({ ...invokeOptions, effort });

      const args = spawn.mock.calls[0]?.[1] ?? [];
      expect(args[args.indexOf('--thinking') + 1]).toBe(effort);
      expect(args).not.toContain('--thinking off');
      expect(args).not.toContain('--thinking minimal');
    },
  );

  it('declares Pi without deferred capabilities and requires configured models', async () => {
    const pi = providerDescriptor('pi');

    expect(pi).toMatchObject({
      defaultExecutable: 'pi',
      executableOverrideEnv: 'PI_EXECUTABLE',
      versionArgv: ['--version'],
      capabilities: {},
    });
    expect(pi.modelPolicy.requiresConfiguredModels).toBe(true);
    expect(pi.modelPolicy.modelFallbackLadder).toEqual([]);
    expect(Object.values(pi.modelPolicy.stepModels)).toEqual(
      expect.arrayContaining(['']),
    );

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({ success: true });
  });

  it('returns the terminal assistant message and its cumulative usage as cost-unmetered', async () => {
    spawn.mockResolvedValue({
      stdout: await readFixture('terminal-assistant.jsonl'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({
      success: true,
      output: 'Implemented the requested change.',
      tokenUsage: { input: 144, output: 21, cacheRead: 55, cacheCreation: 8 },
    });
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('counts terminal assistant turns and accepts usage on a terminal event', async () => {
    spawn.mockResolvedValue({
      stdout: [
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', content: 'First turn.' },
          usage: { input: 9, output: 4 },
        }),
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', content: 'Second turn.' },
        }),
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      output: 'Second turn.',
      tokenUsage: { input: 9, output: 4, numTurns: 2 },
    });
  });

  it('ignores a malformed JSONL line and still returns the terminal assistant message', async () => {
    spawn.mockResolvedValue({
      stdout: await readFixture('malformed-before-terminal.jsonl'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      output: 'The valid terminal message survives.',
    });
  });

  it('fails an exit-zero stream without a terminal assistant message', async () => {
    spawn.mockResolvedValue({
      stdout: await readFixture('no-terminal-assistant.jsonl'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      output: expect.stringContaining('missing terminal assistant message'),
    });
  });

  it('fails an exit-zero error-stop stream as an ordinary step failure', async () => {
    spawn.mockResolvedValue({
      stdout: await readFile(new URL('../fixtures/pi-error-stop-stream.jsonl', import.meta.url), 'utf8'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({
      success: false,
      exitCode: 0,
      output: expect.stringContaining('No API key for provider: cline'),
    });
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('rateLimited');
    expect(result).not.toHaveProperty('modelUnavailable');
  });

  it('fails an exit-zero error stop without an error message', async () => {
    spawn.mockResolvedValue({
      stdout: JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [], stopReason: 'error' },
      }),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      output: 'Pi reported an error stop with no message',
    });
  });

  it('retains an error stop before a malformed trailing JSONL line', async () => {
    const errorStop = await readFile(new URL('../fixtures/pi-error-stop-stream.jsonl', import.meta.url), 'utf8');
    spawn.mockResolvedValue({
      stdout: `${errorStop}\nnot JSON`,
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      output: expect.stringContaining('No API key for provider: cline'),
    });
  });

  it('kills a running Pi subprocess on abort without reporting a provider failure signal', async () => {
    const controller = new AbortController();
    let resolveProcess: (result: ExecaResult) => void;
    const process = Object.assign(
      new Promise<ExecaResult>((resolve) => { resolveProcess = resolve; }),
      {
        kill: vi.fn(() => resolveProcess({ stdout: '', stderr: '', exitCode: 1 } as ExecaResult)),
      },
    );
    spawn.mockImplementationOnce(() => process as ReturnType<PiSubprocessFactory>);

    const invocation = provider.invoke({
      ...invokeOptions,
      abortSignal: controller.signal,
    });
    controller.abort();

    const result = await invocation;

    expect(process.kill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: false, output: 'Pi invocation aborted.', exitCode: 1 });
    expect(result).not.toHaveProperty('providerUnavailable');
    expect(result).not.toHaveProperty('modelUnavailable');
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('rateLimited');
  });

  it('records a SIGTERM without inventing an exit code for an unclassified Pi failure', async () => {
    const diagnosticLog = vi.fn();
    spawn.mockResolvedValue({ stdout: '', stderr: '', exitCode: null, signal: 'SIGTERM' } as unknown as ExecaResult);

    const result = await provider.invoke({ ...invokeOptions, diagnosticLog });

    expect(result).toMatchObject({
      success: false,
      output: '',
      exitCode: 1,
      exitFacts: { signal: 'SIGTERM', stdoutBytes: 0, stderrBytes: 0 },
    });
    expect(diagnosticLog.mock.calls.filter(([message]) =>
      String(message).startsWith('pi subprocess exited without a classifiable result:'),
    )).toEqual([[
      'pi subprocess exited without a classifiable result: signal=SIGTERM stdoutBytes=0 stderrBytes=0',
    ]]);
  });

  it.each([
    [
      'a structural ENOENT',
      { stdout: '', stderr: '', exitCode: undefined, code: 'ENOENT' },
      { providerUnavailable: true, providerUnavailableScope: 'run' },
    ],
    [
      'exit 127',
      { stdout: '', stderr: 'shell could not execute command', exitCode: 127 },
      { providerUnavailable: true, providerUnavailableScope: 'run' },
    ],
    [
      'the verified unknown-model diagnostic',
      { stdout: '', stderr: 'Error: Model "x" not found. Use --list-models to see available models.', exitCode: 1 },
      { modelUnavailable: true },
    ],
    [
      'an unmatched non-zero failure',
      { stdout: '', stderr: 'Pi encountered an unexpected transport failure.', exitCode: 1 },
      {},
    ],
    [
      'authentication-style output',
      { stdout: '', stderr: 'Authentication required. Please log in.', exitCode: 1 },
      {},
    ],
    [
      'rate-limit-style output',
      { stdout: '', stderr: 'Error 429: rate limit exceeded.', exitCode: 1 },
      {},
    ],
  ])('classifies %s without inferring unsupported Pi recovery signals', async (_name, response, expected) => {
    spawn.mockResolvedValue(response as ExecaResult);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({ success: false, exitCode: response.exitCode ?? 1, ...expected });
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('rateLimited');
    if (!('providerUnavailable' in expected)) {
      expect(result).not.toHaveProperty('providerUnavailable');
      expect(result).not.toHaveProperty('providerUnavailableScope');
    }
    if (!('modelUnavailable' in expected)) expect(result).not.toHaveProperty('modelUnavailable');
    if (Object.keys(expected).length > 0) expect(result).not.toHaveProperty('exitFacts');
  });
});

describe('parsePiModelId', () => {
  it.each([
    ['anthropic/claude-opus-4-5', { provider: 'anthropic', model: 'claude-opus-4-5' }],
    ['cline/google/gemma-4-31b-it:free', { provider: 'cline', model: 'google/gemma-4-31b-it:free' }],
  ])('splits canonical id %s at its first separator only', (modelId, expected) => {
    expect(parsePiModelId(modelId)).toEqual(expected);
  });

  it.each([
    ['claude-opus-4-5', 'missing-separator'],
    ['anthropic/', 'empty-model'],
    ['/claude-opus-4-5', 'empty-provider'],
    ['anthropic/claude opus-4-5', 'whitespace'],
  ] as const)('rejects invalid Pi id %j with reason %s', (modelId, reason) => {
    expect(parsePiModelId(modelId)).toEqual({ reason });
  });
});
