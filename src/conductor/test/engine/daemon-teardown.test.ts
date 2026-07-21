import { describe, expect, it, vi } from 'vitest';
import { createDaemonTeardown } from '../../src/engine/daemon-teardown.js';

function makeFakeTimer() {
  const armed: { handle: number; cb: () => void; ms: number }[] = [];
  const cleared: unknown[] = [];
  let nextHandle = 0;
  const setTimer = vi.fn((cb: () => void, ms: number) => {
    const handle = ++nextHandle;
    armed.push({ handle, cb, ms });
    return handle;
  });
  const clearTimer = vi.fn((handle: unknown) => {
    cleared.push(handle);
  });
  const fire = (index: number) => {
    const entry = armed[index];
    if (cleared.includes(entry.handle)) return;
    entry.cb();
  };
  return { armed, cleared, setTimer, clearTimer, fire };
}

describe('createDaemonTeardown', () => {
  it('fresh controller shouldStop() is false', () => {
    const { setTimer, clearTimer } = makeFakeTimer();
    const teardown = createDaemonTeardown({
      timeoutMs: 5000,
      onForceRelease: vi.fn(),
      setTimer,
      clearTimer,
    });

    expect(teardown.shouldStop()).toBe(false);
  });

  it('requestStop() sets shouldStop() true and arms timer with configured timeoutMs', () => {
    const { armed, setTimer, clearTimer } = makeFakeTimer();
    const teardown = createDaemonTeardown({
      timeoutMs: 5000,
      onForceRelease: vi.fn(),
      setTimer,
      clearTimer,
    });

    teardown.requestStop();

    expect(teardown.shouldStop()).toBe(true);
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(armed[0].ms).toBe(5000);
  });

  it('firing the fake timer invokes onForceRelease exactly once', () => {
    const { fire, setTimer, clearTimer } = makeFakeTimer();
    const onForceRelease = vi.fn();
    const teardown = createDaemonTeardown({
      timeoutMs: 5000,
      onForceRelease,
      setTimer,
      clearTimer,
    });

    teardown.requestStop();
    fire(0);

    expect(onForceRelease).toHaveBeenCalledTimes(1);
  });

  it('cancel() clears the timer so a subsequent fake fire does not call onForceRelease', () => {
    const { cleared, fire, setTimer, clearTimer } = makeFakeTimer();
    const onForceRelease = vi.fn();
    const teardown = createDaemonTeardown({
      timeoutMs: 5000,
      onForceRelease,
      setTimer,
      clearTimer,
    });

    teardown.requestStop();
    teardown.cancel();

    expect(cleared).toHaveLength(1);

    fire(0);
    expect(onForceRelease).not.toHaveBeenCalled();
  });

  it('requestStop() is idempotent — second call does not arm a second timer', () => {
    const { setTimer, clearTimer } = makeFakeTimer();
    const onForceRelease = vi.fn();
    const teardown = createDaemonTeardown({
      timeoutMs: 5000,
      onForceRelease,
      setTimer,
      clearTimer,
    });

    teardown.requestStop();
    teardown.requestStop();

    expect(setTimer).toHaveBeenCalledTimes(1);
  });
});
