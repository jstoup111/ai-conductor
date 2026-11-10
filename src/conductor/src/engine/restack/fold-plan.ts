import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withDaemonCoAuthorTrailer } from '../bot-co-author.js';
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

/** One source hunk, retained in the plan so its placement can be replayed exactly. */
export interface FoldHunk {
  readonly path: string;
  readonly patch: string;
  readonly wholeFile: boolean;
}

export type FoldPart =
  | { readonly kind: 'hunks'; readonly child: ChildId | 'leaf'; readonly path: string; readonly hunk: FoldHunk; readonly reason: FoldPartReason }
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
export type FoldPlan =
  | { readonly kind: 'planned'; readonly commits: readonly FoldCommitPlan[] }
  | {
    readonly kind: 'refused';
    readonly reason: 'fold-unplaced-path' | 'fold-residual-unexpressible';
    readonly commit: CommitSha;
    readonly paths: readonly string[];
  };

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

function hunkPatches(path: string, diff: string): FoldHunk[] {
  const lines = diff.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@ '));
  // A mode-only change, an empty-file add/delete, and a binary patch have no
  // text hunk.  They still represent one atomic path change and must travel
  // through the same materialize-and-probe path as an ordinary hunk.
  if (firstHunk === -1) return [{ path, patch: diff, wholeFile: true }];
  const header = lines.slice(0, firstHunk);
  const hunks: FoldHunk[] = [];
  for (let start = firstHunk; start < lines.length;) {
    let end = start + 1;
    while (end < lines.length && !lines[end]!.startsWith('@@ ')) end += 1;
    hunks.push({ path, patch: `${[...header, ...lines.slice(start, end)].join('\n').trimEnd()}\n`, wholeFile: false });
    start = end;
  }
  return hunks;
}

function containsFrozenBlock(hunk: FoldHunk, blocks: readonly { readonly id: string; readonly body: string }[]): boolean {
  const added = new Set(hunk.patch.split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1)));
  return blocks.some(({ body }) => body.replace(/\n$/, '').split('\n').every((line) => added.has(line)));
}

/**
 * Removes each frozen block's contiguous added run from a hunk and returns the
 * residual patch carrying the hunk's remaining additions and deletions. Returns
 * null when nothing remains, and undefined when a block contained in the hunk
 * is not one contiguous added run, so the residual cannot be expressed.
 */
function residualHunk(hunk: FoldHunk, blocks: readonly { readonly id: string; readonly body: string }[]): FoldHunk | null | undefined {
  const lines = hunk.patch.replace(/\n$/, '').split('\n');
  const start = lines.findIndex((line) => line.startsWith('@@ '));
  const header = start === -1 ? undefined : lines[start]!.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  if (header === undefined || header === null) return undefined;
  let body = lines.slice(start + 1);
  for (const block of blocks) {
    const blockLines = block.body.replace(/\n$/, '').split('\n').map((line) => `+${line}`);
    if (!blockLines.every((line) => body.includes(line))) continue;
    const at = body.findIndex((_, index) => blockLines.every((line, offset) => body[index + offset] === line));
    if (at === -1) return undefined;
    let end = at + blockLines.length;
    // A no-newline marker belongs to the line before it; drop it with that line.
    if (body[end]?.startsWith('\\')) end += 1;
    body = [...body.slice(0, at), ...body.slice(end)];
  }
  const added = body.filter((line) => line.startsWith('+')).length;
  const removed = body.filter((line) => line.startsWith('-')).length;
  if (added === 0 && removed === 0) return null;
  const [, oldStart, oldCount, newStart, , section] = header;
  const range = `@@ -${oldStart}${oldCount === undefined ? '' : `,${oldCount}`} +${newStart},${added} @@${section}`;
  return { path: hunk.path, patch: `${[...lines.slice(0, start), range, ...body].join('\n')}\n`, wholeFile: false };
}

async function residualApplies(git: GitRunner, parent: CommitSha, patch: string, index: string): Promise<boolean> {
  const env = { GIT_INDEX_FILE: index };
  const seeded = await git(['read-tree', parent], { env });
  if (seeded.exitCode !== 0) throw new Error(`cannot seed fold residual index: ${seeded.stderr}`);
  const checked = await git(['apply', '--cached', '--check', '--binary', '--unidiff-zero', '--whitespace=nowarn'], { env, input: patch });
  return checked.exitCode === 0;
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
  source: CommitSha,
  path: string,
  patch: string,
  wholeFile: boolean,
  index: string,
): Promise<CommitSha> {
  const env = { GIT_INDEX_FILE: index };
  const seeded = await git(['read-tree', parent], { env });
  if (seeded.exitCode !== 0) throw new Error(`cannot seed fold hunk index: ${seeded.stderr}`);
  if (wholeFile) {
    const exists = await git(['cat-file', '-e', `${source}:${path}`], { env });
    const materialized = exists.exitCode === 0
      ? await git(['restore', '--source', source, '--staged', '--', path], { env })
      : await git(['rm', '--cached', '--ignore-unmatch', '--', path], { env });
    if (materialized.exitCode !== 0) throw new Error(`cannot materialize fold whole-file path: ${materialized.stderr}`);
  } else {
    const applied = await git(['apply', '--cached', '--binary', '--unidiff-zero', '--whitespace=nowarn'], { env, input: patch });
    if (applied.exitCode !== 0) throw new Error(`cannot materialize fold hunk: ${applied.stderr}`);
  }
  const tree = await git(['write-tree'], { env });
  const treeSha = tree.exitCode === 0 ? parseCommitSha(tree.stdout.trim()) : undefined;
  if (treeSha === undefined) throw new Error(`cannot write fold hunk tree: ${tree.stderr}`);
  const commit = await git(['commit-tree', treeSha, '-p', parent], {
    input: withDaemonCoAuthorTrailer('fold placement probe\n'),
  });
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

type FoldPlanRefusal = Extract<FoldPlan, { readonly kind: 'refused' }>;

type HunkPlacement =
  | { readonly kind: 'placed'; readonly part: FoldPart }
  | { readonly kind: 'frozen'; readonly path: string }
  | { readonly kind: 'unexpressible'; readonly path: string };

interface HunkPlacementInput {
  readonly source: FoldSourceCommit;
  readonly parent: CommitSha;
  readonly candidates: readonly { readonly child: ChildId; readonly tip: CommitSha }[];
  readonly blocks: readonly { readonly id: string; readonly body: string }[] | undefined;
  readonly sourceHunk: FoldHunk;
  readonly index: string;
}

/** Classifies a hunk's frozen-block residual, then probes and places it. */
async function placeFoldHunk(input: PlaceFoldCommitsInput, hunkInput: HunkPlacementInput): Promise<HunkPlacement> {
  let hunk = hunkInput.sourceHunk;
  if (hunkInput.blocks !== undefined && containsFrozenBlock(hunk, hunkInput.blocks)) {
    const residual = residualHunk(hunk, hunkInput.blocks);
    if (residual === null) return { kind: 'frozen', path: hunk.path };
    if (residual === undefined || !await residualApplies(input.git, hunkInput.parent, residual.patch, hunkInput.index)) {
      return { kind: 'unexpressible', path: hunk.path };
    }
    hunk = residual;
  }

  const probe = await materializeHunk(
    input.git,
    hunkInput.parent,
    hunkInput.source.sha,
    hunk.path,
    hunk.patch,
    hunk.wholeFile,
    hunkInput.index,
  );
  const child = await lowestAcceptingChild(input, hunkInput.parent, probe, hunkInput.candidates);
  const reason: FoldPartReason = child === hunkInput.source.owner ? 'owner' : 'introduced-above-owner';
  return { kind: 'placed', part: { kind: 'hunks', child, path: hunk.path, hunk, reason } };
}

/** Plans one source commit, classifying whole, block, residual, and hunk parts. */
async function planFoldCommit(
  input: PlaceFoldCommitsInput,
  source: FoldSourceCommit,
  indexDirectory: string,
): Promise<FoldCommitPlan | FoldPlanRefusal> {
  const blocks = await frozenBlocks(input, source);
  const paths = await changedPaths(input.git, source.sha);
  if (paths.length === 0) {
    return { ...source, parts: [{ kind: 'whole', child: source.owner, paths: [], reason: 'owner' }] };
  }

  const parent = await sourceParent(input.git, source.sha);
  const candidates = await childTips(input, source.owner);
  const parts: FoldPart[] = blocks === undefined
    ? []
    : [{ kind: 'blocks', child: source.owner, paths: [], reason: 'owner', blocks }];
  const frozenPaths = new Set<string>();
  const unexpressiblePaths: string[] = [];

  for (const path of paths) {
    const diff = await input.git(['diff', '--binary', '--no-ext-diff', '--no-renames', '--unified=0', parent, source.sha, '--', path]);
    if (diff.exitCode !== 0) throw new Error(`cannot read fold hunks for ${source.sha}:${path}`);
    for (const [ordinal, sourceHunk] of hunkPatches(path, diff.stdout).entries()) {
      const index = join(indexDirectory, `${source.sha}-${path.replace(/[^A-Za-z0-9_.-]/g, '-')}-${ordinal}.index`);
      const placement = await placeFoldHunk(input, { source, parent, candidates, blocks, sourceHunk, index });
      if (placement.kind === 'frozen') {
        frozenPaths.add(placement.path);
        continue;
      }
      if (placement.kind === 'unexpressible') {
        unexpressiblePaths.push(placement.path);
        continue;
      }
      parts.push(placement.part);
    }
  }

  if (unexpressiblePaths.length > 0) {
    return { kind: 'refused', reason: 'fold-residual-unexpressible', commit: source.sha, paths: [...new Set(unexpressiblePaths)] };
  }
  const placedPaths = new Set(parts.flatMap((part) => part.kind === 'hunks' ? [part.path] : []).concat([...frozenPaths]));
  const unplacedPaths = paths.filter((path) => !placedPaths.has(path));
  if (unplacedPaths.length > 0) {
    return { kind: 'refused', reason: 'fold-unplaced-path', commit: source.sha, paths: unplacedPaths };
  }
  return { ...source, parts };
}

/**
 * Plans, without moving a ref or worktree, where each folded source commit is
 * replayed. Hunk probes use temporary indexes and merge-tree's three-way mode
 * so a later child only receives a change its accumulated tree can accept.
 */
export async function placeFoldCommits(input: PlaceFoldCommitsInput): Promise<FoldPlan> {
  const planned: FoldCommitPlan[] = [];
  const indexDirectory = await mkdtemp(join(tmpdir(), 'fold-plan-index-'));
  try {
    for (const source of input.commits) {
      const commit = await planFoldCommit(input, source, indexDirectory);
      if (commit.kind === 'refused') return commit;
      planned.push(commit);
    }
    return { kind: 'planned', commits: planned };
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}
