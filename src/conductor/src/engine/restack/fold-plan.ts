import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ChildId } from '../child-context.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { type GitRunner } from '../rebase.js';
import { readRouteRecord } from '../routing/route-record-store.js';
import { closureRefFor } from '../routing/routing-refs.js';
import { parseRoundId, type FrozenHostAllocation, type RoundId } from '../routing/route-types.js';
import { parseCommitSha, type CommitSha } from './restack-types.js';

export interface FoldSourceCommit {
  readonly sha: CommitSha;
  readonly roundId: RoundId;
  readonly owner: ChildId;
}

export type CollectFoldSetResult =
  | { readonly kind: 'collected'; readonly commits: readonly FoldSourceCommit[] }
  | { readonly kind: 'refused'; readonly reason: 'fold-owner-invalid'; readonly commit: CommitSha; readonly host: ChildId }
  | { readonly kind: 'unavailable' };

export interface CollectFoldSetInput {
  readonly worktree: string;
  readonly slug: string;
  readonly git: GitRunner;
}

export type FoldPartReason = 'owner' | 'introduced-above-owner';

export type FoldPart =
  | { readonly kind: 'hunks'; readonly child: ChildId | 'leaf'; readonly paths: readonly string[]; readonly reason: FoldPartReason }
  | { readonly kind: 'whole'; readonly child: ChildId; readonly paths: readonly []; readonly reason: 'owner' }
  | {
    readonly kind: 'blocks';
    readonly child: ChildId;
    readonly paths: readonly [];
    readonly reason: 'owner';
    readonly blocks: readonly { readonly id: string; readonly body: string }[];
  };

export interface FoldCommitPlan extends FoldSourceCommit {
  readonly parts: readonly FoldPart[];
}

/** The durable source-to-placement correspondence recorded before fold replay. */
export interface FoldPlan {
  readonly kind: 'planned';
  readonly commits: readonly FoldCommitPlan[];
}

export interface PlaceFoldCommitsInput {
  readonly worktree: string;
  readonly slug: string;
  readonly commits: readonly FoldSourceCommit[];
  readonly git: GitRunner;
}

type DeferredRange = {
  readonly host: ChildId;
  readonly roundId: RoundId;
  readonly leafEntryTip: CommitSha;
  readonly exitTip?: CommitSha;
};

function refused(commit: CommitSha, host: ChildId): Extract<CollectFoldSetResult, { readonly kind: 'refused' }> {
  return { kind: 'refused', reason: 'fold-owner-invalid', commit, host };
}

function trailerValues(message: string, key: 'Round' | 'Owner'): string[] {
  const finalParagraph = message.trimEnd().split(/\n\s*\n/).at(-1) ?? '';
  return finalParagraph.split('\n').flatMap((line) => {
    const match = line.match(new RegExp(`^${key}:\\s*(.*)\\s*$`));
    return match === null ? [] : [match[1]!];
  });
}

async function isLeafHost(git: GitRunner, slug: string, host: ChildId): Promise<boolean | undefined> {
  try {
    const closure = await git(['rev-parse', '-q', '--verify', closureRefFor(slug, host)]);
    return closure.exitCode === 1 ? true : closure.exitCode === 0 ? false : undefined;
  } catch {
    return undefined;
  }
}

async function deferredRanges(input: CollectFoldSetInput): Promise<DeferredRange[] | undefined> {
  const prefix = `refs/conductor/${input.slug}/routes/`;
  let listed;
  try {
    listed = await input.git(['for-each-ref', '--format=%(refname)', prefix]);
  } catch {
    return undefined;
  }
  if (listed.exitCode !== 0) return undefined;

  const ranges: DeferredRange[] = [];
  for (const ref of listed.stdout.split('\n').filter(Boolean)) {
    const roundId = parseRoundId(ref.slice(prefix.length));
    if (roundId === undefined || ref !== `${prefix}${roundId}`) return undefined;
    const stored = await readRouteRecord(input.worktree, input.slug, roundId, { git: input.git });
    if (stored.kind !== 'record') return undefined;
    for (const [rawHost, placement] of Object.entries(stored.record.placements ?? {})) {
      const host = Number(rawHost) as ChildId;
      if (placement.state !== 'deferred') continue;
      const leaf = await isLeafHost(input.git, input.slug, host);
      if (leaf === undefined) return undefined;
      if (leaf) continue;
      ranges.push({ host, roundId, leafEntryTip: placement.leafEntryTip, ...(placement.exitTip === undefined ? {} : { exitTip: placement.exitTip }) });
    }
  }
  return ranges;
}

async function rangeCommits(input: CollectFoldSetInput, range: DeferredRange): Promise<CommitSha[] | CollectFoldSetResult> {
  const boundary = range.exitTip ?? range.leafEntryTip;
  if (range.exitTip === undefined) return refused(boundary, range.host);
  try {
    const ancestor = await input.git(['merge-base', '--is-ancestor', range.leafEntryTip, range.exitTip]);
    if (ancestor.exitCode !== 0) return refused(boundary, range.host);
    const listed = await input.git(['rev-list', '--first-parent', '--reverse', `${range.leafEntryTip}..${range.exitTip}`]);
    if (listed.exitCode !== 0) return refused(boundary, range.host);
    const commits = listed.stdout.split('\n').filter(Boolean).map(parseCommitSha);
    return commits.every((commit): commit is CommitSha => commit !== undefined) ? commits : refused(boundary, range.host);
  } catch {
    return refused(boundary, range.host);
  }
}

async function validOwnedCommit(input: CollectFoldSetInput, commit: CommitSha, range: DeferredRange): Promise<boolean> {
  try {
    const parents = await input.git(['rev-list', '--parents', '-n', '1', commit]);
    if (parents.exitCode !== 0 || parents.stdout.trim().split(/\s+/).length !== 2) return false;
    const message = await input.git(['show', '-s', '--format=%B', commit]);
    if (message.exitCode !== 0) return false;
    const rounds = trailerValues(message.stdout, 'Round');
    const owners = trailerValues(message.stdout, 'Owner');
    return rounds.length === 1 && rounds[0] === range.roundId && owners.length === 1 && owners[0] === `c${range.host}`;
  } catch {
    return false;
  }
}

/**
 * Reads only deferred host boundary ranges. Every selected commit is a
 * first-parent, non-merge commit stamped for the round and host that own it.
 */
export async function collectFoldSet(input: CollectFoldSetInput): Promise<CollectFoldSetResult> {
  const ranges = await deferredRanges(input);
  if (ranges === undefined) return { kind: 'unavailable' };

  const commits: FoldSourceCommit[] = [];
  for (const range of ranges) {
    const listed = await rangeCommits(input, range);
    if (!Array.isArray(listed)) return listed;
    for (const commit of listed) {
      if (!await validOwnedCommit(input, commit, range)) return refused(commit, range.host);
      commits.push({ sha: commit, roundId: range.roundId, owner: range.host });
    }
  }

  if (commits.length < 2) return { kind: 'collected', commits };
  try {
    const leaf = await input.git(['rev-list', '--first-parent', '--reverse', `refs/heads/${leafBranchFor(input.slug)}`]);
    if (leaf.exitCode !== 0) return { kind: 'unavailable' };
    const order = new Map(leaf.stdout.split('\n').filter(Boolean).map((sha, index) => [sha, index]));
    if (commits.some(({ sha }) => !order.has(sha))) return { kind: 'unavailable' };
    commits.sort((left, right) => order.get(left.sha)! - order.get(right.sha)!);
  } catch {
    return { kind: 'unavailable' };
  }
  return { kind: 'collected', commits };
}

type DiffHunk = { readonly path: string; readonly patch: string };

function hunkPatches(path: string, diff: string): DiffHunk[] {
  const lines = diff.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@ '));
  if (firstHunk === -1) return [];
  const header = lines.slice(0, firstHunk);
  const hunks: DiffHunk[] = [];
  for (let start = firstHunk; start < lines.length;) {
    let end = start + 1;
    while (end < lines.length && !lines[end]!.startsWith('@@ ')) end += 1;
    hunks.push({ path, patch: `${[...header, ...lines.slice(start, end)].join('\n').trimEnd()}\n` });
    start = end;
  }
  return hunks;
}

async function changedPaths(git: GitRunner, sha: CommitSha): Promise<string[]> {
  const changed = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
  if (changed.exitCode !== 0) throw new Error(`cannot read changed paths for ${sha}`);
  return changed.stdout.split('\n').filter(Boolean);
}

async function sourceParent(git: GitRunner, sha: CommitSha): Promise<CommitSha> {
  const parent = await git(['rev-parse', `${sha}^`]);
  const parsed = parent.exitCode === 0 ? parseCommitSha(parent.stdout.trim()) : undefined;
  if (parsed === undefined) throw new Error(`cannot read parent for ${sha}`);
  return parsed;
}

async function frozenBlocks(
  input: PlaceFoldCommitsInput,
  source: FoldSourceCommit,
): Promise<readonly { readonly id: string; readonly body: string }[] | undefined> {
  const stored = await readRouteRecord(input.worktree, input.slug, source.roundId, { git: input.git });
  if (stored.kind !== 'record') return undefined;
  const allocation: FrozenHostAllocation | undefined = stored.record.allocation[source.owner];
  if (allocation === undefined || allocation.remTaskIds.length === 0) return undefined;
  const patch = await input.git(['show', '--format=', '--no-ext-diff', source.sha]);
  if (patch.exitCode !== 0) throw new Error(`cannot read frozen block commit ${source.sha}`);
  const added = new Set(patch.stdout.split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1)));
  const blocks = allocation.blockBodies.map((body, index) => ({ id: allocation.remTaskIds[index]!, body }));
  return blocks.every(({ body }) => body.replace(/\n$/, '').split('\n').every((line) => added.has(line))) ? blocks : undefined;
}

async function childTips(input: PlaceFoldCommitsInput, owner: ChildId): Promise<readonly { readonly child: ChildId; readonly tip: CommitSha }[]> {
  const entries: { child: ChildId; tip: CommitSha }[] = [];
  for (let raw = Number(owner); raw <= 9; raw += 1) {
    const child = raw as ChildId;
    const branch = childBranchFor(input.slug, child);
    if (!branch.ok) continue;
    const resolved = await input.git(['rev-parse', '-q', '--verify', `refs/heads/${branch.branch}`]);
    if (resolved.exitCode === 1) continue;
    const tip = resolved.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
    if (tip === undefined) throw new Error(`cannot read child ${child} tip`);
    entries.push({ child, tip });
  }
  return entries;
}

async function materializeHunk(
  git: GitRunner,
  parent: CommitSha,
  patch: string,
  index: string,
): Promise<CommitSha> {
  const env = { GIT_INDEX_FILE: index };
  const seeded = await git(['read-tree', parent], { env });
  if (seeded.exitCode !== 0) throw new Error(`cannot seed fold hunk index: ${seeded.stderr}`);
  const applied = await git(['apply', '--cached', '--whitespace=nowarn'], { env, input: patch });
  if (applied.exitCode !== 0) throw new Error(`cannot materialize fold hunk: ${applied.stderr}`);
  const tree = await git(['write-tree'], { env });
  const treeSha = tree.exitCode === 0 ? parseCommitSha(tree.stdout.trim()) : undefined;
  if (treeSha === undefined) throw new Error(`cannot write fold hunk tree: ${tree.stderr}`);
  const commit = await git(['commit-tree', treeSha, '-p', parent], { input: 'fold placement probe\n' });
  const commitSha = commit.exitCode === 0 ? parseCommitSha(commit.stdout.trim()) : undefined;
  if (commitSha === undefined) throw new Error(`cannot write fold hunk probe: ${commit.stderr}`);
  return commitSha;
}

async function lowestAcceptingChild(
  input: PlaceFoldCommitsInput,
  parent: CommitSha,
  probe: CommitSha,
  candidates: readonly { readonly child: ChildId; readonly tip: CommitSha }[],
): Promise<ChildId | 'leaf'> {
  for (const candidate of candidates) {
    const merged = await input.git(['merge-tree', '--write-tree', '--merge-base', parent, candidate.tip, probe]);
    if (merged.exitCode === 0) return candidate.child;
    if (merged.exitCode !== 1) throw new Error(`cannot probe fold placement on child ${candidate.child}: ${merged.stderr}`);
  }
  const leaf = await input.git(['rev-parse', '--verify', `refs/heads/${leafBranchFor(input.slug)}`]);
  const leafTip = leaf.exitCode === 0 ? parseCommitSha(leaf.stdout.trim()) : undefined;
  if (leafTip === undefined) throw new Error('cannot read fold leaf tip');
  const merged = await input.git(['merge-tree', '--write-tree', '--merge-base', parent, leafTip, probe]);
  if (merged.exitCode !== 0) throw new Error(`cannot probe fold placement on leaf: ${merged.stderr}`);
  return 'leaf';
}

/**
 * Plans, without moving a ref or worktree, where each folded source commit is
 * replayed. Hunk probes use temporary indexes and merge-tree's three-way mode
 * so a later child only receives a change its accumulated tree can accept.
 */
export async function placeFoldCommits(input: PlaceFoldCommitsInput): Promise<FoldPlan> {
  const planned: FoldCommitPlan[] = [];
  for (const source of input.commits) {
    const blocks = await frozenBlocks(input, source);
    if (blocks !== undefined) {
      planned.push({ ...source, parts: [{ kind: 'blocks', child: source.owner, paths: [], reason: 'owner', blocks }] });
      continue;
    }

    const paths = await changedPaths(input.git, source.sha);
    if (paths.length === 0) {
      planned.push({ ...source, parts: [{ kind: 'whole', child: source.owner, paths: [], reason: 'owner' }] });
      continue;
    }

    const parent = await sourceParent(input.git, source.sha);
    const candidates = await childTips(input, source.owner);
    const parts = new Map<string, { child: ChildId | 'leaf'; reason: FoldPartReason; paths: Set<string> }>();
    const indexDirectory = await mkdtemp(join(tmpdir(), 'fold-plan-index-'));
    try {
      for (const path of paths) {
        const diff = await input.git(['diff', '--no-ext-diff', '--no-renames', '--unified=0', parent, source.sha, '--', path]);
        if (diff.exitCode !== 0) throw new Error(`cannot read fold hunks for ${source.sha}:${path}`);
        for (const [ordinal, hunk] of hunkPatches(path, diff.stdout).entries()) {
          const probe = await materializeHunk(input.git, parent, hunk.patch, join(indexDirectory, `${path.replace(/[^A-Za-z0-9_.-]/g, '-')}-${ordinal}.index`));
          const child = await lowestAcceptingChild(input, parent, probe, candidates);
          const reason: FoldPartReason = child === source.owner ? 'owner' : 'introduced-above-owner';
          const key = `${child}:${reason}`;
          const part = parts.get(key) ?? { child, reason, paths: new Set<string>() };
          part.paths.add(path);
          parts.set(key, part);
        }
      }
    } finally {
      await rm(indexDirectory, { recursive: true, force: true });
    }
    planned.push({
      ...source,
      parts: [...parts.values()].map((part) => ({ kind: 'hunks' as const, child: part.child, paths: [...part.paths], reason: part.reason })),
    });
  }
  return { kind: 'planned', commits: planned };
}
