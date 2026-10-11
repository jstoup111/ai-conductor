import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { parseChildId } from '../child-context.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import {
  isJournalOwnerAlive,
  journalRefFor,
  readRestackJournal,
  stagingRefFor,
  updateRestackChildStatus,
  writeRestackJournalBlob,
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
import { replayChildRange } from './restack-replay.js';
import { syncRestackedWorktree } from './restack-sync.js';
import { applyRestackTransition } from './restack-transition.js';
import { runRestack } from './restack-executor.js';
import {
  isLegalJournalTransition,
  parseCommitSha,
  parseRefName,
  type ChildRange,
  type CommitSha,
  type JournalState,
  type RefName,
} from './restack-types.js';

/** Result of attempting recovery of the one durable journal for a feature. */
export type RecoverRestackJournalResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'live-owner' }
  | { readonly kind: 'recovered'; readonly fromState: Exclude<JournalState, 'applied' | 'aborted'> }
  | { readonly kind: 'cleaned' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface RecoverRestackJournalOptions {
  readonly worktree: string;
  readonly slug: string;
  readonly events?: ConductorEventEmitter;
  readonly git?: GitRunner;
}

function ref(raw: string): RefName {
  const value = parseRefName(raw);
  if (!value) throw new Error(`invalid restack ref: ${raw}`);
  return value;
}

async function runGit(git: GitRunner, args: string[], input?: string) {
  try {
    return await git(args, input === undefined ? undefined : { input });
  } catch {
    return undefined;
  }
}

function transaction(lines: readonly string[]): string {
  return ['start', ...lines, 'prepare', 'commit', ''].join('\n');
}

async function resolveSha(git: GitRunner, revision: string): Promise<CommitSha | undefined> {
  const result = await runGit(git, ['rev-parse', '-q', '--verify', revision]);
  return result?.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
}

function branchRefForRange(slug: string, range: ChildRange): RefName {
  if (range.kind === 'leaf-active' || range.kind === 'leaf-unentered') return ref(`refs/heads/${leafBranchFor(slug)}`);
  const branch = childBranchFor(slug, range.child);
  if (!branch.ok) throw new Error(branch.reason);
  return ref(`refs/heads/${branch.branch}`);
}

/** Reconstruct the exact move transaction solely from durable journal refs. */
async function movesFor(journal: StoredRestackJournal, git: GitRunner): Promise<RestackMoveRef[] | undefined> {
  const moves: RestackMoveRef[] = [];
  for (const range of journal.journal.ranges) {
    const newSha = await resolveSha(git, stagingRefFor(journal.slug, range.child));
    const branchRef = branchRefForRange(journal.slug, range);
    const branch = journal.journal.refs.find((entry) => entry.ref === branchRef);
    if (!newSha || !branch) return undefined;
    moves.push({ ref: branchRef, oldSha: branch.oldSha, newSha, child: range.child });
    if (range.kind === 'closed') {
      const closureRef = ref(`refs/conductor/${journal.slug}/closed/c${range.child}`);
      const closure = journal.journal.refs.find((entry) => entry.ref === closureRef);
      if (!closure) return undefined;
      moves.push({ ref: closureRef, oldSha: closure.oldSha, newSha, child: range.child });
    }
  }
  return moves;
}

async function transition(
  worktree: string,
  stored: StoredRestackJournal,
  state: Extract<JournalState, 'ready' | 'synced' | 'applied' | 'aborted'>,
  git: GitRunner,
): Promise<StoredRestackJournal | undefined> {
  if (!isLegalJournalTransition(stored.journal.state, state)) return undefined;
  const journal = { ...stored.journal, state };
  let blob: CommitSha;
  try {
    blob = await writeRestackJournalBlob(worktree, journal, { git });
  } catch {
    return undefined;
  }
  const updated = await runGit(git, ['update-ref', journalRefFor(stored.slug), blob, stored.blob]);
  return updated?.exitCode === 0 ? { slug: stored.slug, blob, journal } : undefined;
}

async function cleanJournal(worktree: string, journal: StoredRestackJournal, git: GitRunner): Promise<boolean> {
  const listed = await runGit(git, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/conductor/${journal.slug}/restack/staging/`]);
  if (!listed || listed.exitCode !== 0) return false;
  const deletes = listed.stdout.split('\n').flatMap((line) => {
    const [name, object] = line.trim().split(/\s+/, 2);
    return name && object ? [`delete ${name} ${object}`] : [];
  });
  const deleted = await runGit(git, ['update-ref', '--stdin'], transaction([
    `delete ${journalRefFor(journal.slug)} ${journal.blob}`,
    ...deletes,
  ]));
  if (deleted?.exitCode !== 0) return false;
  // Resolver worktrees are transient by contract. A process crash before its
  // finally can leave only this ignored directory behind.
  await rm(join(worktree, '.pipeline', 'restack', 'resolve'), { recursive: true, force: true });
  return true;
}

async function checkedOutRef(git: GitRunner): Promise<RefName | undefined> {
  const result = await runGit(git, ['symbolic-ref', '-q', 'HEAD']);
  return result?.exitCode === 0 ? parseRefName(result.stdout.trim()) : undefined;
}

async function refsStillAtOldValues(journal: StoredRestackJournal, git: GitRunner): Promise<boolean> {
  for (const entry of journal.journal.refs) {
    if (await resolveSha(git, entry.ref) !== entry.oldSha) return false;
  }
  return true;
}

/** The committed halt record is the only durable answer after worktree loss. */
async function hasOutstandingHalt(slug: string, git: GitRunner): Promise<boolean> {
  const record = await runGit(git, ['show', `HEAD:.docs/halted/${slug}.md`]);
  return record?.exitCode === 0 && /^Status:\s*halted\s*$/mi.test(record.stdout);
}

async function resumePlanned(
  worktree: string,
  journal: StoredRestackJournal,
  git: GitRunner,
): Promise<StoredRestackJournal | undefined> {
  if (!await refsStillAtOldValues(journal, git)) return undefined;
  let current = journal;
  let parent = current.journal.ranges[0]?.oldParent;
  if (!parent) return undefined;
  for (const range of current.journal.ranges) {
    const child = current.journal.children.find((entry) => entry.child === range.child);
    if (!child) return undefined;
    if (child.status !== 'pending') {
      const staged = await resolveSha(git, stagingRefFor(current.slug, range.child));
      if (!staged) return undefined;
      parent = staged;
      continue;
    }
    const replay = await replayChildRange(range, parent, current.journal.committer, git);
    const updated = await updateRestackChildStatus(worktree, current.slug, current, range.child, 'replayed', replay.tip, { git });
    if (updated.kind !== 'updated') return undefined;
    current = updated.journal;
    parent = replay.tip;
  }
  return transition(worktree, current, 'ready', git);
}

async function rollBackFromRolling(
  worktree: string,
  journal: StoredRestackJournal,
  moves: readonly RestackMoveRef[],
  git: GitRunner,
): Promise<StoredRestackJournal | undefined> {
  if (journal.journal.state !== 'rolling-back') return undefined;
  const aborted = { ...journal.journal, state: 'aborted' as const };
  let blob: CommitSha;
  try {
    blob = await writeRestackJournalBlob(worktree, aborted, { git });
  } catch {
    return undefined;
  }
  const reversed = await runGit(git, ['update-ref', '--stdin'], transaction([
    ...moves.map((move) => `update ${move.ref} ${move.oldSha} ${move.newSha}`),
    `update ${journalRefFor(journal.slug)} ${blob} ${journal.blob}`,
  ]));
  return reversed?.exitCode === 0 ? { slug: journal.slug, blob, journal: aborted } : undefined;
}

async function haltVerificationFailure(worktree: string, detail: string, events: ConductorEventEmitter | undefined): Promise<void> {
  await haltRestack(worktree, 'verification-failed', events, { detail });
}

/**
 * Continue or roll back a dead process's journal using only Git refs and the
 * journal blob.  `.pipeline` is deliberately neither read nor required.
 */
export async function recoverRestackJournal(options: RecoverRestackJournalOptions): Promise<RecoverRestackJournalResult> {
  const git = options.git ?? makeGitRunner(options.worktree);
  const read = await readRestackJournal(options.worktree, options.slug, { git });
  if (read.kind === 'missing') return { kind: 'none' };
  if (read.kind === 'unreadable') return { kind: 'unavailable', detail: `cannot read restack journal ${journalRefFor(options.slug)}` };
  if (await isJournalOwnerAlive(read.journal.owner)) return { kind: 'live-owner' };

  const fromState = read.journal.state;
  let journal = read;
  try {
    if (journal.journal.state === 'applied') {
      if (journal.journal.followOnCause !== undefined) {
        const result = await runRestack({
          worktree: options.worktree,
          slug: options.slug,
          cause: journal.journal.followOnCause,
          git,
          ...(options.events === undefined ? {} : { events: options.events }),
          replacesAppliedJournal: journal,
        });
        return result.kind === 'unavailable'
          ? { kind: 'unavailable', detail: result.detail }
          : { kind: 'cleaned' };
      }
      return await cleanJournal(options.worktree, journal, git) ? { kind: 'cleaned' } : { kind: 'unavailable', detail: 'cannot remove applied restack journal' };
    }
    if (journal.journal.state === 'aborted') {
      return !(await hasOutstandingHalt(options.slug, git)) && await cleanJournal(options.worktree, journal, git)
        ? { kind: 'cleaned' }
        : { kind: 'none' };
    }
    if (journal.journal.state === 'planned') {
      const resumed = await resumePlanned(options.worktree, journal, git);
      if (!resumed) {
        // A planned journal has never moved a production ref.  If an operator
        // changed one of its inputs, discard its now-untrustworthy staged
        // commits rather than replaying across a different stack.
        if (!await refsStillAtOldValues(journal, git)) {
          const aborted = await transition(options.worktree, journal, 'aborted', git);
          if (!aborted || !await cleanJournal(options.worktree, aborted, git)) {
            return { kind: 'unavailable', detail: 'cannot abort changed planned restack journal' };
          }
          await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail: 'a journaled input ref changed before recovery' });
          await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
          return { kind: 'recovered', fromState };
        }
        return { kind: 'unavailable', detail: 'cannot resume planned restack journal from durable refs' };
      }
      journal = resumed;
    }

    const moves = await movesFor(journal, git);
    if (!moves) return { kind: 'unavailable', detail: 'cannot reconstruct restack move from journal refs' };
    const checkedOut = await checkedOutRef(git);
    if (!checkedOut) return { kind: 'unavailable', detail: 'restack recovery requires a checked-out feature branch' };

    if (journal.journal.state === 'ready') {
      const preMove = await checkRestackPreMove(options.worktree, moves, checkedOut, { git });
      if (preMove.kind === 'refused') {
        const aborted = await transition(options.worktree, journal, 'aborted', git);
        if (!aborted) return { kind: 'unavailable', detail: 'cannot abort refused recovered restack' };
        await haltRestack(options.worktree, preMove.reason, options.events, { detail: preMove.detail });
        await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
        return { kind: 'recovered', fromState };
      }
      if (preMove.kind !== 'clear') return { kind: 'unavailable', detail: preMove.detail };
      const moved = await applyRestackMove(options.worktree, journal, moves, { git, events: options.events });
      if (moved.kind !== 'moved') return { kind: 'unavailable', detail: moved.detail };
      journal = moved.journal;
    }

    if (journal.journal.state === 'moved') {
      const verified = await verifyRestackMove(options.worktree, journal, moves, { git });
      if (verified.kind === 'failed') {
        const rolledBack = await rollbackRestackMove(options.worktree, journal, moves, { git });
        if (rolledBack.kind !== 'aborted') return { kind: 'unavailable', detail: rolledBack.detail };
        await haltVerificationFailure(options.worktree, verified.detail, options.events);
        await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
        return { kind: 'recovered', fromState };
      }
      if (verified.kind !== 'verified') return { kind: 'unavailable', detail: verified.detail };
      const checkedOutMove = moves.find((move) => move.ref === checkedOut);
      if (!checkedOutMove) return { kind: 'unavailable', detail: 'checked-out branch is not in recovered restack' };
      await syncRestackedWorktree(options.worktree, checkedOutMove.oldSha, checkedOutMove.newSha, { git });
      const synced = await transition(options.worktree, journal, 'synced', git);
      if (!synced) return { kind: 'unavailable', detail: 'cannot record recovered restack sync' };
      journal = synced;
    }

    if (journal.journal.state === 'rolling-back') {
      const rolledBack = await rollBackFromRolling(options.worktree, journal, moves, git);
      if (!rolledBack) return { kind: 'unavailable', detail: 'cannot complete recovered restack rollback' };
      await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
      return { kind: 'recovered', fromState };
    }

    if (journal.journal.state === 'synced') {
      const activeMove = moves.find((move) => move.ref === checkedOut);
      if (!activeMove?.child) return { kind: 'unavailable', detail: 'cannot identify active child for recovered transition' };
      await applyRestackTransition({
        worktree: options.worktree,
        cause: journal.journal.cause,
        newDefault: journal.journal.ranges[0]!.oldParent,
        activeChild: activeMove.child,
        ranges: journal.journal.ranges,
        moves,
        git,
        ...(options.events === undefined ? {} : { events: options.events }),
      });
      const applied = await transition(options.worktree, journal, 'applied', git);
      if (!applied) return { kind: 'unavailable', detail: 'cannot apply recovered restack transition' };
      if (applied.journal.followOnCause === undefined && !await cleanJournal(options.worktree, applied, git)) {
        return { kind: 'unavailable', detail: 'cannot clean recovered restack journal' };
      }
    }
    await options.events?.emit({ type: 'restack_recovered', opId: read.journal.opId, fromState });
    return { kind: 'recovered', fromState };
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
}
