// Covers: task:15
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';
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

describe('PiProvider', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  let provider: PiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    spawn.mockResolvedValue({ stdout: 'Pi completed.', stderr: '', exitCode: 0 } as ExecaResult);
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
});
