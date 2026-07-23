import { originDefaultBranch, type GitRunner } from './rebase.js';

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

export type OriginAncestryOutcome = 'current' | 'behind' | 'undeterminable';

export interface OriginAncestryResult {
  outcome: OriginAncestryOutcome;
  originHead?: string;
  defaultBranch?: string;
}

/**
 * Advisory-only ancestry probe (Task 9, TI-4 HP3/NP3/NP4): is the boot-stamped
 * engine source SHA (`stampedSha`, read once at boot from the
 * `.engine-source-sha` sidecar — Task 8) determinably BEHIND origin's default
 * branch?
 *
 * Fetches origin and checks `git merge-base --is-ancestor <originHead>
 * <stampedSha>`:
 *   - exit 0  → originHead IS an ancestor of the stamp → stamp is current/ahead → 'current'.
 *   - exit 1  → originHead is NOT an ancestor of the stamp → stamp is determinably behind → 'behind'.
 *   - anything else (bad object, error) → 'undeterminable' — NEVER claims 'behind'
 *     on an ambiguous result.
 *
 * Also 'undeterminable' (silent, by design — NEVER throws) when: the stamped
 * sha is missing/unknown, there is no origin remote, the default branch can't
 * be discovered, or the fetch fails (no prior origin knowledge to compare
 * against).
 */
export async function probeStampedShaBehindOrigin(
  git: GitRunner,
  stampedSha: string,
): Promise<OriginAncestryResult> {
  if (!stampedSha || stampedSha === 'unknown') return { outcome: 'undeterminable' };

  try {
    const remotes = await git(['remote']);
    if (remotes.exitCode !== 0) return { outcome: 'undeterminable' };
    const hasOrigin = remotes.stdout
      .split('\n')
      .map((l) => l.trim())
      .includes('origin');
    if (!hasOrigin) return { outcome: 'undeterminable' };

    const defaultBranch = await originDefaultBranch(git);
    if (!defaultBranch) return { outcome: 'undeterminable' };

    const fetched = await git(['fetch', 'origin', defaultBranch]);
    if (fetched.exitCode !== 0) return { outcome: 'undeterminable' };

    const originHeadResult = await git(['rev-parse', `origin/${defaultBranch}`]);
    if (originHeadResult.exitCode !== 0) return { outcome: 'undeterminable' };
    const originHead = originHeadResult.stdout.trim();

    const ancestorResult = await git(['merge-base', '--is-ancestor', originHead, stampedSha]);
    if (ancestorResult.exitCode === 0) return { outcome: 'current', originHead, defaultBranch };
    if (ancestorResult.exitCode === 1) return { outcome: 'behind', originHead, defaultBranch };
    return { outcome: 'undeterminable', originHead, defaultBranch };
  } catch {
    return { outcome: 'undeterminable' };
  }
}
