import { classifyReplayMerge, type GitRunner } from '../rebase.js';
import { stripInheritedRemBlocks } from '../routing/rem-block-merge.js';
import type { ChildRange, CommitSha } from './restack-types.js';

export type PathOwnershipResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'refused'; readonly paths: readonly string[] };

function pathSet(output: string): Set<string> {
  return new Set(output.split('\n').map((path) => path.trim()).filter(Boolean));
}

function sorted(paths: Iterable<string>): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

async function changedPaths(git: GitRunner, oldTip: CommitSha, newTip: CommitSha): Promise<Set<string>> {
  const result = await git(['diff', '--no-renames', '--name-only', oldTip, newTip]);
  if (result.exitCode !== 0) throw new Error(`cannot determine changed paths: ${result.stderr}`);
  return pathSet(result.stdout);
}

async function firstParentCommits(git: GitRunner, range: ChildRange): Promise<CommitSha[]> {
  const result = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (result.exitCode !== 0) throw new Error(`cannot list child commits for ownership: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean) as CommitSha[];
}

/**
 * The Q side of a carried merge is already supplied by the new parent. Its
 * automatic paths are therefore not child-owned; only its hand resolution is.
 */
async function removeCarriedMergePaths(
  git: GitRunner,
  range: ChildRange,
  newParent: CommitSha,
  owned: Set<string>,
): Promise<void> {
  for (const commit of await firstParentCommits(git, range)) {
    const parents = await git(['rev-list', '--parents', '-n', '1', commit]);
    if (parents.exitCode !== 0) throw new Error(`cannot read child commit parents: ${parents.stderr}`);
    if (parents.stdout.trim().split(/\s+/).length < 3) continue;
    const merge = await classifyReplayMerge(git, commit, newParent, 'stacked');
    if (merge.kind !== 'q-carried') continue;
    const [automaticPaths, handResolvedPaths] = await Promise.all([
      changedPaths(git, merge.firstParent as CommitSha, merge.autoTree as CommitSha),
      changedPaths(git, merge.autoTree as CommitSha, commit),
    ]);
    for (const path of automaticPaths) owned.delete(path);
    for (const path of handResolvedPaths) owned.add(path);
  }
}

async function ownedPaths(range: ChildRange, newParent: CommitSha, git: GitRunner): Promise<Set<string>> {
  const owned = await changedPaths(git, range.oldParent, range.oldTip);
  await removeCarriedMergePaths(git, range, newParent, owned);
  return owned;
}

/** Accept only a replay whose resulting path set is owned by its old range. */
export async function checkPathOwnership(
  range: ChildRange,
  newParent: CommitSha,
  newTip: CommitSha,
  git: GitRunner,
  options: { readonly normaliseInheritedRemBlocks?: boolean } = {},
): Promise<PathOwnershipResult> {
  const [owned, replayed] = await Promise.all([
    ownedPaths(range, newParent, git),
    changedPaths(git, newParent, newTip),
  ]);
  const inheritedPlans = options.normaliseInheritedRemBlocks
    ? await inheritedRemPlan(range, newParent, newTip, git)
    : new Set<string>();
  const unowned = sorted([...replayed].filter((path) => !owned.has(path) && !inheritedPlans.has(path)));
  return unowned.length === 0 ? { kind: 'accepted' } : { kind: 'refused', paths: unowned };
}

async function fileAt(git: GitRunner, revision: CommitSha, path: string): Promise<string | undefined> {
  const result = await git(['show', `${revision}:${path}`]);
  return result.exitCode === 0 ? result.stdout : undefined;
}

/** A plan path is inherited only when removing the new parent's rem blocks restores the old child text. */
async function inheritedRemPlan(range: ChildRange, newParent: CommitSha, newTip: CommitSha, git: GitRunner): Promise<Set<string>> {
  const inherited = new Set<string>();
  const paths = await changedPaths(git, newParent, newTip);
  for (const path of paths) {
    if (!path.startsWith('.docs/plans/') || !path.endsWith('.md')) continue;
    const [oldPlan, replayedPlan, parentPlan] = await Promise.all([
      fileAt(git, range.oldTip, path), fileAt(git, newTip, path), fileAt(git, newParent, path),
    ]);
    if (oldPlan !== undefined && replayedPlan !== undefined && parentPlan !== undefined
      && stripInheritedRemBlocks(replayedPlan, parentPlan) === oldPlan) inherited.add(path);
  }
  return inherited;
}

/** Paths jointly changed by a child's old-to-new parent delta and its owned range. */
export async function parentOverlapPaths(
  range: ChildRange,
  newParent: CommitSha,
  git: GitRunner,
): Promise<string[]> {
  const [owned, parentDelta] = await Promise.all([
    ownedPaths(range, newParent, git),
    changedPaths(git, range.oldParent, newParent),
  ]);
  return sorted([...parentDelta].filter((path) => owned.has(path)));
}
