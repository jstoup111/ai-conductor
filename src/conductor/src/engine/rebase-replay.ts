import type { GitRunner } from './rebase.js';

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
export async function compareReplayTree(
  git: GitRunner,
  identity: ReplayIdentity,
): Promise<ReplayComparison> {
  if (!validObject(identity.preRebaseHead) || !validObject(identity.mergeBase) ||
      !validObject(identity.target) || !validObject(identity.completedHead)) {
    return { kind: 'unproved', identity, reason: 'replay identity is missing or malformed' };
  }

  let merge: Awaited<ReturnType<GitRunner>>;
  let completed: Awaited<ReturnType<GitRunner>>;
  try {
    merge = await git(['merge-tree', '--write-tree', '--merge-base', identity.mergeBase, identity.preRebaseHead, identity.target]);
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

/** Capture only a complete, immutable identity tuple; partial tuples are unsafe. */
export async function captureReplayIdentity(
  git: GitRunner,
  preRebaseHead: string,
  mergeBase: string,
  target: string,
): Promise<ReplayIdentity | undefined> {
  try {
    const completed = await git(['rev-parse', 'HEAD']);
    const identity = {
      preRebaseHead: preRebaseHead.trim(),
      mergeBase: mergeBase.trim(),
      // This must be the object captured before replay, not a ref resolved
      // afterwards: the base ref may move while the replay is in progress.
      target: target.trim(),
      completedHead: completed.exitCode === 0 ? completed.stdout.trim() : '',
    };
    return validObject(identity.preRebaseHead) && validObject(identity.mergeBase) &&
      validObject(identity.target) && validObject(identity.completedHead)
      ? identity
      : undefined;
  } catch {
    return undefined;
  }
}
