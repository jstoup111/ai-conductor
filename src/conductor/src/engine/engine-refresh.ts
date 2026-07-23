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

export interface StalenessWarner {
  warn(cause: string, originHead: string, defaultBranch: string): void;
}

/**
 * Emits a loud, deduped warning when the running daemon engine is stale
 * relative to origin. Dedups per (cause, originHead) pair: repeated warn()
 * calls for the same pair are suppressed, but a new originHead for a given
 * cause re-arms the warning.
 */
export function createStalenessWarner(
  log: (msg: string) => void,
): StalenessWarner {
  const lastWarnedHeadByCause = new Map<string, string>();

  return {
    warn(cause: string, originHead: string, defaultBranch: string): void {
      if (lastWarnedHeadByCause.get(cause) === originHead) return;
      lastWarnedHeadByCause.set(cause, originHead);

      log(
        `⚠️ [daemon] WARN engine-stale: ${cause} — the running daemon engine is out of date. ` +
          `Reload with: git pull --ff-only origin ${defaultBranch} && ` +
          `(cd src/conductor && npm run build) && conduct daemon restart`,
      );
    },
  };
}
