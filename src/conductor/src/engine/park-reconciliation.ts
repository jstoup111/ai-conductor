import type { GhRunner, GitRunner } from './pr-labels.js';

export interface ReconcileMergedParkOptions {
  projectRoot: string;
  slug: string;
  runGit?: GitRunner;
  runGh?: GhRunner;
  log?: (message: string) => void;
}

export interface ReconcileMergedParkOutcome {
  slug: string;
  steps: string[];
  refusal?: string;
}

const SINGLE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Guarded deletion seam for one parked feature. Later gates establish every
 * deletion precondition; this initial gate ensures no caller can widen scope.
 */
export async function reconcileMergedPark(
  opts: ReconcileMergedParkOptions,
): Promise<ReconcileMergedParkOutcome> {
  if (!SINGLE_SLUG.test(opts.slug)) {
    return { slug: opts.slug, steps: [], refusal: 'invalid-slug' };
  }

  return { slug: opts.slug, steps: [], refusal: 'not-implemented' };
}
