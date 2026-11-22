import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { GitRunner } from './rebase.js';
import type { RebaseRecoveryAttempt } from './rebase-recovery-attempt.js';

/** Immutable identities captured around one completed replay. */
export interface ReplayIdentity {
  /** Feature tip before `git rebase` moved it. */
  preRebaseHead: string;
  /** Common ancestor of the feature tip and target. */
  mergeBase: string;
  /** Resolved target object, never a mutable ref name. */
  target: string;
  /** Feature tip after replay completed. */
  completedHead: string;
}

/**
 * Immutable replay inputs captured before `git rebase` moves HEAD. This is
 * deliberately not completed replay authority: only {@link ReplayIdentity}
 * adds a completed HEAD after the rebase and its acceptance guards succeed.
 */
export interface ReplayIdentitySeed {
  preRebaseHead: string;
  mergeBase: string;
  target: string;
}

export type ReplayComparison =
  | { kind: 'unchanged'; identity: ReplayIdentity; expectedTree: string; completedTree: string }
  | { kind: 'changed'; identity: ReplayIdentity; expectedTree: string; completedTree: string }
  | { kind: 'unproved'; identity: ReplayIdentity; reason: string };

const OBJECT_ID = /^[0-9a-f]{40,64}$/i;

function validObject(value: string | undefined): value is string {
  return value !== undefined && OBJECT_ID.test(value);
}

/**
 * Reconstruct the exact clean tree Git would have produced from P/B/O. This
 * intentionally has no fallback to path overlap or patch identity: inability
 * to reconstruct is not evidence that the completed resolution was unchanged.
 */
export async function compareReplayTree(git: GitRunner, identity: ReplayIdentity): Promise<ReplayComparison> {
  if (
    !validObject(identity.preRebaseHead) ||
    !validObject(identity.mergeBase) ||
    !validObject(identity.target) ||
    !validObject(identity.completedHead)
  ) {
    return { kind: 'unproved', identity, reason: 'replay identity is missing or malformed' };
  }

  let merge: Awaited<ReturnType<GitRunner>>;
  let completed: Awaited<ReturnType<GitRunner>>;
  try {
    merge = await git([
      'merge-tree',
      '--write-tree',
      '--merge-base',
      identity.mergeBase,
      identity.preRebaseHead,
      identity.target,
    ]);
    if (merge.exitCode !== 0) {
      return { kind: 'unproved', identity, reason: 'clean replay reconstruction was unavailable or conflicted' };
    }
    completed = await git(['rev-parse', `${identity.completedHead}^{tree}`]);
  } catch {
    return { kind: 'unproved', identity, reason: 'replay reconstruction command failed' };
  }

  const expectedTree = merge.stdout.trim();
  const completedTree = completed.exitCode === 0 ? completed.stdout.trim() : '';
  if (!validObject(expectedTree) || !validObject(completedTree)) {
    return { kind: 'unproved', identity, reason: 'replay reconstruction returned malformed tree identity' };
  }
  return expectedTree === completedTree
    ? { kind: 'unchanged', identity, expectedTree, completedTree }
    : { kind: 'changed', identity, expectedTree, completedTree };
}

/**
 * Capture the immutable replay tuple, including an incomplete tuple when Git
 * cannot provide one of its objects. The comparator owns the conservative
 * unproved decision; dropping this value would bypass that decision entirely.
 */
export async function captureReplayIdentity(
  git: GitRunner,
  preRebaseHead: string,
  mergeBase: string,
  target: string,
): Promise<ReplayIdentity> {
  const identity = {
    preRebaseHead: preRebaseHead.trim(),
    mergeBase: mergeBase.trim(),
    // This must be the object captured before replay, not a ref resolved
    // afterwards: the base ref may move while the replay is in progress.
    target: target.trim(),
    completedHead: '',
  };
  try {
    const completed = await git(['rev-parse', 'HEAD']);
    return { ...identity, completedHead: completed.exitCode === 0 ? completed.stdout.trim() : '' };
  } catch {
    return identity;
  }
}

/** The verifier's deliberately narrow result: callers retain the halt on every blocker. */
export type CompletedReplayVerification =
  | { kind: 'accepted'; identity: ReplayIdentity; comparison: Exclude<ReplayComparison, { kind: 'unproved' }> }
  | { kind: 'blocked'; reason: string };

/**
 * Verify the worktree left by one persisted replay attempt without treating a
 * clean checkout or matching commit subjects as proof of preserved work.
 *
 * A clean replay is authorized only by exact tree reconstruction. A resolved
 * conflict must still have separately recorded, revision-bound intent; this
 * helper fails closed until that evidence is supplied by the recovery owner.
 */
export async function verifyCompletedReplay(
  git: GitRunner,
  projectRoot: string,
  attempt: RebaseRecoveryAttempt | undefined,
): Promise<CompletedReplayVerification> {
  if (!attempt) return { kind: 'blocked', reason: 'rebase recovery attempt evidence is missing or invalid' };

  for (const name of ['rebase-merge', 'rebase-apply']) {
    let state;
    try {
      state = await git(['rev-parse', '--git-path', name]);
    } catch {
      return { kind: 'blocked', reason: 'cannot inspect whether rebase is still active' };
    }
    if (state.exitCode !== 0 || !state.stdout.trim()) continue;
    const path = state.stdout.trim();
    const absolute = isAbsolute(path) ? path : join(projectRoot, path);
    if (
      await access(absolute).then(
        () => true,
        () => false,
      )
    ) {
      return { kind: 'blocked', reason: 'rebase is still active' };
    }
  }

  let status;
  let head;
  let targetAncestor;
  try {
    [status, head, targetAncestor] = await Promise.all([
      git(['status', '--porcelain']),
      git(['rev-parse', 'HEAD']),
      git(['merge-base', '--is-ancestor', attempt.target, 'HEAD']),
    ]);
  } catch {
    return { kind: 'blocked', reason: 'cannot inspect completed rebase revision' };
  }
  if (status.exitCode !== 0) return { kind: 'blocked', reason: 'cannot inspect worktree cleanliness' };
  if (status.stdout.trim()) return { kind: 'blocked', reason: 'checkout is dirty after completed rebase' };
  const completedHead = head.exitCode === 0 ? head.stdout.trim() : '';
  if (!validObject(completedHead)) return { kind: 'blocked', reason: 'completed rebase revision is unavailable' };
  if (targetAncestor.exitCode !== 0)
    return { kind: 'blocked', reason: 'completed revision is not based on the captured rebase target' };

  let originalFeature;
  let completedFeature;
  try {
    [originalFeature, completedFeature] = await Promise.all([
      git(['diff', '--quiet', attempt.mergeBase, attempt.preRebaseHead]),
      git(['diff', '--quiet', attempt.target, completedHead]),
    ]);
  } catch {
    return { kind: 'blocked', reason: 'cannot inspect preserved feature content' };
  }
  if (originalFeature.exitCode === 0)
    return { kind: 'blocked', reason: 'captured replay attempt has no feature content to verify' };
  if (originalFeature.exitCode > 1 || completedFeature.exitCode > 1) {
    return { kind: 'blocked', reason: 'cannot inspect preserved feature content' };
  }
  if (completedFeature.exitCode === 0)
    return { kind: 'blocked', reason: 'completed revision has no preserved feature content' };

  const identity: ReplayIdentity = { ...attempt, completedHead };
  const comparison = await compareReplayTree(git, identity);
  if (comparison.kind === 'unproved') return { kind: 'blocked', reason: comparison.reason };
  if (comparison.kind === 'changed') {
    return { kind: 'blocked', reason: 'resolved rebase lacks accepted revision-bound intent evidence' };
  }
  return { kind: 'accepted', identity, comparison };
}
