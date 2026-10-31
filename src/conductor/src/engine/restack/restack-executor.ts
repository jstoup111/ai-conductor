import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type ChildId } from '../child-context.js';
import { hasDurableChildState, resolveActiveChild, resolveSealedLeaf } from '../child-cursor.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { loadMergedConfigForRead } from '../config.js';
import { verifyProtectedArtifactSeal } from '../protected-artifact-seal.js';
import { makeGitRunner, type GitRunner, writeSealHalt } from '../rebase.js';
import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import {
  createRestackJournal,
  journalRefFor,
  pinStagingRef,
  replaceAppliedJournalWithFollowOn,
  stagingRefFor,
  updateRestackChildStatus,
  writeRestackJournalBlob,
  journalStateUpdateLines,
  recordRoutedApplyPlan,
  type RestackJournalDraft,
  type RestackJournalRouted,
  type StoredRestackJournal,
} from './restack-journal.js';
import {
  applyRestackMove,
  checkRestackPreMove,
  haltRestack,
  haltRestackConflict,
  rollbackRestackMove,
  verifyRestackMove,
  type RestackMoveRef,
} from './restack-move.js';
import { planRestackRanges } from './restack-plan.js';
import { checkPathOwnership, parentOverlapPaths } from './restack-ownership.js';
import { replayChildRange, RemBlockBodyMismatchError, type CommitterStamp } from './restack-replay.js';
import { replayCandidateSubjects, resolveRestackConflict, type RestackResolver } from './restack-resolver.js';
import { conflictDeleteLines, consumeRecordedResolution } from './restack-conflict-record.js';
import { haltRecordedRestackConflict } from './restack-conflict-halt.js';
import { haltRecordPathFor } from './halt-record-bookkeeping.js';
import { resolveRebaseResolutionAttempts } from '../resolved-config.js';
import { syncRestackedWorktree } from './restack-sync.js';
import { emitRestackRefused } from './restack-events.js';
import { applyRestackTransition } from './restack-transition.js';
import { cleanClearedAbortedRestackJournal } from './restack-recovery.js';
import { resolveUnenteredLeafOwner, type ConsumedTipCorrespondence } from './restack-unentered-leaf.js';
import {
  cascadeUpdateLines,
  checkCascadeCap,
} from './cascade-cap.js';
import { formatCascadeAllowance, resolveCascadeAllowanceForWorktree } from './cascade-allowance.js';
import { readRevalidationQueue, readRouteRecord, routedAppliedLines, routedRecordAfterExit } from '../routing/route-record-store.js';
import { repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../routing/routing-refs.js';
import { mergeQueueGeneration } from '../routing/revalidation-queue.js';
import { childRevalidatedEvent } from '../routing/routing-events.js';
import { parseRevalidationQueueRecord, routingEligible, type RevalidationQueueRecord } from '../routing/route-types.js';
import { recordKickbackCapEvidence } from '../kickback-ledger.js';
import { renderKickbackBudgetView } from '../kickback-budget-view.js';
import {
  isLegalJournalTransition,
  parseCommitSha,
  parseRefName,
  type ChildRange,
  type CommitSha,
  type RefName,
  type RestackCause,
  type RestackOpId,
} from './restack-types.js';

export interface RunRestackOptions {
  readonly worktree: string;
  readonly slug: string;
  readonly cause: RestackCause;
  /**
   * Explicit routed origins are captured by the exit cursor.  Other repairs
   * derive them solely from the immutable range planner.
   */
  readonly originatingChildren?: readonly ChildId[];
  /** The already-resolved default-branch tip for a base refresh. */
  readonly newDefault?: string;
  readonly events?: ConductorEventEmitter;
  readonly git?: GitRunner;
  /** Narrow, bounded resolver used only after one child's plumbing replay conflicts. */
  readonly resolver?: RestackResolver;
  readonly resolverCap?: number;
  /** Recovery-only replacement of an applied operation that named this cause. */
  readonly replacesAppliedJournal?: StoredRestackJournal;
  /** A durable operation which must replace this one after it reaches applied. */
  readonly followOnCause?: RestackCause;
  /** Durable route and marker CAS values for an exit restack. */
  readonly routed?: Omit<RestackJournalRouted, 'routeNew' | 'queueNew'>;
}

export type RunRestackResult =
  | { readonly kind: 'applied'; readonly opId: RestackOpId }
  /** The exact durable halt body written for this terminal outcome. */
  | { readonly kind: 'halted'; readonly detail: string }
  /** Another live operation owns the journal; this run did nothing durable. */
  | { readonly kind: 'refused'; readonly reason: 'restack-outstanding' }
  | { readonly kind: 'repair-pending'; readonly child: number }
  | { readonly kind: 'unavailable'; readonly detail: string };

function ref(raw: string): RefName {
  const parsed = parseRefName(raw);
  if (!parsed) throw new Error(`invalid restack ref: ${raw}`);
  return parsed;
}

async function runGit(git: GitRunner, args: string[], input?: string) {
  return git(args, input === undefined ? undefined : { input });
}

function transaction(lines: readonly string[]): string {
  return ['start', ...lines, 'prepare', 'commit', ''].join('\n');
}

/** Return the durable diagnostic rather than losing it at the routed boundary. */
async function haltedResult(worktree: string): Promise<Extract<RunRestackResult, { readonly kind: 'halted' }>> {
  const detail = await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')
    .catch(() => 'restack halt marker could not be read');
  return { kind: 'halted', detail };
}

const EMPTY_REVALIDATION_QUEUE: RevalidationQueueRecord = { generation: 0, entries: [], outbox: [] };

async function queueTrackingAtCreation(
  worktree: string,
  slug: string,
  git: GitRunner,
): Promise<{ readonly queueTracked: true; readonly queueOld?: CommitSha } | undefined> {
  const config = await loadMergedConfigForRead(worktree);
  if (!config.ok || !routingEligible({ kind: 'active' }, config.config as Parameters<typeof routingEligible>[1])) return undefined;
  if (!await hasDurableChildState(worktree, slug, { git })) return undefined;
  const queue = await readRevalidationQueue(worktree, slug, { git });
  if (queue.kind === 'unreadable') throw new Error('cannot read revalidation queue before restack');
  return queue.kind === 'queue'
    ? { queueTracked: true, queueOld: queue.blob }
    : { queueTracked: true };
}

async function queueRecordAtJournalStart(
  journal: StoredRestackJournal,
  git: GitRunner,
): Promise<RevalidationQueueRecord> {
  const old = journal.journal.queueOld;
  if (old === undefined) return EMPTY_REVALIDATION_QUEUE;
  const result = await runGit(git, ['cat-file', '-p', old]);
  const parsed = result.exitCode === 0 ? parseRevalidationQueueRecord(result.stdout) : undefined;
  if (!parsed) throw new Error('cannot read journaled revalidation queue');
  return parsed;
}

async function writeQueuePlan(
  journal: StoredRestackJournal,
  entries: Awaited<ReturnType<typeof applyRestackTransition>>['queueInvalidation'],
  git: GitRunner,
): Promise<CommitSha | undefined> {
  if (journal.journal.queueTracked !== true || (entries.length === 0 && journal.journal.routed === undefined)) return undefined;
  const current = await queueRecordAtJournalStart(journal, git);
  const host = journal.journal.routed?.host;
  const acknowledged = host === undefined ? undefined : current.entries.find((entry) => entry.child === host);
  let next = mergeQueueGeneration(current, entries, host === undefined ? {} : { acknowledge: host });
  if (acknowledged !== undefined) {
    const event = childRevalidatedEvent(host!, next.generation, acknowledged.closureSha, 'fixed');
    next = { ...next, outbox: [...next.outbox, { eventId: event.eventId, occurredAt: event.occurredAt, event }] };
  }
  if (next.entries.length === current.entries.length && next.outbox.length === current.outbox.length && entries.length === 0) return undefined;
  const written = await runGit(git, ['hash-object', '-w', '--stdin'], JSON.stringify(next));
  const queueNew = written.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
  if (!queueNew) throw new Error('cannot write revalidation queue blob');
  return queueNew;
}

async function requiredSha(git: GitRunner, revision: string, context: string): Promise<CommitSha> {
  const result = await runGit(git, ['rev-parse', '--verify', revision]);
  const value = result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
  if (!value) throw new Error(`cannot resolve ${context}`);
  return value;
}

export async function defaultTip(git: GitRunner, supplied?: string): Promise<CommitSha> {
  if (supplied !== undefined) {
    const parsed = parseCommitSha(supplied);
    if (!parsed) throw new Error('newDefault is not a full Git object name');
    return parsed;
  }
  const remoteHead = await runGit(git, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead.exitCode === 0 && remoteHead.stdout.trim() !== '') {
    return requiredSha(git, remoteHead.stdout.trim(), 'origin default branch');
  }
  for (const candidate of ['refs/heads/main', 'refs/heads/master', 'refs/heads/trunk']) {
    const result = await runGit(git, ['rev-parse', '-q', '--verify', candidate]);
    const parsed = result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
    if (parsed) return parsed;
  }
  throw new Error('cannot resolve default branch tip; provide newDefault');
}

async function commitsInRange(git: GitRunner, range: string, context: string): Promise<CommitSha[]> {
  const result = await runGit(git, ['rev-list', '--reverse', range]);
  if (result.exitCode !== 0) throw new Error(`cannot list ${context}`);
  return result.stdout.split('\n').filter(Boolean).map((value) => {
    const commit = parseCommitSha(value);
    if (!commit) throw new Error(`cannot parse ${context} commit`);
    return commit;
  });
}

async function descendsFrom(git: GitRunner, ancestor: CommitSha, descendant: CommitSha): Promise<boolean> {
  const result = await runGit(git, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (result.exitCode > 1) throw new Error(`cannot inspect ancestry of ${descendant}`);
  return result.exitCode === 0;
}

async function leafIsInsideRange(git: GitRunner, leafTip: CommitSha, range: ChildRange): Promise<boolean> {
  if (leafTip === range.oldParent) return false;
  const [afterParent, beforeTip] = await Promise.all([
    runGit(git, ['merge-base', '--is-ancestor', range.oldParent, leafTip]),
    runGit(git, ['merge-base', '--is-ancestor', leafTip, range.oldTip]),
  ]);
  if (afterParent.exitCode > 1 || beforeTip.exitCode > 1) throw new Error(`cannot inspect unentered leaf ${leafTip}`);
  return afterParent.exitCode === 0 && beforeTip.exitCode === 0;
}

async function comparisonCommits(
  git: GitRunner,
  cause: RestackCause,
  ranges: readonly ChildRange[],
  newDefault: CommitSha,
): Promise<CommitSha[]> {
  if (cause === 'base-refresh') {
    const first = ranges[0];
    return first === undefined ? [] : commitsInRange(git, `${first.oldParent}..${newDefault}`, 'new default commits');
  }

  // Feature-repair origins are exactly the patches that must be carried into
  // every descendant. Treating them as already-present comparison patches
  // silently drops the operator's appended work from the rebuilt stack.
  return [];
}

async function committerStamp(git: GitRunner): Promise<CommitterStamp> {
  const [name, email] = await Promise.all([
    runGit(git, ['config', '--get', 'user.name']),
    runGit(git, ['config', '--get', 'user.email']),
  ]);
  if (name.exitCode !== 0 || email.exitCode !== 0 || name.stdout.trim() === '' || email.stdout.trim() === '') {
    throw new Error('cannot determine restack committer identity');
  }
  return { name: name.stdout.trim(), email: email.stdout.trim(), date: new Date().toISOString() };
}

async function checkedOutRef(git: GitRunner): Promise<RefName> {
  const head = await runGit(git, ['symbolic-ref', '-q', 'HEAD']);
  const parsed = head.exitCode === 0 ? parseRefName(head.stdout.trim()) : undefined;
  if (!parsed) throw new Error('restack requires a checked-out feature branch');
  return parsed;
}

type RestackActiveChild =
  | { readonly child: ChildId; readonly branchRef: RefName; readonly isLeaf: true }
  | { readonly child: ChildId; readonly branchRef: RefName; readonly isLeaf: false; readonly unenteredLeaf: ChildId };

/** A stack the cursor proved divergent: a planner refusal, never an unavailable cursor. */
interface RestackCursorDivergence {
  readonly divergent: { readonly child: ChildId; readonly check: 'closed-child-rewritten' | 'range-not-ancestor' };
}

async function activeFor(worktree: string, slug: string, git: GitRunner): Promise<RestackActiveChild | RestackCursorDivergence> {
  const cursor = await resolveActiveChild(worktree, slug, { git });
  if (cursor.kind === 'divergent') return { divergent: { child: cursor.child, check: cursor.check } };
  if (cursor.kind === 'active' || cursor.kind === 'repair-pending') {
    const branch = ref(`refs/heads/${cursor.branch}`);
    if (cursor.isLeaf) return { child: cursor.child, branchRef: branch, isLeaf: true };
    const unenteredLeaf = await resolveSealedLeaf(worktree);
    if (unenteredLeaf === undefined) throw new Error('cannot resolve restack cursor: envelope-missing');
    return { child: cursor.child, branchRef: branch, isLeaf: false, unenteredLeaf };
  }
  throw new Error(`cannot resolve restack cursor: ${cursor.kind}`);
}

function branchRefForRange(slug: string, range: ChildRange): RefName {
  if (range.kind === 'leaf-active' || range.kind === 'leaf-unentered') return ref(`refs/heads/${leafBranchFor(slug)}`);
  const branch = childBranchFor(slug, range.child);
  if (!branch.ok) throw new Error(branch.reason);
  return ref(`refs/heads/${branch.branch}`);
}

async function journalRefs(git: GitRunner, slug: string, ranges: readonly ChildRange[]): Promise<{ readonly ref: RefName; readonly oldSha: CommitSha }[]> {
  const refs: { ref: RefName; oldSha: CommitSha }[] = [];
  for (const range of ranges) {
    const branchRef = branchRefForRange(slug, range);
    // A closed branch can carry a halt record after its closure. That commit is
    // intentionally outside the replay range, but its current ref value must
    // still be the CAS old value so the move discards it without a race.
    refs.push({ ref: branchRef, oldSha: await requiredSha(git, branchRef, `branch for child ${range.child}`) });
    if (range.kind === 'closed') {
      const closureRef = ref(`refs/conductor/${slug}/closed/c${range.child}`);
      // A feature repair replays an appended branch tip, while the closure
      // still names its earlier sealed tip. Pin the actual closure value for
      // the CAS rather than the replay range's (possibly appended) oldTip.
      refs.push({ ref: closureRef, oldSha: await requiredSha(git, closureRef, `closure for child ${range.child}`) });
    }
  }
  return refs;
}

async function transitionState(
  worktree: string,
  journal: StoredRestackJournal,
  state: 'ready' | 'synced' | 'applied' | 'aborted',
  git: GitRunner,
): Promise<StoredRestackJournal> {
  if (!isLegalJournalTransition(journal.journal.state, state)) throw new Error(`illegal restack state transition to ${state}`);
  const next = { ...journal.journal, state };
  const blob = await writeRestackJournalBlob(worktree, next, { git });
  const updated = await runGit(git, ['update-ref', '--stdin'], transaction(journalStateUpdateLines(journal, blob, state)));
  if (updated.exitCode !== 0) throw new Error(`cannot transition restack journal to ${state}`);
  return { slug: journal.slug, blob, journal: next };
}

/**
 * Assemble the sole applied transaction shared by normal execution and
 * recovery.  Nothing writes these lines except the caller's one update-ref
 * transaction, so routed state, cascade accounting, and the journal settle
 * together or not at all.
 */
export async function appliedTransactionLines(
  worktree: string,
  journal: StoredRestackJournal,
  git: GitRunner,
): Promise<{ readonly journal: StoredRestackJournal; readonly lines: readonly string[] }> {
  if (!isLegalJournalTransition(journal.journal.state, 'applied')) throw new Error('illegal restack state transition to applied');
  const next = { ...journal.journal, state: 'applied' as const };
  const blob = await writeRestackJournalBlob(worktree, next, { git });
  const lines: string[] = [];
  if ((journal.journal.originatingChildren?.length ?? 0) > 0) {
    const updates = await cascadeUpdateLines(worktree, journal.slug, journal.journal.originatingChildren!, { git });
    if (updates.kind !== 'lines') throw new Error(updates.detail);
    lines.push(...updates.lines);
  }
  if (journal.journal.routed !== undefined) {
    const routed = routedAppliedLines(journal.slug, journal.journal, journal.journal.opId);
    if (routed === 'refused') throw new Error('cannot build routed applied transaction');
    lines.push(...routed);
  }
  if (journal.journal.queueTracked === true && journal.journal.queueNew !== undefined) {
    const queueRef = revalidationQueueRefFor(journal.slug);
    if (journal.journal.queueOld === undefined) lines.push(`create ${queueRef} ${journal.journal.queueNew}`);
    else lines.push(`update ${queueRef} ${journal.journal.queueNew} ${journal.journal.queueOld}`);
  }
  if (journal.journal.consumedResolution !== undefined) {
    lines.push(...conflictDeleteLines(journal.slug, journal.journal.consumedResolution));
  }
  lines.push(...journalStateUpdateLines(journal, blob, 'applied'));
  return { journal: { slug: journal.slug, blob, journal: next }, lines };
}

/** Injectable ownership seam: normal execution and recovery share this builder. */
export const restackTransactionBuilder = { appliedTransactionLines };

/**
 * A routed applied transaction owns a fixed set of old values. When its CAS
 * loses, name the first changed value rather than replaying an ambiguous exit.
 */
export async function changedRoutedAppliedRef(
  journal: StoredRestackJournal,
  git: GitRunner,
): Promise<string | undefined> {
  const routed = journal.journal.routed;
  const expected = [
    ...(routed === undefined ? [] : [
      { ref: routeRecordRefFor(journal.slug, routed.roundId), old: routed.routeOld },
      { ref: repairMarkerRefFor(journal.slug), old: routed.markerOld },
    ]),
    ...(journal.journal.queueTracked === true ? [{ ref: revalidationQueueRefFor(journal.slug), old: journal.journal.queueOld }] : []),
  ];
  for (const entry of expected) {
    const result = await runGit(git, ['rev-parse', '-q', '--verify', entry.ref]);
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(`cannot read routed applied ref ${entry.ref}`);
    const live = result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
    if (result.exitCode === 0 && !live) throw new Error(`cannot parse routed applied ref ${entry.ref}`);
    if (live !== entry.old) return entry.ref;
  }
  return undefined;
}

/** A route CAS lost before its applied plan could be made durable. */
export class RoutedApplyPlanRefChangedError extends Error {
  constructor(readonly ref: string) {
    super(`routed applied ref changed: ${ref}`);
    this.name = 'RoutedApplyPlanRefChangedError';
  }
}

/** Persist a routed route-record replacement before the applied transaction can use it. */
export async function journalRoutedApplyPlan(
  worktree: string,
  journal: StoredRestackJournal,
  transition: Awaited<ReturnType<typeof applyRestackTransition>>,
  git: GitRunner,
): Promise<StoredRestackJournal> {
  const routed = journal.journal.routed;
  // A crash can leave a synced journal with only one side of its applied plan
  // durable.  Route planning is not optional merely because a queue plan was
  // already recorded: recovery must finish the missing route plan before the
  // shared applied transaction can be rendered.
  const routePlanReady = routed === undefined || routed.routeNew !== undefined;
  // `queueInvalidation` is recorded even when merging leaves the queue blob
  // unchanged, so it is the durable completion bit for that half of a plan.
  const queuePlanReady = journal.journal.queueTracked !== true || journal.journal.queueInvalidation !== undefined;
  if (journal.journal.state !== 'synced' || (routePlanReady && queuePlanReady)) return journal;
  let routeNew: CommitSha | undefined;
  if (routed !== undefined) {
    const stored = await readRouteRecord(worktree, journal.slug, routed.roundId, { git });
    if (stored.kind !== 'record') throw new Error('cannot read routed record for applied transaction');
    if (stored.blob !== routed.routeOld) {
      throw new RoutedApplyPlanRefChangedError(routeRecordRefFor(journal.slug, routed.roundId));
    }
    const advanced = routedRecordAfterExit(stored, routed.host, 'restacked');
    if (advanced.kind !== 'updated') throw new Error('cannot mark routed host restacked');
    const written = await runGit(git, ['hash-object', '-w', '--stdin'], JSON.stringify(advanced.record));
    routeNew = written.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
    if (!routeNew) throw new Error('cannot write routed applied record blob');
  }
  const queueNew = await writeQueuePlan(journal, transition.queueInvalidation, git);
  if (routeNew === undefined && queueNew === undefined) return journal;
  const planned = await recordRoutedApplyPlan(worktree, journal, {
    routeNew,
    queueNew,
    invalidation: transition.queueInvalidation.map(({ child, gates }) => ({ child, gates: [...gates] })),
    queueInvalidation: transition.queueInvalidation,
  }, { git });
  if (planned.kind !== 'updated') throw new Error('cannot record routed apply plan');
  return planned.journal;
}

async function cleanAppliedJournal(journal: StoredRestackJournal, git: GitRunner): Promise<void> {
  const lines = [
    `delete ${journalRefFor(journal.slug)} ${journal.blob}`,
    ...journal.journal.ranges.map((range) => `delete ${stagingRefFor(journal.slug, range.child)}`),
  ];
  const deleted = await runGit(git, ['update-ref', '--stdin'], transaction(lines));
  if (deleted.exitCode !== 0) throw new Error('cannot remove applied restack journal');
}

async function abortJournal(worktree: string, journal: StoredRestackJournal, git: GitRunner, moves: readonly RestackMoveRef[]): Promise<void> {
  if (journal.journal.state === 'moved') {
    await rollbackRestackMove(worktree, journal, moves, { git });
    return;
  }
  if (journal.journal.state === 'planned' || journal.journal.state === 'ready') {
    await transitionState(worktree, journal, 'aborted', git);
  }
}

interface ReplayConflict {
  readonly commit: CommitSha;
  readonly paths: readonly string[];
}

/**
 * Plumbing replay reports the failed commit in its error. Its complete changed
 * path set is the durable hand-off context: merge-tree's human stderr is not a
 * stable interface and may omit a path on some Git versions.
 */
async function replayConflict(git: GitRunner, slug: string, error: unknown): Promise<ReplayConflict | undefined> {
  const message = error instanceof Error ? error.message : String(error);
  const matched = /^merge-tree failed for ([0-9a-f]{40}|[0-9a-f]{64}):/m.exec(message);
  const commit = matched === null ? undefined : parseCommitSha(matched[1]!);
  if (!commit) return undefined;
  const changed = await runGit(git, ['diff', '--no-renames', '--name-only', `${commit}^`, commit]);
  if (changed.exitCode !== 0) throw new Error(`cannot determine conflicted paths for ${commit}`);
  const haltRecordPath = haltRecordPathFor(slug);
  const paths = [...new Set(changed.stdout.split('\n').map((path) => path.trim()).filter((path) => path && path !== haltRecordPath))]
    .sort((left, right) => left.localeCompare(right));
  return { commit, paths };
}

export async function mergeInRange(git: GitRunner, range: ChildRange): Promise<CommitSha | undefined> {
  for (const commit of await commitsInRange(git, `${range.oldParent}..${range.oldTip}`, `child ${range.child} range`)) {
    const parents = await runGit(git, ['rev-list', '--parents', '-n', '1', commit]);
    if (parents.exitCode !== 0) throw new Error(`cannot read parents for ${commit}`);
    if (parents.stdout.trim().split(/\s+/).length > 2) return commit;
  }
  return undefined;
}

async function haltUnresolvedConflict(
  worktree: string,
  slug: string,
  journal: StoredRestackJournal,
  range: ChildRange,
  conflict: ReplayConflict,
  events: ConductorEventEmitter | undefined,
  git: GitRunner,
  newParent: CommitSha,
  reason: 'conflict' | 'replay-mismatch',
  resolutionDetail?: string,
  candidates: readonly CommitSha[] = [],
): Promise<void> {
  // The rejected resolver result is deliberately discarded. Keeping the
  // journaled own tip reachable gives the operator the exact child history
  // that entered the hand-off, while no real branch has moved.
  if (!await pinStagingRef(worktree, slug, range.child, range.oldTip, { git })) {
    throw new Error(`cannot pin original tip for conflicted child ${range.child}`);
  }
  await abortJournal(worktree, journal, git, []);
  await events?.emit({ type: 'restack_conflict', opId: journal.journal.opId, child: range.child, commit: conflict.commit, paths: [...conflict.paths] });
  const detail = `commit ${conflict.commit}; paths: ${conflict.paths.join(', ')}${resolutionDetail === undefined ? '' : `\n${resolutionDetail}`}`;
  if (reason === 'replay-mismatch') await haltRestack(worktree, 'replay-mismatch', events, { child: range.child, detail });
  else {
    await haltRecordedRestackConflict({
      worktree, slug, journal, range, replayParent: newParent,
      candidateSubjects: await replayCandidateSubjects(git, candidates),
      commit: conflict.commit, paths: conflict.paths, detail, events, git, writeHalt: haltRestackConflict,
    });
  }
}

/**
 * Replay the existing stack off-worktree, then apply every branch and closure
 * ref in a single transaction. Follow-on handling and transition semantics are
 * deliberately left to their owning later tasks.
 */
export async function runRestack(options: RunRestackOptions): Promise<RunRestackResult> {
  const git = options.git ?? makeGitRunner(options.worktree);
  let journal: StoredRestackJournal | undefined;
  let moves: RestackMoveRef[] = [];
  let terminal = false;
  try {
    // The seal is the authority boundary for the plan that now supplies stack
    // topology. Verify it before loading that topology so a tampered plan
    // cannot turn a protected-artifact refusal into a cursor-unavailable
    // outcome. Supplying HEAD preserves the legacy no-seal path.
    const seal = await verifyProtectedArtifactSeal({
      projectRoot: options.worktree,
      baselineCommit: 'HEAD',
      toleratesEngineAppendedRemediation: true,
    });
    if (!seal.ok) {
      await writeSealHalt(options.worktree, seal.reason, options.events);
      terminal = true;
      return haltedResult(options.worktree);
    }
    // The caller has already superseded the committed halt record and consumed
    // any matching authorization.  Do one narrow, terminal-only recheck here
    // so a cleared halt cannot make the next restack look outstanding.
    const staleCleanup = await cleanClearedAbortedRestackJournal(options.worktree, options.slug, { git });
    if (staleCleanup === 'unavailable') return { kind: 'unavailable', detail: 'cannot remove cleared aborted restack journal' };
    const active = await activeFor(options.worktree, options.slug, git);
    if ('divergent' in active) {
      await haltRestack(options.worktree, active.divergent.check, options.events, { child: active.divergent.child });
      terminal = true;
      return haltedResult(options.worktree);
    }
    // A repair's default is unchanged. Resolve that local default before
    // planning instead of borrowing the active child's closure, which is an
    // intermediate stack tip rather than the whole feature's base.
    const planningDefault = await defaultTip(git, options.cause === 'base-refresh' ? options.newDefault : undefined);
    const plan = await planRestackRanges(options.worktree, {
      slug: options.slug,
      oldDefaultTip: planningDefault,
      cause: options.cause,
      active,
      ...(active.isLeaf ? {} : {
        unenteredLeaf: { child: active.unenteredLeaf, branchRef: ref(`refs/heads/${leafBranchFor(options.slug)}`) },
      }),
    }, { git });
    if (plan.kind === 'refused') {
      await haltRestack(options.worktree, plan.reason, options.events, { child: plan.child });
      terminal = true;
      return haltedResult(options.worktree);
    }
    if (plan.kind === 'repair-pending') {
      terminal = true;
      return { kind: 'repair-pending', child: plan.child };
    }
    if (plan.kind === 'unavailable') throw new Error(plan.detail);

    const originating = options.originatingChildren === undefined
      ? plan.originating
      : [...new Set(options.originatingChildren)].sort((left, right) => left - right);
    if (options.routed !== undefined && !originating.includes(options.routed.host)) {
      await haltRestack(options.worktree, 'range-not-ancestor', options.events, {
        child: options.routed.host,
        detail: `routed exit origin set is missing host ${options.routed.host}`,
      });
      terminal = true;
      return haltedResult(options.worktree);
    }

    if (options.cause === 'feature-repair') {
      const allowance = await resolveCascadeAllowanceForWorktree(options.worktree);
      const cap = await checkCascadeCap(options.worktree, options.slug, originating, allowance.limit, { git });
      if (cap.kind === 'exhausted') {
        const entry = await recordKickbackCapEvidence(options.worktree, 'restack', {
          consumed: cap.count,
          limit: cap.limit,
          latestReason: `restack cascade cap for originating child ${cap.child}`,
          allowance: 'restacks',
        }, active.child);
        const rendered = renderKickbackBudgetView(entry, 'restack', cap.limit, undefined, undefined, active.child);
        const capDetail = cap.detail ??
          `originating child ${cap.child} reached ${cap.count}/${cap.limit} cascades — ${formatCascadeAllowance(allowance)}` +
          `${cap.raised ? `; raised to ${cap.limit}` : ''}`;
        await haltRestack(options.worktree, 'cascade-cap', options.events, {
          child: cap.child,
          detail: capDetail +
            `${options.routed === undefined ? '' : '\nRunbook: Routed repair halted on the cascade cap'}` +
            `\n${rendered}\nKickback halt generation: ${entry.capEvidence!.haltGeneration}`,
        });
        terminal = true;
        return haltedResult(options.worktree);
      }
    }

    // A repair keeps the stack on the default it already sits on: child 1's
    // old parent. The resolved default tip may be a freshly fetched
    // origin/main, which only a later base refresh may carry into the stack.
    const stackDefault = options.cause === 'feature-repair' && plan.ranges[0] !== undefined
      ? plan.ranges[0].oldParent
      : planningDefault;
    const comparison = await comparisonCommits(git, options.cause, plan.ranges, planningDefault);
    const queueTracking = await queueTrackingAtCreation(options.worktree, options.slug, git);
    const draft: RestackJournalDraft = {
      opId: randomUUID() as RestackOpId,
      cause: options.cause,
      ...(options.followOnCause === undefined ? {} : { followOnCause: options.followOnCause }),
      committer: await committerStamp(git),
      newDefault: stackDefault,
      comparisonCommits: comparison,
      ...(options.cause === 'feature-repair' ? { originatingChildren: originating } : {}),
      ...(options.routed === undefined ? {} : { routed: options.routed }),
      ...(queueTracking === undefined ? {} : queueTracking),
      dirtyPaths: [],
      refs: await journalRefs(git, options.slug, plan.ranges),
      ranges: plan.ranges,
      children: plan.ranges.map((range) => ({ child: range.child, status: 'pending' as const, rewrites: [] })),
    };
    const created = options.replacesAppliedJournal === undefined
      ? await createRestackJournal(options.worktree, options.slug, draft, options.events, { git })
      : await replaceAppliedJournalWithFollowOn(options.worktree, options.slug, options.replacesAppliedJournal, draft, { git });
    if (created.kind === 'refused') {
      terminal = true;
      // The journal belongs to another operation, which remains its sole
      // owner. Halting here would write a needs-human HALT and commit a halt
      // record on the checked-out branch, moving a ref the owner journaled.
      // createRestackJournal already emitted the one refusal; the follow-on
      // replacement does not, so emit it here exactly once.
      if (options.replacesAppliedJournal !== undefined) {
        await options.events?.emit(emitRestackRefused({ reason: created.reason }));
      }
      return { kind: 'refused', reason: created.reason };
    }
    if (created.kind === 'unavailable') throw new Error(created.detail);
    journal = created.journal;
    await options.events?.emit({ type: 'restack_planned', opId: draft.opId, cause: draft.cause, children: plan.ranges.map((range) => range.child) });

    const newStackCommits = comparison;
    const mergeAudit = { flattenedMerges: [] as string[], ancestryOnlyMerges: [] as string[], sideLineageCount: 0 };
    const overlaps = new Map<number, string[]>();
    const exactRewrites = new Map<ChildId, ReadonlyMap<CommitSha, CommitSha>>();
    // `consumeRecordedResolution` deliberately omits ambiguous duplicate
    // subjects from its durable rewrite map. Keep the range-tip correspondence
    // separately: an unentered leaf may itself be at that old tip, and moving
    // it must not turn the ambiguity policy into a general rewrite entry.
    const consumedTipCorrespondences = new Map<ChildId, ConsumedTipCorrespondence>();
    const unenteredLeafOwners = new Map<ChildId, ChildId>();
    let parent = planningDefault;
    const lastOriginIndex = options.cause === 'feature-repair'
      ? Math.max(-1, ...plan.ranges.map((range, index) => originating.includes(range.child) ? index : -1))
      : -1;
    for (const [rangeIndex, range] of plan.ranges.entries()) {
      if (range.kind === 'leaf-unentered') {
        const resolution = await resolveUnenteredLeafOwner(
          git, range.oldTip, exactRewrites, [...consumedTipCorrespondences.values()],
        );
        const resolvedMatches = resolution.matches;
        // A repair adopts every child through the highest origin unchanged
        // (originating or not), so a pre-region leaf contained by one of those
        // ranges has no rewritten counterpart. Its durable identity is its
        // original tip, not the adopted child's tip.
        const identityMatches = resolvedMatches.length === 0 && options.cause === 'feature-repair'
          ? (await Promise.all(plan.ranges.slice(0, rangeIndex).map(async (candidate, candidateIndex) => {
            if (candidateIndex > lastOriginIndex || candidate.kind === 'leaf-unentered') return undefined;
            return await leafIsInsideRange(git, range.oldTip, candidate)
              ? { child: candidate.child, rewritten: range.oldTip }
              : undefined;
          }))).filter((match): match is { child: ChildId; rewritten: CommitSha } => match !== undefined)
          : [];
        const matches = resolvedMatches.length === 0 ? identityMatches : resolvedMatches;
        if (matches.length !== 1) {
          throw new Error(`cannot resolve unentered leaf ${range.child} from its owning child rewrite map`);
        }
        const { child: owner, rewritten } = matches[0]!;
        const rewrites = new Map([[range.oldTip, rewritten]]);
        const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'replayed', rewritten, rewrites, { git });
        if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while moving unentered leaf' : updated.detail);
        journal = updated.journal;
        // A leaf's move is still journaled, but a correspondence recovered
        // from a consumed duplicate-subject resolution must remain local to
        // that move. Feeding it to the transition translator would persist
        // precisely the ambiguous entry consumption intentionally omitted.
        const recoveredFromConsumedResolution = resolution.recoveredFromConsumedResolution;
        exactRewrites.set(range.child, recoveredFromConsumedResolution ? new Map() : rewrites);
        unenteredLeafOwners.set(range.child, owner);
        overlaps.set(range.child, []);
        parent = rewritten;
        continue;
      }
      // Repair leaves all existing lower tips intact. Only descendants of the
      // highest originating child are rebuilt on the new closure chain. A
      // lower child whose branch no longer descends from its (adopted)
      // parent, such as a second originating child above an appended one, is
      // replayed onto that parent so one repair carries both appends.
      const adoptable = options.cause === 'feature-repair' && rangeIndex <= lastOriginIndex
        ? await requiredSha(git, branchRefForRange(options.slug, range), `branch for child ${range.child}`)
        : undefined;
      if (adoptable !== undefined && (rangeIndex === 0 || await descendsFrom(git, parent, adoptable))) {
        const adopted = adoptable;
        const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'replayed', adopted, new Map(), { git });
        if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while adopting child' : updated.detail);
        journal = updated.journal;
        overlaps.set(range.child, []);
        parent = adopted;
        continue;
      }
      if (options.cause === 'feature-repair') {
        const recorded = await consumeRecordedResolution({
          slug: options.slug, range, parent, committer: journal.journal.committer, git,
          replay: (replayRange, replayParent, replayCommitter, replayGit) => replayChildRange(
            replayRange, replayParent, replayCommitter, replayGit, { comparisonCommits: [] },
          ),
        });
        if (recorded.kind === 'stale') {
          await abortJournal(options.worktree, journal, git, moves);
          await haltRestack(options.worktree, 'restack-resolution-stale', options.events, { child: range.child, detail: recorded.field });
          terminal = true;
          return haltedResult(options.worktree);
        }
        if (recorded.kind === 'consumed') {
          const ownership = await checkPathOwnership(range, parent, recorded.tip, git);
          if (ownership.kind === 'refused') {
            await abortJournal(options.worktree, journal, git, moves);
            await haltRestack(options.worktree, 'replay-mismatch', options.events, { child: range.child, detail: ownership.paths.join(', ') });
            terminal = true;
            return haltedResult(options.worktree);
          }
          const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'resolved', recorded.tip, recorded.rewrites, {
            git,
            consumedResolution: recorded.resolution,
          });
          if (updated.kind !== 'updated') throw new Error('restack journal changed while consuming resolution');
          journal = updated.journal;
          await options.events?.emit({ type: 'restack_resolution', opId: journal.journal.opId, child: range.child, action: 'consumed', tip: recorded.tip });
          exactRewrites.set(range.child, recorded.rewrites);
          consumedTipCorrespondences.set(range.child, {
            child: range.child,
            oldParent: range.oldParent,
            oldTip: range.oldTip,
            newParent: parent,
            tip: recorded.tip,
          });
          overlaps.set(range.child, await parentOverlapPaths(range, parent, git));
          parent = recorded.tip;
          continue;
        }
      }
      let replay;
      try {
        replay = await replayChildRange(range, parent, journal.journal.committer, git, {
          comparisonCommits: newStackCommits,
          appendOnlyRemUnion: options.routed !== undefined,
          haltRecordSlug: options.slug,
        });
      } catch (error) {
        if (error instanceof RemBlockBodyMismatchError) {
          await haltUnresolvedConflict(options.worktree, options.slug, journal, range, {
            commit: error.commit, paths: [error.path],
          }, options.events, git, parent, 'conflict', `remediation block body mismatch: ${error.remId}`, await commitsInRange(git, `${range.oldParent}..${range.oldTip}`, `child ${range.child} range`));
          terminal = true;
          return haltedResult(options.worktree);
        }
        const conflict = await replayConflict(git, options.slug, error);
        if (!conflict) throw error;
        const merge = await mergeInRange(git, range);
        if (merge) {
          if (!await pinStagingRef(options.worktree, options.slug, range.child, range.oldTip, { git })) {
            throw new Error(`cannot pin original tip for merge-bearing child ${range.child}`);
          }
          await abortJournal(options.worktree, journal, git, []);
          await haltRestack(options.worktree, 'flatten_refused', options.events, {
            child: range.child,
            detail: `merge ${merge}; resolve the conflict on child branch ${branchRefForRange(options.slug, range).slice('refs/heads/'.length)} and resume`,
          });
          terminal = true;
          return haltedResult(options.worktree);
        }
        const resolution = await resolveRestackConflict({
          worktree: options.worktree,
          range,
          newParent: parent,
          stamp: journal.journal.committer,
          comparisonCommits: newStackCommits,
          haltRecordSlug: options.slug,
          resolver: options.resolver ?? (async () => ({ resolved: false, reason: 'restack resolver unavailable' })),
          cap: options.resolverCap ?? resolveRebaseResolutionAttempts(),
          git,
        });
        if ((resolution.outcome.kind !== 'changed' && resolution.outcome.kind !== 'noop') || !resolution.tip) {
          const detail = 'reason' in resolution.outcome ? resolution.outcome.reason : undefined;
          await haltUnresolvedConflict(options.worktree, options.slug, journal, range, conflict, options.events, git, parent, 'conflict', detail, resolution.candidates);
          terminal = true;
          return haltedResult(options.worktree);
        }
        const ownership = await checkPathOwnership(range, parent, resolution.tip, git, { normaliseInheritedRemBlocks: options.routed !== undefined });
        if (ownership.kind === 'refused') {
          await haltUnresolvedConflict(options.worktree, options.slug, journal, range, { ...conflict, paths: ownership.paths }, options.events, git, parent, 'replay-mismatch');
          terminal = true;
          return haltedResult(options.worktree);
        }
        const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'resolved', resolution.tip, resolution.rewrites, { git });
        if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while resolving' : updated.detail);
        journal = updated.journal;
        exactRewrites.set(range.child, resolution.rewrites);
        overlaps.set(range.child, await parentOverlapPaths(range, parent, git));
        parent = resolution.tip;
        continue;
      }
      const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'replayed', replay.tip, replay.rewrites, { git });
      if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while replaying' : updated.detail);
      journal = updated.journal;
      exactRewrites.set(range.child, replay.rewrites);
      const ownership = await checkPathOwnership(range, parent, replay.tip, git, { normaliseInheritedRemBlocks: options.routed !== undefined });
      if (ownership.kind === 'refused') {
        await abortJournal(options.worktree, journal, git, moves);
        await haltRestack(options.worktree, 'replay-mismatch', options.events, {
          child: range.child,
          detail: ownership.paths.join(', '),
        });
        terminal = true;
        return haltedResult(options.worktree);
      }
      overlaps.set(range.child, await parentOverlapPaths(range, parent, git));
      parent = replay.tip;
      mergeAudit.flattenedMerges.push(...replay.audit.flattenedMerges);
      mergeAudit.ancestryOnlyMerges.push(...replay.audit.ancestryOnlyMerges);
      mergeAudit.sideLineageCount += replay.audit.sideLineageCount;
    }

    journal = await transitionState(options.worktree, journal, 'ready', git);
    const readyJournal = journal;
    moves = plan.ranges.flatMap((range) => {
      const branchRef = branchRefForRange(options.slug, range);
      const branchOld = readyJournal.journal.refs.find((entry) => entry.ref === branchRef)?.oldSha;
      if (!branchOld) throw new Error(`missing journaled branch ref for child ${range.child}`);
      const closureRef = ref(`refs/conductor/${options.slug}/closed/c${range.child}`);
      const closureOld = range.kind === 'closed'
        ? readyJournal.journal.refs.find((entry) => entry.ref === closureRef)?.oldSha
        : undefined;
      if (range.kind === 'closed' && !closureOld) throw new Error(`missing journaled closure ref for child ${range.child}`);
      return [
        { ref: branchRef, oldSha: branchOld, newSha: range.oldTip, child: range.child },
        ...(range.kind === 'closed' ? [{ ref: closureRef, oldSha: closureOld!, newSha: range.oldTip, child: range.child }] : []),
      ];
    });
    // Each staged ref is the source of truth for its move; resolve it after all
    // replays so the transaction never relies on an in-memory replay result.
    moves = await Promise.all(moves.map(async (move) => ({ ...move, newSha: await requiredSha(git, stagingRefFor(options.slug, move.child!), `staging ref for child ${move.child}`) })));
    const checkedOut = await checkedOutRef(git);
    const preMove = await checkRestackPreMove(options.worktree, moves, checkedOut, { git });
    if (preMove.kind === 'refused') {
      await abortJournal(options.worktree, journal, git, moves);
      await haltRestack(options.worktree, preMove.reason, options.events, { detail: preMove.detail });
      terminal = true;
      return haltedResult(options.worktree);
    }
    if (preMove.kind === 'seal-refused') {
      await abortJournal(options.worktree, journal, git, moves);
      await writeSealHalt(options.worktree, preMove.detail, options.events);
      terminal = true;
      return haltedResult(options.worktree);
    }
    if (preMove.kind === 'unavailable') throw new Error(preMove.detail);
    const moved = await applyRestackMove(options.worktree, journal, moves, { git, events: options.events });
    // applyRestackMove normally aborts before returning a refusal. Keep this
    // frame live, however, so the finally path repairs a failed abort rather
    // than leaving a ready journal owned by this still-running process.
    if (moved.kind === 'refused') return haltedResult(options.worktree);
    if (moved.kind === 'unavailable') throw new Error(moved.detail);
    journal = moved.journal;
    // An unentered leaf can point into its owner's own range. The durable
    // plan keeps it last for translation, while move verification needs the
    // ancestry order H′ -> owner's rewritten tip.
    const verificationRanges = plan.ranges.flatMap((range) => [
      ...plan.ranges.filter((candidate) => candidate.kind === 'leaf-unentered' && unenteredLeafOwners.get(candidate.child) === range.child),
      ...(range.kind === 'leaf-unentered' ? [] : [range]),
    ]);
    const verificationJournal = { ...journal, journal: { ...journal.journal, ranges: verificationRanges } };
    const verified = await verifyRestackMove(options.worktree, verificationJournal, moves, { git });
    if (verified.kind === 'failed') {
      const rolledBack = await rollbackRestackMove(options.worktree, journal, moves, { git });
      if (rolledBack.kind !== 'aborted') throw new Error(rolledBack.detail);
      await haltRestack(options.worktree, 'verification-failed', options.events, { detail: verified.detail });
      terminal = true;
      return haltedResult(options.worktree);
    }
    if (verified.kind === 'unavailable') throw new Error(verified.detail);

    const checkedOutMove = moves.find((move) => move.ref === checkedOut);
    if (!checkedOutMove) throw new Error('checked-out branch is not part of restack move');
    await syncRestackedWorktree(options.worktree, checkedOutMove.oldSha, checkedOutMove.newSha, { git });
    journal = await transitionState(options.worktree, journal, 'synced', git);

    const transition = await applyRestackTransition({
      worktree: options.worktree,
      cause: options.cause,
      opId: draft.opId,
      // The journaled range records the old side of a base refresh; a repair
      // keeps both sides at its unchanged default.
      oldDefault: options.cause === 'feature-repair' ? stackDefault : journal.journal.ranges[0]!.oldParent,
      newDefault: options.cause === 'feature-repair' ? stackDefault : journal.journal.newDefault ?? planningDefault,
      activeChild: active.child,
      ranges: plan.ranges,
      moves,
      git,
      rewritesByChild: exactRewrites,
      ...(options.events === undefined ? {} : { events: options.events }),
    });
    try {
      journal = await journalRoutedApplyPlan(options.worktree, journal, transition, git);
    } catch (error) {
      if (error instanceof RoutedApplyPlanRefChangedError) {
        await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail: error.ref });
        terminal = true;
        return haltedResult(options.worktree);
      }
      throw error;
    }
    const applied = await restackTransactionBuilder.appliedTransactionLines(options.worktree, journal, git);
    const appliedWrite = await runGit(git, ['update-ref', '--stdin'], transaction(applied.lines));
    if (appliedWrite.exitCode !== 0) {
      const changed = await changedRoutedAppliedRef(journal, git);
      if (changed !== undefined) {
        await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail: changed });
        terminal = true;
        return haltedResult(options.worktree);
      }
      throw new Error('cannot transition restack journal to applied');
    }
    journal = applied.journal;
    if (journal.journal.followOnCause === undefined) await cleanAppliedJournal(journal, git);
    for (const range of plan.ranges) {
      const move = moves.find((entry) => entry.child === range.child);
      if (!move) throw new Error(`missing move for child ${range.child}`);
      await options.events?.emit({
        type: 'restack_applied', opId: draft.opId, cause: draft.cause, child: range.child,
        oldTip: range.oldTip, newTip: move.newSha, wouldInvalidate: [...(transition.wouldInvalidate.get(range.child) ?? [])], parentOverlapPaths: overlaps.get(range.child) ?? [],
      });
    }
    if (mergeAudit.flattenedMerges.length > 0 || mergeAudit.ancestryOnlyMerges.length > 0 || mergeAudit.sideLineageCount > 0) {
      await options.events?.emit({ type: 'rebase_merge_audit', ...mergeAudit });
    }
    terminal = true;
    return { kind: 'applied', opId: draft.opId };
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (!terminal && journal !== undefined) await abortJournal(options.worktree, journal, git, moves);
  }
}
