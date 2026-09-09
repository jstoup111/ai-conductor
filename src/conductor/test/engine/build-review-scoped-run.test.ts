// Covers: task:1, task:2
import { describe, expect, it, vi } from 'vitest';

import {
  BUILD_REVIEW_SCOPED_KILL_GRACE_MS,
  runBuildReviewScopedCommand,
  type BuildReviewScopedChild,
  type BuildReviewScopedEscalationScheduler,
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

function fakeEscalationScheduler() {
  let escalation: (() => void) | undefined;
  const handle = {};
  const scheduler: BuildReviewScopedEscalationScheduler = {
    schedule: vi.fn((callback: () => void) => {
      escalation = callback;
      return handle;
    }),
    cancel: vi.fn(),
  };
  return { scheduler, fire: () => escalation?.(), handle };
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

  it('sends SIGTERM but waits for close before reporting an in-flight abort as a timeout', async () => {
    const fake = fakeChild();
    const escalation = fakeEscalationScheduler();
    const controller = new AbortController();
    let settled = false;
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/term.test.ts'], cwd: '/counterfactual', signal: controller.signal,
      launcher: () => fake.child, escalationScheduler: escalation.scheduler,
    }).then((result) => { settled = true; return result; });

    controller.abort();
    await Promise.resolve();

    expect(fake.child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(escalation.scheduler.schedule).toHaveBeenCalledWith(expect.any(Function), BUILD_REVIEW_SCOPED_KILL_GRACE_MS);
    expect(settled).toBe(false);
    fake.close(0);

    await expect(run).resolves.toEqual({ kind: 'timeout', stdout: '', stderr: '' });
  });

  it('escalates a child that does not close and reports the captured output as a timeout', async () => {
    const fake = fakeChild();
    const escalation = fakeEscalationScheduler();
    const controller = new AbortController();
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/kill.test.ts'], cwd: '/counterfactual', signal: controller.signal,
      launcher: () => fake.child, escalationScheduler: escalation.scheduler,
    });
    fake.stdout('before abort');
    fake.stderr('warning');
    controller.abort();
    escalation.fire();

    await expect(run).resolves.toEqual({ kind: 'timeout', stdout: 'before abort', stderr: 'warning' });
    expect(fake.child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(fake.child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('cancels escalation without SIGKILL when the child closes during its grace period', async () => {
    const fake = fakeChild();
    const escalation = fakeEscalationScheduler();
    const controller = new AbortController();
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/graceful.test.ts'], cwd: '/counterfactual', signal: controller.signal,
      launcher: () => fake.child, escalationScheduler: escalation.scheduler,
    });

    controller.abort();
    fake.close(0);
    escalation.fire();

    await expect(run).resolves.toEqual({ kind: 'timeout', stdout: '', stderr: '' });
    expect(escalation.scheduler.cancel).toHaveBeenCalledExactlyOnceWith(escalation.handle);
    expect(fake.child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
  });

  it('does not signal or replace an outcome when abort arrives after close', async () => {
    const fake = fakeChild();
    const controller = new AbortController();
    const run = runBuildReviewScopedCommand({
      template: 'npm test -- {selectors}', selectors: ['test/already-closed.test.ts'], cwd: '/counterfactual', signal: controller.signal,
      launcher: () => fake.child,
    });
    fake.close(0);
    await expect(run).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '' });

    controller.abort();

    expect(fake.child.kill).not.toHaveBeenCalled();
  });
});
