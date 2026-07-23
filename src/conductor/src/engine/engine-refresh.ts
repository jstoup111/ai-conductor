export interface RefreshThrottle {
  shouldRun(): boolean;
  markRan(): void;
}

/**
 * Pure, injectable-clock throttle for gating origin fetches so they don't
 * run more often than `minIntervalMs`. No I/O — the caller decides what
 * "running" means and calls markRan() after it does the work.
 */
export function createRefreshThrottle(
  minIntervalMs: number,
  now: () => number,
): RefreshThrottle {
  let lastRanAt: number | null = null;

  return {
    shouldRun(): boolean {
      if (lastRanAt === null) return true;
      return now() - lastRanAt >= minIntervalMs;
    },
    markRan(): void {
      lastRanAt = now();
    },
  };
}
