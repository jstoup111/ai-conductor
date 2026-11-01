import type { ChildId } from '../child-context.js';
import { parseFeatureBranch } from '../feature-branch-identity.js';
import type { GitRunner } from '../rebase.js';
import { closureRefFor } from './routing-refs.js';

export type ResolvedCitedPaths = {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly dropped: readonly {
    readonly path: string;
    readonly kind: 'dropped-directory' | 'dropped-ambiguous';
  }[];
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

/** Resolves citations against one recursive listing of the leaf's files. */
export async function resolveCitedPaths(
  paths: readonly string[],
  leafTip: string,
  git: GitRunner,
): Promise<ResolvedCitedPaths> {
  const listing = await git(['ls-tree', '-r', '--name-only', leafTip]);
  if (listing.exitCode !== 0) return { kind: 'halt', detail: `cannot read leaf branch ${leafTip}` };

  const files = listing.stdout.split('\n').filter((path) => path.length > 0);
  const listed = new Set(files);
  const inputs: string[] = [];
  const inputSet = new Set<string>();
  const outputs: string[] = [];
  const dropped: { path: string; kind: 'dropped-directory' | 'dropped-ambiguous' }[] = [];

  for (const path of paths) {
    if (listed.has(path)) {
      if (!inputSet.has(path)) {
        inputSet.add(path);
        inputs.push(path);
      }
      continue;
    }

    const directory = path.endsWith('/') ? path.slice(0, -1) : path;
    if (files.some((file) => file.startsWith(`${directory}/`))) {
      dropped.push({ path, kind: 'dropped-directory' });
      continue;
    }

    const suffixMatches = files.filter((file) => file.endsWith(`/${path}`));
    if (suffixMatches.length === 1) {
      const [match] = suffixMatches;
      if (!inputSet.has(match)) {
        inputSet.add(match);
        inputs.push(match);
      }
    } else if (suffixMatches.length > 1) {
      dropped.push({ path, kind: 'dropped-ambiguous' });
    } else {
      outputs.push(path);
    }
  }

  return { inputs, outputs, dropped };
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
