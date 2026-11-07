import type { ChildId } from '../child-context.js';
import { leafBranchFor } from '../feature-branch-identity.js';
import { writeHaltMarker, type HaltMarkerWriteResult } from '../halt-marker.js';
import {
  confirmUntrackedRebasePaths,
  makeGitRunner,
  moveRebaseUntrackedPathsToQuarantine,
  type GitRunner,
} from '../rebase.js';
import { verifyProtectedArtifactSeal } from '../protected-artifact-seal.js';
import { resolve } from 'node:path';
import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import {
  journalStateUpdateLines,
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

export type RestackPreMoveResult =
  | { readonly kind: 'clear' }
  | {
    readonly kind: 'refused';
    readonly reason: Extract<RestackRefusalReason, 'checked-out-elsewhere' | 'dirty-overlap' | 'sync-collision'>;
    readonly detail: string;
  }
  | { readonly kind: 'seal-refused'; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly detail: string };

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

function paths(output: string): string[] {
  return output.split('\n').map((path) => path.trim()).filter(Boolean);
}

function worktreeRecords(output: string): { readonly path: string; readonly branch?: string }[] {
  return output.split(/\n\s*\n/).flatMap((record) => {
    const lines = record.split('\n');
    const worktree = lines.find((line) => line.startsWith('worktree '));
    if (!worktree) return [];
    const branch = lines.find((line) => line.startsWith('branch '));
    return [{
      path: worktree.slice('worktree '.length).trim(),
      ...(branch === undefined ? {} : { branch: branch.slice('branch '.length).trim() }),
    }];
  });
}

async function changedPaths(git: GitRunner, oldSha: CommitSha, newSha: CommitSha): Promise<string[] | undefined> {
  const changed = await runGit(git, ['diff', '--name-only', oldSha, newSha]);
  return changed?.exitCode === 0 ? paths(changed.stdout) : undefined;
}

async function dirtyTrackedPaths(git: GitRunner): Promise<string[] | undefined> {
  const [unstaged, staged] = await Promise.all([
    runGit(git, ['diff', '--name-only']),
    runGit(git, ['diff', '--cached', '--name-only']),
  ]);
  if (!unstaged || !staged || unstaged.exitCode !== 0 || staged.exitCode !== 0) return undefined;
  return [...new Set([...paths(unstaged.stdout), ...paths(staged.stdout)])];
}

async function untrackedAddedPaths(
  worktree: string,
  git: GitRunner,
  oldSha: CommitSha,
  newSha: CommitSha,
): Promise<string[] | undefined> {
  const added = await runGit(git, ['diff', '--name-only', '--diff-filter=A', oldSha, newSha]);
  if (!added || added.exitCode !== 0) return undefined;
  const candidates: string[] = [];
  for (const path of paths(added.stdout)) {
    const status = await runGit(git, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', path]);
    if (!status || status.exitCode !== 0) return undefined;
    if (status.stdout === `?? ${path}\0`) candidates.push(path);
  }
  try {
    return await confirmUntrackedRebasePaths(git, worktree, candidates);
  } catch {
    return undefined;
  }
}

/**
 * Check the live worktree immediately before the journaled ref transaction.
 * Nothing here rewrites refs; an unsuccessful check leaves the executor's
 * ready journal available for its normal abort path.
 */
export async function checkRestackPreMove(
  worktree: string,
  moves: readonly RestackMoveRef[],
  checkedOut: RefName,
  dependencies: Pick<RestackMoveDependencies, 'git'> = {},
): Promise<RestackPreMoveResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const changedMoves = moves.filter((move) => move.oldSha !== move.newSha && move.ref.startsWith('refs/heads/'));
  const listed = await runGit(git, ['worktree', 'list', '--porcelain']);
  if (!listed || listed.exitCode !== 0) return { kind: 'unavailable', detail: 'cannot list Git worktrees before restack move' };
  const thisWorktree = resolve(worktree);
  for (const record of worktreeRecords(listed.stdout)) {
    if (resolve(record.path) === thisWorktree || record.branch === undefined) continue;
    const move = changedMoves.find((candidate) => candidate.ref === record.branch);
    if (move) return { kind: 'refused', reason: 'checked-out-elsewhere', detail: record.path };
  }

  const checkedOutMove = moves.find((move) => move.ref === checkedOut);
  if (!checkedOutMove) return { kind: 'unavailable', detail: 'checked-out branch is not part of restack move' };
  if (checkedOutMove.oldSha === checkedOutMove.newSha) return { kind: 'clear' };

  const [delta, dirty] = await Promise.all([
    changedPaths(git, checkedOutMove.oldSha, checkedOutMove.newSha),
    dirtyTrackedPaths(git),
  ]);
  if (delta === undefined || dirty === undefined) return { kind: 'unavailable', detail: 'cannot inspect restack worktree changes' };
  const overlap = delta.filter((path) => dirty.includes(path)).sort();
  if (overlap.length > 0) return { kind: 'refused', reason: 'dirty-overlap', detail: overlap.join(', ') };

  const untracked = await untrackedAddedPaths(worktree, git, checkedOutMove.oldSha, checkedOutMove.newSha);
  if (untracked === undefined) return { kind: 'unavailable', detail: 'cannot inspect untracked restack collisions' };
  if (untracked.length > 0) {
    try {
      await moveRebaseUntrackedPathsToQuarantine(worktree, untracked);
    } catch {
      return { kind: 'refused', reason: 'sync-collision', detail: untracked[0]! };
    }
  }

  const dryRun = await runGit(git, ['read-tree', '-m', '-u', '-n', checkedOutMove.oldSha, checkedOutMove.newSha]);
  if (!dryRun || dryRun.exitCode !== 0) {
    return {
      kind: 'refused',
      reason: 'sync-collision',
      detail: untracked[0] ?? (dryRun?.stderr.trim() || 'read-tree dry run failed'),
    };
  }

  try {
    const seal = await verifyProtectedArtifactSeal({
      projectRoot: worktree,
      baselineCommit: checkedOutMove.oldSha,
      toleratesEngineAppendedRemediation: true,
    });
    return seal.ok ? { kind: 'clear' } : { kind: 'seal-refused', detail: seal.reason };
  } catch (error) {
    return { kind: 'seal-refused', detail: error instanceof Error ? error.message : String(error) };
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

function consumedResolutionVerifyLines(journal: StoredRestackJournal): readonly string[] {
  const consumed = journal.journal.consumedResolution;
  if (!consumed) return [];
  return [
    `verify refs/conductor/${journal.slug}/restack/resolution/c${consumed.child} ${consumed.tip}`,
    `verify refs/conductor/${journal.slug}/restack/conflict/record ${consumed.record}`,
    `verify refs/conductor/${journal.slug}/restack/conflict/parent ${consumed.parent}`,
  ];
}

function deliveredDecisionVerifyLines(journal: StoredRestackJournal): readonly string[] {
  const delivered = journal.journal.deliveredDecision;
  return delivered === undefined
    ? []
    : [
      `verify refs/conductor/${journal.slug}/restack/decision/c${delivered.child} ${delivered.blob}`,
      `verify refs/conductor/${journal.slug}/restack/conflict/record ${delivered.record}`,
      `verify refs/conductor/${journal.slug}/restack/conflict/parent ${delivered.parent}`,
    ];
}

function leafMovedLine(journal: StoredRestackJournal, moves: readonly RestackMoveRef[]): string | undefined {
  const leaf = journal.journal.ranges.find((range) => range.kind === 'leaf-active');
  if (!leaf) return undefined;
  const leafRef = `refs/heads/${leafBranchFor(journal.slug)}`;
  const move = moves.find((candidate) => candidate.child === leaf.child && candidate.ref === leafRef);
  if (!move || move.oldSha === move.newSha) return undefined;
  return `update refs/conductor/${journal.slug}/leaf-moved ${move.newSha}`;
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
  const updated = await runGit(git, ['update-ref', '--stdin'], transaction(journalStateUpdateLines(previous, blob, state)));
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

/** Write the human halt for an unresolved replay conflict without a refusal event. */
export async function haltRestackConflict(
  worktree: string,
  child: ChildId,
  detail: string,
  events?: ConductorEventEmitter,
  recipe?: { readonly slug: string; readonly opId: string; readonly oldTip: CommitSha; readonly newParent: CommitSha; readonly oldParent: CommitSha },
): Promise<HaltMarkerWriteResult> {
  const instructions = recipe === undefined ? '' : [
    // ai-conductor:session-command-context=operator-only
    `Restack-Conflict: ${child} ${recipe.opId}`,
    `git switch -c restack-resolve/${recipe.slug}/c${child} ${recipe.oldTip}`,
    `git rebase --onto ${recipe.newParent} ${recipe.oldParent}`,
    `ai-conductor stack restack-resolve --slug ${recipe.slug} --child ${child} --tip <sha>`,
    `ai-conductor stack restack-resolve --slug ${recipe.slug} --child ${child} --decision "<answer>"`,
    // /ai-conductor:session-command-context
  ].join('\n');
  return writeHaltMarker(worktree, `restack conflict child ${child}\n${detail}${instructions === '' ? '' : `\n${instructions}`}\n`, 'needs-human', events);
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
  const marker = leafMovedLine(journal, moves);
  let lastLock = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const moved = await runGit(git, ['update-ref', '--stdin'], transaction([
      ...moveLines(moves),
      ...(marker === undefined ? [] : [marker]),
      ...consumedResolutionVerifyLines(journal),
      ...deliveredDecisionVerifyLines(journal),
      ...journalStateUpdateLines(journal, nextBlob, 'moved'),
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
    ...journalStateUpdateLines(rolling, abortedBlob, 'aborted'),
  ]));
  if (rolledBack?.exitCode !== 0) return { kind: 'unavailable', detail: rolledBack ? detail(rolledBack) : 'Git unavailable while rolling back restack refs' };
  return { kind: 'aborted', journal: { slug: journal.slug, blob: abortedBlob, journal: abortedJournal } };
}
