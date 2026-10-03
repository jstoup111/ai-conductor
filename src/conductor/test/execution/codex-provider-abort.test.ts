// Covers: task:12
import { describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions, Result as ExecaResult, ResultPromise } from 'execa';
import { CodexProvider, type CodexDoctorRunner } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const invokeOptions: InvokeOptions = {
  prompt: 'Make the no-op change',
  sessionId: 'fresh-session',
  resume: false,
  cwd: '/workspace',
};

const readyDoctor: CodexDoctorRunner = async () => ({
  stdout: JSON.stringify({
    schemaVersion: 1,
    auth: { selectedMode: 'cached-login', configured: true },
    transport: { authenticated: true },
  }),
  exitCode: 0,
});

function provider(subprocessFactory: (file: string, args: readonly string[], options: ExecaOptions) => ResultPromise) {
  return new CodexProvider(readyDoctor, 'codex', undefined, subprocessFactory);
}

describe('CodexProvider abort handling', () => {
  it('cancels its subprocess and returns an ordinary failure when aborted', async () => {
    const controller = new AbortController();
    const subprocessFactory = vi.fn((_file: string, _args: readonly string[], options: ExecaOptions) =>
      new Promise<ExecaResult>((_resolve, reject) => {
        options.cancelSignal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { isCanceled: true }));
        }, { once: true });
      }) as ResultPromise,
    );
    const invocation = provider(subprocessFactory).invoke({ ...invokeOptions, abortSignal: controller.signal });
    await vi.waitFor(() => expect(subprocessFactory).toHaveBeenCalledOnce());
    controller.abort();

    const result = await invocation;
    const subprocessOptions = subprocessFactory.mock.calls[0]?.[2];
    expect({
      result: {
        success: result.success,
        output: result.output,
        rateLimited: result.rateLimited,
        authFailure: result.authFailure,
        sessionExpired: result.sessionExpired,
      },
      cancelSignal: subprocessOptions?.cancelSignal,
      forceKillAfterDelay: subprocessOptions?.forceKillAfterDelay,
    }).toEqual({
      result: {
        success: false,
        output: 'Codex invocation aborted.',
        rateLimited: undefined,
        authFailure: undefined,
        sessionExpired: undefined,
      },
      cancelSignal: controller.signal,
      forceKillAfterDelay: undefined,
    });
  });

  it('does not spawn when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const subprocessFactory = vi.fn();

    const result = await provider(subprocessFactory as never).invoke({ ...invokeOptions, abortSignal: controller.signal });

    expect({ success: result.success, output: result.output, calls: subprocessFactory.mock.calls.length }).toEqual({
      success: false,
      output: 'Codex invocation aborted.',
      calls: 0,
    });
  });

  it('leaves subprocess cancellation options absent without an abort signal', async () => {
    const subprocessFactory = vi.fn((_file: string, _args: readonly string[], _options: ExecaOptions) =>
      Promise.resolve({ stdout: '{"type":"turn.completed"}', stderr: '', exitCode: 0 }) as ResultPromise,
    );

    const result = await provider(subprocessFactory).invoke(invokeOptions);
    const subprocessOptions = subprocessFactory.mock.calls[0]?.[2];
    expect({
      result: { success: result.success, output: result.output, exitCode: result.exitCode },
      hasCancelSignal: Object.hasOwn(subprocessOptions ?? {}, 'cancelSignal'),
    }).toEqual({
      result: { success: true, output: '{"type":"turn.completed"}', exitCode: 0 },
      hasCancelSignal: false,
    });
  });
});
