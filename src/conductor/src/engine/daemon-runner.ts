import type { BacklogItem, FeatureOutcome } from './daemon.js';

/**
 * Outcome of running the gate loop inside a feature's worktree, read from the
 * `.pipeline/DONE` / `.pipeline/HALT` markers the conductor writes.
 */
export interface WorktreeOutcome {
  done: boolean;
  halted: boolean;
  reason?: string;
  prUrl?: string;
  costTokens?: number;
}

export interface FeatureWorktree {
  path: string;
  branch: string;
}

/**
 * The real-I/O primitives a feature run needs. Injected so the orchestration
 * (done/halted/error + teardown discipline) is unit-testable without git,
 * Claude, or gh.
 */
export interface FeatureRunnerDeps {
  /** `git worktree add` a fresh branch+dir for the feature. */
  createWorktree: (slug: string) => Promise<FeatureWorktree>;
  /** Copy/commit the feature's stories+plan into the worktree (materialization)
   *  so the loop's inputs physically exist there, not just in the main checkout. */
  materializeSpecs: (worktree: FeatureWorktree, item: BacklogItem) => Promise<void>;
  /** Run the conductor's gate loop in the worktree to DONE/HALT (finish=open PR). */
  runConductor: (worktree: FeatureWorktree, item: BacklogItem) => Promise<void>;
  /** Read the loop outcome from the worktree's markers. */
  readOutcome: (worktree: FeatureWorktree) => Promise<WorktreeOutcome>;
  /** Remove the worktree (keep=true leaves it for inspection after halt/error). */
  teardownWorktree: (worktree: FeatureWorktree, keep: boolean) => Promise<void>;
  /** Persist that a slug shipped so discoverBacklog skips it next poll. */
  markProcessed: (slug: string) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Build the `runFeature` the daemon pool calls. Discipline:
 *   - done   → mark processed, remove the worktree, report prUrl.
 *   - halted → KEEP the worktree (for the human), park the feature.
 *   - error / no marker → keep the worktree, report error.
 *   - a thrown primitive is caught here too (belt-and-suspenders; the pool also
 *     guards), worktree kept for inspection.
 */
export function makeRunFeature(
  deps: FeatureRunnerDeps,
): (item: BacklogItem) => Promise<FeatureOutcome> {
  const log = deps.log ?? (() => {});

  return async (item: BacklogItem): Promise<FeatureOutcome> => {
    let worktree: FeatureWorktree | null = null;
    try {
      worktree = await deps.createWorktree(item.slug);
      await deps.materializeSpecs(worktree, item);
      await deps.runConductor(worktree, item);
      const outcome = await deps.readOutcome(worktree);

      if (outcome.done) {
        await deps.markProcessed(item.slug);
        await deps.teardownWorktree(worktree, false);
        log(`✓ ${item.slug} shipped${outcome.prUrl ? ` → ${outcome.prUrl}` : ''}`);
        return {
          slug: item.slug,
          status: 'done',
          prUrl: outcome.prUrl,
          costTokens: outcome.costTokens,
        };
      }

      if (outcome.halted) {
        await deps.teardownWorktree(worktree, true); // keep for the human
        log(`✋ ${item.slug} halted — worktree kept (${outcome.reason ?? 'see .pipeline/HALT'})`);
        return {
          slug: item.slug,
          status: 'halted',
          reason: outcome.reason,
          costTokens: outcome.costTokens,
        };
      }

      // Loop ended without DONE or HALT — treat as an error, keep the worktree.
      await deps.teardownWorktree(worktree, true);
      return {
        slug: item.slug,
        status: 'error',
        reason: outcome.reason ?? 'loop ended without DONE or HALT marker',
        costTokens: outcome.costTokens,
      };
    } catch (err) {
      if (worktree) await deps.teardownWorktree(worktree, true).catch(() => {});
      return {
        slug: item.slug,
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
