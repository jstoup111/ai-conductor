import { access, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StepName } from '../../types/index.js';
import { CHILD_REGION_STEPS, isRegionStep, pipelinePathFor, type ChildId } from '../child-context.js';
import { createFilesystemConductStateStore } from '../filesystem-conduct-state-store.js';
import { checkGateCompletion, readVerdict, type RebasePreservedCandidate, type ReplayEvidence } from '../gate-verdicts.js';
import { classifyReplayGateInvalidation } from '../gate-invalidation.js';
import type { RegionGate, RevalidationQueueEntry } from '../routing/route-types.js';
import {
  applyRebaseVerdicts,
  emitGateInvalidationEvents,
  filterCodeOrTestPaths,
  resolveReviewInputs,
  type GitRunner,
  type RebaseOutcome,
} from '../rebase.js';
import { compareReplayTree, type ReplayComparison, type ReplayIdentity } from '../rebase-replay.js';
import { applyRebaseTransition } from '../rebase-transition.js';
import { translateAfterRebase } from '../rebase-translate.js';
import { readState } from '../state.js';
import { parsePlanTaskBlocks } from '../plan-task-parse.js';
import { stripInheritedRemBlocks } from '../routing/rem-block-merge.js';
import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import type { RestackMoveRef } from './restack-move.js';
import type { ChildRange, CommitSha, RestackCause } from './restack-types.js';

export interface ApplyRestackTransitionOptions {
  readonly worktree: string;
  readonly cause: RestackCause;
  /** The restack operation id; every verdict transition and refund receipt uses it. */
  readonly opId?: string;
  /** The default tip before this restack. */
  readonly oldDefault: CommitSha;
  /** The default tip after this restack (unchanged for a repair). */
  readonly newDefault: CommitSha;
  readonly activeChild: ChildId;
  readonly ranges: readonly ChildRange[];
  readonly moves: readonly RestackMoveRef[];
  /** Exact replay identities retained by the executor or recovered journal. */
  readonly rewritesByChild?: ReadonlyMap<ChildId, ReadonlyMap<CommitSha, CommitSha>>;
  /** Gate-owned freshness check for preserved closed-child verdicts. */
  readonly isRegionGateFresh?: (gate: RegionGate, child: ChildId) => Promise<boolean>;
  readonly git: GitRunner;
  readonly events?: ConductorEventEmitter;
}

export interface RestackTransitionResult {
  readonly wouldInvalidate: ReadonlyMap<ChildId, readonly StepName[]>;
  /** Closed children whose region gates cannot be safely retained. */
  readonly queueInvalidation: readonly RevalidationQueueEntry[];
}

interface RestackTuple {
  readonly previous: CommitSha;
  readonly base: CommitSha;
  readonly onto: CommitSha;
  readonly head: CommitSha;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function changedPaths(git: GitRunner, from: CommitSha, to: CommitSha): Promise<string[]> {
  const result = await git(['diff', '--name-only', from, to]);
  if (result.exitCode !== 0) throw new Error(`cannot compare restack transition ${from}..${to}`);
  return result.stdout.split('\n').map((path) => path.trim()).filter(Boolean);
}

async function showPath(git: GitRunner, ref: CommitSha, path: string): Promise<string | undefined> {
  const result = await git(['show', `${ref}:${path}`]);
  return result.exitCode === 0 ? result.stdout : undefined;
}

interface NormalizedRemPlanSurface {
  readonly authored: string;
  readonly remBlocks: readonly [string, string][];
}

/**
 * The conflict resolver preserves task blocks but may attach a separator to
 * the preceding block body. Compare the inherited-rem-free surfaces rather
 * than treating that formatting detail as a child replay change.
 */
function normalizedRemPlanSurface(plan: string, parent: string): NormalizedRemPlanSurface | undefined {
  const entries = [...parsePlanTaskBlocks(plan)];
  const parentBlocks = parsePlanTaskBlocks(parent);
  const firstRem = entries.findIndex(([id]) => id.startsWith('rem-'));
  if (firstRem === -1 || entries.slice(firstRem).some(([id]) => !id.startsWith('rem-'))) return undefined;
  const firstHeading = entries[firstRem]![1].heading;
  const firstStart = plan.startsWith(firstHeading) ? 0 : plan.indexOf(`\n${firstHeading}`);
  if (firstStart === -1) return undefined;
  const remBlocks = entries.slice(firstRem)
    .filter(([id, block]) => {
      const inherited = parentBlocks.get(id);
      return inherited === undefined || `${inherited.heading}\n${inherited.body}`.trimEnd() !== `${block.heading}\n${block.body}`.trimEnd();
    })
    .map(([id, block]) => [id, `${block.heading}\n${block.body}`.trimEnd()] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
  return { authored: plan.slice(0, firstStart === 0 ? 0 : firstStart + 1).trimEnd(), remBlocks };
}

function sameInheritedRemSurface(before: string, oldParent: string, after: string, newParent: string): boolean {
  const left = normalizedRemPlanSurface(before, oldParent);
  const right = normalizedRemPlanSurface(after, newParent);
  return left !== undefined && right !== undefined &&
    left.authored === right.authored && JSON.stringify(left.remBlocks) === JSON.stringify(right.remBlocks);
}

/** Remove only plan deltas that are byte-for-byte inherited rem blocks from their respective parents. */
async function normalizeInheritedRemPaths(git: GitRunner, tuple: RestackTuple, paths: readonly string[]): Promise<string[]> {
  const normalized: string[] = [];
  for (const path of paths) {
    if (!path.startsWith('.docs/plans/') || !path.endsWith('.md')) { normalized.push(path); continue; }
    const [before, after, oldParent, newParent] = await Promise.all([
      showPath(git, tuple.previous, path),
      showPath(git, tuple.head, path),
      showPath(git, tuple.base, path),
      showPath(git, tuple.onto, path),
    ]);
    if (
      before === undefined || after === undefined || oldParent === undefined || newParent === undefined ||
      (
        stripInheritedRemBlocks(before, oldParent) !== stripInheritedRemBlocks(after, newParent) &&
        !sameInheritedRemSurface(before, oldParent, after, newParent)
      )
    ) normalized.push(path);
  }
  return normalized;
}

/**
 * Prove that the replay retained the child's own surface when merge-tree
 * cannot construct a whole tree solely because the two sides appended rem
 * blocks to the same plan.  Non-plan paths remain eligible only when the new
 * parent did not touch them; a genuine overlapping code edit stays unproved.
 */
async function unchangedChildOwnedSurface(
  git: GitRunner,
  tuple: RestackTuple,
  childOwned: readonly string[],
): Promise<boolean> {
  for (const path of childOwned) {
    const [before, after, oldParent, newParent] = await Promise.all([
      showPath(git, tuple.previous, path),
      showPath(git, tuple.head, path),
      showPath(git, tuple.base, path),
      showPath(git, tuple.onto, path),
    ]);
    if (path.startsWith('.docs/plans/') && path.endsWith('.md')) {
      if (before === undefined || after === undefined || oldParent === undefined || newParent === undefined ||
          (stripInheritedRemBlocks(before, oldParent) !== stripInheritedRemBlocks(after, newParent) &&
           !sameInheritedRemSurface(before, oldParent, after, newParent))) return false;
      continue;
    }
    // A parent edit to a child-owned code/test path requires merge-tree's
    // exact reconstruction; do not infer that its conflict resolution held.
    if (oldParent !== newParent || before !== after) return false;
  }
  return true;
}

interface NormalizedReplayComparison {
  readonly comparison: ReplayComparison;
  /** Present only when child-owned replay normalization replaces a failed exact reconstruction. */
  readonly fallbackPaths?: readonly string[];
}

async function normalizedReplayComparison(
  git: GitRunner,
  tuple: RestackTuple,
  replay: ReplayIdentity,
): Promise<NormalizedReplayComparison> {
  // A restacked child owns only its old range. The new parent's changes are
  // inherited inputs, not evidence that this child changed its replay.
  // Normalize rem blocks on both sides before using this fallback so a union
  // resolution does not turn the parent's appended block into child work.
  const childOwned = await changedPaths(git, tuple.base, tuple.previous);
  const relevant = await normalizeInheritedRemPaths(git, tuple, childOwned);
  // Replay proof answers whether the child's contribution is unchanged. Gate
  // invalidation must still see independent runtime changes inherited from
  // the new parent, except for rem blocks normalized out of the plan surface.
  const invalidationPaths = await normalizeInheritedRemPaths(
    git,
    tuple,
    await changedPaths(git, tuple.previous, tuple.head),
  );
  const comparison = await compareReplayTree(git, replay);
  if (comparison.kind === 'unchanged') return { comparison };
  if (comparison.kind === 'changed') {
    if (relevant.length > 0 && !await unchangedChildOwnedSurface(git, tuple, childOwned)) return { comparison };
    return {
      comparison: { ...comparison, kind: 'unchanged' as const, expectedTree: comparison.completedTree },
      fallbackPaths: invalidationPaths,
    };
  }

  // A plan-only conflict makes merge-tree conservatively unproved even when
  // the resolved child-owned surface is identical. Bind the normalized result
  // to the actual completed tree rather than returning early on `unproved`.
  if (relevant.length > 0 && !await unchangedChildOwnedSurface(git, tuple, childOwned)) return { comparison };
  const completed = await git(['rev-parse', `${replay.completedHead}^{tree}`]);
  const completedTree = completed.exitCode === 0 ? completed.stdout.trim() : '';
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(completedTree)
    ? {
        comparison: { kind: 'unchanged', identity: replay, expectedTree: completedTree, completedTree },
        // The child-owned surface above is byte-for-byte retained after
        // inherited rem blocks are removed. Its replay is unchanged, while
        // independent parent runtime paths remain invalidation inputs.
        fallbackPaths: invalidationPaths,
      }
    : { comparison };
}

async function mergeBase(git: GitRunner, left: CommitSha, right: CommitSha): Promise<CommitSha> {
  const result = await git(['merge-base', left, right]);
  const value = result.stdout.trim();
  if (result.exitCode !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    throw new Error(`cannot resolve restack transition merge base ${left}..${right}`);
  }
  return value as CommitSha;
}

async function outcomeFor(worktree: string, git: GitRunner, tuple: RestackTuple): Promise<RebaseOutcome> {
  const delta = await normalizeInheritedRemPaths(git, tuple, await changedPaths(git, tuple.previous, tuple.head));
  if (delta.length === 0) {
    return { kind: 'noop', baseSha: tuple.onto, allChangedPaths: [] };
  }
  const featureSurface = await changedPaths(git, tuple.base, tuple.previous);
  return {
    kind: 'changed',
    baseSha: tuple.onto,
    changedCodePaths: filterCodeOrTestPaths(delta),
    allChangedPaths: delta,
    featureSurface,
    documentInputs: await resolveReviewInputs(worktree, delta),
    replay: {
      preRebaseHead: tuple.previous,
      mergeBase: tuple.base,
      target: tuple.onto,
      completedHead: tuple.head,
    },
  };
}

/**
 * Produces one revalidation obligation for a moved closed child when replay
 * proof cannot retain every one of its region gates. A gate verdict is the
 * existing gate-owned freshness decision: an absent, unreadable, or
 * unsatisfied record is therefore conservative evidence to re-run that gate.
 */
export async function queueInvalidation(
  worktree: string,
  git: GitRunner,
  range: ChildRange,
  move: RestackMoveRef,
  newParent: CommitSha,
  isRegionGateFresh: (gate: RegionGate, child: ChildId) => Promise<boolean> = async (gate, child) =>
    (await checkGateCompletion(worktree, gate, { activeChild: child })).done,
): Promise<RevalidationQueueEntry | undefined> {
  const outcome = await outcomeFor(worktree, git, {
    previous: range.oldTip,
    base: range.oldParent,
    onto: newParent,
    head: move.newSha,
  });
  if (outcome.kind !== 'changed' || outcome.replay === undefined) return undefined;

  const normalized = await normalizedReplayComparison(git, {
    previous: range.oldTip, base: range.oldParent, onto: newParent, head: move.newSha,
  }, outcome.replay);
  const projection = classifyReplayGateInvalidation(
    normalized.fallbackPaths ?? outcome.allChangedPaths ?? outcome.changedCodePaths,
    outcome.featureSurface ?? [],
    false,
    normalized.comparison,
    outcome.documentInputs,
  );
  const invalidated = new Set(projection.invalidated);
  const gates = (await Promise.all(CHILD_REGION_STEPS.map(async (gate) => {
    if (invalidated.has(gate)) return gate;
    const verdict = await readVerdict(worktree, gate, range.child);
    if (verdict?.satisfied !== true || !(await isRegionGateFresh(gate, range.child))) return gate;
    return undefined;
  }))).filter((gate): gate is RegionGate => gate !== undefined);
  if (gates.length === 0) return undefined;

  return {
    child: range.child,
    position: range.child,
    closureSha: move.newSha,
    gates,
    replay: { oldParent: range.oldParent, newParent },
    state: 'queued',
  };
}

interface RebaseVerdictDecision {
  readonly kickedBack: readonly StepName[];
  readonly reverified: readonly StepName[];
  readonly preservedGates?: readonly StepName[];
  readonly preservedCandidates?: readonly RebasePreservedCandidate[];
  readonly replay?: ReplayEvidence;
}

function regionDecision(verdict: RebaseVerdictDecision) {
  const isRegion = (gate: StepName) => isRegionStep(gate);
  return {
    invalidated: verdict.kickedBack.filter(isRegion),
    reverified: verdict.reverified.filter(isRegion),
    preserved: (verdict.preservedGates ?? []).filter(isRegion),
    preservedCandidates: (verdict.preservedCandidates ?? []).filter((candidate) => isRegion(candidate.gate)),
    replay: verdict.replay,
  };
}

async function withActiveChildProjection<T>(
  worktree: string,
  child: ChildId,
  run: (projectionRoot: string) => Promise<T>,
): Promise<T> {
  const projectionRoot = await mkdtemp(join(tmpdir(), 'restack-active-transition-'));
  try {
    const target = join(worktree, '.pipeline', 'children', String(child));
    const link = join(projectionRoot, '.pipeline', 'children', String(child));
    await mkdir(join(projectionRoot, '.pipeline', 'children'), { recursive: true });
    await symlink(target, link, 'dir');
    // The region's state and judge artifacts live together in its child
    // store.  The policy still resolves its legacy flat artifact paths, so
    // project those *child* artifacts into the isolated root.  Linking the
    // whole-feature artifacts here would let an active child inherit another
    // review's provenance.
    const childEvidence = join(worktree, '.pipeline', 'children', String(child));
    for (const artifact of ['build-review.json', 'test-suite-evidence.json']) {
      const source = join(childEvidence, artifact);
      if (await exists(source)) await symlink(source, join(projectionRoot, '.pipeline', artifact), 'file');
    }
    const state = join(worktree, '.pipeline', 'conduct-state.json');
    if (await exists(state)) await symlink(state, join(projectionRoot, '.pipeline', 'conduct-state.json'), 'file');
    // Code-validity resolves the feature's declared inputs before it can
    // retain a judged region verdict. These are read-only inputs; writes stay
    // confined to the projection's own flat gate directory.
    for (const directory of ['.docs', '.ai-conductor']) {
      const source = join(worktree, directory);
      if (await exists(source)) await symlink(source, join(projectionRoot, directory), 'dir');
    }
    return await run(projectionRoot);
  } finally {
    await rm(projectionRoot, { recursive: true, force: true });
  }
}

function featureDecision(verdict: RebaseVerdictDecision) {
  const isFeature = (gate: StepName) => !isRegionStep(gate);
  return {
    invalidated: verdict.kickedBack.filter(isFeature),
    reverified: verdict.reverified.filter(isFeature),
    preserved: (verdict.preservedGates ?? []).filter(isFeature),
    preservedCandidates: (verdict.preservedCandidates ?? []).filter((candidate) => isFeature(candidate.gate)),
    replay: verdict.replay,
  };
}

async function applyDecision(
  worktree: string,
  statePath: string,
  child: ChildId | undefined,
  outcome: RebaseOutcome,
  decision: { readonly invalidated: readonly StepName[]; readonly reverified: readonly StepName[]; readonly preserved: readonly StepName[]; readonly preservedCandidates: readonly RebasePreservedCandidate[]; readonly replay?: ReplayEvidence },
  events: ConductorEventEmitter | undefined,
  cause?: RestackCause,
  opId?: string,
): Promise<void> {
  if (outcome.kind !== 'changed' || outcome.replay === undefined) return;
  const transition = await applyRebaseTransition({
    projectRoot: worktree,
    stateFilePath: statePath,
    stateStore: createFilesystemConductStateStore(statePath),
    replay: decision.replay ?? outcome.replay,
    invalidated: decision.invalidated,
    preserved: decision.preserved,
    preservedCandidates: decision.preservedCandidates,
    reverified: decision.reverified,
    ...(child === undefined ? {} : { child }),
    ...(cause === undefined ? {} : { cause }),
    ...(opId === undefined ? {} : { operationId: opId }),
  });
  if (transition.stateResult === 'refused') throw new Error('restack verdict transition was refused');
  if (events) {
    await emitGateInvalidationEvents(events, outcome, false, {
      kickedBack: transition.invalidated,
      reverified: transition.operation.transition.reverified,
      preservedGates: transition.preserved,
      convergenceCredit: transition.convergenceCredit,
    });
  }
}

/**
 * Apply the existing rebase verdict machinery using the two replay tuples the
 * stacked contract defines.  The rebase helper remains the gate-policy owner;
 * this adapter only routes region records to their child and restores the
 * legacy flat region paths it must not own in a stacked feature.
 */
export async function applyRestackTransition(options: ApplyRestackTransitionOptions): Promise<RestackTransitionResult> {
  const moveByChild = new Map(options.moves.filter((move): move is RestackMoveRef & { child: ChildId } => move.child !== undefined).map((move) => [move.child, move]));
  // A closed child's closure ref can advance to its already-adopted branch
  // tip. That ref movement is not a replay of the child's own range, so it
  // must not feed an identity correspondence into the shared rewrite map.
  const rewrittenChildren = new Set(options.moves
    .filter((move): move is RestackMoveRef & { child: ChildId } => move.child !== undefined && move.ref.startsWith('refs/heads/') && move.oldSha !== move.newSha)
    .map((move) => move.child));
  const wouldInvalidate = new Map<ChildId, readonly StepName[]>();
  const queuedInvalidations: RevalidationQueueEntry[] = [];
  const newParentFor = (range: ChildRange): CommitSha => {
    const index = options.ranges.indexOf(range);
    const previous = index > 0 ? moveByChild.get(options.ranges[index - 1]!.child) : undefined;
    return previous?.newSha ?? options.newDefault;
  };
  const activeRange = options.ranges.find((range) => range.child === options.activeChild);
  const activeMove = moveByChild.get(options.activeChild);

  // Replay constructs the exact old child range on a new parent. Preserve
  // those asymmetric boundaries for the translator: using oldParent for both
  // sides would make a later child's map inspect lower replay commits too.
  // Flat evidence is shared; only the active child's region evidence follows
  // it. Closed children are historical records and stay byte-identical.
  for (const range of options.ranges) {
    const move = moveByChild.get(range.child);
    if (!move || !rewrittenChildren.has(range.child)) continue;
    const additionalPipelineDirs = range.child === options.activeChild && range.kind !== 'closed'
      ? [pipelinePathFor(options.worktree, '', range.child)]
      : [];
    await translateAfterRebase(
      options.git,
      options.worktree,
      newParentFor(range),
      range.oldTip,
      move.newSha,
      options.events,
      undefined,
      undefined,
      {
        preImageBase: range.oldParent,
        postImageBase: newParentFor(range),
        additionalPipelineDirs,
      },
      options.rewritesByChild?.get(range.child),
    );
  }
  if (activeRange && activeRange.kind !== 'closed' && activeMove) {
    const activeOutcome = await outcomeFor(options.worktree, options.git, {
      previous: activeRange.oldTip,
      base: activeRange.oldParent,
      onto: newParentFor(activeRange),
      head: activeMove.newSha,
    });
    const childState = pipelinePathFor(options.worktree, 'conduct-state.json', options.activeChild);
    if (await exists(childState)) {
      await withActiveChildProjection(options.worktree, options.activeChild, async (projectionRoot) => {
        const projectedState = pipelinePathFor(projectionRoot, 'conduct-state.json', options.activeChild);
        const verdict = await applyRebaseVerdicts(projectionRoot, activeOutcome, false, undefined, options.git, undefined, options.activeChild, options.cause);
        await applyDecision(projectionRoot, projectedState, options.activeChild, activeOutcome, regionDecision(verdict), options.events, options.cause, options.opId);
      });
    }
  }

    const first = options.ranges[0];
    // The flat, whole-feature policy belongs solely to the declared leaf. An
    // intermediate active child has its own region tuple and must not claim it.
    const leaf = options.ranges.find((range) => range.kind === 'leaf-active' || range.kind === 'leaf-unentered');
    const leafMove = leaf === undefined ? undefined : moveByChild.get(leaf.child);
    const featureState = join(options.worktree, '.pipeline', 'conduct-state.json');
  if (first && leaf && leafMove && await exists(featureState)) {
    const wholeOutcome = await outcomeFor(options.worktree, options.git, {
        previous: leaf.oldTip,
        base: await mergeBase(options.git, first.oldTip, options.oldDefault),
        onto: options.newDefault,
        head: leafMove.newSha,
      });
      const state = await readState(featureState);
    const verdict = await applyRebaseVerdicts(
      options.worktree,
      wholeOutcome,
      state.ok && state.value.manual_test !== 'skipped',
      undefined,
      options.git,
      undefined,
      leaf.child,
      options.cause,
    );
    // Whole-stack policy owns the flat gates, but its region effects belong
    // to the leaf child. Apply that child's state transition through the
    // same isolated projection as the active tuple so it cannot publish a
    // flat rebase operation while reopening the leaf's actual state.
    const leafState = pipelinePathFor(options.worktree, 'conduct-state.json', leaf.child);
    if (await exists(leafState)) {
      await withActiveChildProjection(options.worktree, leaf.child, async (projectionRoot) => {
        await applyDecision(
          projectionRoot,
          pipelinePathFor(projectionRoot, 'conduct-state.json', leaf.child),
          leaf.child,
          wholeOutcome,
          regionDecision(verdict),
          options.events,
          options.cause,
          options.opId,
        );
      });
    }
    await applyDecision(options.worktree, featureState, undefined, wholeOutcome, featureDecision(verdict), options.events, options.cause, options.opId);
  }

  for (const range of options.ranges) {
    if (range.kind !== 'closed') continue;
    const move = moveByChild.get(range.child);
    if (!move) continue;
    const outcome = await outcomeFor(options.worktree, options.git, {
      previous: range.oldTip,
      base: range.oldParent,
      onto: newParentFor(range),
      head: move.newSha,
    });
    if (outcome.kind !== 'changed') {
      wouldInvalidate.set(range.child, []);
      continue;
    }
    const normalized = await normalizedReplayComparison(options.git, {
      previous: range.oldTip, base: range.oldParent, onto: newParentFor(range), head: move.newSha,
    }, outcome.replay!);
    const projection = classifyReplayGateInvalidation(
      normalized.fallbackPaths ?? outcome.allChangedPaths ?? outcome.changedCodePaths,
      outcome.featureSurface ?? [],
      false,
      normalized.comparison,
      outcome.documentInputs,
    );
    const invalidated = new Set(projection.invalidated);
    const gates = (await Promise.all(CHILD_REGION_STEPS.map(async (gate) =>
      invalidated.has(gate) && (await readVerdict(options.worktree, gate, range.child))?.satisfied === true
        ? gate
        : undefined,
    ))).filter((gate) => gate !== undefined);
    wouldInvalidate.set(range.child, gates);
    const queued = await queueInvalidation(
      options.worktree,
      options.git,
      range,
      move,
      newParentFor(range),
      options.isRegionGateFresh,
    );
    if (queued) queuedInvalidations.push(queued);
  }
  return { wouldInvalidate, queueInvalidation: queuedInvalidations };
}
