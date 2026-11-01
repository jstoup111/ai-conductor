import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { childBranchFor, isChildRefOf, leafBranchFor } from '../feature-branch-identity.js';
import type { ChildId } from '../child-context.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import {
  isJournalOwnerAlive,
  journalRefFor,
  journalStateUpdateLines,
  pinStagingRef,
  readRestackJournal,
  stagingRefFor,
  updateRestackChildStatus,
  writeRestackJournalBlob,
  type RestackJournalOwner,
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
import { replayChildRange, RemBlockBodyMismatchError } from './restack-replay.js';
import { consumeRecordedResolution } from './restack-conflict-record.js';
import { prepareRestackDecisionDelivery, restackDecisionDetailLines } from './restack-decision-delivery.js';
import { checkPathOwnership } from './restack-ownership.js';
import { RestackSyncOperatorEditError, syncRestackedWorktree } from './restack-sync.js';
import { applyRestackTransition } from './restack-transition.js';
import {
  changedRoutedAppliedRef,
  journalRoutedApplyPlan,
  mergeInRange,
  restackTransactionBuilder,
  RoutedApplyPlanRefChangedError,
  runRestack,
} from './restack-executor.js';
import { replayCandidateSubjects, resolveRestackConflict, type RestackResolver } from './restack-resolver.js';
import { haltRecordedRestackConflict } from './restack-conflict-halt.js';
import { resolveUnenteredLeafOwner, type ConsumedTipCorrespondence } from './restack-unentered-leaf.js';
import { haltRecordPathFor } from './halt-record-bookkeeping.js';
import { resolveRebaseResolutionAttempts } from '../resolved-config.js';
import { publishedStackRefusal } from '../stack-publication.js';
import { routedRoundOpen } from '../routing/round-admission.js';
import { emitRestackRefused } from './restack-events.js';
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
  | { readonly kind: 'live-owner'; readonly owner?: RestackJournalOwner }
  | { readonly kind: 'halted' }
  | { readonly kind: 'recovered'; readonly fromState: Exclude<JournalState, 'applied' | 'aborted'> }
  | { readonly kind: 'cleaned' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface RecoverRestackJournalOptions {
  readonly worktree: string;
  readonly slug: string;
  readonly events?: ConductorEventEmitter;
  readonly git?: GitRunner;
  /** Provider-backed resolver and its configured attempt budget. */
  readonly resolver?: RestackResolver;
  readonly resolverCap?: number;
  /**
   * Halt writers need the refs and worktree settled, but must not publish the
   * restack transition while composing their durable halt record.  This mode
   * therefore stops at `synced` (or finishes a rollback at `aborted`).
   */
  readonly target?: 'completed' | 'synced';
  /**
   * A publication that appeared after a feature-repair applied may retain its
   * settled work, but must not start the journal-owned base-refresh follow-on.
   */
  readonly suppressFollowOn?: boolean;
  /** Recreates REKICK before suppressing a queued follow-on base refresh. */
  readonly rearmRekick?: () => Promise<void>;
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
  const updated = await runGit(git, ['update-ref', '--stdin'], transaction(journalStateUpdateLines(stored, blob, state)));
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

async function refValue(git: GitRunner, name: string): Promise<string> {
  const result = await runGit(git, ['rev-parse', '-q', '--verify', name]);
  return result?.exitCode === 0 ? result.stdout.trim() : '<missing>';
}

async function journaledRefValues(journal: StoredRestackJournal, git: GitRunner): Promise<string> {
  return Promise.all(journal.journal.refs.map(async ({ ref: name }) => `${name} ${await refValue(git, name)}`))
    .then((values) => values.join('\n'));
}

/** Include every durable ref which can identify this feature if its journal is corrupt. */
async function corruptJournalRefValues(slug: string, git: GitRunner): Promise<string> {
  const listed = await runGit(git, [
    'for-each-ref', '--format=%(refname) %(objectname)',
    'refs/heads/feat/',
    `refs/conductor/${slug}/closed/`,
    `refs/conductor/${slug}/restack/staging/`,
  ]);
  const values = new Map<string, string>();
  values.set(journalRefFor(slug), await refValue(git, journalRefFor(slug)));
  if (listed?.exitCode === 0) {
    for (const line of listed.stdout.split('\n')) {
      const [name, value] = line.trim().split(/\s+/, 2);
      if (!name || !value) continue;
      const isChild = isChildRefOf(name, slug);
      const isClosure = name.startsWith(`refs/conductor/${slug}/closed/`);
      const isStaging = name.startsWith(`refs/conductor/${slug}/restack/staging/`);
      if (isChild || isClosure || isStaging) values.set(name, value);
    }
  }
  return [...values].map(([name, value]) => `${name} ${value}`).join('\n');
}

/**
 * A routed reset may discard only the engine's durable halt-record extension.
 * Keep this check here with the restack recovery rules so both callers use the
 * same definition of a harmless descendant.
 */
export async function isHaltRecordOnlyDescendant(
  git: GitRunner,
  base: CommitSha,
  tip: CommitSha,
  slug: string,
): Promise<boolean> {
  const commits = await runGit(git, ['rev-list', `${base}..${tip}`]);
  if (commits?.exitCode !== 0) return false;
  for (const raw of commits.stdout.split('\n').filter(Boolean)) {
    const changed = await runGit(git, ['diff-tree', '--no-commit-id', '--name-only', '-r', raw]);
    const paths = changed?.exitCode === 0 ? changed.stdout.split('\n').filter(Boolean) : undefined;
    if (!paths || paths.length === 0 || paths.some((path) => path !== `.docs/halted/${slug}.md`)) return false;
  }
  return true;
}

type MovedRefSide = 'old' | 'new' | 'unchanged' | 'unknown';

async function movedRefSides(
  journal: StoredRestackJournal,
  moves: readonly RestackMoveRef[],
  checkedOut: RefName,
  git: GitRunner,
): Promise<Map<RefName, MovedRefSide>> {
  const sides = new Map<RefName, MovedRefSide>();
  for (const move of moves) {
    const live = await resolveSha(git, move.ref);
    if (live === move.oldSha && move.oldSha === move.newSha) {
      sides.set(move.ref, 'unchanged');
    } else if (live === move.oldSha) {
      sides.set(move.ref, 'old');
    } else if (live === move.newSha || (live !== undefined && move.ref === checkedOut
      && await isHaltRecordOnlyDescendant(git, move.newSha, live, journal.slug))) {
      sides.set(move.ref, 'new');
    } else {
      sides.set(move.ref, 'unknown');
    }
  }
  return sides;
}

async function haltChangedJournalRefs(
  worktree: string,
  journal: StoredRestackJournal,
  events: ConductorEventEmitter | undefined,
  git: GitRunner,
): Promise<void> {
  await haltRestack(worktree, 'stack-ref-changed', events, { detail: await journaledRefValues(journal, git) });
}

/**
 * The normal verifier intentionally requires byte-for-byte staged tips. During
 * recovery a halt record may be the sole commit after the checked-out moved
 * tip, so validate the unaffected stack normally and exempt only that durable
 * record from the tree equality check.
 */
async function verifyMovedRecovery(
  worktree: string,
  journal: StoredRestackJournal,
  moves: readonly RestackMoveRef[],
  checkedOut: RefName,
  git: GitRunner,
): Promise<Awaited<ReturnType<typeof verifyRestackMove>>> {
  // Resolve the small fixed journal set once, before any tree checks.
  const liveByRef = new Map<RefName, CommitSha>();
  for (const move of moves) {
    const live = await resolveSha(git, move.ref);
    if (!live) return { kind: 'unavailable', detail: `cannot resolve moved ref ${move.ref}` };
    liveByRef.set(move.ref, live);
  }
  const hasHaltRecordExtension = moves.some((move) => move.ref === checkedOut && liveByRef.get(move.ref) !== move.newSha);
  const unenteredLeafOwners = new Map<ChildId, ChildId>();
  for (const range of journal.journal.ranges) {
    if (range.kind !== 'leaf-unentered') continue;
    const owner = await unenteredLeafOwner(journal, range, git);
    if (owner) unenteredLeafOwners.set(range.child, owner.child);
  }
  const verificationRanges = journal.journal.ranges.flatMap((range) => [
    ...journal.journal.ranges.filter((candidate) => candidate.kind === 'leaf-unentered' && unenteredLeafOwners.get(candidate.child) === range.child),
    ...(range.kind !== 'leaf-unentered' || !unenteredLeafOwners.has(range.child) ? [range] : []),
  ]);
  const verificationJournal = { ...journal, journal: { ...journal.journal, ranges: verificationRanges } };
  if (!hasHaltRecordExtension) return verifyRestackMove(worktree, verificationJournal, moves, { git });

  let previous: CommitSha | undefined;
  for (const range of verificationJournal.journal.ranges) {
    const move = moves.find((entry) => entry.child === range.child && entry.ref.startsWith('refs/heads/'));
    if (!move) return { kind: 'failed', detail: `missing moved ref for child ${range.child}` };
    const live = liveByRef.get(move.ref)!;
    const staging = await resolveSha(git, stagingRefFor(journal.slug, range.child));
    if (!staging) return { kind: 'unavailable', detail: `cannot resolve staging ref for child ${range.child}` };
    if (!(move.ref === checkedOut && live !== move.newSha)) {
      const [movedTree, stagedTree] = await Promise.all([
        resolveSha(git, `${live}^{tree}`),
        resolveSha(git, `${staging}^{tree}`),
      ]);
      if (!movedTree || !stagedTree) return { kind: 'unavailable', detail: `cannot read tree for child ${range.child}` };
      if (movedTree !== stagedTree) return { kind: 'failed', detail: `tree mismatch for child ${range.child}` };
    }
    if (previous !== undefined) {
      const ancestor = await runGit(git, ['merge-base', '--is-ancestor', previous, live]);
      if (!ancestor) return { kind: 'unavailable', detail: `cannot inspect ancestry for child ${range.child}` };
      if (ancestor.exitCode !== 0) return { kind: 'failed', detail: `ancestry mismatch before child ${range.child}` };
    }
    previous = live;
  }
  return { kind: 'verified' };
}

async function leafIsInsideRange(git: GitRunner, leafTip: CommitSha, range: ChildRange): Promise<boolean | undefined> {
  if (leafTip === range.oldParent) return false;
  const [afterParent, beforeTip] = await Promise.all([
    runGit(git, ['merge-base', '--is-ancestor', range.oldParent, leafTip]),
    runGit(git, ['merge-base', '--is-ancestor', leafTip, range.oldTip]),
  ]);
  if (!afterParent || !beforeTip || afterParent.exitCode > 1 || beforeTip.exitCode > 1) return undefined;
  return afterParent.exitCode === 0 && beforeTip.exitCode === 0;
}

async function unenteredLeafOwner(
  journal: StoredRestackJournal,
  range: ChildRange,
  git: GitRunner,
): Promise<{ readonly child: ChildId; readonly rewritten: CommitSha } | undefined> {
  if (range.kind !== 'leaf-unentered') return undefined;
  const exactRewrites = new Map(journal.journal.children
    .filter((entry) => entry.child !== range.child)
    .map((entry) => [entry.child, new Map(entry.rewrites?.map(({ from, to }) => [from, to]))] as const));
  const consumed = journal.journal.consumedResolution;
  const consumedRange = consumed === undefined ? undefined : journal.journal.ranges.find((candidate) => candidate.child === consumed.child);
  const consumedTip = consumedRange === undefined ? undefined : await resolveSha(git, stagingRefFor(journal.slug, consumedRange.child));
  const correspondences: readonly ConsumedTipCorrespondence[] = consumedRange === undefined || consumedTip === undefined || consumed === undefined
    ? []
    : [{ child: consumedRange.child, oldParent: consumedRange.oldParent, oldTip: consumedRange.oldTip, newParent: consumed.parent, tip: consumedTip }];
  const rewrittenMatches = (await resolveUnenteredLeafOwner(git, range.oldTip, exactRewrites, correspondences)).matches;
  if (rewrittenMatches.length > 0) return rewrittenMatches.length === 1 ? rewrittenMatches[0] : undefined;
  if (journal.journal.cause !== 'feature-repair') return undefined;
  // Every child through the highest origin is adopted unchanged, whether or
  // not it originated the repair; an adopted owner maps the leaf to itself.
  const lastOriginIndex = Math.max(-1, ...journal.journal.ranges.map((candidate, index) =>
    journal.journal.originatingChildren?.includes(candidate.child) ? index : -1));
  const identityMatches = (await Promise.all(journal.journal.ranges.map(async (candidate, index) => {
    if (candidate.kind === 'leaf-unentered' || index > lastOriginIndex) return undefined;
    const child = journal.journal.children.find((entry) => entry.child === candidate.child);
    if (child?.status !== 'replayed' || (child.rewrites?.length ?? 0) !== 0) return undefined;
    const inside = await leafIsInsideRange(git, range.oldTip, candidate);
    return inside ? { child: candidate.child, rewritten: range.oldTip } : undefined;
  }))).filter((match): match is { child: ChildId; rewritten: CommitSha } => match !== undefined);
  return identityMatches.length === 1 ? identityMatches[0] : undefined;
}

/** The committed halt record is the only durable answer after worktree loss. */
async function hasOutstandingHalt(slug: string, git: GitRunner): Promise<boolean> {
  const record = await runGit(git, ['show', `HEAD:.docs/halted/${slug}.md`]);
  return record?.exitCode === 0 && /^Status:\s*halted\s*$/mi.test(record.stdout);
}

/**
 * Remove precisely the stale terminal journal an entry point may inherit after
 * its halt record was superseded.  This intentionally does not drive a
 * non-terminal journal: recovery remains its sole owner.
 */
export async function cleanClearedAbortedRestackJournal(
  worktree: string,
  slug: string,
  options: Pick<RecoverRestackJournalOptions, 'git'> = {},
): Promise<'none' | 'cleaned' | 'unavailable'> {
  const git = options.git ?? makeGitRunner(worktree);
  const read = await readRestackJournal(worktree, slug, { git });
  if (read.kind === 'missing') return 'none';
  if (read.kind !== 'journal') return 'unavailable';
  if (read.journal.state !== 'aborted') return 'none';
  if (await hasOutstandingHalt(slug, git)) return 'none';
  return await cleanJournal(worktree, { slug: read.slug, blob: read.blob, journal: read.journal }, git)
    ? 'cleaned'
    : 'unavailable';
}

type ResumePlannedResult =
  | { readonly kind: 'resumed'; readonly journal: StoredRestackJournal }
  | {
    readonly kind: 'flatten-refused';
    readonly journal: StoredRestackJournal;
    readonly range: ChildRange;
    readonly merge: CommitSha;
  }
  | {
    readonly kind: 'ownership-refused';
    readonly journal: StoredRestackJournal;
    readonly child: ChildRange['child'];
    readonly paths: readonly string[];
  }
  | {
    readonly kind: 'resolution-stale';
    readonly journal: StoredRestackJournal;
    readonly child: ChildRange['child'];
    readonly field: 'record' | 'range' | 'parent-tree';
  }
  | {
    readonly kind: 'conflict-unresolved';
    readonly journal: StoredRestackJournal;
    readonly child: ChildRange['child'];
    /** The live parent used for this replay, not the range's historical parent. */
    readonly newParent: CommitSha;
    /** Ordered subjects from the resolver's engine-owned replay todo. */
    readonly candidateSubjects: readonly string[];
    readonly commit: CommitSha;
    readonly paths: readonly string[];
    readonly detail?: string;
  }
  | { readonly kind: 'unavailable' };

interface ReplayConflict {
  readonly commit: CommitSha;
  readonly paths: readonly string[];
}

/** Match executor conflict diagnosis before handing the exact range to the resolver. */
async function replayConflict(git: GitRunner, slug: string, error: unknown): Promise<ReplayConflict | undefined> {
  const message = error instanceof Error ? error.message : String(error);
  const matched = /^merge-tree failed for ([0-9a-f]{40}|[0-9a-f]{64}):/m.exec(message);
  const commit = matched === null ? undefined : parseCommitSha(matched[1]!);
  if (!commit) return undefined;
  const changed = await runGit(git, ['diff', '--no-renames', '--name-only', `${commit}^`, commit]);
  if (changed?.exitCode !== 0) throw new Error(`cannot determine conflicted paths for ${commit}`);
  const haltRecordPath = haltRecordPathFor(slug);
  const paths = [...new Set((changed?.stdout ?? '').split('\n').map((path) => path.trim()).filter((path) => path && path !== haltRecordPath))]
    .sort((left, right) => left.localeCompare(right));
  return { commit, paths };
}

async function resumePlanned(
  worktree: string,
  journal: StoredRestackJournal,
  git: GitRunner,
  options: Pick<RecoverRestackJournalOptions, 'events' | 'resolver' | 'resolverCap'>,
): Promise<ResumePlannedResult> {
  if (!await refsStillAtOldValues(journal, git)) return { kind: 'unavailable' };
  let current = journal;
  let parent = current.journal.newDefault ?? current.journal.ranges[0]?.oldParent;
  if (!parent) return { kind: 'unavailable' };
  const lastOriginIndex = current.journal.cause === 'feature-repair'
    ? Math.max(-1, ...current.journal.ranges.map((range, index) => current.journal.originatingChildren?.includes(range.child) ? index : -1))
    : -1;
  for (const [rangeIndex, range] of current.journal.ranges.entries()) {
    const child = current.journal.children.find((entry) => entry.child === range.child);
    if (!child) return { kind: 'unavailable' };
    if (child.status !== 'pending') {
      const staged = await resolveSha(git, stagingRefFor(current.slug, range.child));
      if (!staged) return { kind: 'unavailable' };
      parent = staged;
      continue;
    }
    if (range.kind === 'leaf-unentered') {
      const owner = await unenteredLeafOwner(current, range, git);
      if (!owner) return { kind: 'unavailable' };
      const rewrites = new Map([[range.oldTip, owner.rewritten]]);
      const updated = await updateRestackChildStatus(worktree, current.slug, current, range.child, 'replayed', owner.rewritten, rewrites, { git });
      if (updated.kind !== 'updated') return { kind: 'unavailable' };
      current = updated.journal;
      parent = owner.rewritten;
      continue;
    }
    // Feature repair retains every existing tip through the highest
    // originating child. Only descendants beyond that point are rebuilt.
    // A lower child that no longer descends from its adopted parent is
    // replayed onto it, exactly as the executor does.
    const adoptable = current.journal.cause === 'feature-repair' && rangeIndex <= lastOriginIndex
      ? await resolveSha(git, branchRefForRange(current.slug, range))
      : undefined;
    if (current.journal.cause === 'feature-repair' && rangeIndex <= lastOriginIndex && !adoptable) return { kind: 'unavailable' };
    const parentContained = adoptable === undefined || rangeIndex === 0
      ? true
      : await runGit(git, ['merge-base', '--is-ancestor', parent, adoptable]);
    if (parentContained !== true && (!parentContained || parentContained.exitCode > 1)) return { kind: 'unavailable' };
    if (adoptable !== undefined && (parentContained === true || parentContained.exitCode === 0)) {
      const adopted = adoptable;
      const updated = await updateRestackChildStatus(worktree, current.slug, current, range.child, 'replayed', adopted, new Map(), { git });
      if (updated.kind !== 'updated') return { kind: 'unavailable' };
      current = updated.journal;
      parent = adopted;
      continue;
    }
    {
      const recorded = await consumeRecordedResolution({
        slug: current.slug, range, parent, committer: current.journal.committer, git,
        replay: (replayRange, replayParent, replayCommitter, replayGit) => replayChildRange(
          replayRange, replayParent, replayCommitter, replayGit, { comparisonCommits: [] },
        ),
      });
      if (recorded.kind === 'stale') return { kind: 'resolution-stale', journal: current, child: range.child, field: recorded.field };
      if (recorded.kind === 'consumed') {
        const ownership = await checkPathOwnership(range, parent, recorded.tip, git);
        if (ownership.kind === 'refused') return { kind: 'ownership-refused', journal: current, child: range.child, paths: ownership.paths };
        const updated = await updateRestackChildStatus(worktree, current.slug, current, range.child, 'resolved', recorded.tip, recorded.rewrites, {
          git, consumedResolution: recorded.resolution,
        });
        if (updated.kind !== 'updated') return { kind: 'unavailable' };
        current = updated.journal;
        await options.events?.emit({
          type: 'restack_resolution',
          opId: current.journal.opId,
          child: range.child,
          action: 'consumed',
          tip: recorded.tip,
        });
        parent = recorded.tip;
        continue;
      }
    }
    let replay;
    try {
      replay = await replayChildRange(range, parent, current.journal.committer, git, {
        comparisonCommits: current.journal.comparisonCommits,
        appendOnlyRemUnion: current.journal.routed !== undefined,
        haltRecordSlug: current.slug,
      });
    } catch (error) {
      if (error instanceof RemBlockBodyMismatchError) {
        const candidates = await runGit(git, ['rev-list', '--reverse', `${range.oldParent}..${range.oldTip}`]);
        if (candidates?.exitCode !== 0) return { kind: 'unavailable' };
        return {
          kind: 'conflict-unresolved', journal: current, child: range.child, newParent: parent,
          candidateSubjects: await replayCandidateSubjects(git, (candidates?.stdout ?? '').split('\n').filter(Boolean) as CommitSha[]),
          commit: error.commit, paths: [error.path], detail: `remediation block body mismatch: ${error.remId}`,
        };
      }
      const conflict = await replayConflict(git, current.slug, error);
      if (!conflict) throw error;
      const merge = await mergeInRange(git, range);
      if (merge) return { kind: 'flatten-refused', journal: current, range, merge };
      const decisionDelivery = await prepareRestackDecisionDelivery({
        worktree, slug: current.slug, range, opId: current.journal.opId, git, events: options.events,
      });
      if (decisionDelivery === undefined) return { kind: 'unavailable' };
      const resolution = await resolveRestackConflict({
        worktree,
        range,
        newParent: parent,
        stamp: current.journal.committer,
        comparisonCommits: current.journal.comparisonCommits,
        haltRecordSlug: current.slug,
        resolver: options.resolver ?? (async () => ({ resolved: false, reason: 'restack resolver unavailable' })),
        cap: options.resolverCap ?? resolveRebaseResolutionAttempts(),
        ...(decisionDelivery.operatorDecision === undefined ? {} : { operatorDecision: decisionDelivery.operatorDecision }),
        git,
      });
      if ((resolution.outcome.kind !== 'changed' && resolution.outcome.kind !== 'noop') || !resolution.tip) {
        return {
          kind: 'conflict-unresolved',
          journal: current,
          child: range.child,
          newParent: parent,
          candidateSubjects: await replayCandidateSubjects(git, resolution.candidates),
          commit: conflict.commit,
          paths: conflict.paths,
          detail: [
            ...restackDecisionDetailLines(decisionDelivery),
            ...('reason' in resolution.outcome ? [resolution.outcome.reason] : []),
          ].join('\n') || undefined,
        };
      }
      const ownership = await checkPathOwnership(range, parent, resolution.tip, git, { normaliseInheritedRemBlocks: current.journal.routed !== undefined });
      if (ownership.kind === 'refused') {
        return { kind: 'ownership-refused', journal: current, child: range.child, paths: ownership.paths };
      }
      const updated = await updateRestackChildStatus(
        worktree,
        current.slug,
        current,
        range.child,
        'resolved',
        resolution.tip,
        resolution.rewrites,
        {
          git,
          ...(decisionDelivery.deliveredDecision === undefined ? {} : { deliveredDecision: decisionDelivery.deliveredDecision }),
        },
      );
      if (updated.kind !== 'updated') return { kind: 'unavailable' };
      current = updated.journal;
      parent = resolution.tip;
      continue;
    }
    const ownership = await checkPathOwnership(range, parent, replay.tip, git, { normaliseInheritedRemBlocks: current.journal.routed !== undefined });
    if (ownership.kind === 'refused') {
      return { kind: 'ownership-refused', journal: current, child: range.child, paths: ownership.paths };
    }
    const updated = await updateRestackChildStatus(worktree, current.slug, current, range.child, 'replayed', replay.tip, replay.rewrites, { git });
    if (updated.kind !== 'updated') return { kind: 'unavailable' };
    current = updated.journal;
    parent = replay.tip;
  }
  const ready = await transition(worktree, current, 'ready', git);
  return ready === undefined ? { kind: 'unavailable' } : { kind: 'resumed', journal: ready };
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
  // A dead process may have restored only part of the stack. Restore each ref
  // still on its new side and pin each already-restored one; any other value
  // fails closed through the transaction's compare-and-swap.
  const reverse: string[] = [];
  for (const move of moves) {
    const live = await resolveSha(git, move.ref);
    if (live === move.oldSha) reverse.push(`verify ${move.ref} ${move.oldSha}`);
    else if (live === move.newSha) reverse.push(`update ${move.ref} ${move.oldSha} ${move.newSha}`);
    else return undefined;
  }
  const reversed = await runGit(git, ['update-ref', '--stdin'], transaction([
    ...reverse,
    ...journalStateUpdateLines(journal, blob, 'aborted'),
  ]));
  return reversed?.exitCode === 0 ? { slug: journal.slug, blob, journal: aborted } : undefined;
}

async function haltVerificationFailure(worktree: string, detail: string, events: ConductorEventEmitter | undefined): Promise<void> {
  await haltRestack(worktree, 'verification-failed', events, { detail });
}

async function abortHaltTargetRecovery(
  worktree: string,
  journal: StoredRestackJournal | undefined,
  moves: readonly RestackMoveRef[],
  git: GitRunner,
): Promise<void> {
  if (!journal) return;
  if (journal.journal.state === 'moved' && moves.length > 0) {
    await rollbackRestackMove(worktree, journal, moves, { git });
    return;
  }
  if (journal.journal.state === 'rolling-back' && moves.length > 0) {
    await rollBackFromRolling(worktree, journal, moves, git);
    return;
  }
  if (journal.journal.state === 'planned' || journal.journal.state === 'ready') {
    await transition(worktree, journal, 'aborted', git);
  }
}

/**
 * Continue or roll back a dead process's journal using only Git refs and the
 * journal blob.  `.pipeline` is deliberately neither read nor required.
 */
export async function recoverRestackJournal(options: RecoverRestackJournalOptions): Promise<RecoverRestackJournalResult> {
  const git = options.git ?? makeGitRunner(options.worktree);
  const stopAtSynced = options.target === 'synced';
  const read = await readRestackJournal(options.worktree, options.slug, { git });
  if (read.kind === 'missing') return { kind: 'none' };
  if (read.kind === 'unreadable') {
    const detail = await corruptJournalRefValues(options.slug, git);
    if (!stopAtSynced) await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail });
    return { kind: 'unavailable', detail: `cannot read restack journal ${journalRefFor(options.slug)}` };
  }
  // An aborted journal is terminal: its owner wrote its last state and only
  // leaves cleanup behind.  A long-lived daemon that halted a restack is still
  // that owner at its next dispatch, so liveness must not block the cleanup.
  if (read.journal.state !== 'aborted'
    && !(read.journal.state === 'applied' && options.suppressFollowOn)
    && await isJournalOwnerAlive(read.journal.owner)) return { kind: 'live-owner', owner: read.journal.owner };

  let journal: StoredRestackJournal | undefined = { slug: read.slug, blob: read.blob, journal: read.journal };
  let moves: RestackMoveRef[] = [];
  const unavailableAfterHaltTargetAbort = async (detail: string): Promise<RecoverRestackJournalResult> => {
    if (stopAtSynced) await abortHaltTargetRecovery(options.worktree, journal, moves, git).catch(() => {});
    return { kind: 'unavailable', detail };
  };
  try {
    if (journal.journal.state === 'applied') {
      if (journal.journal.followOnCause !== undefined) {
        if (options.suppressFollowOn) {
          return await cleanJournal(options.worktree, journal, git)
            ? { kind: 'cleaned' }
            : { kind: 'unavailable', detail: 'cannot remove applied restack journal' };
        }
        if (journal.journal.followOnCause === 'base-refresh' && await routedRoundOpen(options.worktree, options.slug, { git })) {
          await options.rearmRekick?.();
          await options.events?.emit(emitRestackRefused({ reason: 'deferred-base-refresh' }));
          return await cleanJournal(options.worktree, journal, git)
            ? { kind: 'cleaned' }
            : { kind: 'unavailable', detail: 'cannot remove deferred applied restack journal' };
        }
        if (await publishedStackRefusal(options.worktree, options.slug, { git })) {
          await haltRestack(options.worktree, 'published-stack', options.events, {
            child: journal.journal.ranges[0]?.child,
          });
          return { kind: 'halted' };
        }
        const result = await runRestack({
          worktree: options.worktree,
          slug: options.slug,
          cause: journal.journal.followOnCause,
          git,
          ...(options.events === undefined ? {} : { events: options.events }),
          ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
          ...(options.resolverCap === undefined ? {} : { resolverCap: options.resolverCap }),
          replacesAppliedJournal: journal,
        });
        if (result.kind === 'unavailable') return { kind: 'unavailable', detail: result.detail };
        // Losing the follow-on replacement means another live operation now
        // owns the journal; recovery must not report it as cleaned.
        if (result.kind !== 'refused') return { kind: 'cleaned' };
        const current = await readRestackJournal(options.worktree, options.slug, { git });
        return current.kind === 'journal'
          ? { kind: 'live-owner', owner: current.journal.owner }
          : { kind: 'live-owner' };
      }
      return await cleanJournal(options.worktree, journal, git) ? { kind: 'cleaned' } : { kind: 'unavailable', detail: 'cannot remove applied restack journal' };
    }
    if (journal.journal.state === 'aborted') {
      const cleaned = await cleanClearedAbortedRestackJournal(options.worktree, options.slug, { git });
      return cleaned === 'cleaned' ? { kind: 'cleaned' }
        : cleaned === 'unavailable' ? { kind: 'unavailable', detail: 'cannot remove aborted restack journal' }
          : { kind: 'none' };
    }
    const fromState = journal.journal.state as Exclude<JournalState, 'applied' | 'aborted'>;
    if (journal.journal.state === 'planned') {
      if (stopAtSynced) {
        await transition(options.worktree, journal, 'aborted', git);
        await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
        return { kind: 'recovered', fromState };
      }
      const resumed = await resumePlanned(options.worktree, journal, git, options);
      if (resumed.kind === 'flatten-refused') {
        journal = resumed.journal;
        if (!await pinStagingRef(options.worktree, options.slug, resumed.range.child, resumed.range.oldTip, { git })) {
          return { kind: 'unavailable', detail: `cannot pin original tip for merge-bearing child ${resumed.range.child}` };
        }
        const aborted = await transition(options.worktree, journal, 'aborted', git);
        if (!aborted) return { kind: 'unavailable', detail: 'cannot abort merge-bearing recovered restack conflict' };
        await haltRestack(options.worktree, 'flatten_refused', options.events, {
          child: resumed.range.child,
          detail: `merge ${resumed.merge}; resolve the conflict on child branch ${branchRefForRange(options.slug, resumed.range).slice('refs/heads/'.length)} and resume`,
        });
        return { kind: 'halted' };
      }
      if (resumed.kind === 'conflict-unresolved') {
        journal = resumed.journal;
        if (!await pinStagingRef(options.worktree, options.slug, resumed.child, journal.journal.ranges.find((range) => range.child === resumed.child)!.oldTip, { git })) {
          return { kind: 'unavailable', detail: `cannot pin original tip for conflicted child ${resumed.child}` };
        }
        const aborted = await transition(options.worktree, journal, 'aborted', git);
        if (!aborted) return { kind: 'unavailable', detail: 'cannot abort unresolved recovered restack conflict' };
        await options.events?.emit({
          type: 'restack_conflict',
          opId: journal.journal.opId,
          child: resumed.child,
          commit: resumed.commit,
          paths: [...resumed.paths],
        });
        const detail = `commit ${resumed.commit}; paths: ${resumed.paths.join(', ')}${resumed.detail === undefined ? '' : `\n${resumed.detail}`}`;
        const range = journal.journal.ranges.find((candidate) => candidate.child === resumed.child)!;
        await haltRecordedRestackConflict({
          worktree: options.worktree, slug: options.slug, journal, range,
          replayParent: resumed.newParent,
          candidateSubjects: resumed.candidateSubjects, commit: resumed.commit, paths: resumed.paths,
          detail, events: options.events, git, writeHalt: haltRestackConflict,
        });
        return { kind: 'halted' };
      }
      if (resumed.kind === 'ownership-refused') {
        journal = resumed.journal;
        const aborted = await transition(options.worktree, journal, 'aborted', git);
        if (!aborted) return { kind: 'unavailable', detail: 'cannot abort ownership-refused recovered restack' };
        await haltRestack(options.worktree, 'replay-mismatch', options.events, {
          child: resumed.child,
          detail: resumed.paths.join(', '),
        });
        return { kind: 'halted' };
      }
      if (resumed.kind === 'resolution-stale') {
        journal = resumed.journal;
        const aborted = await transition(options.worktree, journal, 'aborted', git);
        if (!aborted) return { kind: 'unavailable', detail: 'cannot abort stale recovered restack resolution' };
        await haltRestack(options.worktree, 'restack-resolution-stale', options.events, {
          child: resumed.child,
          detail: resumed.field,
        });
        return { kind: 'halted' };
      }
      if (resumed.kind !== 'resumed') {
        // A planned journal has never moved a production ref.  If an operator
        // changed one of its inputs, discard its now-untrustworthy staged
        // commits rather than replaying across a different stack.
        if (!await refsStillAtOldValues(journal, git)) {
          const aborted = await transition(options.worktree, journal, 'aborted', git);
          if (!aborted || !await cleanJournal(options.worktree, aborted, git)) {
            return { kind: 'unavailable', detail: 'cannot abort changed planned restack journal' };
          }
          if (!stopAtSynced) await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail: 'a journaled input ref changed before recovery' });
          await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
          return { kind: 'recovered', fromState };
        }
        return { kind: 'unavailable', detail: 'cannot resume planned restack journal from durable refs' };
      }
      journal = resumed.journal;
    }

    moves = await movesFor(journal, git) ?? [];
    if (moves.length === 0) return unavailableAfterHaltTargetAbort('cannot reconstruct restack move from journal refs');
    const checkedOut = await checkedOutRef(git);
    if (!checkedOut) return unavailableAfterHaltTargetAbort('restack recovery requires a checked-out feature branch');

    if (journal.journal.state === 'ready') {
      const sides = await movedRefSides(journal, moves, checkedOut, git);
      if ([...sides.values()].some((side) => side !== 'old' && side !== 'unchanged')) {
        const aborted = await transition(options.worktree, journal, 'aborted', git);
        if (!aborted) return { kind: 'unavailable', detail: 'cannot abort changed recovered restack' };
        if (!stopAtSynced) await haltChangedJournalRefs(options.worktree, journal, options.events, git);
        return { kind: 'recovered', fromState };
      }
      const preMove = await checkRestackPreMove(options.worktree, moves, checkedOut, { git });
      if (preMove.kind === 'refused') {
        const aborted = await transition(options.worktree, journal, 'aborted', git);
        if (!aborted) return { kind: 'unavailable', detail: 'cannot abort refused recovered restack' };
        if (!stopAtSynced) await haltRestack(options.worktree, preMove.reason, options.events, { detail: preMove.detail });
        await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
        return { kind: 'recovered', fromState };
      }
      if (preMove.kind !== 'clear') return { kind: 'unavailable', detail: preMove.detail };
      const moved = await applyRestackMove(options.worktree, journal, moves, { git, events: options.events });
      if (moved.kind !== 'moved') return { kind: 'unavailable', detail: moved.detail };
      journal = moved.journal;
    }

    if (journal.journal.state === 'moved') {
      const sides = await movedRefSides(journal, moves, checkedOut, git);
      if ([...sides.values()].some((side) => side !== 'new' && side !== 'unchanged')) {
        if (!stopAtSynced) await haltChangedJournalRefs(options.worktree, journal, options.events, git);
        return { kind: 'unavailable', detail: 'journaled refs no longer match the moved side' };
      }
      const verified = await verifyMovedRecovery(options.worktree, journal, moves, checkedOut, git);
      if (verified.kind === 'failed') {
        const rolledBack = await rollbackRestackMove(options.worktree, journal, moves, { git });
        if (rolledBack.kind !== 'aborted') return { kind: 'unavailable', detail: rolledBack.detail };
        if (!stopAtSynced) await haltVerificationFailure(options.worktree, verified.detail, options.events);
        await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
        return { kind: 'recovered', fromState };
      }
      if (verified.kind !== 'verified') return { kind: 'unavailable', detail: verified.detail };
      const checkedOutMove = moves.find((move) => move.ref === checkedOut);
      if (!checkedOutMove) return { kind: 'unavailable', detail: 'checked-out branch is not in recovered restack' };
      try {
        await syncRestackedWorktree(options.worktree, checkedOutMove.oldSha, checkedOutMove.newSha, { git });
      } catch (error) {
        if (!(error instanceof RestackSyncOperatorEditError)) throw error;
        const rolledBack = await rollbackRestackMove(options.worktree, journal, moves, { git });
        if (rolledBack.kind !== 'aborted') return { kind: 'unavailable', detail: rolledBack.detail };
        if (!stopAtSynced) await haltRestack(options.worktree, 'dirty-overlap', options.events, { detail: error.path });
        await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
        return { kind: 'recovered', fromState };
      }
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
      if (stopAtSynced) {
        await options.events?.emit({ type: 'restack_recovered', opId: journal.journal.opId, fromState });
        return { kind: 'recovered', fromState };
      }
      const activeMove = moves.find((move) => move.ref === checkedOut);
      if (!activeMove?.child) return { kind: 'unavailable', detail: 'cannot identify active child for recovered transition' };
      const transitionResult = await applyRestackTransition({
        worktree: options.worktree,
        cause: journal.journal.cause,
        opId: journal.journal.opId,
        oldDefault: journal.journal.cause === 'feature-repair'
          ? journal.journal.newDefault ?? journal.journal.ranges[0]!.oldParent
          : journal.journal.ranges[0]!.oldParent,
        newDefault: journal.journal.newDefault ?? journal.journal.ranges[0]!.oldParent,
        activeChild: activeMove.child,
        ranges: journal.journal.ranges,
        moves,
        git,
        rewritesByChild: new Map(journal.journal.children.flatMap((entry) => entry.rewrites === undefined
          ? []
          : [[entry.child, new Map(entry.rewrites.map(({ from, to }) => [from, to]))] as const])),
        ...(options.events === undefined ? {} : { events: options.events }),
      });
      try {
        journal = await journalRoutedApplyPlan(options.worktree, journal, transitionResult, git);
      } catch (error) {
        if (error instanceof RoutedApplyPlanRefChangedError) {
          await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail: error.ref });
          return { kind: 'halted' };
        }
        throw error;
      }
      const appliedTransaction = await restackTransactionBuilder.appliedTransactionLines(options.worktree, journal, git);
      const appliedWrite = await runGit(git, ['update-ref', '--stdin'], transaction(appliedTransaction.lines));
      if (appliedWrite?.exitCode !== 0) {
        const changed = await changedRoutedAppliedRef(journal, git);
        if (changed !== undefined) {
          await haltRestack(options.worktree, 'stack-ref-changed', options.events, { detail: changed });
          return { kind: 'halted' };
        }
        return { kind: 'unavailable', detail: 'cannot apply recovered restack transition' };
      }
      const applied = appliedTransaction.journal;
      if (applied.journal.followOnCause === undefined && !await cleanJournal(options.worktree, applied, git)) {
        return { kind: 'unavailable', detail: 'cannot clean recovered restack journal' };
      }
    }
    await options.events?.emit({ type: 'restack_recovered', opId: read.journal.opId, fromState });
    return { kind: 'recovered', fromState };
  } catch (error) {
    if (stopAtSynced) await abortHaltTargetRecovery(options.worktree, journal, moves, git).catch(() => {});
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
}
