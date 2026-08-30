import { describe, expect, it, vi } from 'vitest';
import { createScaledDaemonTeardown } from '../../src/daemon-cli.js';

function makeFakeTimer() {
  const armed: { handle: number; cb: () => void; ms: number }[] = [];
  const cleared: number[] = [];
  let nextHandle = 0;

  const setTimer = vi.fn((cb: () => void, ms: number) => {
    const handle = ++nextHandle;
    armed.push({ handle, cb, ms });
    return handle;
  });
  const clearTimer = vi.fn((handle: number) => {
    cleared.push(handle);
  });
  const fire = (index: number) => {
    const entry = armed[index];
    if (!cleared.includes(entry.handle)) entry.cb();
  };

  return { armed, cleared, setTimer, clearTimer, fire };
}

describe('SIGTERM scaled force-release bound (Task 17)', () => {
  const PER_EXECUTOR_TIMEOUT_MS = 30_000;

  it('allows a normal N=3 cooperative drain to settle without force release', () => {
    let liveExecutors = 3;
    const timer = makeFakeTimer();
    const onForceRelease = vi.fn();
    const teardown = createScaledDaemonTeardown({
      perExecutorTimeoutMs: PER_EXECUTOR_TIMEOUT_MS,
      liveExecutorCount: () => liveExecutors,
      onForceRelease,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    teardown.requestStop();
    expect(timer.armed[0].ms).toBe(3 * PER_EXECUTOR_TIMEOUT_MS);

    liveExecutors = 2;
    teardown.executorSettled();
    expect(timer.armed[1].ms).toBe(2 * PER_EXECUTOR_TIMEOUT_MS);

    liveExecutors = 1;
    teardown.executorSettled();
    expect(timer.armed[2].ms).toBe(PER_EXECUTOR_TIMEOUT_MS);

    teardown.cancel();
    timer.fire(0);
    timer.fire(1);
    timer.fire(2);
    expect(onForceRelease).not.toHaveBeenCalled();
  });

  it('force-releases a wedged N=3 drain after the scaled bound', () => {
    const timer = makeFakeTimer();
    const onForceRelease = vi.fn();
    const teardown = createScaledDaemonTeardown({
      perExecutorTimeoutMs: PER_EXECUTOR_TIMEOUT_MS,
      liveExecutorCount: () => 3,
      onForceRelease,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    teardown.requestStop();

    expect(timer.armed).toHaveLength(1);
    expect(timer.armed[0].ms).toBe(3 * PER_EXECUTOR_TIMEOUT_MS);
    timer.fire(0);
    expect(onForceRelease).toHaveBeenCalledTimes(1);
  });

  it('retains the existing single-worker force-release bound', () => {
    const timer = makeFakeTimer();
    const teardown = createScaledDaemonTeardown({
      perExecutorTimeoutMs: PER_EXECUTOR_TIMEOUT_MS,
      liveExecutorCount: () => 1,
      onForceRelease: vi.fn(),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    teardown.requestStop();

    expect(timer.armed[0].ms).toBe(PER_EXECUTOR_TIMEOUT_MS);
  });
});
