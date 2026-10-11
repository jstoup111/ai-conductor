import { access, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StepName } from '../../types/index.js';
import { CHILD_REGION_STEPS, isRegionStep, pipelinePathFor, type ChildId } from '../child-context.js';
import { createFilesystemConductStateStore } from '../filesystem-conduct-state-store.js';
import { readVerdict, type RebasePreservedCandidate, type ReplayEvidence } from '../gate-verdicts.js';
import { classifyReplayGateInvalidation } from '../gate-invalidation.js';
import {
  applyRebaseVerdicts,
  emitGateInvalidationEvents,
  filterCodeOrTestPaths,
  resolveReviewInputs,
  type GitRunner,
  type RebaseOutcome,
} from '../rebase.js';
import { compareReplayTree } from '../rebase-replay.js';
import { applyRebaseTransition } from '../rebase-transition.js';
import { readState } from '../state.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import type { RestackMoveRef } from './restack-move.js';
import type { ChildRange, CommitSha, RestackCause } from './restack-types.js';

export interface ApplyRestackTransitionOptions {
  readonly worktree: string;
  readonly cause: RestackCause;
  /** The current default tip (also the unchanged default for a repair). */
  readonly newDefault: CommitSha;
  readonly activeChild: ChildId;
  readonly ranges: readonly ChildRange[];
  readonly moves: readonly RestackMoveRef[];
  readonly git: GitRunner;
  readonly events?: ConductorEventEmitter;
}

export interface RestackTransitionResult {
  readonly wouldInvalidate: ReadonlyMap<ChildId, readonly StepName[]>;
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

async function mergeBase(git: GitRunner, left: CommitSha, right: CommitSha): Promise<CommitSha> {
  const result = await git(['merge-base', left, right]);
  const value = result.stdout.trim();
  if (result.exitCode !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    throw new Error(`cannot resolve restack transition merge base ${left}..${right}`);
  }
  return value as CommitSha;
}

async function outcomeFor(worktree: string, git: GitRunner, tuple: RestackTuple): Promise<RebaseOutcome> {
  const delta = await changedPaths(git, tuple.previous, tuple.head);
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
  const wouldInvalidate = new Map<ChildId, readonly StepName[]>();
  const newParentFor = (range: ChildRange): CommitSha => {
    const index = options.ranges.indexOf(range);
    const previous = index > 0 ? moveByChild.get(options.ranges[index - 1]!.child) : undefined;
    return previous?.newSha ?? options.newDefault;
  };
  const activeRange = options.ranges.find((range) => range.child === options.activeChild);
  const activeMove = moveByChild.get(options.activeChild);
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
        const verdict = await applyRebaseVerdicts(projectionRoot, activeOutcome, false, undefined, options.git, undefined, options.activeChild);
        await applyDecision(projectionRoot, projectedState, options.activeChild, activeOutcome, regionDecision(verdict), options.events);
      });
    }
  }

    const first = options.ranges[0];
    const leaf = options.ranges.at(-1);
    const leafMove = leaf === undefined ? undefined : moveByChild.get(leaf.child);
    const featureState = join(options.worktree, '.pipeline', 'conduct-state.json');
  if (first && leaf && leafMove && await exists(featureState)) {
    const wholeOutcome = await outcomeFor(options.worktree, options.git, {
        previous: leaf.oldTip,
        base: await mergeBase(options.git, first.oldTip, options.newDefault),
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
        );
      });
    }
    await applyDecision(options.worktree, featureState, undefined, wholeOutcome, featureDecision(verdict), options.events);
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
    const projection = classifyReplayGateInvalidation(
      outcome.allChangedPaths ?? outcome.changedCodePaths,
      outcome.featureSurface ?? [],
      false,
      await compareReplayTree(options.git, outcome.replay!),
      outcome.documentInputs,
    );
    const invalidated = new Set(projection.invalidated);
    const gates = (await Promise.all(CHILD_REGION_STEPS.map(async (gate) =>
      invalidated.has(gate) && (await readVerdict(options.worktree, gate, range.child))?.satisfied === true
        ? gate
        : undefined,
    ))).filter((gate) => gate !== undefined);
    wouldInvalidate.set(range.child, gates);
  }
  return { wouldInvalidate };
}
