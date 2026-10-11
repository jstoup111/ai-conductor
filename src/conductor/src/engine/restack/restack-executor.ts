import { randomUUID } from 'node:crypto';

import { parseChildId, type ChildId } from '../child-context.js';
import { resolveActiveChild } from '../child-cursor.js';
import { childBranchFor, leafBranchFor, parseFeatureBranch } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner, writeSealHalt } from '../rebase.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import {
  createRestackJournal,
  journalRefFor,
  pinStagingRef,
  replaceAppliedJournalWithFollowOn,
  stagingRefFor,
  updateRestackChildStatus,
  writeRestackJournalBlob,
  journalStateUpdateLines,
  type RestackJournalDraft,
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
import { replayChildRange, type CommitterStamp } from './restack-replay.js';
import { resolveRestackConflict, type RestackResolver } from './restack-resolver.js';
import { resolveRebaseResolutionAttempts } from '../resolved-config.js';
import { syncRestackedWorktree } from './restack-sync.js';
import { applyRestackTransition } from './restack-transition.js';
import { cleanClearedAbortedRestackJournal } from './restack-recovery.js';
import { cascadeUpdateLines, checkCascadeCap, MAX_RESTACK_CASCADES_PER_CHILD, readCascadeCounts } from './cascade-cap.js';
import { readKickbackLedger, recordKickbackCapEvidence } from '../kickback-ledger.js';
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

async function commitsInRange(git: GitRunner, range: string, context: string): Promise<CommitSha[]> {
  const result = await runGit(git, ['rev-list', '--reverse', range]);
  if (result.exitCode !== 0) throw new Error(`cannot list ${context}`);
  return result.stdout.split('\n').filter(Boolean).map((value) => {
    const commit = parseCommitSha(value);
    if (!commit) throw new Error(`cannot parse ${context} commit`);
    return commit;
  });
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

async function activeFor(worktree: string, slug: string, git: GitRunner): Promise<{ child: ChildId; branchRef: RefName; isLeaf: boolean; unenteredLeaf?: ChildId }> {
  const cursor = await resolveActiveChild(worktree, slug, { git });
  if (cursor.kind === 'active' || cursor.kind === 'repair-pending') {
    const branch = ref(`refs/heads/${cursor.branch}`);
    // The sealed cursor, rather than the checkout, is authoritative.  This
    // also preserves declared gaps such as c1 -> c3.
    return { child: cursor.child, branchRef: branch, isLeaf: cursor.isLeaf, ...(cursor.nextChild === undefined ? {} : { unenteredLeaf: cursor.nextChild }) };
  }
  // N=1/older stack records predate the sealed envelope. Keep their existing
  // ref-only recovery path, but never use it when a sealed cursor exists.
  if (cursor.kind !== 'envelope-missing' && cursor.kind !== 'no-child') throw new Error(`cannot resolve restack cursor: ${cursor.kind}`);
  const head = await checkedOutRef(git);
  const identity = parseFeatureBranch(head.slice('refs/heads/'.length));
  if (identity.kind === 'child' && identity.slug === slug) return { child: identity.child, branchRef: head, isLeaf: false };
  if (identity.kind !== 'leaf' || identity.slug !== slug) throw new Error('restack requires this feature\'s checked-out branch');
  const closed = await runGit(git, ['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/closed/`]);
  if (closed.exitCode !== 0) throw new Error('cannot inspect closed child refs');
  const ids = closed.stdout.split('\n').flatMap((entry) => {
    const matched = /\/closed\/c([1-9][0-9]*)$/.exec(entry.trim());
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

/** Apply the terminal journal transition and the repair cascade charge atomically. */
export async function transitionAppliedWithCascade(
  worktree: string,
  journal: StoredRestackJournal,
  originatingChildren: readonly ChildId[],
  git: GitRunner,
): Promise<StoredRestackJournal> {
  if (!isLegalJournalTransition(journal.journal.state, 'applied')) throw new Error('illegal restack state transition to applied');
  const next = { ...journal.journal, state: 'applied' as const };
  const blob = await writeRestackJournalBlob(worktree, next, { git });
  const updates = await cascadeUpdateLines(worktree, journal.slug, originatingChildren, { git });
  if (updates.kind !== 'lines') throw new Error(updates.detail);
  const updated = await runGit(git, ['update-ref', '--stdin'], transaction([
    ...updates.lines,
    ...journalStateUpdateLines(journal, blob, 'applied'),
  ]));
  if (updated.exitCode !== 0) throw new Error('cannot transition restack journal to applied with cascade counts');
  return { slug: journal.slug, blob, journal: next };
}

async function restackCascadeLimit(worktree: string, slug: string, activeChild: ChildId): Promise<number> {
  const cascades = await readCascadeCounts(worktree, slug);
  if (cascades.kind === 'unreadable') throw new Error(`cannot read restack cascade counters: ${cascades.detail}`);
  const durableLimit = cascades.counts.limits?.[String(activeChild)];
  if (durableLimit !== undefined) return durableLimit;
  const ledger = await readKickbackLedger(worktree, activeChild);
  if (ledger.unreadable) throw new Error('cannot read active child kickback ledger for restack cascade cap');
  return ledger.gates.restack?.effectiveLimit ?? MAX_RESTACK_CASCADES_PER_CHILD;
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
async function replayConflict(git: GitRunner, error: unknown): Promise<ReplayConflict | undefined> {
  const message = error instanceof Error ? error.message : String(error);
  const matched = /^merge-tree failed for ([0-9a-f]{40}|[0-9a-f]{64}):/m.exec(message);
  const commit = matched === null ? undefined : parseCommitSha(matched[1]!);
  if (!commit) return undefined;
  const changed = await runGit(git, ['diff', '--no-renames', '--name-only', `${commit}^`, commit]);
  if (changed.exitCode !== 0) throw new Error(`cannot determine conflicted paths for ${commit}`);
  const paths = [...new Set(changed.stdout.split('\n').map((path) => path.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  return { commit, paths };
}

async function mergeInRange(git: GitRunner, range: ChildRange): Promise<CommitSha | undefined> {
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
  reason: 'conflict' | 'replay-mismatch',
  resolutionDetail?: string,
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
  else await haltRestackConflict(worktree, range.child, detail, events);
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
    // The caller has already superseded the committed halt record and consumed
    // any matching authorization.  Do one narrow, terminal-only recheck here
    // so a cleared halt cannot make the next restack look outstanding.
    const staleCleanup = await cleanClearedAbortedRestackJournal(options.worktree, options.slug, { git });
    if (staleCleanup === 'unavailable') return { kind: 'unavailable', detail: 'cannot remove cleared aborted restack journal' };
    const active = await activeFor(options.worktree, options.slug, git);
    // A feature repair preserves its original base. Resolving origin/main here
    // would silently turn a repair into a base refresh.
    const newDefault = options.cause === 'feature-repair'
      ? undefined
      : await defaultTip(git, options.newDefault);
    const planningDefault = newDefault ?? await requiredSha(git, `refs/conductor/${options.slug}/closed/c${active.child}`, 'active closure').catch(async () => {
      const result = await runGit(git, ['merge-base', active.branchRef, 'HEAD']);
      const parsed = result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
      if (!parsed) throw new Error('cannot resolve old default for feature repair');
      return parsed;
    });
    const plan = await planRestackRanges(options.worktree, {
      slug: options.slug,
      oldDefaultTip: planningDefault,
      cause: options.cause,
      active,
      ...(active.isLeaf ? {} : {
        unenteredLeaf: { child: active.unenteredLeaf ?? parseChildId(active.child + 1)!, branchRef: ref(`refs/heads/${leafBranchFor(options.slug)}`) },
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

    if (options.cause === 'feature-repair') {
      const limit = await restackCascadeLimit(options.worktree, options.slug, active.child);
      const cap = await checkCascadeCap(options.worktree, options.slug, plan.originating, limit, { git });
      if (cap.kind === 'exhausted') {
        const entry = await recordKickbackCapEvidence(options.worktree, 'restack', {
          consumed: cap.count,
          limit: cap.limit,
          latestReason: `restack cascade cap for originating child ${cap.child}`,
          allowance: 'restacks',
        }, active.child);
        const rendered = renderKickbackBudgetView(entry, 'restack', cap.limit, undefined, undefined, active.child);
        await haltRestack(options.worktree, 'cascade-cap', options.events, {
          child: cap.child,
          detail: `${cap.detail ?? `originating child ${cap.child} reached ${cap.count}/${cap.limit} cascades`}\n${rendered}\nKickback halt generation: ${entry.capEvidence!.haltGeneration}`,
        });
        terminal = true;
        return { kind: 'halted' };
      }
    }

    const comparison = await comparisonCommits(git, options.cause, plan.ranges, planningDefault);
    const draft: RestackJournalDraft = {
      opId: randomUUID() as RestackOpId,
      cause: options.cause,
      ...(options.followOnCause === undefined ? {} : { followOnCause: options.followOnCause }),
      committer: await committerStamp(git),
      newDefault: planningDefault,
      comparisonCommits: comparison,
      ...(options.cause === 'feature-repair' ? { originatingChildren: plan.originating } : {}),
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
      await haltRestack(options.worktree, created.reason, options.events);
      return { kind: 'halted' };
    }
    if (created.kind === 'unavailable') throw new Error(created.detail);
    journal = created.journal;
    await options.events?.emit({ type: 'restack_planned', opId: draft.opId, cause: draft.cause, children: plan.ranges.map((range) => range.child) });

    const newStackCommits = comparison;
    const mergeAudit = { flattenedMerges: [] as string[], ancestryOnlyMerges: [] as string[], sideLineageCount: 0 };
    const overlaps = new Map<number, string[]>();
    const exactRewrites = new Map<ChildId, ReadonlyMap<CommitSha, CommitSha>>();
    const unenteredLeafOwners = new Map<ChildId, ChildId>();
    let parent = planningDefault;
    const lastOriginIndex = options.cause === 'feature-repair'
      ? Math.max(-1, ...plan.ranges.map((range, index) => plan.originating.includes(range.child) ? index : -1))
      : -1;
    for (const [rangeIndex, range] of plan.ranges.entries()) {
      if (range.kind === 'leaf-unentered') {
        const matches = [...exactRewrites.entries()]
          .flatMap(([child, rewrites]) => {
            const rewritten = rewrites.get(range.oldTip);
            return rewritten === undefined ? [] : [{ child, rewritten }];
          });
        if (matches.length !== 1) {
          throw new Error(`cannot resolve unentered leaf ${range.child} from its owning child rewrite map`);
        }
        const { child: owner, rewritten } = matches[0]!;
        const rewrites = new Map([[range.oldTip, rewritten]]);
        const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'replayed', rewritten, rewrites, { git });
        if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while moving unentered leaf' : updated.detail);
        journal = updated.journal;
        unenteredLeafOwners.set(range.child, owner);
        overlaps.set(range.child, []);
        parent = rewritten;
        continue;
      }
      // Repair leaves all existing lower tips intact. Only descendants of the
      // highest originating child are rebuilt on the new closure chain.
      if (options.cause === 'feature-repair' && rangeIndex <= lastOriginIndex) {
        const adopted = await requiredSha(git, branchRefForRange(options.slug, range), `branch for child ${range.child}`);
        const updated = await updateRestackChildStatus(options.worktree, options.slug, journal, range.child, 'replayed', adopted, new Map(), { git });
        if (updated.kind !== 'updated') throw new Error(updated.kind === 'stale' ? 'restack journal changed while adopting child' : updated.detail);
        journal = updated.journal;
        overlaps.set(range.child, []);
        parent = adopted;
        continue;
      }
      let replay;
      try {
        replay = await replayChildRange(range, parent, journal.journal.committer, git, {
          comparisonCommits: newStackCommits,
        });
      } catch (error) {
        const conflict = await replayConflict(git, error);
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
          return { kind: 'halted' };
        }
        const resolution = await resolveRestackConflict({
          worktree: options.worktree,
          range,
          newParent: parent,
          stamp: journal.journal.committer,
          comparisonCommits: newStackCommits,
          resolver: options.resolver ?? (async () => ({ resolved: false, reason: 'restack resolver unavailable' })),
          cap: options.resolverCap ?? resolveRebaseResolutionAttempts(),
          git,
        });
        if ((resolution.outcome.kind !== 'changed' && resolution.outcome.kind !== 'noop') || !resolution.tip) {
          const detail = 'reason' in resolution.outcome ? resolution.outcome.reason : undefined;
          await haltUnresolvedConflict(options.worktree, options.slug, journal, range, conflict, options.events, git, 'conflict', detail);
          terminal = true;
          return { kind: 'halted' };
        }
        const ownership = await checkPathOwnership(range, parent, resolution.tip, git);
        if (ownership.kind === 'refused') {
          await haltUnresolvedConflict(options.worktree, options.slug, journal, range, { ...conflict, paths: ownership.paths }, options.events, git, 'replay-mismatch');
          terminal = true;
          return { kind: 'halted' };
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
      const ownership = await checkPathOwnership(range, parent, replay.tip, git);
      if (ownership.kind === 'refused') {
        await abortJournal(options.worktree, journal, git, moves);
        await haltRestack(options.worktree, 'replay-mismatch', options.events, {
          child: range.child,
          detail: ownership.paths.join(', '),
        });
        terminal = true;
        return { kind: 'halted' };
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
      return { kind: 'halted' };
    }
    if (preMove.kind === 'seal-refused') {
      await abortJournal(options.worktree, journal, git, moves);
      await writeSealHalt(options.worktree, preMove.detail, options.events);
      terminal = true;
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
      return { kind: 'halted' };
    }
    if (verified.kind === 'unavailable') throw new Error(verified.detail);

    const checkedOutMove = moves.find((move) => move.ref === checkedOut);
    if (!checkedOutMove) throw new Error('checked-out branch is not part of restack move');
    await syncRestackedWorktree(options.worktree, checkedOutMove.oldSha, checkedOutMove.newSha, { git });
    journal = await transitionState(options.worktree, journal, 'synced', git);

    const transition = await applyRestackTransition({
      worktree: options.worktree,
      cause: options.cause,
      newDefault: planningDefault,
      activeChild: active.child,
      ranges: plan.ranges,
      moves,
      git,
      rewritesByChild: exactRewrites,
      ...(options.events === undefined ? {} : { events: options.events }),
    });
    journal = options.cause === 'feature-repair'
      ? await transitionAppliedWithCascade(options.worktree, journal, plan.originating, git)
      : await transitionState(options.worktree, journal, 'applied', git);
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
