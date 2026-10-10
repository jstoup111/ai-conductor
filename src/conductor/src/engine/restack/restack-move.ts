import type { ChildId } from '../child-context.js';
import { writeHaltMarker, type HaltMarkerWriteResult } from '../halt-marker.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import {
  journalRefFor,
  stagingRefFor,
  writeRestackJournalBlob,
  type StoredRestackJournal,
} from './restack-journal.js';
import { emitRestackRefused } from './restack-events.js';
import {
  parseCommitSha,
  type CommitSha,
  type RefName,
  type RestackRefusalReason,
} from './restack-types.js';

/** One compare-and-swap entry in a journaled stack ref move. */
export interface RestackMoveRef {
  readonly ref: RefName;
  readonly oldSha: CommitSha;
  readonly newSha: CommitSha;
  /** The staged child whose replay supplied this ref's next value. */
  readonly child?: ChildId;
}

export interface RestackMoveDependencies {
  readonly git?: GitRunner;
  /** Number of retries after the first lock failure. */
  readonly retries?: number;
  readonly sleep?: () => Promise<void>;
  readonly events?: ConductorEventEmitter;
}

export type ApplyRestackMoveResult =
  | { readonly kind: 'moved'; readonly journal: StoredRestackJournal }
  | { readonly kind: 'refused'; readonly reason: Extract<RestackRefusalReason, 'stack-ref-changed' | 'lock-unavailable'>; readonly detail: string; readonly journal?: StoredRestackJournal }
  | { readonly kind: 'unavailable'; readonly detail: string };

export type VerifyRestackMoveResult =
  | { readonly kind: 'verified' }
  | { readonly kind: 'failed'; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly detail: string };

export type RollbackRestackMoveResult =
  | { readonly kind: 'aborted'; readonly journal: StoredRestackJournal }
  | { readonly kind: 'unavailable'; readonly detail: string };

function detail(result: { readonly stderr: string }): string {
  return result.stderr.trim() || 'Git command failed';
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

function sameJournalRefs(journal: StoredRestackJournal, moves: readonly RestackMoveRef[]): boolean {
  if (journal.journal.refs.length !== moves.length) return false;
  const byRef = new Map(moves.map((move) => [move.ref, move]));
  if (byRef.size !== moves.length) return false;
  return journal.journal.refs.every((entry) => byRef.get(entry.ref)?.oldSha === entry.oldSha);
}

function moveLines(moves: readonly RestackMoveRef[]): string[] {
  return moves.map((move) => `update ${move.ref} ${move.newSha} ${move.oldSha}`);
}

function oldValueRef(stderr: string): string | undefined {
  const matched = /cannot lock ref '([^']+)'/.exec(stderr);
  return matched?.[1];
}

function lockDetail(stderr: string): string | undefined {
  const matched = /(?:Unable to create |cannot create )'([^']+\.lock)'/.exec(stderr);
  return matched?.[1];
}

async function writeState(
  worktree: string,
  previous: StoredRestackJournal,
  state: 'aborted' | 'rolling-back',
  git: GitRunner,
): Promise<StoredRestackJournal | undefined> {
  const next = { ...previous.journal, state };
  let blob: CommitSha;
  try {
    blob = await writeRestackJournalBlob(worktree, next, { git });
  } catch {
    return undefined;
  }
  const updated = await runGit(git, ['update-ref', journalRefFor(previous.slug), blob, previous.blob]);
  return updated?.exitCode === 0 ? { slug: previous.slug, blob, journal: next } : undefined;
}

/**
 * Emit the refusal occurrence before writing the daemon-recognized human halt.
 * The journal stays ref-backed durable state; occurrences remain on the event spine.
 */
export async function haltRestack(
  worktree: string,
  reason: RestackRefusalReason,
  events?: ConductorEventEmitter,
  options: { readonly child?: ChildId; readonly detail?: string } = {},
): Promise<HaltMarkerWriteResult> {
  await events?.emit(emitRestackRefused({ reason, child: options.child, detail: options.detail }));
  const child = options.child === undefined ? '' : ` child ${options.child}`;
  const detail = options.detail === undefined ? '' : `\n${options.detail}`;
  return writeHaltMarker(worktree, `restack refused (${reason})${child}${detail}\n`, 'needs-human', events);
}

async function abortReadyMove(
  worktree: string,
  journal: StoredRestackJournal,
  git: GitRunner,
): Promise<StoredRestackJournal | undefined> {
  if (journal.journal.state !== 'ready') return undefined;
  return writeState(worktree, journal, 'aborted', git);
}

/** Move every recorded ref and the ready→moved journal transition in one CAS transaction. */
export async function applyRestackMove(
  worktree: string,
  journal: StoredRestackJournal,
  moves: readonly RestackMoveRef[],
  dependencies: RestackMoveDependencies = {},
): Promise<ApplyRestackMoveResult> {
  if (journal.journal.state !== 'ready') return { kind: 'unavailable', detail: 'restack journal is not ready to move' };
  if (!sameJournalRefs(journal, moves)) return { kind: 'unavailable', detail: 'restack moves do not exactly match journaled refs' };
  const git = dependencies.git ?? makeGitRunner(worktree);
  const next = { ...journal.journal, state: 'moved' as const };
  let nextBlob: CommitSha;
  try {
    nextBlob = await writeRestackJournalBlob(worktree, next, { git });
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
  const retries = Math.max(0, dependencies.retries ?? 2);
  let lastLock = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const moved = await runGit(git, ['update-ref', '--stdin'], transaction([
      ...moveLines(moves),
      `update ${journalRefFor(journal.slug)} ${nextBlob} ${journal.blob}`,
    ]));
    if (moved?.exitCode === 0) return { kind: 'moved', journal: { slug: journal.slug, blob: nextBlob, journal: next } };
    if (!moved) return { kind: 'unavailable', detail: 'Git unavailable while moving restack refs' };
    const stderr = detail(moved);
    const lock = lockDetail(stderr);
    if (lock !== undefined) {
      lastLock = lock;
      if (attempt < retries) {
        await (dependencies.sleep ?? (() => Promise.resolve()))();
        continue;
      }
      const aborted = await abortReadyMove(worktree, journal, git);
      await haltRestack(worktree, 'lock-unavailable', dependencies.events, { detail: lock });
      return { kind: 'refused', reason: 'lock-unavailable', detail: lock, ...(aborted === undefined ? {} : { journal: aborted }) };
    }
    const changed = oldValueRef(stderr) ?? 'an unknown journaled ref';
    const aborted = await abortReadyMove(worktree, journal, git);
    await haltRestack(worktree, 'stack-ref-changed', dependencies.events, { detail: changed });
    return { kind: 'refused', reason: 'stack-ref-changed', detail: changed, ...(aborted === undefined ? {} : { journal: aborted }) };
  }
  return { kind: 'unavailable', detail: lastLock || 'restack move did not execute' };
}

async function resolvedSha(git: GitRunner, revision: string): Promise<CommitSha | undefined> {
  const result = await runGit(git, ['rev-parse', '--verify', revision]);
  return result?.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
}

/** Verify moved tips, their ordered ancestry, and trees against their staging refs. */
export async function verifyRestackMove(
  worktree: string,
  journal: StoredRestackJournal,
  moves: readonly RestackMoveRef[],
  dependencies: Pick<RestackMoveDependencies, 'git'> = {},
): Promise<VerifyRestackMoveResult> {
  if (journal.journal.state !== 'moved') return { kind: 'unavailable', detail: 'restack journal is not moved' };
  if (!sameJournalRefs(journal, moves)) return { kind: 'unavailable', detail: 'restack moves do not exactly match journaled refs' };
  const git = dependencies.git ?? makeGitRunner(worktree);
  for (const move of moves) {
    const actual = await resolvedSha(git, move.ref);
    if (actual === undefined) return { kind: 'unavailable', detail: `cannot resolve moved ref ${move.ref}` };
    if (actual !== move.newSha) return { kind: 'failed', detail: `tip mismatch for ${move.ref}` };
  }
  let previous: CommitSha | undefined;
  for (const range of journal.journal.ranges) {
    const move = moves.find((entry) => entry.child === range.child);
    if (!move) return { kind: 'failed', detail: `missing moved ref for child ${range.child}` };
    const staging = stagingRefFor(journal.slug, range.child);
    const staged = await resolvedSha(git, staging);
    if (staged === undefined) return { kind: 'unavailable', detail: `cannot resolve staging ref ${staging}` };
    const movedTree = await resolvedSha(git, `${move.newSha}^{tree}`);
    const stagedTree = await resolvedSha(git, `${staging}^{tree}`);
    if (movedTree === undefined || stagedTree === undefined) return { kind: 'unavailable', detail: `cannot read tree for child ${range.child}` };
    if (movedTree !== stagedTree) return { kind: 'failed', detail: `tree mismatch for child ${range.child}` };
    if (previous !== undefined) {
      const ancestor = await runGit(git, ['merge-base', '--is-ancestor', previous, move.newSha]);
      if (!ancestor) return { kind: 'unavailable', detail: `cannot inspect ancestry for child ${range.child}` };
      if (ancestor.exitCode !== 0) return { kind: 'failed', detail: `ancestry mismatch before child ${range.child}` };
    }
    previous = staged;
  }
  return { kind: 'verified' };
}

/** Reverse a moved transaction using the moved values as CAS expectations. */
export async function rollbackRestackMove(
  worktree: string,
  journal: StoredRestackJournal,
  moves: readonly RestackMoveRef[],
  dependencies: Pick<RestackMoveDependencies, 'git'> = {},
): Promise<RollbackRestackMoveResult> {
  if (journal.journal.state !== 'moved') return { kind: 'unavailable', detail: 'restack journal is not moved' };
  if (!sameJournalRefs(journal, moves)) return { kind: 'unavailable', detail: 'restack moves do not exactly match journaled refs' };
  const git = dependencies.git ?? makeGitRunner(worktree);
  const rolling = await writeState(worktree, journal, 'rolling-back', git);
  if (!rolling) return { kind: 'unavailable', detail: 'cannot record restack rollback intent' };
  const abortedJournal = { ...rolling.journal, state: 'aborted' as const };
  let abortedBlob: CommitSha;
  try {
    abortedBlob = await writeRestackJournalBlob(worktree, abortedJournal, { git });
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
  const reverse = moves.map((move) => `update ${move.ref} ${move.oldSha} ${move.newSha}`);
  const rolledBack = await runGit(git, ['update-ref', '--stdin'], transaction([
    ...reverse,
    `update ${journalRefFor(journal.slug)} ${abortedBlob} ${rolling.blob}`,
  ]));
  if (rolledBack?.exitCode !== 0) return { kind: 'unavailable', detail: rolledBack ? detail(rolledBack) : 'Git unavailable while rolling back restack refs' };
  return { kind: 'aborted', journal: { slug: journal.slug, blob: abortedBlob, journal: abortedJournal } };
}
