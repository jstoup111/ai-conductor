import {
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';
import { detectAutoResume } from './auto-resume.js';
import { dispatchDaemonPark } from './daemon-park-cli.js';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listOperatorParkedSlugs } from './park-marker.js';
import { parseIntakeSourceRef } from './artifacts.js';

export interface ReconcileMergedParkOptions {
  projectRoot: string;
  slug: string;
  runGit?: GitRunner;
  runGh?: GhRunner;
  requestRecordRepair?: (request: { slug: string; prUrl: string }) => Promise<void>;
  log?: (message: string) => void;
  disposeHaltWatcher?: (slug: string) => void;
}

export interface ReconcileMergedParkOutcome {
  slug: string;
  steps: string[];
  refusal?: string;
  deferred?: boolean;
}

export type ParkClassification = 'merged' | 'orphan' | 'normal' | 'unclassified';

export interface ParkedSweepEntry {
  slug: string;
  classification: ParkClassification;
}

export interface ParkedSweepResult {
  entries: ParkedSweepEntry[];
  counts: {
    reconciled: number;
    deferred: number;
    orphaned: number;
    parked: number;
    skipped: number;
  };
}

export interface ReconcileParkedFeaturesOptions {
  projectRoot: string;
  runGit?: GitRunner;
  runGh?: GhRunner;
  getIssueState?: (ref: string, cwd: string) => Promise<string>;
  requestRecordRepair?: (request: { slug: string; prUrl: string }) => Promise<void>;
  log?: (message: string) => void;
  autoCleanup?: boolean;
}

const SINGLE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Report the current reconciliation classification for each parked feature.
 * Cleanup is deliberately not initiated here until the later auto-cleanup task.
 */
export async function reconcileParkedFeatures(
  opts: ReconcileParkedFeaturesOptions,
): Promise<ParkedSweepResult> {
  const entries: ParkedSweepEntry[] = [];
  const counts = { reconciled: 0, deferred: 0, orphaned: 0, parked: 0, skipped: 0 };
  const runGit = opts.runGit ?? makeProductionGit();

  for (const slug of await listOperatorParkedSlugs(opts.projectRoot)) {
    let classification: ParkClassification;
    try {
      await runGit(['merge-base', '--is-ancestor', `feature/${slug}`, 'origin/main'], {
        cwd: opts.projectRoot,
      });
      classification = 'merged';
    } catch (error) {
      if ((error as { code?: unknown }).code !== 1) {
        classification = 'unclassified';
      } else {
        const intake = await readFile(join(opts.projectRoot, '.docs', 'intake', `${slug}.md`), 'utf-8')
          .then((content) => content)
          .catch(() => null);
        const sourceRef = parseIntakeSourceRef(intake);
        if (!sourceRef || !opts.getIssueState) {
          classification = 'unclassified';
        } else {
          try {
            classification = (await opts.getIssueState(sourceRef, opts.projectRoot)).toUpperCase() === 'CLOSED'
              ? 'orphan'
              : 'normal';
          } catch {
            classification = 'unclassified';
          }
        }
      }
    }

    entries.push({ slug, classification });
    if (classification === 'orphan') counts.orphaned++;
    else if (classification === 'unclassified') counts.skipped++;
    else counts.parked++;
  }

  return { entries, counts };
}

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

  const resume = await detectAutoResume(opts.projectRoot, opts.slug);
  if (resume.kind === 'resume') {
    opts.log?.(`[parked-reconciliation] ${opts.slug} has an in-progress run; refusing cleanup`);
    return { slug: opts.slug, steps: [], refusal: 'in-progress' };
  }

  const steps: string[] = [];
  const worktreePath = join(opts.projectRoot, '.worktrees', opts.slug);
  opts.disposeHaltWatcher?.(opts.slug);

  try {
    await access(worktreePath);
    await runGit(['worktree', 'remove', '--force', worktreePath], { cwd: opts.projectRoot });
  } catch (error) {
    const failure = error as { code?: unknown };
    if (failure.code !== 'ENOENT') {
      return { slug: opts.slug, steps, refusal: 'worktree-remove-failed' };
    }
  }
  steps.push('worktree-removed');

  try {
    await runGit(['branch', '-d', `feature/${opts.slug}`], { cwd: opts.projectRoot });
  } catch {
    return { slug: opts.slug, steps, refusal: 'branch-delete-failed' };
  }
  steps.push('branch-deleted');

  try {
    const exitCode = await dispatchDaemonPark(
      { kind: 'unpark', slug: opts.slug },
      { cwd: opts.projectRoot, out: opts.log ?? (() => {}) },
    );
    if (exitCode !== 0) throw new Error('canonical unpark failed');
  } catch {
    return { slug: opts.slug, steps, refusal: 'unpark-failed' };
  }
  steps.push('unparked');

  return { slug: opts.slug, steps };
}
