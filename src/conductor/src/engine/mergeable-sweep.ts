/**
 * Per-repo watch registry and mergeable label sweep.
 *
 * Watch registry — `.daemon/mergeable-watch.jsonl`, one JSON object per line
 * `{prUrl, slug, repoCwd}`. Three helpers:
 *   - enrollWatch    — append an entry; best-effort.
 *   - readWatch      — parse entries; tolerate missing file / malformed lines.
 *   - rewriteWatch   — overwrite the file; swallow write failures (C3).
 *
 * sweepMergeableLabels — for each tracked PR:
 *   1. MERGED / CLOSED → enter the shipped-record gate path; NOTFOUND → prune (FR-13).
 *   2. UNKNOWN state (read error) → log + skip (FR-15).
 *   3. labels includes `needs-remediation` → ensure `mergeable` absent (FR-12).
 *   4. isMergeable → add `mergeable` if not already present (FR-10, C2).
 *   5. otherwise → remove `mergeable` if currently present (FR-11, C2).
 *
 * All operations are best-effort / non-throwing (C3, FR-15).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GhRunner,
  makeProductionGh,
  makeProductionGit,
  addLabel,
  removeLabel,
  isMergeable,
  upsertComment,
  type PrMergeState,
  type PrRunner,
} from './pr-labels.js';
import { createGithubTrackerClient, type TrackerClient } from './tracker-client.js';
import type { ConductorEvent } from '../types/events.js';
import type { GithubOperationRunner } from './github-operations.js';
import type { FeatureWorktree } from './daemon-runner.js';
import { shippedRecordOnMain } from './shipped-record-on-main.js';
import { leafBranchFor } from './feature-branch-identity.js';
import { makeGitRunner } from './rebase.js';
import { deleteFeatureConductorRefs } from './restack/restack-refs-cleanup.js';
import {
  classifyShippedReadiness,
  routeShippedReadiness,
  type ShippedReadinessVerdict,
} from './shipped-readiness.js';
import {
  type RepairQueue,
  type RepairCompletion,
  type RepairRequest,
  type WatchEntry,
  type AutoresolveOutcome,
  type CiFixRepairOutcome,
} from './repair-queue.js';
import type { CiFixOutcome } from './ci-fix.js';
export type { WatchEntry } from './repair-queue.js';

// ── Task 21: exhaustion escalation ──────────────────────────────────────────

/** Stable hidden marker identifying the CI-exhaustion escalation comment. */
const CI_EXHAUSTION_MARKER = '<!-- conductor:ci-exhaustion -->';

/** Attempt cap mirrored from `ci-fix.ts#evaluateEligibilityGates` (Gate 1). */
const CI_FIX_ATTEMPT_CAP = 2;

/**
 * Build the escalation comment body: failing check names + attempt history.
 */
function buildExhaustionComment(entry: WatchEntry, state: PrMergeState): string {
  const checkNames =
    state.statusCheckRollup?.map((c) => c.name ?? '?').filter(Boolean) ?? [];
  const attempts = entry.ciFixAttempts ?? 0;
  return [
    '## CI fix exhausted',
    '',
    `Automated CI-fix attempts exhausted after ${attempts} attempt(s).`,
    '',
    'Failing checks:',
    ...(checkNames.length > 0 ? checkNames.map((n) => `- ${n}`) : ['- (none reported)']),
    '',
    'Manual remediation is required.',
  ].join('\n');
}

// ── Watch entry ───────────────────────────────────────────────────────────────


/**
 * Retire a conflict-resolution remediation label only after GitHub reports a
 * safe, readable mergeable state. The returned entry is the single source of
 * truth for the next sweep tick, including bounded retry bookkeeping.
 */
export async function maybeClearConflictLabel(
  entry: WatchEntry,
  state: PrMergeState,
  gh: PrRunner,
  log?: (message: string) => void,
): Promise<WatchEntry> {
  if (entry.escalationCause !== 'conflict-resolution') return entry;
  const clear = (): WatchEntry => {
    const { escalationCause: _cause, labelClearAttempts: _attempts, ...cleared } = entry;
    return cleared;
  };
  if (!state.labels.includes('needs-remediation')) return clear();
  if (state.mergeable !== 'MERGEABLE' || state.hasHaltBodyMarker || state.readFailure) return entry;
  if ((entry.labelClearAttempts ?? 0) >= 3) {
    log?.(`[mergeable-sweep] label clear retry cap reached for ${entry.prUrl}`);
    return clear();
  }
  const result = await removeLabel(gh, entry.repoCwd, entry.prUrl, 'needs-remediation', log);
  if (result.kind === 'executed') return clear();
  return { ...entry, labelClearAttempts: (entry.labelClearAttempts ?? 0) + 1 };
}

/**
 * Retire only the remediation label the shipped-readiness path applied. A
 * human, CI-exhaustion, or conflict-resolution label has no equivalent
 * provenance and must remain sticky. Read uncertainty and transient readiness
 * states deliberately preserve the label to avoid flapping.
 */
export async function maybeClearReadinessLabel(
  entry: WatchEntry,
  state: PrMergeState,
  verdict: ShippedReadinessVerdict,
  gh: PrRunner,
  log?: (message: string) => void,
): Promise<WatchEntry> {
  if (entry.escalationCause !== 'shipped-readiness') return entry;
  const clear = (): WatchEntry => {
    const { escalationCause: _cause, labelClearAttempts: _attempts, ...cleared } = entry;
    return cleared;
  };
  if (!state.labels.includes('needs-remediation')) return clear();
  if (
    state.hasHaltBodyMarker ||
    state.readFailure ||
    verdict === 'no-checks' ||
    verdict === 'draft' ||
    verdict === 'ci-pending' ||
    verdict === 'indeterminate'
  ) return entry;
  if ((entry.labelClearAttempts ?? 0) >= 3) {
    log?.(`[mergeable-sweep] readiness label clear retry cap reached for ${entry.prUrl}`);
    return clear();
  }
  await removeLabel(gh, entry.repoCwd, entry.prUrl, 'needs-remediation', log);
  return { ...entry, labelClearAttempts: (entry.labelClearAttempts ?? 0) + 1 };
}

const WATCH_FILE = '.daemon/mergeable-watch.jsonl';

/**
 * In-process, per-project serialization for watch-registry read-modify-write
 * updates. Each waiter keeps the tail promise alive until its own mutation has
 * either persisted or failed, so a throwing mutation cannot strand the queue.
 */
const watchUpdateLocks = new Map<string, Promise<void>>();

/**
 * Hard cap on the number of entries retained in the watch registry. The
 * JSONL file is append-ordered oldest-first, so when the sweep exceeds this
 * cap it trims from the front, keeping only the most recently enrolled
 * entries — preventing unbounded growth (Task 1).
 */
const MAX_WATCH_ENTRIES = 100;

/** Retain/unknown outcome state scoped to the lifetime of one daemon logger. */
const dispositionCaches = new WeakMap<
  (msg: string) => void,
  Map<string, string>
>();

function recordDisposition(
  log: ((msg: string) => void) | undefined,
  entry: WatchEntry,
  disposition: string,
): boolean {
  if (!log) return false;
  let cache = dispositionCaches.get(log);
  if (!cache) {
    cache = new Map<string, string>();
    dispositionCaches.set(log, cache);
  }
  const entryIdentity = `${entry.repoCwd}\0${entry.prUrl}\0${entry.slug}`;
  if (cache.get(entryIdentity) === disposition) return false;
  cache.set(entryIdentity, disposition);
  return true;
}

function logDisposition(
  log: ((msg: string) => void) | undefined,
  entry: WatchEntry,
  disposition: string,
  message: string,
): void {
  if (recordDisposition(log, entry, disposition)) log?.(message);
}

// ── Registry helpers ──────────────────────────────────────────────────────────

/**
 * Append an entry to the watch registry (mkdir -p .daemon first).
 * Best-effort: swallows all errors.
 */
export async function enrollWatch(projectRoot: string, entry: WatchEntry): Promise<void> {
  try {
    await mkdir(join(projectRoot, '.daemon'), { recursive: true });
    await writeFile(join(projectRoot, WATCH_FILE), JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch {
    // best-effort
  }
}

/**
 * Read all valid entries from the watch registry.
 * Tolerates a missing file (returns []) and skips malformed lines.
 * Normalizes legacy entries: resolveAttempts defaults to 0 if missing.
 */
export async function readWatch(projectRoot: string): Promise<WatchEntry[]> {
  try {
    const content = await readFile(join(projectRoot, WATCH_FILE), 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const obj: unknown = JSON.parse(line);
          if (
            obj !== null &&
            typeof obj === 'object' &&
            'prUrl' in obj &&
            'slug' in obj &&
            'repoCwd' in obj &&
            typeof (obj as Record<string, unknown>).prUrl === 'string' &&
            typeof (obj as Record<string, unknown>).slug === 'string' &&
            typeof (obj as Record<string, unknown>).repoCwd === 'string'
          ) {
            const raw = obj as Record<string, unknown>;
            const entry: WatchEntry = {
              prUrl: raw.prUrl as string,
              slug: raw.slug as string,
              repoCwd: raw.repoCwd as string,
              // Zero-default normalization for legacy entries
              resolveAttempts: typeof raw.resolveAttempts === 'number' ? raw.resolveAttempts : 0,
              // lastResolveAt is optional; only include if present
              ...(typeof raw.lastResolveAt === 'string' && { lastResolveAt: raw.lastResolveAt }),
              // Zero-default normalization for ciFix fields
              ciFixAttempts: typeof raw.ciFixAttempts === 'number' ? raw.ciFixAttempts : 0,
              // lastCiFixAt is optional; only include if present
              ...(typeof raw.lastCiFixAt === 'string' && { lastCiFixAt: raw.lastCiFixAt }),
              ...(typeof raw.ciFailureDetected === 'boolean' && {
                ciFailureDetected: raw.ciFailureDetected,
              }),
              ...(typeof raw.headSha === 'string' && { headSha: raw.headSha }),
              ...(typeof raw.headFirstSeenAt === 'string' && {
                headFirstSeenAt: raw.headFirstSeenAt,
              }),
              ...(raw.readinessEmitted !== null &&
                typeof raw.readinessEmitted === 'object' &&
                typeof (raw.readinessEmitted as Record<string, unknown>).verdict === 'string' &&
                typeof (raw.readinessEmitted as Record<string, unknown>).headSha === 'string' && {
                  readinessEmitted: {
                    verdict: (raw.readinessEmitted as Record<string, unknown>).verdict as ShippedReadinessVerdict,
                    headSha: (raw.readinessEmitted as Record<string, unknown>).headSha as string,
                  },
                }),
              ...((raw.escalationCause === 'conflict-resolution' ||
                raw.escalationCause === 'shipped-readiness') && {
                escalationCause: raw.escalationCause,
              }),
              ...(typeof raw.labelClearAttempts === 'number' && { labelClearAttempts: raw.labelClearAttempts }),
            };
            return [entry];
          }
          return [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * Overwrite the watch registry with the given entries.
 * Swallows write failures (C3).
 */
export async function rewriteWatch(projectRoot: string, entries: WatchEntry[]): Promise<void> {
  try {
    await mkdir(join(projectRoot, '.daemon'), { recursive: true });
    const content =
      entries.length > 0 ? entries.map((e) => JSON.stringify(e)).join('\n') + '\n' : '';
    await writeFile(join(projectRoot, WATCH_FILE), content);
  } catch {
    // swallow (C3)
  }
}

/**
 * Apply a watch-registry mutation as one serialized read-modify-write update.
 * Mutator failures deliberately propagate before `rewriteWatch`, preserving
 * the existing bytes while still releasing the per-project mutex.
 */
export type WatchUpdate<T> = {
  entries: WatchEntry[];
  result: T;
  /** A read-only outcome must not normalize or rewrite the registry. */
  write?: boolean;
};

export async function updateWatch<T = undefined>(
  projectRoot: string,
  mutate: (entries: WatchEntry[]) =>
    | WatchEntry[]
    | WatchUpdate<T>
    | Promise<WatchEntry[] | WatchUpdate<T>>,
): Promise<T | undefined> {
  const previous = watchUpdateLocks.get(projectRoot) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => done);
  watchUpdateLocks.set(projectRoot, tail);

  await previous;
  try {
    const mutation = await mutate(await readWatch(projectRoot));
    if (Array.isArray(mutation)) {
      await rewriteWatch(projectRoot, mutation);
      return undefined;
    }
    if (mutation.write !== false) await rewriteWatch(projectRoot, mutation.entries);
    return mutation.result;
  } finally {
    release();
    if (watchUpdateLocks.get(projectRoot) === tail) watchUpdateLocks.delete(projectRoot);
  }
}

/** Apply only the fields the sweep changed, preserving concurrent updates. */
function mergeSweepEntry(
  before: WatchEntry,
  after: WatchEntry,
  fresh: WatchEntry,
): WatchEntry {
  const merged: Record<string, unknown> = { ...fresh };
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (Object.is(before[key as keyof WatchEntry], after[key as keyof WatchEntry])) continue;
    if (key in after) merged[key] = after[key as keyof WatchEntry];
    else delete merged[key];
  }
  return {
    ...merged,
    prUrl: fresh.prUrl,
    slug: fresh.slug,
    repoCwd: fresh.repoCwd,
  };
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Task 17: sweep-driven autoresolve dispatch, injected so the sweep can pick
 * the first eligible CONFLICTING PR after the label pass and hand it off to
 * the resolution pipeline — without the sweep needing to know how that
 * pipeline works (worktree prep, rebase, guards, etc. live elsewhere).
 *
 * `enabled` is read by the caller from `mergeable_autoresolve.enabled` so the
 * sweep stays byte-identical to today when the feature is off (AC4).
 */
/** The dispatcher result retained by a queued repair until its claim completes. */
export interface AutoresolveDispatchOpts {
  /** Config gate — when false, the sweep runs exactly as before (no new work). */
  enabled: boolean;
  /**
   * Eligibility check for a single entry (cooldown, attempt cap, sticky
   * labels, etc. — see `autoresolve.ts#isEligibleForResolve`). Injected so
   * this module never imports the resolution pipeline directly.
   */
  isEligible: (
    entry: WatchEntry,
    state: PrMergeState,
  ) => Promise<{ eligible: boolean; reason?: string }>;
  /**
   * Dispatch resolution for the chosen entry. The request-owned adapter calls
   * this only after the daemon claims and stamps the entry (AC3).
   * Returns the outcome consumed by the pooled outcome handler.
   */
  dispatch: (entry: WatchEntry) => Promise<AutoresolveOutcome | void>;
  /** Clock override for tests; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * Task 10: sweep-driven CI fix dispatch, injected so the sweep can pick
 * the first eligible failed PR after the label pass and hand it off to
 * the CI fix pipeline — without the sweep needing to know how that
 * pipeline works (worktree prep, fix session, guards, etc. live elsewhere).
 *
 * `enabled` is read by the caller from `ci_watch.enabled` so the
 * sweep stays byte-identical to today when the feature is off (AC4).
 */
export interface CiFixDispatchOpts {
  /** Config gate — when false, the sweep runs exactly as before (no new work). */
  enabled: boolean;
  /**
   * Eligibility check for a single entry (cooldown, attempt cap, sticky
   * labels, etc. — see `ci-fix.ts#isEligibleForCiFix`). Injected so
   * this module never imports the CI fix pipeline directly.
   */
  isEligible: (
    entry: WatchEntry,
    state: PrMergeState,
  ) => Promise<{ eligible: boolean; reason?: string }>;
  /**
   * Dispatch CI fix for the chosen entry. The request-owned adapter calls
   * this only after the daemon claims and stamps the entry (AC3).
   * Returns the outcome consumed by the pooled outcome handler.
   */
  dispatch: (
    entry: WatchEntry,
    state: PrMergeState,
  ) => Promise<CiFixOutcome | { kind: 'green-verified' | 'needs-human' } | void>;
  /** Best-effort observation for selected-state failures before dispatch. */
  diagnostic?: (entry: WatchEntry, state: PrMergeState) => void | Promise<void>;
  /** Clock override for tests; defaults to `new Date()`. */
  now?: () => Date;
}

export interface SweepOpts {
  projectRoot: string;
  log?: (msg: string) => void;
  /** Clock override for persisted watch observations; defaults to `new Date()`. */
  now?: () => Date;
  runGh?: GhRunner;
  /** Typed PR-state reader; raw gh remains scoped to legacy label mutations. */
  tracker?: Pick<TrackerClient, 'readPullRequestMergeState'>;
  /** Reads use `runGh`; writes require this fresh, feature-scoped runner. */
  operations?: GithubOperationRunner | ((entry: WatchEntry) => GithubOperationRunner | undefined);
  /** Task 17: optional autoresolve dispatch, run once per tick after the label pass. */
  autoresolve?: AutoresolveDispatchOpts;
  /** Task 10: optional CI fix dispatch, run once per tick after the label pass. */
  ciFix?: CiFixDispatchOpts;
  /** Dispatcher-owned repair handoff. Sweeps enqueue but never execute repairs. */
  repairs?: {
    queue: RepairQueue;
  };
  /** True while a pooled repair has already claimed this PR. */
  isRepairRunning?: (prUrl: string) => boolean;
  /**
   * Optional worktree teardown seam for the shipped-record gate.
   * MERGED and CLOSED may use this dependency; NOTFOUND never does.
   */
  teardownWorktree?: (worktree: FeatureWorktree, keep: boolean) => Promise<void>;
  /** Probe whether the feature's shipped record is present on origin/main. */
  shippedRecordProbe?: (
    repoCwd: string,
    slug: string,
  ) => Promise<'present' | 'absent' | 'indeterminate'>;
  /**
   * Refuses shipped-record reaping while the daemon still owns the slug.
   * Omitted preserves the standalone sweep's existing behavior.
   */
  canRemoveWorktree?: (slug: string) => boolean | Promise<boolean>;
  /** Task 8: optional event callback for sweep events (e.g. ci_failed on transition). */
  onEvent?: (event: ConductorEvent) => void;
}

function runnerForEntry(
  gh: GhRunner,
  entry: WatchEntry,
  operations: SweepOpts['operations'],
): GhRunner | (GhRunner & GithubOperationRunner) {
  const operationRunner = typeof operations === 'function' ? operations(entry) : operations;
  if (!operationRunner) return gh;
  // Bind a fresh read wrapper for this entry so its target-bound mutation
  // runner cannot be reused by a later entry in the same sweep.
  return Object.assign(gh.bind(undefined), operationRunner);
}

type PooledRepairOutcomeOptions = {
  projectRoot: string;
  previous: WatchEntry;
  runGh?: GhRunner;
  operations?: SweepOpts['operations'];
  log?: (message: string) => void;
} & RepairCompletion;

function isAutoresolveOutcome(
  options: PooledRepairOutcomeOptions,
): options is PooledRepairOutcomeOptions & {
  request: Extract<RepairCompletion, { request: { kind: 'autoresolve' } }>['request'];
  outcome: AutoresolveOutcome;
} {
  return options.request.kind === 'autoresolve';
}

/**
 * Apply the registry and PR-facing consequences of a completed pooled repair.
 *
 * The pool claims and stamps an entry before calling its adapter; this handler
 * is the one counterpart to the former inline dispatch branches.  Keeping the
 * result union here prevents a newly-added adapter outcome from silently
 * skipping its bookkeeping on the queued path.
 */
export async function applyPooledRepairOutcome(options: PooledRepairOutcomeOptions): Promise<void> {
  if (isAutoresolveOutcome(options)) return applyAutoresolveRepairOutcome(options);
  return applyCiFixRepairOutcome(options);
}

/** Rewrite just the completed repair's current watch entry. */
async function rewritePooledRepairWatchEntry(
  projectRoot: string,
  prUrl: string,
  mutate: (entry: WatchEntry) => WatchEntry,
  log?: (message: string) => void,
): Promise<boolean> {
  const outcome = await updateWatch(projectRoot, (entries): WatchUpdate<boolean> => {
    if (!entries.some((entry) => entry.prUrl === prUrl)) {
      return { entries, result: false, write: false };
    }
    return {
      entries: entries.map((entry) => entry.prUrl === prUrl ? mutate(entry) : entry),
      result: true,
    };
  });
  if (!outcome) log?.(`[mergeable-sweep] dropping repair outcome for ${prUrl}: watch entry missing`);
  return outcome ?? false;
}

/** Mark a repair paused before provider work and leave a durable recovery comment. */
async function markPooledSetupRecovery({
  entryRunner,
  previous,
  marker,
  body,
  description,
  log,
}: {
  entryRunner: GhRunner | (GhRunner & GithubOperationRunner);
  previous: WatchEntry;
  marker: string;
  body: string;
  description: string;
  log?: (message: string) => void;
}): Promise<void> {
  try {
    await addLabel(entryRunner, previous.repoCwd, previous.prUrl, 'needs-remediation', log);
    await upsertComment(entryRunner, previous.repoCwd, previous.prUrl, marker, body, log);
  } catch (err) {
    log?.(`[mergeable-sweep] ${description} setup-recovery marker error for ${previous.prUrl}: ${err}`);
  }
}

async function applyAutoresolveRepairOutcome(options: Extract<PooledRepairOutcomeOptions, {
  request: { kind: 'autoresolve' };
}>): Promise<void> {
  const { projectRoot, request, previous, outcome, runGh = makeProductionGh(), operations, log } = options;
  const entryRunner = runnerForEntry(runGh, previous, operations);

  switch (outcome.kind) {
    case 'refreshed':
      await rewritePooledRepairWatchEntry(projectRoot, request.prUrl, (entry) => ({ ...entry, resolveAttempts: 0 }), log);
      return;
    case 'escalated':
      await rewritePooledRepairWatchEntry(projectRoot, request.prUrl, (entry) => ({ ...entry, escalationCause: 'conflict-resolution' }), log);
      return;
    case 'published-stack':
      await rewritePooledRepairWatchEntry(projectRoot, request.prUrl, (entry) => ({ ...entry, resolveAttempts: previous.resolveAttempts ?? 0 }), log);
      return;
    case 'setup-stop':
      if (!await rewritePooledRepairWatchEntry(projectRoot, request.prUrl, (entry) => ({ ...entry, resolveAttempts: previous.resolveAttempts ?? 0 }), log)) return;
      await markPooledSetupRecovery({ entryRunner, previous,
        marker: '<!-- conductor:rebase-setup -->',
        body: '## Rebase resolution paused\n\nProvider setup was unavailable before a resolver was invoked. Complete the provider recovery action, remove `needs-remediation`, then retry.',
        description: 'rebase', log,
      });
      return;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

async function applyCiFixRepairOutcome(options: Extract<PooledRepairOutcomeOptions, {
  request: { kind: 'ci-fix' };
}>): Promise<void> {
  const { projectRoot, request, previous, outcome, runGh = makeProductionGh(), operations, log } = options;
  const entryRunner = runnerForEntry(runGh, previous, operations);
  switch (outcome.kind) {
    case 'needs-human':
      if (!await rewritePooledRepairWatchEntry(projectRoot, request.prUrl, (entry) => ({
        ...entry,
        ciFixAttempts: previous.ciFixAttempts,
        ...(previous.lastCiFixAt === undefined ? { lastCiFixAt: undefined } : { lastCiFixAt: previous.lastCiFixAt }),
      }), log)) return;
      await markPooledSetupRecovery({ entryRunner, previous,
        marker: '<!-- conductor:ci-fix-setup -->',
        body: '## CI repair paused\n\nProvider setup was unavailable before a repair provider was invoked. Complete the provider recovery action, remove `needs-remediation`, then retry.',
        description: 'ciFix', log,
      });
      return;
    case 'not-started':
    case 'branch-gone':
      await rewritePooledRepairWatchEntry(projectRoot, request.prUrl, (entry) => ({
        ...entry,
        ciFixAttempts: previous.ciFixAttempts,
        ...(previous.lastCiFixAt === undefined ? { lastCiFixAt: undefined } : { lastCiFixAt: previous.lastCiFixAt }),
      }), log);
      return;
    case 'noop':
    case 'failed':
    case 'published':
      return;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/**
 * For each tracked PR: evaluate merge state then update the `mergeable` label
 * according to the decision tree; prune closed/merged PRs. Never throws (FR-15).
 */
export async function sweepMergeableLabels({
  projectRoot,
  log,
  runGh,
  tracker,
  operations,
  autoresolve,
  ciFix,
  repairs,
  isRepairRunning,
  teardownWorktree,
  shippedRecordProbe,
  canRemoveWorktree,
  onEvent,
  now = () => new Date(),
}: SweepOpts): Promise<void> {
  const gh = runGh ?? makeProductionGh();
  const prStateTracker = tracker ?? createGithubTrackerClient(gh);
  const git = makeProductionGit();
  const probe =
    shippedRecordProbe ??
    ((repoCwd: string, slug: string) =>
      shippedRecordOnMain(repoCwd, slug, async (args, opts) => ({
        ...(await git(args, opts)),
        stderr: '',
      })));
  const emitEvent = (event: ConductorEvent): void => {
    try {
      onEvent?.(event);
    } catch (error) {
      log?.(`[mergeable-sweep] event listener error: ${error}`);
    }
  };
  try {
    const entries = await readWatch(projectRoot);
    const survivors: WatchEntry[] = [];
    // Repair candidates are gathered from the one merge-state read per entry;
    // the sweep neither re-reads state nor awaits a repair session.
    const conflictingCandidates: Array<{ entry: WatchEntry; state: PrMergeState }> = [];
    const failedCandidates: Array<{ entry: WatchEntry; state: PrMergeState }> = [];

    for (let entry of entries) {
      try {
        const entryGh = runnerForEntry(gh, entry, operations);
        let state = await prStateTracker.readPullRequestMergeState(entry.prUrl, entry.repoCwd, log);

        // GitHub can initially return UNKNOWN while it calculates mergeability
        // for an otherwise readable OPEN PR. Give that lazy result exactly one
        // more read. Handle a terminal state from that re-read through the
        // normal lifecycle path below rather than classifying it as OPEN.
        let mergeabilityReread: 'not-needed' | 'completed' | 'failed' = 'not-needed';
        if (state.state === 'OPEN' && state.mergeable === 'UNKNOWN') {
          try {
            const reread = await prStateTracker.readPullRequestMergeState(entry.prUrl, entry.repoCwd, log);
            if (reread.state === 'UNKNOWN' || reread.readFailure) {
              mergeabilityReread = 'failed';
            } else {
              state = reread;
              mergeabilityReread = 'completed';
            }
          } catch (error) {
            mergeabilityReread = 'failed';
            state = {
              ...state,
              readFailure: { kind: 'runner', error },
            };
          }
        }

        // Preserve lifecycle reconciliation: closed, merged, and not-found
        // states retain their existing stale CI-label cleanup before taking
        // their dedicated lifecycle path. Open states wait for readiness
        // classification so indeterminate observations stay read-only.
        if (state.state !== 'OPEN' && state.labels.includes('ci-failed')) {
          await removeLabel(entryGh, entry.repoCwd, entry.prUrl, 'ci-failed', log);
        }

        // MERGED and CLOSED may both represent a completed merge: only a
        // shipped record proven present authorizes feature-worktree teardown.
        if (state.state === 'MERGED' || state.state === 'CLOSED') {
          log?.(
            `[mergeable-sweep] ${state.state.toLowerCase()} ${entry.prUrl} entering shipped-record gate`,
          );
          const shippedRecord = await probe(entry.repoCwd, entry.slug);
          if (shippedRecord === 'present') {
            if (canRemoveWorktree && !(await canRemoveWorktree(entry.slug))) {
              survivors.push(entry);
              continue;
            }
            try {
              if (!teardownWorktree) {
                throw new Error('worktree teardown dependency unavailable');
              }
              await teardownWorktree(
                {
                  path: join(entry.repoCwd, '.worktrees', entry.slug),
                  branch: leafBranchFor(entry.slug),
                },
                false,
              );
              // Teardown has established all of its own shipped-record and
              // worktree safety gates. Ref cleanup is best-effort and must not
              // turn a successful reap into a retained watch entry.
              await deleteFeatureConductorRefs(entry.slug, makeGitRunner(entry.repoCwd));
              log?.(
                `[mergeable-sweep] reaped ${entry.slug} — reason: shipped-record-on-main`,
              );
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              log?.(
                `[mergeable-sweep] reap failed ${entry.slug} (${entry.prUrl}) — reason: shipped-record-on-main — error: ${detail}`,
              );
            }
          } else if (state.state === 'MERGED') {
            logDisposition(
              log,
              entry,
              `retained:record-not-yet-on-main:${shippedRecord}`,
              `[mergeable-sweep] retained ${entry.slug} — reason: record-not-yet-on-main${
                shippedRecord === 'indeterminate' ? ' (record probe indeterminate)' : ''
              }`,
            );
            survivors.push(entry);
          } else {
            logDisposition(
              log,
              entry,
              `retained:pr-closed-unmerged:${shippedRecord}`,
              `[mergeable-sweep] retained ${entry.slug} (reclaimable) — reason: pr-closed-unmerged${
                shippedRecord === 'indeterminate' ? ' (record probe indeterminate)' : ''
              }`,
            );
          }
          continue;
        }

        // FR-13: NOTFOUND → prune the registry entry while retaining the
        // worktree. It means the PR is genuinely gone (404 / deleted);
        // pruning prevents unbounded registry growth.
        if (state.state === 'NOTFOUND') {
          recordDisposition(log, entry, 'notfound');
          log?.(`[mergeable-sweep] pruning ${entry.prUrl} (state: ${state.state})`);
          continue; // not added to survivors
        }

        // FR-15: UNKNOWN state (transient read/fetch error) → log + skip this
        // iteration; keep the entry so it is retried on the next sweep cycle.
        if (state.state === 'UNKNOWN') {
          if ((state.readFailure || state.contextFailure) && ciFix?.enabled) {
            try { await ciFix.diagnostic?.(entry, state); } catch { /* observational */ }
          }
          log?.(`[mergeable-sweep] skipping ${entry.prUrl} (could not read state)`);
          logDisposition(
            log,
            entry,
            'unknown:pr-state-unknown',
            `[mergeable-sweep] disposition unknown ${entry.slug} — reason: pr-state-unknown`,
          );
          survivors.push(entry);
          continue;
        }

        // The timestamp begins with the first observation of a head and is
        // reset only when that SHA changes. Do this before classification so
        // the first tick for a new head receives a full grace period.
        if (state.headRefOid && state.headRefOid !== entry.headSha) {
          entry = {
            ...entry,
            headSha: state.headRefOid,
            headFirstSeenAt: now().toISOString(),
          };
        }

        // Missing head data leaves legacy bookkeeping intact until GitHub
        // supplies an OID.
        const headFirstSeenAt = entry.headFirstSeenAt
          ? Date.parse(entry.headFirstSeenAt)
          : undefined;
        const readiness = classifyShippedReadiness(
          state,
          {
            mergeabilityReread,
            ...(Number.isFinite(headFirstSeenAt) ? { headFirstSeenAt } : {}),
          },
          now().getTime(),
        );

        if (
          entry.headSha !== undefined &&
          (entry.readinessEmitted?.verdict !== readiness ||
            entry.readinessEmitted.headSha !== entry.headSha)
        ) {
          const headSha = entry.headSha;
          entry = {
            ...entry,
            readinessEmitted: { verdict: readiness, headSha },
          };
          emitEvent({
            type: 'shipped_pr_readiness',
            prUrl: entry.prUrl,
            slug: entry.slug,
            verdict: readiness,
            headSha,
            mergeable: state.mergeable,
            ...(state.mergeStateStatus === undefined ? {} : { mergeStateStatus: state.mergeStateStatus }),
            checksOutcome: state.checksOutcome,
            isDraft: state.isDraft === true,
            ...(state.baseRefName === undefined ? {} : { baseRefName: state.baseRefName }),
          });
        }

        // Entry is live — keep it in the registry.
        recordDisposition(log, entry, `live:${state.state}`);
        survivors.push(entry);

        let conflicting = false;
        let ciFailing = false;
        let needsReadinessRemediation = false;
        const indeterminate = routeShippedReadiness(readiness, {
          ready: () => false,
          conflicting: () => {
            conflicting = true;
            return false;
          },
          'ci-failing': () => {
            ciFailing = true;
            return false;
          },
          'ci-pending': () => false,
          'no-checks': () => {
            needsReadinessRemediation = true;
            return false;
          },
          draft: () => {
            needsReadinessRemediation = true;
            return false;
          },
          indeterminate: () => true,
        });

        // An indeterminate GitHub observation is deliberately read-only. It
        // remains watched for the next tick, but neither a stale label nor a
        // repair/escalation action can turn uncertainty into a side effect.
        if (indeterminate) continue;

        // Retire only labels whose recorded cause says they are stale. This is
        // deliberately before normal reconciliation and candidate collection.
        const readinessClearAttempts = entry.labelClearAttempts ?? 0;
        const clearingReadinessLabel =
          entry.escalationCause === 'shipped-readiness' && state.labels.includes('needs-remediation');
        entry = await maybeClearReadinessLabel(entry, state, readiness, entryGh, log);
        const readinessEntryIdx = survivors.findIndex((survivor) => survivor.prUrl === entry.prUrl);
        if (readinessEntryIdx >= 0) survivors[readinessEntryIdx] = entry;
        const readinessLabelRemoved =
          clearingReadinessLabel && entry.labelClearAttempts === readinessClearAttempts + 1;

        // GitHub checks are authoritative for CI state. Retire the redundant
        // custom label whenever a readable reconciliation observation finds it.
        if (state.labels.includes('ci-failed')) {
          await removeLabel(entryGh, entry.repoCwd, entry.prUrl, 'ci-failed', log);
        }

        // Shipped readiness owns only its own attribution. CI and human
        // remediation labels stay sticky during readiness recovery.

        // Task 17 (AC1): preserve the historical conflict candidate behavior,
        // but collect after remediation recovery so later dispatch sees the
        // entry's current bookkeeping.
        if (conflicting) {
          if (state.isDraft) {
            log?.(`[mergeable-sweep] skipping resolve for ${entry.prUrl} (draft PR)`);
          } else {
            conflictingCandidates.push({ entry, state });
          }
        }

        // A conflict-resolution label becomes stale once GitHub reports the PR
        // mergeable again. Legacy/unattributed labels remain sticky.
        const idx = survivors.findIndex((s) => s.prUrl === entry.prUrl);
        if (idx >= 0) {
          entry = await maybeClearConflictLabel(entry, state, entryGh, log);
          survivors[idx] = entry;
        }

        // FR-12: if the PR carries `needs-remediation`, ensure `mergeable` is absent.
        let hasRemediation = state.labels.includes('needs-remediation') && !readinessLabelRemoved;

        // A stale shipped PR with no checks, or a draft PR, needs human
        // attention. Attribute only a confirmed absent→present label write:
        // failed/refused writes deliberately retain no cause so the next tick
        // retries the same bounded, label-only action.
        if (needsReadinessRemediation && !hasRemediation) {
          const labelResult = await addLabel(
            entryGh,
            entry.repoCwd,
            entry.prUrl,
            'needs-remediation',
            log,
          );
          if (labelResult.kind === 'executed') {
            entry = { ...entry, escalationCause: 'shipped-readiness' };
            const entryIdx = survivors.findIndex((survivor) => survivor.prUrl === entry.prUrl);
            if (entryIdx >= 0) survivors[entryIdx] = entry;
            hasRemediation = true;
          }
        }

        // Task 21: exhaustion — escalate exactly once. Gated on the
        // label-absent→present transition so a sweep that finds
        // needs-remediation already present (sticky) performs zero new gh
        // mutations or events.
        if (
          !hasRemediation &&
          state.checksOutcome === 'failed' &&
          (entry.ciFixAttempts ?? 0) >= CI_FIX_ATTEMPT_CAP
        ) {
          // Task 22 (AC2): re-check PR state immediately before escalating —
          // the PR may have been merged/closed by a human between the
          // detection read above and this point in the sweep. Racing an
          // escalation comment onto an already-resolved PR is pure noise, so
          // prune the entry and skip the label/comment/event work entirely.
          const freshState = await prStateTracker.readPullRequestMergeState(entry.prUrl, entry.repoCwd, log);
          if (
            freshState.state === 'MERGED' ||
            freshState.state === 'CLOSED' ||
            freshState.state === 'NOTFOUND'
          ) {
            log?.(
              `[mergeable-sweep] pruning ${entry.prUrl} (state changed to ${freshState.state} before escalation)`,
            );
            const idx = survivors.findIndex((s) => s.prUrl === entry.prUrl);
            if (idx >= 0) survivors.splice(idx, 1);
            continue;
          }

          // label-before-comment ordering (AC1/AC3): apply the sticky label
          // first so it persists as evidence of exhaustion even if the
          // escalation comment call throws — a hard failure here must never
          // leave the PR silently unlabeled, and must never crash the sweep.
          try {
            await addLabel(entryGh, entry.repoCwd, entry.prUrl, 'needs-remediation', log);
          } catch (err) {
            log?.(`[mergeable-sweep] needs-remediation label error for ${entry.prUrl}: ${err}`);
          }
          try {
            await upsertComment(
              entryGh,
              entry.repoCwd,
              entry.prUrl,
              CI_EXHAUSTION_MARKER,
              buildExhaustionComment(entry, freshState),
              log,
            );
          } catch (err) {
            log?.(`[mergeable-sweep] exhaustion comment error for ${entry.prUrl}: ${err}`);
          }
          emitEvent({
            type: 'ci_failed',
            prUrl: entry.prUrl,
            slug: entry.slug,
            checks: freshState.statusCheckRollup?.map((c) => c.name ?? '?').filter(Boolean) ?? [],
            attempts: entry.ciFixAttempts ?? 0,
            phase: 'exhausted',
          });
          hasRemediation = true;
        }

        if (hasRemediation) {
          if (state.labels.includes('mergeable')) {
            await removeLabel(entryGh, entry.repoCwd, entry.prUrl, 'mergeable', log);
          }
        } else {
          // Task 10 (AC1): track failed PRs for the post-label-pass
          // ciFix dispatch below. Only added when needs-remediation is NOT present
          // (needs-remediation sticky label takes precedence over CI fix dispatch).
          // Collected unconditionally (cheap) but only ever consulted when `ciFix`
          // is configured, so a disabled config leaves the sweep's observable behavior
          // unchanged (AC4).
          // Draft PRs are excluded here for the same reason as the
          // CONFLICTING collection above — resolution only ever runs against
          // non-draft (ready-for-review) PRs.
          if (ciFailing) {
            if (state.isDraft) {
              log?.(`[mergeable-sweep] skipping ci-fix for ${entry.prUrl} (draft PR)`);
            } else {
              failedCandidates.push({ entry, state });
            }
          }
        }

        // Keep edge-triggered failure events independent of GitHub label state.
        if (state.checksOutcome === 'failed') {
          if (!entry.ciFailureDetected) {
            emitEvent({
              type: 'ci_failed',
              prUrl: entry.prUrl,
              slug: entry.slug,
              checks: state.statusCheckRollup?.map((c) => c.name ?? '?').filter(Boolean) ?? [],
              attempts: (entry.ciFixAttempts ?? 0) + 1,
              phase: 'detected',
            });
            const failedIdx = survivors.findIndex((survivor) => survivor.prUrl === entry.prUrl);
            if (failedIdx >= 0) {
              survivors[failedIdx] = { ...survivors[failedIdx], ciFailureDetected: true };
            }
          }
        }

        // A green outcome resets the bounded CI-fix attempt counter.
        if (state.checksOutcome === 'green') {
          const greenIdx = survivors.findIndex((s) => s.prUrl === entry.prUrl);
          if (greenIdx >= 0) {
            survivors[greenIdx] = {
              ...survivors[greenIdx],
              ciFixAttempts: 0,
              ciFailureDetected: false,
            };
          }
        }

        // FR-10 / C2 / FR-12: add/remove `mergeable` only when needs-remediation is absent.
        if (!hasRemediation) {
          if (isMergeable(state)) {
            if (!state.labels.includes('mergeable')) {
              await addLabel(entryGh, entry.repoCwd, entry.prUrl, 'mergeable', log);
            }
          } else {
            // FR-11 / C2: remove `mergeable` only when currently present.
            if (state.labels.includes('mergeable')) {
              await removeLabel(entryGh, entry.repoCwd, entry.prUrl, 'mergeable', log);
            }
          }
        }
      } catch (err) {
        // Per-PR exception (including gh label ensure/add/remove failures):
        // log + skip, continue with other entries (FR-15, Task 9). The entry
        // may already be in survivors (pushed above once its state was read
        // as live) — only push again here if it never made it in, so a
        // label-operation error never duplicates the entry in the registry.
        log?.(`[mergeable-sweep] error processing ${entry.prUrl}: ${err}`);
        if (!survivors.some((s) => s.prUrl === entry.prUrl)) {
          survivors.push(entry);
        }
      }
    }

    const enqueue = (request: RepairRequest): void => {
      if (!repairs) return;
      if (isRepairRunning?.(request.prUrl)) {
        log?.(`[mergeable-sweep] skipping repair for ${request.prUrl} (already running)`);
        return;
      }
      if (!repairs.queue.enqueue(request)) {
        log?.(`[mergeable-sweep] skipping repair for ${request.prUrl} (already queued)`);
      }
    };

    // The sweep only selects and queues repair work. The daemon pool owns
    // claim-time attempt accounting, adapter execution, and outcomes.
    if (autoresolve?.enabled) {
      for (const { entry, state } of conflictingCandidates) {
        const eligibility = await autoresolve.isEligible(entry, state);
        if (!eligibility.eligible) continue;
        const queuedAt = now().toISOString();
        enqueue({
          kind: 'autoresolve', prUrl: entry.prUrl, slug: entry.slug,
          prCreatedAt: state.createdAt ?? queuedAt, queuedAt,
          run: async (claimed) => (await autoresolve.dispatch(claimed)) ?? { kind: 'escalated' },
        });
      }
    }

    if (ciFix?.enabled) {
      for (const { entry, state } of failedCandidates) {
        const eligibility = await ciFix.isEligible(entry, state);
        if (!eligibility.eligible) continue;
        const queuedAt = now().toISOString();
        enqueue({
          kind: 'ci-fix', prUrl: entry.prUrl, slug: entry.slug,
          prCreatedAt: state.createdAt ?? queuedAt, queuedAt,
          run: async (claimed): Promise<CiFixRepairOutcome> => {
            const outcome = await ciFix.dispatch(claimed, state);
            if (!outcome) return { kind: 'failed', stage: 'worktree' };
            switch (outcome.kind) {
              case 'green-verified':
                return { kind: 'published' };
              case 'needs-human':
                return 'providerSetupExhaustion' in outcome
                  ? { kind: 'needs-human', providerSetupExhaustion: outcome.providerSetupExhaustion }
                  : { kind: 'failed', stage: 'provider' };
              case 'not-started':
              case 'noop':
              case 'failed':
              case 'published':
              case 'branch-gone':
                return outcome;
            }
          },
        });
      }
    }

    // Reconcile the sweep result against the lock-protected, current registry.
    // A concurrent update can land while the asynchronous GitHub work above is
    // in progress; retain its fields unless this sweep changed that same field.
    const identity = (entry: WatchEntry): string => `${entry.repoCwd}\0${entry.prUrl}\0${entry.slug}`;
    const before = new Map(entries.map((entry) => [identity(entry), entry]));
    const after = new Map(survivors.map((entry) => [identity(entry), entry]));
    await updateWatch(projectRoot, (freshEntries) => {
      const currentSurvivors = freshEntries.flatMap((fresh) => {
        const key = identity(fresh);
        const original = before.get(key);
        const updated = after.get(key);
        // Entries enrolled after the sweep began were never observed by it, so
        // they survive unchanged. Entries that were observed and omitted were
        // deliberately pruned by this sweep.
        if (!original) return [fresh];
        if (!updated) return [];
        return [mergeSweepEntry(original, updated, fresh)];
      });
      // Task 1: cap the fresh survivor set while holding the same update lock.
      const trimmed = currentSurvivors.length > MAX_WATCH_ENTRIES
        ? currentSurvivors.slice(-MAX_WATCH_ENTRIES)
        : currentSurvivors;
      if (trimmed.length !== currentSurvivors.length) {
        for (const entry of currentSurvivors.slice(0, currentSurvivors.length - MAX_WATCH_ENTRIES)) {
          log?.(
            `[mergeable-sweep] registry cap: dropping ${entry.prUrl} (slug ${entry.slug}) — over MAX_WATCH_ENTRIES`,
          );
        }
      }
      return trimmed;
    });
  } catch (err) {
    // Sweep-level exception: swallow so callers are never disrupted (FR-15).
    log?.(`[mergeable-sweep] sweep error: ${err}`);
  }
}
