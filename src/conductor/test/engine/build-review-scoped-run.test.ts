// Covers: task:1
import { describe, expect, it, vi } from 'vitest';

import {
  runBuildReviewScopedCommand,
  type BuildReviewScopedChild,
  type BuildReviewScopedLauncher,
} from '../../src/engine/build-review-scoped-run.js';

function fakeChild() {
  let onStdout: ((chunk: unknown) => void) | undefined;
  let onStderr: ((chunk: unknown) => void) | undefined;
  let onError: (() => void) | undefined;
  let onClose: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const child = {
    stdout: { on: vi.fn((_event: 'data', listener: (chunk: unknown) => void) => { onStdout = listener; }) },
    stderr: { on: vi.fn((_event: 'data', listener: (chunk: unknown) => void) => { onStderr = listener; }) },
    once: vi.fn((event: 'error' | 'close', listener: (() => void) | ((code: number | null, signal: NodeJS.Signals | null) => void)) => {
      if (event === 'error') onError = listener as () => void;
      else onClose = listener as (code: number | null, signal: NodeJS.Signals | null) => void;
    }),
    kill: vi.fn(),
  } as unknown as BuildReviewScopedChild;
  return {
    child,
    stdout: (chunk: unknown) => onStdout?.(chunk),
    stderr: (chunk: unknown) => onStderr?.(chunk),
    error: () => onError?.(),
    close: (code: number | null, signal: NodeJS.Signals | null = null) => onClose?.(code, signal),
  };
}

describe('runBuildReviewScopedCommand', () => {
  it('returns timeout without launching when its deadline has already expired', async () => {
    const child = {
      stdout: null,
      stderr: null,
      once: vi.fn(),
      kill: vi.fn(),
    } as unknown as BuildReviewScopedChild;
    const launcher = vi.fn<BuildReviewScopedLauncher>(() => child);
    const controller = new AbortController();
    controller.abort();

    const result = await runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}',
      selectors: ['test/engine/example.test.ts'],
      cwd: '/counterfactual',
      signal: controller.signal,
      launcher,
    });

    expect(result).toEqual({ kind: 'timeout', stdout: '', stderr: '' });
    expect(launcher).not.toHaveBeenCalled();
  });

  it('preserves a zero exit and captured streams from a launched command', async () => {
    const fake = fakeChild();
    const launcher = vi.fn<BuildReviewScopedLauncher>(() => fake.child);
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/with space.test.ts'], cwd: '/counterfactual', signal: new AbortController().signal, launcher,
    });
    fake.stdout('passed');
    fake.stderr('warning');
    fake.close(0);

    await expect(run).resolves.toEqual({ exitCode: 0, stdout: 'passed', stderr: 'warning' });
    expect(launcher).toHaveBeenCalledWith('sh', ['-c', 'npm test -- "test/with space.test.ts"'], {
      cwd: '/counterfactual', stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('preserves a nonzero exit from a launched command', async () => {
    const fake = fakeChild();
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/fails.test.ts'], cwd: '/counterfactual', signal: new AbortController().signal,
      launcher: () => fake.child,
    });
    fake.close(7);

    await expect(run).resolves.toEqual({ kind: 'nonzero-exit', exitCode: 7, stdout: '', stderr: '' });
  });

  it('preserves a signal exit from a launched command', async () => {
    const fake = fakeChild();
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/signaled.test.ts'], cwd: '/counterfactual', signal: new AbortController().signal,
      launcher: () => fake.child,
    });
    fake.close(null, 'SIGKILL');

    await expect(run).resolves.toEqual({ kind: 'signal', signal: 'SIGKILL', stdout: '', stderr: '' });
  });

  it('maps a launcher error with output captured before the error', async () => {
    const fake = fakeChild();
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/error.test.ts'], cwd: '/counterfactual', signal: new AbortController().signal,
      launcher: () => fake.child,
    });
    fake.stdout('before');
    fake.stderr('error');
    fake.error();

    await expect(run).resolves.toEqual({ kind: 'launch-error', stdout: 'before', stderr: 'error' });
  });

  it.each([
    ['a missing template', undefined, ['test/example.test.ts']],
    ['an empty selector list', 'npm test -- {selectors}', []],
  ])('returns launch-error without launching for %s', async (_caseName, template, selectors) => {
    const launcher = vi.fn<BuildReviewScopedLauncher>();

    await expect(runBuildReviewScopedCommand({
      template, selectors, cwd: '/counterfactual', signal: new AbortController().signal, launcher,
    })).resolves.toEqual({ kind: 'launch-error', stdout: '', stderr: '' });
    expect(launcher).not.toHaveBeenCalled();
  });
});
