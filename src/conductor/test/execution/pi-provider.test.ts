// Covers: task:15, task:16, task:17, task:18
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';
import { classifyMetering } from '../../src/engine/metering.js';
import { PiProvider } from '../../src/execution/pi-provider.js';
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
  model: 'ignored-by-pi',
};

const readFixture = (name: string) => readFile(new URL(`../fixtures/pi/${name}`, import.meta.url), 'utf8');

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

  it('spawns a resolved Pi executable headlessly with the prompt on stdin and no model flag', async () => {
    await provider.invoke(invokeOptions);

    expect(spawn).toHaveBeenCalledWith(
      '/resolved/pi',
      ['-p', '--no-session', '--mode', 'json'],
      expect.objectContaining({
        input: invokeOptions.prompt,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: invokeOptions.cwd,
        reject: false,
      }),
    );
    expect(spawn.mock.calls[0]?.[1]).not.toContain('--model');
  });

  it('keeps retries in fresh no-session invocations and exposes only invoke dispatch', async () => {
    await provider.invoke(invokeOptions);
    await provider.invoke({ ...invokeOptions, resume: true, sessionId: 'retry-session' });

    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
      ['-p', '--no-session', '--mode', 'json'],
      ['-p', '--no-session', '--mode', 'json'],
    ]);
    expect(provider.supportsSessionResume).toBe(false);
    expect(provider.lifecycleCapability).toEqual({ synchronousSpawnPermit: true });
    expect(Object.getOwnPropertyNames(PiProvider.prototype)).toEqual(['constructor', 'invoke']);
  });

  it('declares Pi without deferred capabilities and with a no-model policy rung', async () => {
    const pi = providerDescriptor('pi');

    expect(pi).toMatchObject({
      defaultExecutable: 'pi',
      executableOverrideEnv: 'PI_EXECUTABLE',
      versionArgv: ['--version'],
      capabilities: { supportsSessionResume: false },
    });
    expect(pi.modelPolicy.modelFallbackLadder).toEqual(['']);
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
    } as InvokeOptions & { abortSignal: AbortSignal });
    controller.abort();

    const result = await invocation;

    expect(process.kill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: false, output: 'Pi invocation aborted.', exitCode: 1 });
    expect(result).not.toHaveProperty('providerUnavailable');
    expect(result).not.toHaveProperty('modelUnavailable');
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('rateLimited');
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
  });
});
