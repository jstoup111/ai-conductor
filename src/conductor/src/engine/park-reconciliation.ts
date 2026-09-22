import {
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';
import { GhCapabilityError } from './tracker-client.js';
import { dispatchDaemonPark } from './daemon-park-cli.js';
import { access, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isOperatorParked, listOperatorParkedSlugs } from './park-marker.js';
import { parseIntakeSourceRef } from './artifacts.js';
import { runProjectTeardown } from './worktree-prepare.js';
import { loadConfig } from './config.js';
import { resolveTeardownTimeoutSeconds } from './resolved-config.js';
import { phaseMarkerPath } from './phase-marker.js';
import type { WorktreeLifecycleQueue } from './worktree.js';
import type { ConductorEvent, WorktreeReclaimRetainedReason } from '../types/events.js';
import { runTrackerAmbientRead } from './tracker-client.js';

export interface ReconcileMergedParkOptions {
  projectRoot: string;
  slug: string;
  /** Registered worktree branch; when present, evidence is scoped to this ref. */
  branch?: string;
  /** Internal sweep hand-off: expose the proof kind to the event producer. */
  emitProof?: boolean;
  runGit?: GitRunner;
  runGh?: GhRunner;
  requestRecordRepair?: (request: { slug: string; prUrl: string }) => Promise<void>;
  log?: (message: string) => void;
  /** Logger reserved for capability diagnostics during a quiet daemon sweep. */
  capabilityLog?: (message: string) => void;
  /** Logger reserved for project-teardown output during a quiet sweep. */
  teardownLog?: (message: string) => void;
  disposeHaltWatcher?: (slug: string) => void;
  /** Resolved project teardown timeout, carried by daemon and operator paths. */
  teardownTimeoutSeconds?: number;
  /** Whether project teardown output should be logged. */
  verbose?: boolean;
  worktreeLifecycle?: WorktreeLifecycleQueue;
  /** Daemon-pool liveness guard; destructive reconciliation always re-checks it. */
  isFeatureInFlight?: (slug: string) => boolean;
}

type ReclaimProof = 'ancestry' | 'merged-pr-head';

interface ReconcileMergedParkBaseOutcome {
  slug: string;
  steps: string[];
  refusal?: RefusalReason;
  unmergedCommits?: UnmergedCommitListing;
  deferred?: boolean;
}

/** A successful branch reconciliation carries its deletion authority; a branchless record reconciliation does not. */
export type ReconcileMergedParkOutcome = ReconcileMergedParkBaseOutcome & (
  | { proof: ReclaimProof }
  | { proof?: never }
);

export interface UnmergedCommitSummary {
  sha: string;
  subject: string;
}

export interface UnmergedCommitListing {
  commits: UnmergedCommitSummary[];
  overflow: number;
}

export type RefusalReason =
  | 'invalid-slug'
  | 'in-flight'
  | 'ancestry-check-failed'
  | 'branch-missing'
  | 'no-merge-proof'
  | 'unmerged-commits'
  | 'branch-behind-merged-head'
  | 'record-missing'
  | 'dirty-worktree'
  | 'worktree-remove-failed'
  | 'branch-delete-failed'
  | 'unpark-failed';

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
    refused: number;
    skipped: number;
  };
  refusedByReason: Partial<Record<RefusalReason, number>>;
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
  /** Daemon-pool liveness guard; active worktrees are never reclaimed. */
  isFeatureInFlight?: (slug: string) => boolean;
  /** Test seam for the single pass-wide registered-worktree snapshot. */
  worktreeListing?: () => Promise<RegisteredWorktree[] | null>;
  /** Resolved reclamation policy; false holds registered, non-parked candidates. */
  reclaimMergedWorktrees?: boolean;
  /** Best-effort event-spine sink for one terminal candidate disposition. */
  onEvent?: (event: ConductorEvent) => void;
  log?: (message: string) => void;
  autoCleanup?: boolean;
  cache?: Map<string, ParkClassification>;
  /** Resolved project teardown timeout, passed to each cleanup operation. */
  teardownTimeoutSeconds?: number;
  /** Whether project teardown output should be logged. */
  verbose?: boolean;
  worktreeLifecycle?: WorktreeLifecycleQueue;
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
 *   --is-ancestor` proves are contained in `origin/main`. Ancestry is one of
 *   the two deletion proofs `reconcileMergedPark` accepts; the other is
 *   head-oid identity against a merged PR (`proveByMergedPrHead`), needed
 *   because a squash merge makes ancestry permanently false for the source
 *   branch. A shipped record is never a deletion proof on its own — it says
 *   nothing about commits added to the branch after the merge.
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
 * A shipped record is a dispatch-dedup precondition only for parked candidates
 * and daemon-created feature branches. Other listed branches are authorized by
 * the merge proofs alone.
 */
export function requiresShippedRecord(branch?: string): boolean {
  return branch === undefined || branch.startsWith('feat/daemon-');
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
 * Registered, depth-one feature worktrees and their checked-out branches, or
 * `null` when Git cannot provide the listing. This deliberately reads once so
 * a caller can apply one coherent registry snapshot to a whole sweep.
 */
export interface RegisteredWorktree {
  slug: string;
  branch?: string;
  /** Nested paths are reported for retention, but never passed to the helper. */
  reclaimable?: boolean;
}

export async function listRegisteredWorktrees(
  runGit: GitRunner,
  projectRoot: string,
): Promise<RegisteredWorktree[] | null> {
  try {
    const { stdout } = await runGit(['worktree', 'list', '--porcelain'], { cwd: projectRoot });
    const worktreesRoot = join(projectRoot, '.worktrees');
    const candidates: RegisteredWorktree[] = [];

    for (const record of stdout.split(/\n\s*\n/)) {
      const lines = record.split('\n');
      const worktreeLine = lines.find((line) => line.startsWith('worktree '));
      const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'));
      if (!worktreeLine) continue;

      const path = worktreeLine.slice('worktree '.length).trim();
      const parent = dirname(path);
      // The root checkout and other worktree roots are not part of this
      // lifecycle. Nested entries are retained below as invalid-slug, never
      // handed to the destructive helper.
      if (parent !== worktreesRoot && !path.startsWith(`${worktreesRoot}/`)) continue;

      candidates.push({
        slug: parent === worktreesRoot ? basename(path) : path.slice(`${worktreesRoot}/`.length),
        ...(branchLine === undefined ? {} : { branch: branchLine.slice('branch refs/heads/'.length).trim() }),
        reclaimable: branchLine !== undefined && parent === worktreesRoot,
      });
    }

    return candidates;
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
 * The diagnosis from a merged pull request's recorded head commit. `proven` is
 * the squash/rebase-merge equivalent of ancestry; the other cases preserve why
 * that proof was unavailable without changing deletion authority.
 */
export type MergedPrHeadDiagnosis =
  | { kind: 'proven' }
  | { kind: 'no-pr' }
  | { kind: 'ahead'; headRefOid: string }
  | { kind: 'behind'; headRefOid: string }
  | { kind: 'capability-unavailable' }
  | { kind: 'indeterminate' };

/**
 * Proves or diagnoses head identity for a merged pull request on `ref`.
 *
 * A squash merge rewrites the branch's commits into one new commit on the base
 * branch, so `merge-base --is-ancestor` is permanently `false` for the source
 * branch even when that branch carries nothing beyond what was merged. Ancestry
 * alone therefore refuses every squash-merged branch forever (the same
 * squash-merge blind spot #1157 fixed for the worktree reap).
 *
 * The head-oid comparison answers the question ancestry was asked for — "does
 * deleting this ref drop a commit?" — without weakening it: GitHub recorded
 * which commit it merged, and if the local tip still equals that commit then
 * every commit on the branch is contained in the squash. One extra local commit
 * moves the tip, the SHAs diverge, and the result distinguishes whether the
 * branch is ahead of or behind the merged head.
 *
 * Fails closed: an unavailable `gh`, a non-JSON payload, or an unresolvable
 * object returns `indeterminate`, leaving ancestry as the only authority.
 */
export async function proveByMergedPrHead(
  runGit: GitRunner,
  runGh: GhRunner,
  projectRoot: string,
  ref: string,
  onCapabilityError?: (error: GhCapabilityError) => void,
): Promise<MergedPrHeadDiagnosis> {
  try {
    const stdout = await runTrackerAmbientRead(runGh, projectRoot, 'ambient.pull-request.read', ['pr', 'list', '--head', ref, '--state', 'merged', '--json', 'headRefOid', '--limit', '1']);
    const prs = JSON.parse(stdout) as Array<{ headRefOid?: unknown }>;
    const headRefOid = prs[0]?.headRefOid;
    if (prs.length === 0) return { kind: 'no-pr' };
    if (typeof headRefOid !== 'string' || headRefOid.trim() === '') return { kind: 'indeterminate' };
    const { stdout: tip } = await runGit(['rev-parse', ref], { cwd: projectRoot });
    const normalizedHeadRefOid = headRefOid.trim();
    if (tip.trim() === normalizedHeadRefOid) return { kind: 'proven' };

    await runGit(['cat-file', '-e', `${normalizedHeadRefOid}^{commit}`], { cwd: projectRoot });
    try {
      await runGit(['merge-base', '--is-ancestor', normalizedHeadRefOid, ref], { cwd: projectRoot });
      return { kind: 'ahead', headRefOid: normalizedHeadRefOid };
    } catch (error) {
      if ((error as { code?: unknown }).code === 1) {
        return { kind: 'behind', headRefOid: normalizedHeadRefOid };
      }
      return { kind: 'indeterminate' };
    }
  } catch (error) {
    if (error instanceof GhCapabilityError) {
      onCapabilityError?.(error);
      return { kind: 'capability-unavailable' };
    }
    return { kind: 'indeterminate' };
  }
}

/**
 * The commits `git branch -D` would discard when a merged-PR branch advanced
 * beyond its recorded head. This is diagnostic data only: it never grants
 * deletion authority.
 */
async function listUnmergedCommits(
  runGit: GitRunner,
  projectRoot: string,
  headRefOid: string,
  ref: string,
): Promise<UnmergedCommitListing | null> {
  try {
    const { stdout } = await runGit(
      ['log', '--oneline', '--no-decorate', `${headRefOid}..${ref}`],
      { cwd: projectRoot },
    );
    const commits = stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [sha, ...subject] = line.trim().split(/\s+/);
        return { sha, subject: subject.join(' ') };
      });
    return { commits: commits.slice(0, 10), overflow: Math.max(0, commits.length - 10) };
  } catch {
    return null;
  }
}

/**
 * `true` when `path` appears in `git worktree list --porcelain` — i.e. git owns
 * it and `git worktree remove` failing on it is a REAL failure (locked, dirty,
 * permissions) that must refuse cleanup.
 *
 * `false` only when the listing was read successfully and `path` is absent: a
 * plain leftover directory under `.worktrees/` that was never registered (or
 * whose registration was already pruned). `git worktree remove` rejects such a
 * path with "is not a working tree" — not `ENOENT` — so without this
 * distinction the reconciler refuses forever on a directory that is safe to
 * delete outright once every merge proof has passed.
 *
 * Fails closed: an unreadable listing reports `true`, keeping the refusal.
 */
async function isRegisteredWorktree(
  runGit: GitRunner,
  projectRoot: string,
  path: string,
): Promise<boolean> {
  try {
    const { stdout } = await runGit(['worktree', 'list', '--porcelain'], { cwd: projectRoot });
    return stdout
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length).trim())
      .includes(path);
  } catch {
    return true;
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
  branch?: string,
): Promise<MergeEvidence | null> {
  // A record is mandatory only for daemon branches, but it is corroborating
  // evidence for every branch.  In particular, ancestry by itself no longer
  // authorizes reclaiming a non-daemon worktree: a record can corroborate it
  // without a GitHub lookup.
  const shippedStems = prefetched === undefined
    ? await listShippedStemsOnMain(runGit, projectRoot)
    : prefetched.shippedStems;
  if (shippedStems === null) return null;
  const branchesBySlug =
    prefetched?.branchesBySlug ?? (await listBranchesBySlug(runGit, projectRoot));
  if (branchesBySlug === null) return null;

  const key = undatedStem(slug);
  const shippedRecordOnMain = shippedStems.some((stem) => undatedStem(stem) === key);
  const branches = branch === undefined
    ? branchesBySlug.get(key) ?? []
    : [...branchesBySlug.values()].some((refs) => refs.includes(branch)) ? [branch] : [];

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
  const counts = {
    reconciled: 0,
    deferred: 0,
    orphaned: 0,
    parked: 0,
    refused: 0,
    skipped: 0,
  };
  const refusedByReason: Partial<Record<RefusalReason, number>> = {};
  const retainedByReason: Record<WorktreeReclaimRetainedReason, number> = {
    detached: 0,
    'in-flight': 0,
    'foreign-lifecycle': 0,
    'invalid-slug': 0,
    halted: 0,
    'listing-unavailable': 0,
    'evidence-unavailable': 0,
    disabled: 0,
    'ancestry-check-failed': 0,
    'branch-missing': 0,
    'no-merge-proof': 0,
    'unmerged-commits': 0,
    'branch-behind-merged-head': 0,
    'record-missing': 0,
    'dirty-worktree': 0,
    'worktree-remove-failed': 0,
    'branch-delete-failed': 0,
    'unpark-failed': 0,
  };
  const runGit = opts.runGit ?? makeProductionGit();
  const parkedSlugs = await listOperatorParkedSlugs(opts.projectRoot);
  const registeredWorktrees = await (opts.worktreeListing?.() ?? listRegisteredWorktrees(runGit, opts.projectRoot));
  const candidates = new Map<string, { branch?: string; parked: boolean; reclaimable: boolean }>();
  for (const slug of parkedSlugs) candidates.set(slug, { parked: true, reclaimable: true });
  for (const entry of registeredWorktrees ?? []) {
    const { slug, branch } = entry;
    const reclaimable = entry.reclaimable ?? true;
    const existing = candidates.get(slug);
    candidates.set(slug, {
      branch,
      parked: existing?.parked ?? false,
      reclaimable: (existing?.reclaimable ?? true) && reclaimable,
    });
  }
  const enumeratedCandidates = [...candidates.values()]
    .filter((candidate) => !candidate.parked).length;

  const prefetched = {
    // Records corroborate ancestry for every reclaimable branch, not only
    // daemon branches whose cleanup is record-gated.
    shippedStems: await listShippedStemsOnMain(runGit, opts.projectRoot),
    branchesBySlug: await listBranchesBySlug(runGit, opts.projectRoot),
  };

  for (const [slug, candidate] of candidates) {
    let retainedReason: WorktreeReclaimRetainedReason | undefined;
    if (registeredWorktrees === null) retainedReason = 'listing-unavailable';
    // These guards protect every registered candidate, including one that is
    // also operator-parked. A live dispatch or HALT always wins over cleanup.
    else if (opts.isFeatureInFlight?.(slug)) retainedReason = 'in-flight';
    else if (slug.startsWith('engineer-') || slug.startsWith('resolve-')) retainedReason = 'foreign-lifecycle';
    else if (!candidate.reclaimable || !SINGLE_SLUG.test(slug)) {
      retainedReason = !candidate.reclaimable && candidate.branch === undefined ? 'detached' : 'invalid-slug';
    }
    else {
      try {
        await access(join(opts.projectRoot, '.worktrees', slug, '.pipeline', 'HALT'));
        retainedReason = 'halted';
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT') retainedReason = 'halted';
      }
    }
    if (!retainedReason) {
      let markerReadError = false;
      await isOperatorParked(opts.projectRoot, slug, () => { markerReadError = true; });
      if (markerReadError) retainedReason = 'halted';
    }

    let classification: ParkClassification;
    if (retainedReason) {
      classification = 'unclassified';
      retainedByReason[retainedReason]++;
    } else {
      const evidence = await gatherMergeEvidence(
        runGit,
        opts.projectRoot,
        slug,
        prefetched,
        candidate.branch,
      );
      if (evidence === null) {
      classification = 'unclassified';
      retainedReason = 'evidence-unavailable';
      retainedByReason[retainedReason]++;
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
        }
      }
      }
    }

    const autoCleanup = opts.autoCleanup ?? true;
    entries.push({
      slug,
      classification,
      annotation: classification === 'orphan' ? 'orphan' : classification === 'merged' && !autoCleanup ? 'merged-ready' : undefined,
    });
    // Operator-parked candidates retain their established auto-cleanup gate.
    // Enumerated worktrees are governed by the explicit reclaim gate instead.
    const reclamationDisabled = candidate.parked
      ? !autoCleanup
      : opts.reclaimMergedWorktrees === false;
    // An operator-parked candidate keeps its pre-change path: only a park
    // already classified merged reaches the helper, so an ordinary unmerged
    // park never adds a refusal to the tally (Story 8).
    const shouldReconcile = candidate.parked ? classification === 'merged' : candidate.branch !== undefined;
    if (!retainedReason && shouldReconcile && reclamationDisabled) {
      retainedReason = 'disabled';
      retainedByReason.disabled++;
    } else if (!retainedReason && shouldReconcile) {
      // The helper reports its refusal reason for direct/operator invocation.
      // A daemon sweep deliberately suppresses that per-slug chatter; the
      // aggregate below reports the outcome and the operator's next steps.
      const outcome = await reconcileMergedPark({
        ...opts,
        slug,
        // The porcelain listing is authoritative even when an operator also
        // parked this candidate: evidence and record policy key off this ref.
        branch: candidate.branch,
        log: undefined,
        capabilityLog: opts.log,
        teardownLog: opts.log,
        // Named explicitly (not merely carried by the spread) so the two
        // production hand-off seams stay visible at the only call site that
        // supplies them.
        requestRecordRepair: opts.requestRecordRepair,
        disposeHaltWatcher: opts.disposeHaltWatcher,
        teardownTimeoutSeconds: opts.teardownTimeoutSeconds,
        verbose: opts.verbose,
        worktreeLifecycle: opts.worktreeLifecycle,
        isFeatureInFlight: opts.isFeatureInFlight,
        emitProof: true,
      });
      if (outcome.refusal === undefined) {
        counts.reconciled++;
        try {
          opts.onEvent?.(candidate.branch === undefined
            ? { type: 'worktree_reclaim_reclaimed', slug }
            : {
                type: 'worktree_reclaim_reclaimed',
                slug,
                branch: candidate.branch,
                proof: outcome.proof!,
              });
        } catch {
          // Event persistence must not make this best-effort sweep fail.
        }
      }
      else if (outcome.refusal === 'record-missing') {
        counts.deferred++;
        retainedReason = outcome.refusal;
        retainedByReason[outcome.refusal]++;
      }
      else {
        counts.refused++;
        refusedByReason[outcome.refusal] = (refusedByReason[outcome.refusal] ?? 0) + 1;
      if (
        outcome.refusal === 'worktree-remove-failed'
        || outcome.refusal === 'branch-delete-failed'
        || outcome.refusal === 'dirty-worktree'
        || outcome.refusal === 'no-merge-proof'
      ) {
          try {
            opts.onEvent?.({ type: 'worktree_reclaim_failed', slug, branch: candidate.branch, refusal: outcome.refusal });
          } catch {
            // Event persistence must not make this best-effort sweep fail.
          }
        } else {
          retainedReason = outcome.refusal;
          retainedByReason[outcome.refusal]++;
        }
      }
    }
    // Every candidate gets a terminal retention event when it did not reach
    // the helper. A non-merged classification has no deletion proof.
    if (!retainedReason && !shouldReconcile) {
      retainedReason = 'no-merge-proof';
      retainedByReason[retainedReason]++;
    }
    if (retainedReason) {
      try {
        opts.onEvent?.({ type: 'worktree_reclaim_retained', slug, branch: candidate.branch, reason: retainedReason });
      } catch {
        // Event persistence must not make this best-effort sweep fail.
      }
    }
    if (classification === 'orphan') counts.orphaned++;
    else if (classification === 'unclassified') counts.skipped++;
    else counts.parked++;
    if (candidate.parked) opts.cache?.set(slug, classification);
  }

  const refusalSignature = Object.entries(refusedByReason)
    .sort(([leftReason], [rightReason]) => leftReason.localeCompare(rightReason))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(',');
  const retainedSignature = Object.entries(retainedByReason)
    .filter(([, count]) => count > 0)
    .sort(([leftReason], [rightReason]) => leftReason.localeCompare(rightReason))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(',');
  const signature = `${counts.reconciled}:${counts.deferred}:${counts.orphaned}:${counts.parked}:${counts.refused}:${counts.skipped}:${enumeratedCandidates}:${retainedSignature}:${refusalSignature}`;
  if (!opts.cache || sweepSummarySignatures.get(opts.cache) !== signature) {
    const refusalReasons = Object.entries(refusedByReason)
      .sort(([leftReason, leftCount], [rightReason, rightCount]) =>
        rightCount - leftCount || leftReason.localeCompare(rightReason));
    const refusalSummary = counts.refused > 0
      ? `; refusals: ${refusalReasons.map(([reason, count]) => `${reason}=${count}`).join(', ')}`
      : '';
    const retainedSummary = enumeratedCandidates > 0
      ? ` candidates=${candidates.size} retained=${Object.values(retainedByReason).reduce((sum, count) => sum + count, 0)}${retainedSignature ? `; retained: ${retainedSignature}` : ''}`
      : '';
    const remainingParked = Math.max(0, counts.parked - counts.reconciled);
    const nextSteps = [
      counts.deferred > 0 ? `${counts.deferred} deferred await${counts.deferred === 1 ? 's' : ''} shipped-record repair` : undefined,
      counts.orphaned > 0 ? `${counts.orphaned} orphaned ${counts.orphaned === 1 ? 'park needs' : 'parks need'} operator review` : undefined,
      counts.refused > 0
        ? `${counts.refused} refusal${counts.refused === 1 ? '' : 's'} requires resolving ${refusalReasons[0]?.[0]}`
        : undefined,
      remainingParked > 0 ? `${remainingParked} parked remain${remainingParked === 1 ? 's' : ''} parked` : undefined,
      counts.skipped > 0 ? `${counts.skipped} skipped retry when merge/issue evidence is available` : undefined,
    ].filter((step): step is string => step !== undefined);
    const guidance = nextSteps.length > 0 ? `; next: ${nextSteps.join('; ')}` : '; next: no action required';
    opts.log?.(`[parked-reconciliation] reconciled=${counts.reconciled} deferred=${counts.deferred} orphaned=${counts.orphaned} parked=${counts.parked} refused=${counts.refused} skipped=${counts.skipped}${retainedSummary}${refusalSummary}${guidance}`);
    if (opts.cache) sweepSummarySignatures.set(opts.cache, signature);
  }
  if (opts.cache) {
    // The cache backs parked-marker reporting. Enumerated worktrees have no
    // marker lifecycle, so retaining their old classification after removal
    // would make a later parked sweep report phantom state.
    const live = new Set(parkedSlugs);
    for (const slug of opts.cache.keys()) if (!live.has(slug)) opts.cache.delete(slug);
  }

  return { entries, counts, refusedByReason };
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

  // This helper is also called directly by the operator verb, so it must
  // re-derive liveness instead of relying on the sweep's earlier retention.
  // A live phase marker is the durable fallback when no daemon predicate is
  // available to that caller.
  if (opts.isFeatureInFlight?.(opts.slug)) {
    return { slug: opts.slug, steps: [], refusal: 'in-flight' };
  }
  try {
    await access(phaseMarkerPath(join(opts.projectRoot, '.worktrees', opts.slug)));
    return { slug: opts.slug, steps: [], refusal: 'in-flight' };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      return { slug: opts.slug, steps: [], refusal: 'in-flight' };
    }
  }

  const runGit = opts.runGit ?? makeProductionGit();

  // Re-derive the evidence here rather than trusting any caller's or sweep's
  // cached classification (ADR: the helper re-verifies immediately before any
  // destructive step).
  const evidence = await gatherMergeEvidence(runGit, opts.projectRoot, opts.slug, undefined, opts.branch);
  if (evidence === null) {
    return { slug: opts.slug, steps: [], refusal: 'ancestry-check-failed' };
  }
  if (opts.branch !== undefined && evidence.branches.length === 0) {
    return { slug: opts.slug, steps: [], refusal: 'branch-missing' };
  }
  // A listed branch may be squash- or rebase-merged: neither the record nor
  // ancestry need exist for it, but merged-PR head identity below can still
  // prove deletion safe. The parked path retains its historical classifier.
  if (!isMerged(evidence) && !(opts.branch !== undefined && evidence.branches.length > 0)) {
    return {
      slug: opts.slug,
      steps: [],
      refusal: evidence.branches.length === 0 ? 'branch-missing' : 'no-merge-proof',
    };
  }

  // Deletion gate, unchanged in strength by the record signal: EVERY local
  // branch carrying this slug must be proven to hold no commit that deleting it
  // would drop. A shipped record proves the work shipped, but it says nothing
  // about commits that landed on the branch afterwards — including work that
  // raced this very sweep.
  //
  // Two independent proofs, either of which is sufficient per branch:
  //   (a) ancestry — the branch is contained in origin/main (fast-forward or
  //       merge-commit merge);
  //   (b) head-oid identity — a MERGED PR for the branch reports the branch's
  //       current tip as the commit it merged (squash/rebase merge, where (a)
  //       is structurally always false).
  // Neither proof available ⇒ refuse, exactly as before.
  let proof: ReclaimProof = 'ancestry';
  // A shipped record corroborates ancestry. Without one, ancestry must be
  // corroborated by the merged PR's exact head too; otherwise a branch that
  // merely happens to be an ancestor can still carry an unreconciled checkout.
  const branchesRequiringPrProof = evidence.shippedRecordOnMain
    ? evidence.branches.filter((ref) => !evidence.mergedBranches.includes(ref))
    : evidence.branches;
  if (branchesRequiringPrProof.length > 0) {
    const runGh = opts.runGh ?? makeProductionGh();
    for (const ref of branchesRequiringPrProof) {
      const diagnosis = await proveByMergedPrHead(runGit, runGh, opts.projectRoot, ref, (error) => {
        (opts.capabilityLog ?? opts.log)?.(
          `[parked-reconciliation] ${opts.slug}: gh capability unavailable for ${error.field}`,
        );
      });
      switch (diagnosis.kind) {
        case 'proven':
          proof = 'merged-pr-head';
          continue;
        case 'no-pr':
          return { slug: opts.slug, steps: [], refusal: 'no-merge-proof' };
        case 'capability-unavailable':
          return { slug: opts.slug, steps: [], refusal: 'no-merge-proof' };
        case 'ahead': {
          const unmergedCommits = await listUnmergedCommits(
            runGit,
            opts.projectRoot,
            diagnosis.headRefOid,
            ref,
          );
          return unmergedCommits === null
            ? { slug: opts.slug, steps: [], refusal: 'ancestry-check-failed' }
            : { slug: opts.slug, steps: [], refusal: 'unmerged-commits', unmergedCommits };
        }
        case 'behind':
          return { slug: opts.slug, steps: [], refusal: 'branch-behind-merged-head' };
        case 'indeterminate':
          return {
            slug: opts.slug,
            steps: [],
            refusal: evidence.mergedBranches.includes(ref) ? 'no-merge-proof' : 'ancestry-check-failed',
          };
      }
    }
  }

  // Existing parked feature branches remain record-gated. The newly enumerated, non-daemon
  // branches are independently ancestry-proven and intentionally do not need
  // a shipped record; daemon setup branches stay record-gated by contract.
  if (requiresShippedRecord(opts.branch) && !evidence.shippedRecordOnMain) {
    let prUrl: string | undefined;
    for (const head of evidence.branches) {
      try {
        const stdout = await runTrackerAmbientRead(
          opts.runGh ?? makeProductionGh(), opts.projectRoot, 'ambient.pull-request.read',
          ['pr', 'list', '--state', 'merged', '--head', head, '--json', 'url', '--limit', '1'],
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

  // No local-resume check runs here, deliberately. A parked candidate reaching
  // this line has a shipped record on origin/main — the harness's durable
  // definition of "the work shipped" (CLAUDE.md rule 4). A listed non-daemon
  // branch instead reached this line through its independently proven merge.
  // The per-worktree
  // `detectAutoResume` verdict is derived from local `.pipeline/conduct-state.json`
  // and classifies as resumable any worktree missing `feature_status: complete`,
  // which is the normal state for every feature built before that field existed
  // and for any `finish` that pushed and then died. Such a worktree cannot have
  // an in-progress run worth protecting once its record is on the base branch,
  // so honouring the local verdict refused cleanup for exactly the shipped
  // features this reconciler exists to clean up.

  const steps: string[] = [];
  const worktreePath = join(opts.projectRoot, '.worktrees', opts.slug);

  let worktreeOnDisk = true;
  try {
    await access(worktreePath);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ENOENT') {
      return { slug: opts.slug, steps, refusal: 'worktree-remove-failed' };
    }
    worktreeOnDisk = false;
  }

  if (worktreeOnDisk) {
    try {
      const { stdout } = await runGit(['status', '--porcelain'], { cwd: worktreePath });
      if (stdout.length > 0) {
        return { slug: opts.slug, steps, refusal: 'dirty-worktree' };
      }
    } catch {
      return { slug: opts.slug, steps, refusal: 'dirty-worktree' };
    }
  }

  opts.disposeHaltWatcher?.(opts.slug);

  if (worktreeOnDisk) {
    const configResult = await loadConfig(opts.projectRoot);
    const timeoutSeconds = opts.teardownTimeoutSeconds ?? resolveTeardownTimeoutSeconds(
      configResult.ok ? configResult.config : undefined,
    );
    await runProjectTeardown(worktreePath, opts.teardownLog ?? opts.log, { timeoutSeconds, verbose: opts.verbose });
    try {
      if (opts.worktreeLifecycle) {
        await opts.worktreeLifecycle.run(() =>
          runGit(['worktree', 'remove', '--force', worktreePath], { cwd: opts.projectRoot }),
        );
      } else {
        await runGit(['worktree', 'remove', '--force', worktreePath], { cwd: opts.projectRoot });
      }
    } catch {
      // A removal failure on a path git actually owns is a real failure. A path
      // git never registered is a plain leftover directory, safe to delete once
      // every merge proof above has passed.
      if (await isRegisteredWorktree(runGit, opts.projectRoot, worktreePath)) {
        return { slug: opts.slug, steps, refusal: 'worktree-remove-failed' };
      }
      try {
        await rm(worktreePath, { recursive: true, force: true });
      } catch {
        return { slug: opts.slug, steps, refusal: 'worktree-remove-failed' };
      }
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
        // Force delete. THIS function is the authority that deleting these refs
        // drops no commit, and one of its two proofs — merged-PR head identity —
        // is precisely the squash-merge case where git's own `-d` merge check is
        // permanently false. `-d` would refuse every squash-merged branch here.
        await runGit(['branch', '-D', ref], { cwd: opts.projectRoot });
      } catch {
        return { slug: opts.slug, steps, refusal: 'branch-delete-failed' };
      }
    }
    steps.push('branch-deleted');
  }

  if (await isOperatorParked(opts.projectRoot, opts.slug)) {
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
  }

  return opts.emitProof && opts.branch !== undefined
    ? { slug: opts.slug, steps, proof }
    : { slug: opts.slug, steps };
}
