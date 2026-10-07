// Covers: task:12
import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { execa, type Options as ExecaOptions, type Result as ExecaResult, type ResultPromise } from 'execa';
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
    expect(result).not.toHaveProperty('sessionExpired');
    expect({
      result: {
        success: result.success,
        output: result.output,
        rateLimited: result.rateLimited,
        authFailure: result.authFailure,
      },
      cancelSignal: subprocessOptions?.cancelSignal,
      forceKillAfterDelay: subprocessOptions?.forceKillAfterDelay,
    }).toEqual({
      result: {
        success: false,
        output: 'Codex invocation aborted.',
        rateLimited: undefined,
        authFailure: undefined,
      },
      cancelSignal: controller.signal,
      forceKillAfterDelay: undefined,
    });
  });

  it('records the tokens of turns completed before an abort, unpriced', async () => {
    const controller = new AbortController();
    const stdout = new PassThrough();
    const subprocessFactory = vi.fn((_file: string, _args: readonly string[], options: ExecaOptions) =>
      Object.assign(new Promise<ExecaResult>((_resolve, reject) => {
        options.cancelSignal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { isCanceled: true }));
        }, { once: true });
      }), { stdout, stderr: new PassThrough(), kill: () => true }) as unknown as ResultPromise,
    );
    const invocation = provider(subprocessFactory).invoke({ ...invokeOptions, abortSignal: controller.signal });
    await vi.waitFor(() => expect(subprocessFactory).toHaveBeenCalledOnce());
    stdout.write(`${JSON.stringify({ type: 'turn.started' })}\n`);
    stdout.write(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 5 } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'turn.started' })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    const result = await invocation;

    expect(result).toMatchObject({ success: false, output: 'Codex invocation aborted.' });
    // The cancelled turn's spend is unseen, so no price is applied: cost-unmetered, never $0.
    expect(result.tokenUsage).toEqual({ input: 40, output: 5, cacheRead: 10, numTurns: 1 });
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

  it('uses execa default grace termination when a local child ignores SIGTERM', async () => {
    const controller = new AbortController();
    let child: ResultPromise | undefined;
    const subprocessFactory = (_file: string, _args: readonly string[], options: ExecaOptions): ResultPromise => {
      child = execa(process.execPath, [
        '-e',
        "process.on('SIGTERM', () => {}); setInterval(() => process.stdout.write('ready\\n'), 10);",
      ], {
        ...options,
        forceKillAfterDelay: 50,
      }) as ResultPromise;
      return child;
    };
    const invocation = provider(subprocessFactory).invoke({
      ...invokeOptions,
      cwd: process.cwd(),
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(child).toBeDefined());
    await new Promise<void>((resolve) => child?.stdout?.once('data', () => resolve()));
    controller.abort();

    await expect(invocation).resolves.toMatchObject({
      success: false,
      output: 'Codex invocation aborted.',
      exitCode: 1,
    });
  });
});
