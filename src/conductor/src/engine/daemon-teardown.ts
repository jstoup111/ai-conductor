export interface DaemonTeardown {
  requestStop(): void;
  shouldStop(): boolean;
  cancel(): void;
}

export interface DaemonTeardownOptions<T = ReturnType<typeof setTimeout>> {
  timeoutMs: number;
  onForceRelease: () => void;
  setTimer?: (cb: () => void, ms: number) => T;
  clearTimer?: (handle: T) => void;
}

export function createDaemonTeardown<T = ReturnType<typeof setTimeout>>(
  opts: DaemonTeardownOptions<T>,
): DaemonTeardown {
  const setTimer =
    opts.setTimer ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown as T);
  const clearTimer =
    opts.clearTimer ?? ((handle: T) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));

  let stopRequested = false;
  let timerHandle: T | undefined;

  return {
    requestStop(): void {
      if (stopRequested) return;
      stopRequested = true;
      const handle = setTimer(opts.onForceRelease, opts.timeoutMs);
      const maybeUnref = handle as unknown as { unref?: () => void };
      if (typeof maybeUnref?.unref === 'function') {
        maybeUnref.unref(); // portability-ok: guarded typeof check; only detaches the force-release timeout timer from process exit, no effect on teardown semantics
      }
      timerHandle = handle;
    },
    shouldStop(): boolean {
      return stopRequested;
    },
    cancel(): void {
      if (timerHandle === undefined) return;
      clearTimer(timerHandle);
      timerHandle = undefined;
    },
  };
}
