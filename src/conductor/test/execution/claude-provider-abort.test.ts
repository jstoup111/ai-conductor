import { describe, expect, it, vi } from 'vitest';
import { execa, type Options as ExecaOptions, type ResultPromise } from 'execa';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

type ClaudeSubprocessFactory = (
  file: string,
  args: string[],
  options: ExecaOptions,
) => ResultPromise;

const invokeOptions: InvokeOptions = {
  prompt: 'complete this task',
  sessionId: 'abort-test-session',
  resume: false,
};

function successfulProcess(): ResultPromise {
  return Promise.resolve({
    stdout: JSON.stringify({ type: 'result', result: 'done' }),
    stderr: '',
    exitCode: 0,
    failed: false,
  }) as unknown as ResultPromise;
}

describe('ClaudeProvider abort handling', () => {
  it.each([
    {
      name: 'with its terminal result record already written',
      stdout: [
        JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 500, output_tokens: 500 } } }),
        JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0.9, usage: { input_tokens: 30, output_tokens: 6 } }),
      ].join('\n'),
      expected: { input: 30, output: 6, costUsd: 0.9, costSource: 'provider' },
    },
    {
      name: 'before its terminal result record',
      stdout: JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 500, output_tokens: 500 } } }),
      expected: undefined,
    },
  ])('records usage of a cancelled run only $name', async ({ stdout, expected }) => {
    const controller = new AbortController();
    const factory = vi.fn((_file: string, _args: string[], options: ExecaOptions) =>
      new Promise((_resolve, reject) => {
        options.cancelSignal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('canceled'), { isCanceled: true, stdout }));
        }, { once: true });
      }) as unknown as ResultPromise,
    );
    const provider = new ClaudeProvider(undefined, factory as ClaudeSubprocessFactory);

    const invocation = provider.invoke({ ...invokeOptions, abortSignal: controller.signal });
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    controller.abort();
    const result = await invocation;

    expect(result).toMatchObject({ success: false, output: 'Claude invocation aborted.' });
    expect(result.tokenUsage).toEqual(expected);
  });

  it('passes an abort signal to execa and returns an ordinary failure immediately when canceled', async () => {
    const controller = new AbortController();
    let rejectProcess: (error: Error & { isCanceled?: boolean }) => void = () => {};
    const factory = vi.fn((_file: string, _args: string[], options: ExecaOptions) =>
      new Promise((_resolve, reject) => {
        rejectProcess = reject;
        options.cancelSignal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('canceled'), { isCanceled: true }));
        }, { once: true });
      }) as unknown as ResultPromise,
    );
    const provider = new ClaudeProvider(undefined, factory as ClaudeSubprocessFactory);

    const invocation = provider.invoke({ ...invokeOptions, abortSignal: controller.signal });
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    controller.abort();
    rejectProcess(Object.assign(new Error('canceled'), { isCanceled: true }));

    await expect(invocation).resolves.toMatchObject({
      success: false,
      exitCode: 1,
      output: 'Claude invocation aborted.',
    });
    const options = factory.mock.calls[0]?.[2];
    expect(options?.cancelSignal).toBe(controller.signal);
    expect(options?.forceKillAfterDelay).not.toBe(false);
  });

  it('does not spawn for a pre-aborted signal and exposes no recovery signals', async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn(() => successfulProcess());
    const provider = new ClaudeProvider(undefined, factory as ClaudeSubprocessFactory);

    const result = await provider.invoke({ ...invokeOptions, abortSignal: controller.signal });

    expect(factory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, output: 'Claude invocation aborted.', exitCode: 1 });
    expect(result).not.toHaveProperty('rateLimited');
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('sessionExpired');
  });

  it('keeps the pre-abort subprocess options and successful result unchanged when no signal is supplied', async () => {
    const factory = vi.fn((_file: string, _args: string[], _options: ExecaOptions) => successfulProcess());
    const provider = new ClaudeProvider(undefined, factory as ClaudeSubprocessFactory);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      output: 'done',
      exitCode: 0,
    });
    expect(factory.mock.calls[0]?.[2]).not.toHaveProperty('cancelSignal');
  });

  it('uses execa default grace termination when a local child ignores SIGTERM', async () => {
    const controller = new AbortController();
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    const factory: ClaudeSubprocessFactory = (_file, _args, options) => {
      const child = execa(process.execPath, [
        '-e',
        "process.stdout.write('ready\\n'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);",
      ], {
        ...options,
        forceKillAfterDelay: 50,
      }) as ResultPromise;
      child.stdout?.once('data', () => markReady());
      return child;
    };
    const provider = new ClaudeProvider(undefined, factory);

    const invocation = provider.invoke({ ...invokeOptions, abortSignal: controller.signal });
    await ready;
    controller.abort();

    await expect(invocation).resolves.toMatchObject({
      success: false,
      output: 'Claude invocation aborted.',
      exitCode: 1,
    });
  });
});
