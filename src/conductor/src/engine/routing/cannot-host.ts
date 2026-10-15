import type { ChildId } from '../child-context.js';
import { parseFeatureBranch } from '../feature-branch-identity.js';
import type { GitRunner } from '../rebase.js';
import { closureRefFor } from './routing-refs.js';

export interface CitedPathClassification {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

export interface HostSelection {
  readonly host: ChildId;
  readonly reason: 'owner' | 'prerequisite-paths';
}

export interface SelectHostOptions {
  readonly owner: ChildId;
  readonly inputs: readonly string[];
  readonly positions: readonly ChildId[];
  readonly leafTip: string;
  readonly git: GitRunner;
}

async function hasPath(git: GitRunner, tree: string, path: string): Promise<boolean> {
  const result = await git(['ls-tree', tree, '--', path]);
  if (result.exitCode !== 0) throw new Error(`cannot read tree ${tree}`);
  return result.stdout.trim() !== '';
}

async function containsEveryPath(git: GitRunner, tree: string, paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    if (!await hasPath(git, tree, path)) return false;
  }
  return true;
}

function slugForLeafTip(leafTip: string): string {
  const identity = parseFeatureBranch(leafTip);
  if (identity.kind !== 'leaf') throw new Error(`expected a leaf branch, got ${leafTip}`);
  return identity.slug;
}

/** Separates prerequisite inputs already present on the leaf from repair outputs. */
export async function classifyCitedPaths(
  paths: readonly string[],
  leafTip: string,
  git: GitRunner,
): Promise<CitedPathClassification> {
  const inputs: string[] = [];
  const outputs: string[] = [];
  for (const path of paths) {
    (await hasPath(git, leafTip, path) ? inputs : outputs).push(path);
  }
  return { inputs, outputs };
}

/**
 * Chooses the first closed child at or above an owner that contains every
 * prerequisite input. Authored ownership remains outside this projection.
 */
export async function selectHost(options: SelectHostOptions): Promise<HostSelection> {
  const { owner, inputs, positions, leafTip, git } = options;
  const slug = slugForLeafTip(leafTip);
  const leaf = positions.at(-1);
  if (leaf === undefined) throw new Error('cannot select a host without positions');

  const ownerTree = owner === leaf ? leafTip : closureRefFor(slug, owner);
  if (await containsEveryPath(git, ownerTree, inputs)) return { host: owner, reason: 'owner' };

  const ownerIndex = positions.indexOf(owner);
  for (const candidate of positions.slice(ownerIndex + 1, -1)) {
    if (await containsEveryPath(git, closureRefFor(slug, candidate), inputs)) {
      return { host: candidate, reason: 'prerequisite-paths' };
    }
  }
  return { host: leaf, reason: 'prerequisite-paths' };
}
