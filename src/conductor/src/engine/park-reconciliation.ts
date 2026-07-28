import {
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';
import { detectAutoResume } from './auto-resume.js';
import { dispatchDaemonPark } from './daemon-park-cli.js';
import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
  annotation?: 'orphan' | 'merged-ready';
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
  /**
   * Daemon-owned per-slug HALT-watcher disposal, threaded through to the guarded
   * helper so cleanup never leaves a watcher on a worktree it just deleted.
   */
  disposeHaltWatcher?: (slug: string) => void;
  log?: (message: string) => void;
  autoCleanup?: boolean;
  cache?: Map<string, ParkClassification>;
}

const SINGLE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const sweepSummarySignatures = new WeakMap<Map<string, ParkClassification>, string>();

/**
 * The stem with a leading `YYYY-MM-DD-` date prefix removed. Mirrors
 * `undatedStem` in `daemon-backlog.ts` (and the copy in
 * `protected-artifact-seal.ts`); duplicated rather than imported so the park
 * sweep does not pull the whole discovery module in for one regex. Keep the
 * three in sync if the date-prefix convention ever changes.
 *
 * Needed here because park markers are keyed by the UNDATED slug
 * (`.daemon/parked/first-class-codex-harness-parity-904`) while the shipped
 * record that proves the same feature merged is keyed by the DATED plan stem
 * (`.docs/shipped/2026-07-25-first-class-codex-harness-parity-904.md`).
 */
function undatedStem(stem: string): string {
  return stem.replace(/^\d{4}-\d{2}-\d{2}-(?=.)/, '');
}

/**
 * Everything the reconciler knows about whether one parked slug's work is
 * already contained in the base branch.
 *
 * Two independent signals, because neither alone is sufficient in a real
 * repository:
 *
 * - `shippedRecordOnMain` — `.docs/shipped/<stem>.md` committed on
 *   `origin/main`. Per CLAUDE.md rule 4 this IS the harness's definition of
 *   "the work shipped", and it is what `daemon-backlog.ts` dedups on. It is
 *   durable: it survives the post-merge branch deletion that makes any
 *   branch-derived check permanently unanswerable, and it survives a
 *   squash/rebase merge that leaves the local branch tip outside `origin/main`.
 * - `mergedBranches` — local branches for the slug that `merge-base
 *   --is-ancestor` proves are contained in `origin/main`. This remains the
 *   ONLY authority for deleting a branch (see `reconcileMergedPark`), because
 *   deleting a branch that is not an ancestor would drop commits.
 *
 * `branches` carries every local branch whose final path segment is the slug,
 * whatever its prefix. Branch prefixes are not uniform (`feat/`, `spec/`,
 * `fix/`, `feature/`, `chore/`, `docs/`, `hotfix/`, …), so a hardcoded
 * `feature/<slug>` ref names a branch that usually does not exist — `git
 * merge-base` then exits 128 ("Not a valid object name"), which is a MISSING
 * REF, not "not an ancestor", and must never be read as either.
 */
export interface MergeEvidence {
  /** A shipped record for this slug is committed on `origin/main`. */
  shippedRecordOnMain: boolean;
  /** Local branches whose last path segment matches the slug, any prefix. */
  branches: string[];
  /** Subset of `branches` proven contained in `origin/main`. */
  mergedBranches: string[];
}

/** True when either durable signal proves the slug's work reached the base branch. */
function isMerged(evidence: MergeEvidence): boolean {
  return evidence.shippedRecordOnMain || evidence.mergedBranches.length > 0;
}

/**
 * Shipped-record stems committed on `origin/main`, or `null` when the base
 * branch itself could not be read.
 *
 * A failing `ls-tree` is ambiguous: the repository may simply have no
 * `.docs/shipped` tree yet (an empty record set — a definite answer), or
 * `origin/main` may be unavailable (no answer at all). Reading the second case
 * as "nothing shipped" would silently authorize reconciliation on no evidence,
 * so the ambiguity is resolved with an explicit `rev-parse` and unavailability
 * fails closed.
 */
async function listShippedStemsOnMain(
  runGit: GitRunner,
  projectRoot: string,
): Promise<string[] | null> {
  try {
    const { stdout } = await runGit(['ls-tree', '--name-only', 'origin/main:.docs/shipped'], {
      cwd: projectRoot,
    });
    return stdout
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => basename(entry, '.md'));
  } catch {
    try {
      await runGit(['rev-parse', '--verify', 'origin/main^{commit}'], { cwd: projectRoot });
      return []; // base branch exists, it just carries no `.docs/shipped` tree
    } catch {
      return null; // base branch unreadable — no answer, not an empty answer
    }
  }
}

/**
 * Local branches indexed by their final path segment (undated), so a slug
 * resolves to its branch whatever prefix the author used. `null` when the ref
 * listing itself failed.
 */
async function listBranchesBySlug(
  runGit: GitRunner,
  projectRoot: string,
): Promise<Map<string, string[]> | null> {
  try {
    const { stdout } = await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
      cwd: projectRoot,
    });
    const bySlug = new Map<string, string[]>();
    for (const line of stdout.split('\n')) {
      const ref = line.trim();
      if (!ref) continue;
      const key = undatedStem(ref.slice(ref.lastIndexOf('/') + 1));
      const existing = bySlug.get(key);
      if (existing) existing.push(ref);
      else bySlug.set(key, [ref]);
    }
    return bySlug;
  } catch {
    return null;
  }
}

/**
 * `true` contained in `origin/main`, `false` definitely not, `null` when git
 * could not answer (exit 128: missing ref, unreadable repo, …). Exit 1 — and
 * ONLY exit 1 — means "not an ancestor".
 */
async function isContainedInMain(
  runGit: GitRunner,
  projectRoot: string,
  ref: string,
): Promise<boolean | null> {
  try {
    await runGit(['merge-base', '--is-ancestor', ref, 'origin/main'], { cwd: projectRoot });
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 1 ? false : null;
  }
}

/**
 * Collect both merge signals for one slug. Returns `null` when the evidence is
 * indeterminate, which callers must treat as inaction (`unclassified`), never
 * as "not merged".
 *
 * `prefetched` lets a sweep read the record listing and the ref listing ONCE
 * for the whole pass instead of once per parked slug.
 */
async function gatherMergeEvidence(
  runGit: GitRunner,
  projectRoot: string,
  slug: string,
  prefetched?: { shippedStems: string[] | null; branchesBySlug: Map<string, string[]> | null },
): Promise<MergeEvidence | null> {
  const shippedStems =
    prefetched?.shippedStems ?? (await listShippedStemsOnMain(runGit, projectRoot));
  if (shippedStems === null) return null;
  const branchesBySlug =
    prefetched?.branchesBySlug ?? (await listBranchesBySlug(runGit, projectRoot));
  if (branchesBySlug === null) return null;

  const key = undatedStem(slug);
  const shippedRecordOnMain = shippedStems.some((stem) => undatedStem(stem) === key);
  const branches = branchesBySlug.get(key) ?? [];

  const mergedBranches: string[] = [];
  let ancestryUnavailable = false;
  for (const ref of branches) {
    const contained = await isContainedInMain(runGit, projectRoot, ref);
    if (contained === null) ancestryUnavailable = true;
    else if (contained) mergedBranches.push(ref);
  }

  // A broken ancestry probe only defeats the answer when nothing else settled
  // it; a record on main already proves the ship on its own.
  if (!shippedRecordOnMain && mergedBranches.length === 0 && ancestryUnavailable) return null;

  return { shippedRecordOnMain, branches, mergedBranches };
}

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
  const parkedSlugs = await listOperatorParkedSlugs(opts.projectRoot);

  // Read the base-branch record listing and the local ref listing ONCE for the
  // whole pass; both are pass-invariant and the sweep runs on every idle tick.
  const prefetched = {
    shippedStems: await listShippedStemsOnMain(runGit, opts.projectRoot),
    branchesBySlug: await listBranchesBySlug(runGit, opts.projectRoot),
  };

  for (const slug of parkedSlugs) {
    let classification: ParkClassification;
    const evidence = await gatherMergeEvidence(runGit, opts.projectRoot, slug, prefetched);
    if (evidence === null) {
      classification = 'unclassified';
      opts.log?.(`[parked-reconciliation] ${slug} origin/main merge evidence unavailable; skipped`);
    } else if (isMerged(evidence)) {
      classification = 'merged';
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
          opts.log?.(`[parked-reconciliation] ${slug} issue lookup unavailable; skipped`);
        }
      }
    }

    const autoCleanup = opts.autoCleanup ?? true;
    entries.push({
      slug,
      classification,
      annotation: classification === 'orphan' ? 'orphan' : classification === 'merged' && !autoCleanup ? 'merged-ready' : undefined,
    });
    const classificationChanged = !opts.cache || opts.cache.get(slug) !== classification;
    if (classification === 'merged' && autoCleanup) {
      // The helper reports its refusal reason for direct/operator invocation.
      // In a daemon sweep, route that per-slug report through the outcome cache
      // too, so an unchanged deferred record does not fill every idle-tick log.
      const outcome = await reconcileMergedPark({
        ...opts,
        slug,
        log: classificationChanged ? opts.log : undefined,
        // Named explicitly (not merely carried by the spread) so the two
        // production hand-off seams stay visible at the only call site that
        // supplies them.
        requestRecordRepair: opts.requestRecordRepair,
        disposeHaltWatcher: opts.disposeHaltWatcher,
      });
      if (outcome.refusal === undefined) {
        counts.reconciled++;
        opts.log?.(`[parked-reconciliation] reconciled ${slug}`);
      }
      else if (outcome.deferred) counts.deferred++;
    }
    if (classification === 'orphan') counts.orphaned++;
    else if (classification === 'unclassified') counts.skipped++;
    else counts.parked++;
    if (classification === 'orphan') opts.log?.(`[parked-reconciliation] ${slug} orphan`);
    if (opts.cache && classificationChanged) {
      opts.log?.(`[parked-reconciliation] ${slug} ${classification}`);
    }
    opts.cache?.set(slug, classification);
  }

  if (opts.cache) {
    const signature = `${counts.reconciled}:${counts.deferred}:${counts.orphaned}:${counts.parked}:${counts.skipped}`;
    if (sweepSummarySignatures.get(opts.cache) !== signature) {
      opts.log?.(`[parked-reconciliation] reconciled=${counts.reconciled} deferred=${counts.deferred} orphaned=${counts.orphaned} parked=${counts.parked} skipped=${counts.skipped}`);
      sweepSummarySignatures.set(opts.cache, signature);
    }
    const live = new Set(parkedSlugs);
    for (const slug of opts.cache.keys()) if (!live.has(slug)) opts.cache.delete(slug);
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

  // Re-derive the evidence here rather than trusting any caller's or sweep's
  // cached classification (ADR: the helper re-verifies immediately before any
  // destructive step).
  const evidence = await gatherMergeEvidence(runGit, opts.projectRoot, opts.slug);
  if (evidence === null) {
    return { slug: opts.slug, steps: [], refusal: 'ancestry-check-failed' };
  }
  if (!isMerged(evidence)) {
    return {
      slug: opts.slug,
      steps: [],
      refusal: evidence.branches.length === 0 ? 'branch-missing' : 'not-ancestor',
    };
  }

  // Deletion gate, unchanged in strength by the record signal: EVERY local
  // branch carrying this slug must be ancestry-proven before anything is
  // deleted. A shipped record proves the work shipped, but it says nothing
  // about commits that landed on the branch afterwards — including work that
  // raced this very sweep. Ancestry stays the sole deletion authority, so a
  // record-backed park whose branch is not contained in origin/main is
  // classified `merged` (it is) and refused for cleanup (it must be).
  if (evidence.mergedBranches.length !== evidence.branches.length) {
    return { slug: opts.slug, steps: [], refusal: 'not-ancestor' };
  }

  if (!evidence.shippedRecordOnMain) {
    let prUrl: string | undefined;
    for (const head of evidence.branches) {
      try {
        const { stdout } = await (opts.runGh ?? makeProductionGh())(
          ['pr', 'list', '--state', 'merged', '--head', head, '--json', 'url', '--limit', '1'],
          { cwd: opts.projectRoot },
        );
        const prs = JSON.parse(stdout) as Array<{ url?: unknown }>;
        const url = prs[0]?.url;
        if (typeof url === 'string') {
          prUrl = url;
          break;
        }
      } catch {
        // An unavailable PR lookup cannot authorize cleanup or record creation.
      }
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

  // The gate above proved every branch for this slug is contained in
  // origin/main, so deleting them cannot drop a commit. The no-branch case is
  // the normal end state for shipped work whose branch was deleted at merge:
  // there is nothing to delete, and the shipped record — not a ref that no
  // longer exists — is what proved the ship.
  if (evidence.branches.length === 0) {
    steps.push('branch-absent');
  } else {
    for (const ref of evidence.branches) {
      try {
        await runGit(['branch', '-d', ref], { cwd: opts.projectRoot });
      } catch {
        return { slug: opts.slug, steps, refusal: 'branch-delete-failed' };
      }
    }
    steps.push('branch-deleted');
  }

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
