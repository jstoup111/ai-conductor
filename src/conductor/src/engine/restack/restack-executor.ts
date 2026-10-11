import { randomUUID } from 'node:crypto';

import { parseChildId, type ChildId } from '../child-context.js';
import { childBranchFor, leafBranchFor, parseFeatureBranch } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner, writeSealHalt } from '../rebase.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import {
  createRestackJournal,
  journalRefFor,
  stagingRefFor,
  updateRestackChildStatus,
  writeRestackJournalBlob,
  type RestackJournalDraft,
  type StoredRestackJournal,
} from './restack-journal.js';
import {
  applyRestackMove,
  checkRestackPreMove,
  haltRestack,
  rollbackRestackMove,
  verifyRestackMove,
  type RestackMoveRef,
} from './restack-move.js';
import { planRestackRanges } from './restack-plan.js';
import { replayChildRange, type CommitterStamp } from './restack-replay.js';
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
  readonly originatingChildren?: readonly ChildId[];
  /** The already-resolved default-branch tip for a base refresh. */
  readonly newDefault?: string;
  readonly events?: ConductorEventEmitter;
  readonly git?: GitRunner;
}

export type RunRestackResult =
  | { readonly kind: 'applied'; readonly opId: RestackOpId }
  | { readonly kind: 'halted' }
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

async function requiredSha(git: GitRunner, revision: string, context: string): Promise<CommitSha> {
  const result = await runGit(git, ['rev-parse', '--verify', revision]);
  const value = result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
  if (!value) throw new Error(`cannot resolve ${context}`);
  return value;
}

async function defaultTip(git: GitRunner, supplied?: string): Promise<CommitSha> {
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

async function activeFor(_worktree: string, slug: string, git: GitRunner): Promise<{ child: ChildId; branchRef: RefName; isLeaf: boolean }> {
  const head = await checkedOutRef(git);
  const identity = parseFeatureBranch(head.slice('refs/heads/'.length));
  if (identity.kind === 'child' && identity.slug === slug) {
    return { child: identity.child, branchRef: head, isLeaf: false };
  }
  if (identity.kind !== 'leaf' || identity.slug !== slug) throw new Error('restack requires this feature\'s checked-out branch');
  const closed = await runGit(git, ['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/closed/`]);
  if (closed.exitCode !== 0) throw new Error('cannot inspect closed child refs');
  const ids = closed.stdout.split('\n').flatMap((entry) => {
    const matched = new RegExp(`^refs/conductor/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/closed/c([1-9])$`).exec(entry.trim());
    return matched ? [Number(matched[1])] : [];
  });
  const child = parseChildId(Math.max(0, ...ids) + 1);
  if (!child) throw new Error('cannot determine active leaf child');
  return { child, branchRef: head, isLeaf: true };
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
    if (range.kind === 'closed') refs.push({ ref: ref(`refs/conductor/${slug}/closed/c${range.child}`), oldSha: range.oldTip });
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
  const updated = await runGit(git, ['update-ref', journalRefFor(journal.slug), blob, journal.blob]);
  if (updated.exitCode !== 0) throw new Error(`cannot transition restack journal to ${state}`);
  return { slug: journal.slug, blob, journal: next };
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
    const [newDefault, active] = await Promise.all([
      defaultTip(git, options.newDefault),
      activeFor(options.worktree, options.slug, git),
    ]);
    const plan = await planRestackRanges(options.worktree, {
      slug: options.slug,
      oldDefaultTip: newDefault,
      cause: options.cause,
      active,
      ...(active.isLeaf ? {} : {
        unenteredLeaf: { child: parseChildId(active.child + 1)!, branchRef: ref(`refs/heads/${leafBranchFor(options.slug)}`) },
      }),
    }, { git });
    if (plan.kind === 'refused') {
      await haltRestack(options.worktree, plan.reason, options.events, { child: plan.child });
      terminal = true;
      return { kind: 'halted' };
    }
    if (plan.kind === 'repair-pending') {
      terminal = true;
      return { kind: 'repair-pending', child: plan.child };
    }
    if (plan.kind === 'unavailable') throw new Error(plan.detail);

    const draft: RestackJournalDraft = {
      opId: randomUUID() as RestackOpId,
      cause: options.cause,
      committer: await committerStamp(git),
      dirtyPaths: [],
      refs: await journalRefs(git, options.slug, plan.ranges),
      ranges: plan.ranges,
      children: plan.ranges.map((range) => ({ child: range.child, status: 'pending' as const })),
    };
    const created = await createRestackJournal(options.worktree, options.slug, draft, options.events, { git });
    if (created.kind === 'refused') {
      terminal = true;
      await haltRestack(options.worktree, created.reason, options.events);
      return { kind: 'halted' };
    }
    if (created.kind === 'unavailable') throw new Error(created.detail);
    journal = created.journal;
    await options.events?.emit({ type: 'restack_planned', opId: draft.opId, cause: draft.cause, children: plan.ranges.map((range) => range.child) });

    let parent = newDefault;
    for (const range of plan.ranges) {
      const replay = await replayChildRange(range, parent, journal.journal.committer, git);
      const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'replayed', replay.tip, { git });
      if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while replaying' : updated.detail);
      journal = updated.journal;
      parent = replay.tip;
    }

    journal = await transitionState(options.worktree, journal, 'ready', git);
    const readyJournal = journal;
    moves = plan.ranges.flatMap((range) => {
      const branchRef = branchRefForRange(options.slug, range);
      const branchOld = readyJournal.journal.refs.find((entry) => entry.ref === branchRef)?.oldSha;
      if (!branchOld) throw new Error(`missing journaled branch ref for child ${range.child}`);
      return [
        { ref: branchRef, oldSha: branchOld, newSha: range.oldTip, child: range.child },
        ...(range.kind === 'closed' ? [{ ref: ref(`refs/conductor/${options.slug}/closed/c${range.child}`), oldSha: range.oldTip, newSha: range.oldTip, child: range.child }] : []),
      ];
    });
    // Each staged ref is the source of truth for its move; resolve it after all
    // replays so the transaction never relies on an in-memory replay result.
    moves = await Promise.all(moves.map(async (move) => ({ ...move, newSha: await requiredSha(git, stagingRefFor(options.slug, move.child!), `staging ref for child ${move.child}`) })));
    const checkedOut = await checkedOutRef(git);
    const preMove = await checkRestackPreMove(options.worktree, moves, checkedOut, { git });
    if (preMove.kind === 'refused') {
      await haltRestack(options.worktree, preMove.reason, options.events, { detail: preMove.detail });
      return { kind: 'halted' };
    }
    if (preMove.kind === 'seal-refused') {
      await writeSealHalt(options.worktree, preMove.detail, options.events);
      return { kind: 'halted' };
    }
    if (preMove.kind === 'unavailable') throw new Error(preMove.detail);
    const moved = await applyRestackMove(options.worktree, journal, moves, { git, events: options.events });
    // applyRestackMove normally aborts before returning a refusal. Keep this
    // frame live, however, so the finally path repairs a failed abort rather
    // than leaving a ready journal owned by this still-running process.
    if (moved.kind === 'refused') return { kind: 'halted' };
    if (moved.kind === 'unavailable') throw new Error(moved.detail);
    journal = moved.journal;
    const verified = await verifyRestackMove(options.worktree, journal, moves, { git });
    if (verified.kind === 'failed') {
      const rolledBack = await rollbackRestackMove(options.worktree, journal, moves, { git });
      if (rolledBack.kind !== 'aborted') throw new Error(rolledBack.detail);
      await haltRestack(options.worktree, 'verification-failed', options.events, { detail: verified.detail });
      terminal = true;
      return { kind: 'halted' };
    }
    if (verified.kind === 'unavailable') throw new Error(verified.detail);

    const checkedOutMove = moves.find((move) => move.ref === checkedOut);
    if (!checkedOutMove) throw new Error('checked-out branch is not part of restack move');
    const synced = await runGit(git, ['read-tree', '-m', '-u', checkedOutMove.oldSha, checkedOutMove.newSha]);
    if (synced.exitCode !== 0) throw new Error(`cannot synchronize restacked worktree: ${synced.stderr}`);
    journal = await transitionState(options.worktree, journal, 'synced', git);

    // Task 18 supplies the durable transition hook; this Task 8 boundary keeps
    // state ordering correct until that implementation is available.
    journal = await transitionState(options.worktree, journal, 'applied', git);
    if (journal.journal.followOnCause === undefined) await cleanAppliedJournal(journal, git);
    for (const range of plan.ranges) {
      const move = moves.find((entry) => entry.child === range.child);
      if (!move) throw new Error(`missing move for child ${range.child}`);
      await options.events?.emit({
        type: 'restack_applied', opId: draft.opId, cause: draft.cause, child: range.child,
        oldTip: range.oldTip, newTip: move.newSha, wouldInvalidate: [], parentOverlapPaths: [],
      });
    }
    terminal = true;
    return { kind: 'applied', opId: draft.opId };
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (!terminal && journal !== undefined) await abortJournal(options.worktree, journal, git, moves);
  }
}
