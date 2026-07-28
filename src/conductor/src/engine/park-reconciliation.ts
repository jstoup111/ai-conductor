import {
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';

export interface ReconcileMergedParkOptions {
  projectRoot: string;
  slug: string;
  runGit?: GitRunner;
  runGh?: GhRunner;
  requestRecordRepair?: (request: { slug: string; prUrl: string }) => Promise<void>;
  log?: (message: string) => void;
}

export interface ReconcileMergedParkOutcome {
  slug: string;
  steps: string[];
  refusal?: string;
  deferred?: boolean;
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

  const runGit = opts.runGit ?? makeProductionGit();
  try {
    await runGit(
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

  let shippedRecords: string[];
  try {
    const { stdout } = await runGit(['ls-tree', '--name-only', 'origin/main:.docs/shipped'], {
      cwd: opts.projectRoot,
    });
    shippedRecords = stdout
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return { slug: opts.slug, steps: [], refusal: 'record-check-failed' };
  }

  if (!shippedRecords.includes(`${opts.slug}.md`)) {
    let prUrl: string | undefined;
    try {
      const { stdout } = await (opts.runGh ?? makeProductionGh())(
        [
          'pr',
          'list',
          '--state',
          'merged',
          '--head',
          `feature/${opts.slug}`,
          '--json',
          'url',
          '--limit',
          '1',
        ],
        { cwd: opts.projectRoot },
      );
      const prs = JSON.parse(stdout) as Array<{ url?: unknown }>;
      const url = prs[0]?.url;
      prUrl = typeof url === 'string' ? url : undefined;
    } catch {
      // An unavailable PR lookup cannot authorize cleanup or record creation.
    }

    if (prUrl) await opts.requestRecordRepair?.({ slug: opts.slug, prUrl });
    opts.log?.(`[parked-reconciliation] ${opts.slug} not reconcilable until the record lands`);
    return { slug: opts.slug, steps: [], refusal: 'record-missing', deferred: true };
  }

  return { slug: opts.slug, steps: [], refusal: 'not-implemented' };
}
