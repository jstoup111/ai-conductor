import { makeProductionGit, type GhRunner, type GitRunner } from './pr-labels.js';

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

  try {
    await (opts.runGit ?? makeProductionGit())(
      ['merge-base', '--is-ancestor', `feature/${opts.slug}`, 'origin/main'],
      { cwd: opts.projectRoot },
    );
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown };
    const stderr = typeof failure.stderr === 'string' ? failure.stderr : '';
    if (failure.code === 1) {
      return { slug: opts.slug, steps: [], refusal: 'not-ancestor' };
    }
    if (/not a valid object name|unknown revision|ambiguous argument|bad object/i.test(stderr)) {
      return { slug: opts.slug, steps: [], refusal: 'branch-missing' };
    }
    return { slug: opts.slug, steps: [], refusal: 'ancestry-check-failed' };
  }

  return { slug: opts.slug, steps: [], refusal: 'not-implemented' };
}
