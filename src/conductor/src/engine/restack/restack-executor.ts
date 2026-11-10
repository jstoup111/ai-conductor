import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHILD_REGION_STEPS, type ChildId } from '../child-context.js';
import { hasDurableChildState, resolveActiveChild, resolveSealedLeaf } from '../child-cursor.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { loadMergedConfigForRead } from '../config.js';
import { verifyProtectedArtifactSeal } from '../protected-artifact-seal.js';
import { makeGitRunner, type GitRunner, writeSealHalt } from '../rebase.js';
import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import {
  createRestackJournal,
  journalRefFor,
  readRestackJournal,
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
import { collectFoldSet, placeFoldCommits } from './fold-plan.js';
import type { FoldCommitPlan, FoldFrozenBlock, FoldPart, FoldRange, FoldSourceCommit } from './fold-types.js';
import { withDaemonCoAuthorTrailer } from '../bot-co-author.js';
import { adaptedPathsFor, checkPathOwnership, checkResolvedTipOwnership, parentOverlapPaths } from './restack-ownership.js';
import { replayChildRange, RemBlockBodyMismatchError, type CommitterStamp } from './restack-replay.js';
import { authorOf, messageOf } from './restack-commit-metadata.js';
import { haltRecordedRestackConflict, replayCandidateSubjects, resolveRestackConflict, type RestackResolver } from './restack-resolver.js';
import { conflictDeleteLines, conflictFlattenedTipRefFor, conflictParentRefFor, conflictRecordRefFor, consumeRecordedResolution, decisionDeleteLines, readConflictRecord, refusedTipRefFor, retireRecordedResolution } from './restack-conflict-record.js';
import { prepareRestackDecisionDelivery, restackDecisionDetailLines } from './restack-decision-delivery.js';
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
import { readRevalidationQueue, readRouteRecord, routedAppliedLines, routedRecordAfterExit, writeRoutingTransaction } from '../routing/route-record-store.js';
import { closureRefFor, repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../routing/routing-refs.js';
import { mergeQueueGeneration } from '../routing/revalidation-queue.js';
import { childRevalidatedEvent } from '../routing/routing-events.js';
import { parseRevalidationQueueRecord, parseRoundId, routingEligible, type RevalidationQueueRecord } from '../routing/route-types.js';
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
    const conflict = await readConflictRecord(worktree, journal.slug, { git });
    if (conflict.kind !== 'record' || conflict.blob !== journal.journal.consumedResolution.record) {
      throw new Error('cannot delete flattened tip for a changed conflict record');
    }
    const refused = await git(['rev-parse', '-q', '--verify', refusedTipRefFor(journal.slug)]);
    const refusedTip = refused.exitCode === 1 ? undefined : refused.exitCode === 0 ? parseCommitSha(refused.stdout.trim()) : undefined;
    if (refused.exitCode !== 0 && refused.exitCode !== 1 || refused.exitCode === 0 && !refusedTip) {
      throw new Error('cannot delete refused tip for a changed conflict record');
    }
    lines.push(...conflictDeleteLines(journal.slug, journal.journal.consumedResolution, refusedTip));
    if (conflict.record.flattenedTip !== undefined) {
      lines.push(`delete ${conflictFlattenedTipRefFor(journal.slug)} ${conflict.record.flattenedTip}`);
    }
  }
  if (journal.journal.deliveredDecision !== undefined) {
    const decision = journal.journal.deliveredDecision;
    lines.push(...decisionDeleteLines(journal.slug, {
      blob: decision.blob,
      decision: { child: decision.child },
    }));
    lines.push(`delete ${conflictRecordRefFor(journal.slug)} ${decision.record}`);
    lines.push(`delete ${conflictParentRefFor(journal.slug)} ${decision.parent}`);
    const conflict = await readConflictRecord(worktree, journal.slug, { git });
    if (conflict.kind !== 'record' || conflict.blob !== decision.record) {
      throw new Error('cannot delete flattened tip for a changed conflict record');
    }
    const refused = await git(['rev-parse', '-q', '--verify', refusedTipRefFor(journal.slug)]);
    const refusedTip = refused.exitCode === 1 ? undefined : refused.exitCode === 0 ? parseCommitSha(refused.stdout.trim()) : undefined;
    if (refused.exitCode !== 0 && refused.exitCode !== 1 || refused.exitCode === 0 && !refusedTip) {
      throw new Error('cannot delete refused tip for a changed conflict record');
    }
    if (refusedTip !== undefined) lines.push(`delete ${refusedTipRefFor(journal.slug)} ${refusedTip}`);
    if (conflict.record.flattenedTip !== undefined) {
      lines.push(`delete ${conflictFlattenedTipRefFor(journal.slug)} ${conflict.record.flattenedTip}`);
    }
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
    try {
      await transitionState(worktree, journal, 'aborted', git);
    } catch (error) {
      // A caller can have already committed the abort before a later durable
      // conflict-record write fails. The finally cleanup still holds the
      // pre-abort journal snapshot; treat that exact completed abort as
      // idempotent rather than replacing the operator-facing halt with a CAS
      // error from a second abort attempt.
      const current = await readRestackJournal(worktree, journal.slug, { git });
      if (current.kind !== 'journal' || current.journal.state !== 'aborted') throw error;
    }
  }
}

interface JournaledRestackLifecycle {
  journal?: StoredRestackJournal;
  moves: readonly RestackMoveRef[];
  terminal: boolean;
}

/**
 * Keep the live journal's terminal release in one owner. Both ordinary
 * restacks and folds stage different histories, but any non-terminal exit
 * must leave an aborted journal (and, after a move, the old refs) behind.
 */
async function runJournaledRestack<T>(
  worktree: string,
  git: GitRunner,
  run: (lifecycle: JournaledRestackLifecycle) => Promise<T>,
): Promise<T> {
  const lifecycle: JournaledRestackLifecycle = { moves: [], terminal: false };
  try {
    return await run(lifecycle);
  } finally {
    if (!lifecycle.terminal && lifecycle.journal !== undefined) {
      await abortJournal(worktree, lifecycle.journal, git, lifecycle.moves);
    }
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
  refusedTip?: CommitSha,
  refusedPaths: readonly { readonly path: string; readonly cause: string }[] = [],
): Promise<void> {
  // Keep the journaled original tip reachable for every conflict. Ownership
  // refusals additionally retain the resolver's attempted tip in the durable
  // conflict hand-off, while no feature branch has moved.
  if (!await pinStagingRef(worktree, slug, range.child, range.oldTip, { git })) {
    throw new Error(`cannot pin original tip for conflicted child ${range.child}`);
  }
  await abortJournal(worktree, journal, git, []);
  await events?.emit({ type: 'restack_conflict', opId: journal.journal.opId, child: range.child, commit: conflict.commit, paths: [...conflict.paths] });
  const refusedDetail = refusedTip === undefined ? undefined : [
    `refused tip: ${refusedTipRefFor(slug)}`,
    ...refusedPaths.map(({ path, cause }) => `${path} (${cause})`),
  ].join('\n');
  const detail = `commit ${conflict.commit}; paths: ${conflict.paths.join(', ')}${resolutionDetail === undefined ? '' : `\n${resolutionDetail}`}${refusedDetail === undefined ? '' : `\n${refusedDetail}`}`;
  if (refusedTip !== undefined) {
    await events?.emit(emitRestackRefused({
      reason: 'replay-mismatch', child: range.child,
      detail: refusedPaths.map(({ path, cause }) => `${path} (${cause})`).join(', '),
    }));
    await haltRecordedRestackConflict({
      worktree, slug, journal, range, replayParent: newParent,
      comparisonCommits: journal.journal.comparisonCommits, haltRecordSlug: slug,
      candidateSubjects: await replayCandidateSubjects(git, candidates),
      commit: conflict.commit, paths: conflict.paths, detail, refusedTip, events, git, writeHalt: haltRestackConflict,
    });
  } else if (reason === 'replay-mismatch') await haltRestack(worktree, 'replay-mismatch', events, { child: range.child, detail });
  else {
    await haltRecordedRestackConflict({
      worktree, slug, journal, range, replayParent: newParent,
      comparisonCommits: journal.journal.comparisonCommits, haltRecordSlug: slug,
      candidateSubjects: await replayCandidateSubjects(git, candidates),
      commit: conflict.commit, paths: conflict.paths, detail, events, git, writeHalt: haltRestackConflict,
    });
  }
}

function foldCommitEnvironment(author: Awaited<ReturnType<typeof authorOf>>, stamp: CommitterStamp): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: author.date,
    GIT_COMMITTER_NAME: stamp.name,
    GIT_COMMITTER_EMAIL: stamp.email,
    GIT_COMMITTER_DATE: stamp.date,
  };
}

async function writeFoldCommit(
  git: GitRunner,
  parent: CommitSha,
  source: FoldCommitPlan,
  parts: readonly FoldPart[],
  stamp: CommitterStamp,
  index: string,
): Promise<CommitSha> {
  const env = { GIT_INDEX_FILE: index };
  const seeded = await git(['read-tree', parent], { env });
  if (seeded.exitCode !== 0) throw new Error(`cannot seed fold index: ${seeded.stderr}`);
  let copiedWholePatch = false;
  for (const part of parts) {
    if (part.kind === 'whole') continue;
    if (part.kind === 'blocks') {
      // Frozen rem blocks are normally the entire source commit. Applying the
      // source patch keeps their deterministic append semantics and also
      // preserves an intentionally empty evidence commit below.
      if (copiedWholePatch) continue;
      const patch = await git(['show', '--format=', '--binary', '--no-ext-diff', source.sha]);
      if (patch.exitCode !== 0) throw new Error(`cannot read frozen fold source ${source.sha}`);
      const applied = await git(['apply', '--cached', '--binary', '--whitespace=nowarn'], { env, input: patch.stdout });
      if (applied.exitCode !== 0) throw new Error(`cannot apply frozen fold source ${source.sha}: ${applied.stderr}`);
      copiedWholePatch = true;
      continue;
    }
    const applied = await git(['apply', '--cached', '--binary', '--unidiff-zero', '--whitespace=nowarn'], { env, input: part.hunk.patch });
    if (applied.exitCode !== 0) throw new Error(`cannot apply fold hunk ${source.sha}:${part.path}: ${applied.stderr}`);
  }
  const tree = await git(['write-tree'], { env });
  const treeSha = tree.exitCode === 0 ? parseCommitSha(tree.stdout.trim()) : undefined;
  if (!treeSha) throw new Error(`cannot write fold tree for ${source.sha}`);
  const [author, message] = await Promise.all([authorOf(git, source.sha), messageOf(git, source.sha)]);
  const commit = await git(['commit-tree', treeSha, '-p', parent], {
    input: withDaemonCoAuthorTrailer(`${message.trimEnd()}\n\nFolded-from: ${source.sha}\n`),
    env: foldCommitEnvironment(author, stamp),
  });
  const tip = commit.exitCode === 0 ? parseCommitSha(commit.stdout.trim()) : undefined;
  if (!tip) throw new Error(`cannot write folded commit for ${source.sha}: ${commit.stderr}`);
  return tip;
}

async function replayLeafWithoutFoldSources(
  git: GitRunner,
  range: ChildRange,
  parent: CommitSha,
  omitted: ReadonlySet<CommitSha>,
  stamp: CommitterStamp,
): Promise<{ readonly tip: CommitSha; readonly rewrites: ReadonlyMap<CommitSha, CommitSha> }> {
  const listed = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (listed.exitCode !== 0) throw new Error(`cannot enumerate leaf fold range: ${listed.stderr}`);
  let tip = parent;
  const rewrites = new Map<CommitSha, CommitSha>();
  for (const raw of listed.stdout.split('\n').filter(Boolean)) {
    const commit = parseCommitSha(raw);
    if (!commit) throw new Error('cannot parse leaf fold commit');
    if (omitted.has(commit)) continue;
    const merged = await git(['merge-tree', '--write-tree', '--merge-base', `${commit}^1`, tip, commit]);
    const tree = merged.exitCode === 0 ? parseCommitSha(merged.stdout.trim().split('\n', 1)[0] ?? '') : undefined;
    if (!tree) throw new Error(`unresolved-restack-conflict folding leaf commit ${commit}`);
    const [author, message] = await Promise.all([authorOf(git, commit), messageOf(git, commit)]);
    const written = await git(['commit-tree', tree, '-p', tip], { input: withDaemonCoAuthorTrailer(message), env: foldCommitEnvironment(author, stamp) });
    const next = written.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
    if (!next) throw new Error(`cannot replay leaf commit ${commit}: ${written.stderr}`);
    rewrites.set(commit, next);
    tip = next;
  }
  return { tip, rewrites };
}

/** Read fold candidates at the routing boundary so the fold planner remains routing-free. */
async function deferredFoldRanges(
  worktree: string,
  slug: string,
  git: GitRunner,
): Promise<readonly FoldRange[] | undefined> {
  const prefix = `refs/conductor/${slug}/routes/`;
  const listed = await git(['for-each-ref', '--format=%(refname)', prefix]);
  if (listed.exitCode !== 0) return undefined;
  const ranges: FoldRange[] = [];
  for (const ref of listed.stdout.split('\n').filter(Boolean)) {
    const roundId = parseRoundId(ref.slice(prefix.length));
    if (roundId === undefined || ref !== `${prefix}${roundId}`) return undefined;
    const stored = await readRouteRecord(worktree, slug, roundId, { git });
    if (stored.kind !== 'record') return undefined;
    for (const [rawHost, placement] of Object.entries(stored.record.placements ?? {})) {
      if (placement.state !== 'deferred') continue;
      const host = Number(rawHost) as ChildId;
      const closure = await git(['rev-parse', '-q', '--verify', closureRefFor(slug, host)]);
      if (closure.exitCode !== 0 && closure.exitCode !== 1) return undefined;
      if (closure.exitCode === 1) continue;
      ranges.push({
        host, roundId,
        findingIds: stored.record.items.filter((item) => item.host === host).map((item) => item.findingId),
        leafEntryTip: placement.leafEntryTip,
        ...(placement.exitTip === undefined ? {} : { exitTip: placement.exitTip }),
      });
    }
  }
  return ranges;
}

async function foldFrozenBlocks(
  worktree: string,
  slug: string,
  source: FoldSourceCommit,
  git: GitRunner,
): Promise<readonly FoldFrozenBlock[] | undefined> {
  const stored = await readRouteRecord(worktree, slug, source.roundId, { git });
  if (stored.kind !== 'record') return undefined;
  const allocation = stored.record.allocation[source.owner];
  if (allocation === undefined || allocation.remTaskIds.length === 0) return undefined;
  return allocation.blockBodies.map((body, index) => ({ id: allocation.remTaskIds[index]!, body }));
}

/**
 * Fold deferred leaf ranges back onto their owners.  The normal restacker is
 * intentionally range-centric; folding adds a source-to-placement plan first,
 * then rebuilds the stack once so the leaf tree is unchanged while the source
 * commits disappear from its history.
 */
async function runFoldRestack(options: RunRestackOptions, git: GitRunner): Promise<RunRestackResult> {
  const ranges = await deferredFoldRanges(options.worktree, options.slug, git);
  if (ranges === undefined) return { kind: 'unavailable', detail: 'cannot collect deferred fold ranges' };
  const collected = await collectFoldSet({ ranges, slug: options.slug, git });
  if (collected.kind === 'unavailable') return { kind: 'unavailable', detail: 'cannot collect deferred fold ranges' };
  if (collected.kind === 'refused') {
    await haltRestack(options.worktree, 'fold-owner-invalid', options.events, { child: collected.host, detail: `fold owner invalid for ${collected.commit}` });
    return haltedResult(options.worktree);
  }
  if (collected.commits.length === 0) return { kind: 'applied', opId: randomUUID() as RestackOpId };
  const folded = await placeFoldCommits({
    worktree: options.worktree, slug: options.slug, commits: collected.commits, ranges, git,
    frozenBlocksFor: (source) => foldFrozenBlocks(options.worktree, options.slug, source, git),
  });
  if (folded.kind === 'refused') {
    const detail = folded.reason === 'fold-misrouted'
      ? `fold-misrouted host c${folded.host}; findings ${folded.findingIds.join(', ') || '(none)'}; accepting children ${folded.acceptingChildren.map((child) => `c${child}`).join(', ') || '(none)'}`
      : `${folded.reason}: ${folded.commit}; ${folded.paths.join(', ')}`;
    await haltRestack(options.worktree, 'fold-misrouted', options.events, {
      ...(folded.reason === 'fold-misrouted' ? { child: folded.host } : {}), detail,
    });
    return haltedResult(options.worktree);
  }
  for (const source of folded.commits) {
    if (!source.parts.some((part) => part.child === source.owner)) {
      await haltRestack(options.worktree, 'fold-misrouted', options.events, { child: source.owner, detail: `fold source ${source.sha} has no part on owner c${source.owner}` });
      return haltedResult(options.worktree);
    }
    if (source.parts.some((part) => part.child === 'leaf')) {
      await haltRestack(options.worktree, 'fold-misrouted', options.events, { child: source.owner, detail: `fold source ${source.sha} can only be placed on leaf` });
      return haltedResult(options.worktree);
    }
  }
  const foldTargets = [...new Set(folded.commits.flatMap((source) => source.parts
    .flatMap((part) => part.child === 'leaf' ? [] : [part.child])))].sort((left, right) => Number(left) - Number(right));
  const allowance = await resolveCascadeAllowanceForWorktree(options.worktree);
  const cap = await checkCascadeCap(options.worktree, options.slug, foldTargets, allowance.limit, { git });
  if (cap.kind === 'exhausted') {
    await haltRestack(options.worktree, 'cascade-cap', options.events, {
      child: cap.child,
      detail: cap.detail ?? `fold target child ${cap.child} reached ${cap.count}/${cap.limit} cascades — ${formatCascadeAllowance(allowance)}`,
    });
    return haltedResult(options.worktree);
  }

  const active = await activeFor(options.worktree, options.slug, git);
  if ('divergent' in active) return { kind: 'unavailable', detail: `cannot fold divergent child ${active.divergent.child}` };
  const base = await defaultTip(git);
  const planned = await planRestackRanges(options.worktree, { slug: options.slug, oldDefaultTip: base, cause: 'base-refresh', active }, { git });
  if (planned.kind !== 'planned') return planned.kind === 'repair-pending'
    ? { kind: 'repair-pending', child: planned.child }
    : { kind: 'unavailable', detail: planned.kind === 'unavailable' ? planned.detail : `cannot fold ${planned.kind}` };
  const leafRange = planned.ranges.find((range) => range.kind === 'leaf-active');
  if (!leafRange) return { kind: 'unavailable', detail: 'fold requires the leaf to be the active stack branch' };

  const draft: RestackJournalDraft = {
    opId: randomUUID() as RestackOpId,
    cause: 'fold',
    committer: await committerStamp(git),
    ...(await queueTrackingAtCreation(options.worktree, options.slug, git) ?? {}),
    foldPlan: folded.commits,
    dirtyPaths: [],
    refs: await journalRefs(git, options.slug, planned.ranges),
    ranges: planned.ranges,
    children: planned.ranges.map((range) => ({ child: range.child, status: 'pending' as const, rewrites: [] })),
  };
  const created = await createRestackJournal(options.worktree, options.slug, draft, options.events, { git });
  if (created.kind === 'refused') return { kind: 'refused', reason: created.reason };
  if (created.kind === 'unavailable') return { kind: 'unavailable', detail: created.detail };
  return runJournaledRestack(options.worktree, git, async (lifecycle) => {
    let journal = created.journal;
    let moves: RestackMoveRef[] = [];
    let terminal = false;
    try {
      const foldRounds = [...new Set(folded.commits.map((source) => source.roundId))];
      await options.events?.emit({
        type: 'restack_planned', opId: draft.opId, cause: 'fold', children: planned.ranges.map((range) => range.child),
        ...(foldRounds.length === 1 ? { roundId: foldRounds[0]! } : {}),
      });
      await options.events?.emit({
        type: 'fold_planned', opId: draft.opId,
        commits: folded.commits.map((source) => ({
          sha: source.sha, roundId: source.roundId, owner: source.owner,
          placements: source.parts.flatMap((part) => part.child === 'leaf' ? [] : [{
            child: part.child, paths: part.kind === 'hunks' ? [part.path] : [], reason: part.reason,
          }]),
        })),
      });

  const byChild = new Map<ChildId, Array<{ source: FoldCommitPlan; parts: FoldPart[] }>>();
  for (const source of folded.commits) for (const part of source.parts) {
    if (part.child === 'leaf') continue;
    const entries = byChild.get(part.child) ?? [];
    const last = entries.at(-1);
    if (last?.source.sha === source.sha) last.parts.push(part);
    else entries.push({ source, parts: [part] });
    byChild.set(part.child, entries);
  }
  const directory = await mkdtemp(join(tmpdir(), 'restack-fold-index-'));
  const omitted = new Set(folded.commits.map((commit) => commit.sha));
  const staged = new Map<ChildId, CommitSha>();
  try {
    let parent = base;
    for (const range of planned.ranges) {
      let replay;
      try {
        if (range.kind === 'leaf-active') replay = await replayLeafWithoutFoldSources(git, range, parent, omitted, draft.committer);
        else replay = await replayChildRange(range, parent, draft.committer, git, { haltRecordSlug: options.slug });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (detail.startsWith('unresolved-restack-conflict')) {
          await abortJournal(options.worktree, journal, git, []);
          await haltRestackConflict(options.worktree, range.child, detail, options.events);
          return haltedResult(options.worktree);
        }
        throw error;
      }
      let tip = replay.tip;
      try {
        for (const entry of byChild.get(range.child) ?? []) {
          tip = await writeFoldCommit(git, tip, entry.source, entry.parts, draft.committer, join(directory, `c${range.child}-${entry.source.sha}.index`));
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (detail.startsWith('cannot apply fold hunk') || detail.startsWith('cannot apply frozen fold source')) {
          await abortJournal(options.worktree, journal, git, []);
          await haltRestackConflict(options.worktree, range.child, `unresolved-restack-conflict ${detail}`, options.events);
          return haltedResult(options.worktree);
        }
        throw error;
      }
      const rewrites = new Map(replay.rewrites);
      const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'replayed', tip, rewrites, { git });
      if (updated.kind !== 'updated') return { kind: 'unavailable', detail: `cannot stage fold child ${range.child}: ${updated.kind}` };
      journal = updated.journal;
      staged.set(range.child, tip);
      parent = tip;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const leafTip = staged.get(leafRange.child);
  const oldTree = await git(['rev-parse', `${leafRange.oldTip}^{tree}`]);
  const newTree = leafTip === undefined ? undefined : await git(['rev-parse', `${leafTip}^{tree}`]);
  if (oldTree.exitCode !== 0 || newTree?.exitCode !== 0 || oldTree.stdout.trim() !== newTree.stdout.trim()) {
    const changed = leafTip === undefined ? undefined : await git(['diff', '--name-only', leafRange.oldTip, leafTip]);
    const paths = changed?.exitCode === 0 ? changed.stdout.split('\n').filter(Boolean) : [];
    const touchedBy = new Set<CommitSha>();
    for (const source of folded.commits) {
      const sourceChanged = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', source.sha]);
      const sourcePaths = sourceChanged.exitCode === 0 ? sourceChanged.stdout.split('\n').filter(Boolean) : [];
      if (sourcePaths.some((path) => paths.includes(path))) touchedBy.add(source.sha);
    }
    await haltRestack(options.worktree, 'fold-tree-mismatch', options.events, {
      detail: `leaf tree changed at ${paths.join(', ') || '(unknown path)'}; folded source ${[...touchedBy].join(', ') || folded.commits.map((commit) => commit.sha).join(', ')}`,
    });
    return haltedResult(options.worktree);
  }
  journal = await transitionState(options.worktree, journal, 'ready', git);
  moves = planned.ranges.flatMap((range) => {
    const branch = branchRefForRange(options.slug, range);
    const old = journal.journal.refs.find((entry) => entry.ref === branch)?.oldSha;
    const next = staged.get(range.child);
    if (!old || !next) throw new Error(`missing fold move for child ${range.child}`);
    const closure = ref(`refs/conductor/${options.slug}/closed/c${range.child}`);
    const closureOld = range.kind === 'closed' ? journal.journal.refs.find((entry) => entry.ref === closure)?.oldSha : undefined;
    return [{ ref: branch, oldSha: old, newSha: next, child: range.child }, ...(range.kind === 'closed' && closureOld ? [{ ref: closure, oldSha: closureOld, newSha: next, child: range.child }] : [])];
  });
  const checkedOut = await checkedOutRef(git);
  const preMove = await checkRestackPreMove(options.worktree, moves, checkedOut, { git });
  if (preMove.kind === 'refused') {
    await haltRestack(options.worktree, preMove.reason, options.events, { detail: preMove.detail });
    return haltedResult(options.worktree);
  }
  if (preMove.kind === 'seal-refused') {
    await writeSealHalt(options.worktree, preMove.detail, options.events);
    return haltedResult(options.worktree);
  }
  if (preMove.kind === 'unavailable') throw new Error(preMove.detail);
  // Prepare every route replacement while its old blob is still the CAS value
  // carried into the fold's applied transaction.  These writes are authority
  // state and must not be left for a second transaction after journal cleanup.
  const foldedHosts = new Map<import('../routing/route-types.js').RoundId, Set<ChildId>>();
  for (const source of folded.commits) {
    const hosts = foldedHosts.get(source.roundId) ?? new Set<ChildId>();
    hosts.add(source.owner);
    foldedHosts.set(source.roundId, hosts);
  }
  const leafHead = staged.get(leafRange.child)!;
  const foldRoutes: Array<{ readonly roundId: import('../routing/route-types.js').RoundId; readonly old: CommitSha; readonly next: CommitSha }> = [];
  for (const [roundId, hosts] of foldedHosts) {
    const stored = await readRouteRecord(options.worktree, options.slug, roundId, { git });
    if (stored.kind !== 'record') return { kind: 'unavailable', detail: `cannot prepare fold route ${roundId}` };
    const placements = { ...(stored.record.placements ?? {}) };
    for (const host of hosts) {
      const placement = placements[host];
      if (placement !== undefined) placements[host] = { ...placement, state: 'placed' };
    }
    const written = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({
      ...stored.record, placements, leafReturn: { branch: leafBranchFor(options.slug), head: leafHead },
    }) });
    const next = written.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
    if (!next) return { kind: 'unavailable', detail: `cannot prepare fold route ${roundId}` };
    foldRoutes.push({ roundId, old: stored.blob, next });
  }
  const moved = await applyRestackMove(options.worktree, journal, moves, { git, events: options.events });
  if (moved.kind !== 'moved') return { kind: 'unavailable', detail: moved.kind === 'unavailable' ? moved.detail : moved.detail };
  journal = moved.journal;
  const verified = await verifyRestackMove(options.worktree, journal, moves, { git });
  if (verified.kind === 'failed') {
    const rolledBack = await rollbackRestackMove(options.worktree, journal, moves, { git });
    if (rolledBack.kind !== 'aborted') throw new Error(rolledBack.detail);
    await haltRestack(options.worktree, 'verification-failed', options.events, { detail: verified.detail });
    terminal = true;
    return haltedResult(options.worktree);
  }
  if (verified.kind === 'unavailable') throw new Error(verified.detail);
  const checked = moves.find((move) => move.ref === checkedOut);
  if (!checked) return { kind: 'unavailable', detail: 'checked-out leaf was not moved by fold' };
  await syncRestackedWorktree(options.worktree, checked.oldSha, checked.newSha, { git });
  journal = await transitionState(options.worktree, journal, 'synced', git);
  // The fold's branch moves are already verified.  Its route placement state
  // and terminal journal transition now commit together, guarded by the route
  // blobs observed before any ref moved.
  // Every non-leaf range rebuilt by a fold must be revalidated before the
  // stack can publish.  Record the generation in the journal before the
  // applied transaction so crash recovery has one durable authority for the
  // queue CAS as well as the route replacements.
  if (journal.journal.queueTracked === true) {
    const queueBefore = await queueRecordAtJournalStart(journal, git);
    const entries = planned.ranges
      .filter((range) => range.kind !== 'leaf-active' && range.kind !== 'leaf-unentered')
      .flatMap((range, index) => {
        const move = moves.find((candidate) => candidate.child === range.child && candidate.ref.startsWith('refs/heads/'));
        if (move === undefined || move.oldSha === move.newSha) return [];
        const prior = planned.ranges[index - 1];
        return [{
          child: range.child,
          position: range.child,
          closureSha: move.newSha,
          gates: [...CHILD_REGION_STEPS],
          replay: { oldParent: range.oldParent, newParent: prior === undefined ? base : staged.get(prior.child) ?? base },
          state: 'queued' as const,
        }];
      });
    const nextQueue = mergeQueueGeneration(queueBefore, entries);
    const queueBlob = await runGit(git, ['hash-object', '-w', '--stdin'], JSON.stringify(nextQueue));
    const queueNew = queueBlob.exitCode === 0 ? parseCommitSha(queueBlob.stdout.trim()) : undefined;
    if (queueNew === undefined) return { kind: 'unavailable', detail: 'cannot write fold revalidation queue' };
    const recorded = await recordRoutedApplyPlan(options.worktree, journal, {
      queueNew,
      invalidation: entries.map(({ child, gates }) => ({ child, gates })),
      queueInvalidation: entries,
    }, { git });
    if (recorded.kind !== 'updated') return { kind: 'unavailable', detail: 'cannot journal fold revalidation queue' };
    journal = recorded.journal;
  }
  const applied = { ...journal.journal, state: 'applied' as const };
  const appliedBlob = await writeRestackJournalBlob(options.worktree, applied, { git });
  const cascade = await cascadeUpdateLines(options.worktree, options.slug, foldTargets, { git });
  if (cascade.kind !== 'lines') return { kind: 'unavailable', detail: cascade.detail };
  const appliedLines = [
    ...foldRoutes.map((route) => `update ${routeRecordRefFor(options.slug, route.roundId)} ${route.next} ${route.old}`),
    ...cascade.lines,
    ...(journal.journal.queueTracked !== true || journal.journal.queueNew === undefined
      ? []
      : journal.journal.queueOld === undefined
        ? [`create ${revalidationQueueRefFor(options.slug)} ${journal.journal.queueNew}`]
        : [`update ${revalidationQueueRefFor(options.slug)} ${journal.journal.queueNew} ${journal.journal.queueOld}`]),
    ...journalStateUpdateLines(journal, appliedBlob, 'applied'),
  ];
  const appliedWrite = await writeRoutingTransaction(options.worktree, options.slug, [{
    kind: 'restack-applied', ownerOpId: journal.journal.opId, lines: appliedLines,
  }], { git });
  if (appliedWrite.kind !== 'updated') {
    await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail: 'fold route record changed during applied transaction' });
    return haltedResult(options.worktree);
  }
  journal = { slug: journal.slug, blob: appliedBlob, journal: applied };
  await cleanAppliedJournal(journal, git);
  for (const range of planned.ranges) {
    const move = moves.find((entry) => entry.child === range.child && entry.ref.startsWith('refs/heads/'))!;
    await options.events?.emit({ type: 'restack_applied', opId: draft.opId, cause: 'fold', child: range.child, oldTip: range.oldTip, newTip: move.newSha, wouldInvalidate: [], parentOverlapPaths: [], adaptedPaths: [] });
  }
  terminal = true;
  return { kind: 'applied', opId: draft.opId };
    } catch (error) {
      return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
    } finally {
      lifecycle.journal = journal;
      lifecycle.moves = moves;
      lifecycle.terminal = terminal;
    }
  });
}

/**
 * Replay the existing stack off-worktree, then apply every branch and closure
 * ref in a single transaction. Follow-on handling and transition semantics are
 * deliberately left to their owning later tasks.
 */
export async function runRestack(options: RunRestackOptions): Promise<RunRestackResult> {
  const git = options.git ?? makeGitRunner(options.worktree);
  if (options.cause === 'fold') return runFoldRestack(options, git);
  return runJournaledRestack(
    options.worktree,
    git,
    async (lifecycle) => runOrdinaryRestack(options, git, lifecycle),
  );
}

async function runOrdinaryRestack(
  options: RunRestackOptions,
  git: GitRunner,
  lifecycle: JournaledRestackLifecycle,
): Promise<RunRestackResult> {
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
    await options.events?.emit({
      type: 'restack_planned', opId: draft.opId, cause: draft.cause, children: plan.ranges.map((range) => range.child),
      ...(options.routed === undefined ? {} : { roundId: options.routed.roundId }),
    });

    const newStackCommits = comparison;
    const mergeAudit = { flattenedMerges: [] as string[], ancestryOnlyMerges: [] as string[], sideLineageCount: 0 };
    const overlaps = new Map<number, string[]>();
    const replayParents = new Map<ChildId, CommitSha>();
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
      replayParents.set(range.child, parent);
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
      {
        const recorded = await consumeRecordedResolution({
          slug: options.slug, range, parent, committer: journal.journal.committer, git,
          replay: (replayRange, replayParent, replayCommitter, replayGit) => replayChildRange(
            replayRange, replayParent, replayCommitter, replayGit, {
              comparisonCommits: [],
              haltRecordSlug: options.slug,
            },
          ),
        });
        if (recorded.kind === 'stale') {
          // An answer can outlive either its conflict record (an orphan) or
          // the exact history it described.  Orphans are harmless once their
          // ref is retired and must continue through the ordinary replay;
          // history drift becomes a new, operator-actionable conflict.
          if (recorded.field !== 'record') await abortJournal(options.worktree, journal, git, moves);
          // Keep the matching record while retiring a stale answer. The
          // replacement record is the later atomic write; preserving the old
          // one lets a failure there leave an ordinary replay path rather
          // than turning the retirement transaction into an unavailable run.
          const retired = await retireRecordedResolution(options.worktree, options.slug, range.child, {
            git,
            preserveConflictRecord: recorded.field !== 'record',
          });
          if (retired.kind !== 'retired') throw new Error(`cannot retire stale restack resolution: ${retired.kind}`);
          await options.events?.emit({ type: 'restack_resolution', opId: journal.journal.opId, child: range.child, action: 'retired', tip: retired.tip });
          if (recorded.field !== 'record') {
            if (!retired.record) throw new Error('stale restack resolution lost its matching conflict record');
            await options.events?.emit(emitRestackRefused({ reason: 'restack-resolution-stale', child: range.child, detail: recorded.field }));
            await haltRecordedRestackConflict({
              worktree: options.worktree, slug: options.slug, journal, range, replayParent: parent,
              comparisonCommits: journal.journal.comparisonCommits, haltRecordSlug: options.slug,
              candidateSubjects: await replayCandidateSubjects(git, await commitsInRange(git, `${range.oldParent}..${range.oldTip}`, `child ${range.child} range`)),
              commit: retired.record.commit, paths: retired.record.paths,
              detail: `restack-resolution-stale\n${recorded.field}`,
              events: options.events, git, writeHalt: haltRestackConflict,
            });
            terminal = true;
            return haltedResult(options.worktree);
          }
        }
        if (recorded.kind === 'consumed') {
          const ownership = await checkResolvedTipOwnership(range, parent, recorded.tip, git, {
            normaliseInheritedRemBlocks: options.routed !== undefined,
          });
          if (ownership.kind === 'refused') {
            await abortJournal(options.worktree, journal, git, moves);
            await haltRestack(options.worktree, 'replay-mismatch', options.events, {
              child: range.child,
              detail: ownership.paths.map(({ path, cause }) => `${path} (${cause})`).join(', '),
            });
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
        const decisionDelivery = await prepareRestackDecisionDelivery({
          worktree: options.worktree, slug: options.slug, range, opId: journal.journal.opId, git, events: options.events,
        });
        if (decisionDelivery === undefined) {
          throw new Error('cannot record delivered decision conflict state');
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
          restack: { opId: journal.journal.opId, cause: options.cause, ...(options.routed === undefined ? {} : { roundId: options.routed.roundId }) },
          ...(decisionDelivery.operatorDecision === undefined ? {} : { operatorDecision: decisionDelivery.operatorDecision }),
          git,
        });
        if ((resolution.outcome.kind !== 'changed' && resolution.outcome.kind !== 'noop') || !resolution.tip) {
          const detail = [
            ...restackDecisionDetailLines(decisionDelivery),
            ...('reason' in resolution.outcome ? [resolution.outcome.reason] : []),
          ].join('\n') || undefined;
          await haltUnresolvedConflict(options.worktree, options.slug, journal, range, conflict, options.events, git, parent, 'conflict', detail, resolution.candidates);
          terminal = true;
          return haltedResult(options.worktree);
        }
        const ownership = await checkResolvedTipOwnership(range, parent, resolution.tip, git, { normaliseInheritedRemBlocks: options.routed !== undefined });
        if (ownership.kind === 'refused') {
          await haltUnresolvedConflict(
            options.worktree, options.slug, journal, range, { ...conflict, paths: ownership.paths.map(({ path }) => path) },
            options.events, git, parent, 'replay-mismatch', undefined, resolution.candidates, resolution.tip, ownership.paths,
          );
          terminal = true;
          return haltedResult(options.worktree);
        }
        const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'resolved', resolution.tip, resolution.rewrites, {
          git,
          ...(decisionDelivery.deliveredDecision === undefined ? {} : { deliveredDecision: decisionDelivery.deliveredDecision }),
        });
        if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while resolving' : updated.detail);
        journal = updated.journal;
        exactRewrites.set(range.child, resolution.rewrites);
        overlaps.set(range.child, await parentOverlapPaths(range, parent, git));
        parent = resolution.tip;
        if (resolution.audit !== undefined) {
          mergeAudit.flattenedMerges.push(...resolution.audit.flattenedMerges);
          mergeAudit.ancestryOnlyMerges.push(...resolution.audit.ancestryOnlyMerges);
          mergeAudit.sideLineageCount += resolution.audit.sideLineageCount;
        }
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
    const appliedWrite = await writeRoutingTransaction(options.worktree, options.slug, [{
      kind: 'restack-applied', ownerOpId: journal.journal.opId, lines: applied.lines,
    }], { git });
    if (appliedWrite.kind !== 'updated') {
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
      const newParent = replayParents.get(range.child);
      if (!newParent) throw new Error(`missing replay parent for child ${range.child}`);
      await options.events?.emit({
        type: 'restack_applied', opId: draft.opId, cause: draft.cause, child: range.child,
        oldTip: range.oldTip, newTip: move.newSha, wouldInvalidate: [...(transition.wouldInvalidate.get(range.child) ?? [])], parentOverlapPaths: overlaps.get(range.child) ?? [],
        adaptedPaths: await adaptedPathsFor(range, newParent, move.newSha, git),
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
    lifecycle.journal = journal;
    lifecycle.moves = moves;
    lifecycle.terminal = terminal;
  }
}
