import type { ChildId } from '../child-context.js';
import { parseFeatureBranch } from '../feature-branch-identity.js';
import type { GitRunner } from '../rebase.js';
import { closureRefFor } from './routing-refs.js';

export type CitedPathClassification = {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
} | { readonly kind: 'halt'; readonly detail: string };

export type HostSelection = {
  readonly host: ChildId;
  readonly reason: 'owner' | 'prerequisite-paths';
} | { readonly kind: 'halt'; readonly detail: string };

export interface SelectHostOptions {
  readonly owner: ChildId;
  readonly inputs: readonly string[];
  readonly positions: readonly ChildId[];
  readonly leafTip: string;
  readonly git: GitRunner;
}

async function hasPath(git: GitRunner, tree: string, path: string): Promise<boolean | undefined> {
  const result = await git(['ls-tree', tree, '--', path]);
  if (result.exitCode !== 0) return undefined;
  return result.stdout.trim() !== '';
}

async function containsEveryPath(git: GitRunner, tree: string, paths: readonly string[]): Promise<boolean | undefined> {
  for (const path of paths) {
    const exists = await hasPath(git, tree, path);
    if (exists === undefined) return undefined;
    if (!exists) return false;
  }
  return true;
}

function slugForLeafTip(leafTip: string): string | undefined {
  const identity = parseFeatureBranch(leafTip);
  return identity.kind === 'leaf' ? identity.slug : undefined;
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
    const exists = await hasPath(git, leafTip, path);
    if (exists === undefined) return { kind: 'halt', detail: `cannot read leaf branch ${leafTip}` };
    (exists ? inputs : outputs).push(path);
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
  if (!slug) return { kind: 'halt', detail: `cannot read leaf branch ${leafTip}` };
  const leaf = positions.at(-1);
  if (leaf === undefined) return { kind: 'halt', detail: 'cannot select a host without positions' };

  const ownerTree = owner === leaf ? leafTip : closureRefFor(slug, owner);
  const atOwner = await containsEveryPath(git, ownerTree, inputs);
  if (atOwner === undefined) return { kind: 'halt', detail: `cannot read closure tree for child ${owner}` };
  if (atOwner) return { host: owner, reason: 'owner' };

  const ownerIndex = positions.indexOf(owner);
  for (const candidate of positions.slice(ownerIndex + 1, -1)) {
    const atCandidate = await containsEveryPath(git, closureRefFor(slug, candidate), inputs);
    if (atCandidate === undefined) return { kind: 'halt', detail: `cannot read closure tree for child ${candidate}` };
    if (atCandidate) {
      return { host: candidate, reason: 'prerequisite-paths' };
    }
  }
  const atLeaf = await containsEveryPath(git, leafTip, inputs);
  if (atLeaf === undefined) return { kind: 'halt', detail: `cannot read leaf branch ${leafTip}` };
  if (!atLeaf) {
    const missing: string[] = [];
    for (const path of inputs) {
      const exists = await hasPath(git, leafTip, path);
      if (exists === undefined) return { kind: 'halt', detail: `cannot read leaf branch ${leafTip}` };
      if (!exists) missing.push(path);
    }
    return { kind: 'halt', detail: `leaf branch ${leafTip} is missing prerequisite path${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` };
  }
  return { host: leaf, reason: 'prerequisite-paths' };
}
