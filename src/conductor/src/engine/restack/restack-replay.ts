import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyReplayMerge, type GitRunner } from '../rebase.js';
import type { CommitSha, ChildRange } from './restack-types.js';
import { parseCommitSha } from './restack-types.js';

/** The operation-wide identity recorded in the durable restack journal. */
export interface CommitterStamp {
  readonly name: string;
  readonly email: string;
  readonly date: string;
}

export interface ChildRangeReplay {
  /** The rewritten range tip, or `newParent` when every commit was dropped. */
  readonly tip: CommitSha;
  /** Exact correspondences for commits that produced a new object. */
  readonly rewrites: ReadonlyMap<CommitSha, CommitSha>;
  /** The merge decisions that become one persisted audit event per restack. */
  readonly audit: {
    readonly flattenedMerges: readonly CommitSha[];
    readonly ancestryOnlyMerges: readonly CommitSha[];
    readonly sideLineageCount: number;
  };
}

/** Commits newly introduced by the operation, never commits already in the stack. */
export interface ReplayChildRangeOptions {
  readonly comparisonCommits?: readonly CommitSha[];
}

interface AuthorIdentity {
  readonly name: string;
  readonly email: string;
  readonly date: string;
}

function requiredSha(raw: string, context: string): CommitSha {
  const value = parseCommitSha(raw.trim());
  if (!value) throw new Error(`${context} did not return a full Git object name`);
  return value;
}

async function requiredShaFrom(git: GitRunner, args: string[], context: string): Promise<CommitSha> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`${context}: ${result.stderr}`);
  return requiredSha(result.stdout, context);
}

async function authorOf(git: GitRunner, commit: CommitSha): Promise<AuthorIdentity> {
  const result = await git(['show', '-s', '--format=%an%x00%ae%x00%aI', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read author for ${commit}: ${result.stderr}`);
  const [name, email, date, extra] = result.stdout.split('\0');
  if (!name || !email || !date || extra !== undefined) throw new Error(`could not parse author for ${commit}`);
  return { name, email, date: date.trim() };
}

async function messageOf(git: GitRunner, commit: CommitSha): Promise<string> {
  const result = await git(['show', '-s', '--format=%B', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read message for ${commit}: ${result.stderr}`);
  return result.stdout;
}

async function mergeParents(git: GitRunner, commit: CommitSha): Promise<readonly CommitSha[]> {
  const result = await git(['rev-list', '--parents', '-n', '1', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read parents for ${commit}: ${result.stderr}`);
  return result.stdout.trim().split(/\s+/).slice(1).map((parent) => requiredSha(parent, `parent for ${commit}`));
}

async function sideLineageCount(git: GitRunner, firstParent: CommitSha, secondParent: CommitSha): Promise<number> {
  const result = await git(['rev-list', `${firstParent}..${secondParent}`]);
  if (result.exitCode !== 0) throw new Error(`could not list side lineage for ${secondParent}: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean).length;
}

async function commitsInFirstParentRange(git: GitRunner, range: ChildRange): Promise<CommitSha[]> {
  const result = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (result.exitCode !== 0) throw new Error(`could not list restack range: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean).map((value) => requiredSha(value, 'rev-list'));
}

async function commitsAreSigned(git: GitRunner): Promise<boolean> {
  const result = await git(['config', '--bool', 'commit.gpgSign']);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

async function patchIdForCommit(git: GitRunner, commit: CommitSha): Promise<string | undefined> {
  const patch = await git(['show', '--format=', '--no-ext-diff', commit]);
  if (patch.exitCode !== 0) throw new Error(`could not read patch for ${commit}: ${patch.stderr}`);
  const result = await git(['patch-id', '--stable'], { input: patch.stdout });
  if (result.exitCode !== 0) throw new Error(`could not compute patch-id for ${commit}: ${result.stderr}`);
  const line = result.stdout.trim().split('\n').find(Boolean);
  return line?.split(/\s+/, 1)[0];
}

async function patchIdsForCommits(git: GitRunner, commits: readonly CommitSha[]): Promise<ReadonlySet<string>> {
  const patchIds = new Set<string>();
  for (const commit of commits) {
    const patchId = await patchIdForCommit(git, commit);
    if (patchId !== undefined) patchIds.add(patchId);
  }
  return patchIds;
}

function conflictPaths(stdout: string, stderr: string): string[] {
  const paths = new Set<string>();
  for (const line of `${stdout}\n${stderr}`.split('\n')) {
    const match = line.match(/CONFLICT .*? in\s+(.+)$/);
    if (match?.[1]?.trim()) paths.add(match[1].trim());
  }
  return [...paths];
}

function isHaltRecordPath(path: string): boolean {
  return /^\.docs\/halted\/[^/]+\.md$/.test(path);
}

async function upperChildHaltRecordTree(
  git: GitRunner,
  mergeTreeOutput: string,
  commit: CommitSha,
  path: string,
): Promise<CommitSha> {
  const mergedTree = requiredSha(mergeTreeOutput.split('\n', 1)[0] ?? '', `merge-tree for ${commit}`);
  const upper = await git(['ls-tree', commit, '--', path]);
  if (upper.exitCode !== 0) throw new Error(`could not read halt record from ${commit}: ${upper.stderr}`);
  const entry = upper.stdout.trim();
  const match = entry.match(/^(\d+)\s+(blob)\s+([0-9a-f]{40,64})\t/);
  const indexDirectory = await mkdtemp(join(tmpdir(), 'restack-halt-record-index-'));
  const indexPath = join(indexDirectory, 'index');
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    const read = await git(['read-tree', mergedTree], { env });
    if (read.exitCode !== 0) throw new Error(`could not load merged tree for ${commit}: ${read.stderr}`);
    const update = match
      ? await git(['update-index', '--add', '--cacheinfo', `${match[1]},${match[3]},${path}`], { env })
      : await git(['update-index', '--force-remove', path], { env });
    if (update.exitCode !== 0) throw new Error(`could not select upper halt record from ${commit}: ${update.stderr}`);
    const written = await git(['write-tree'], { env });
    if (written.exitCode !== 0) throw new Error(`could not write halt-record tree for ${commit}: ${written.stderr}`);
    return requiredSha(written.stdout, `halt-record tree for ${commit}`);
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

/** Construct identity for exactly one replayed commit. */
function commitEnvironment(
  author: AuthorIdentity,
  stamp: CommitterStamp,
): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: author.date,
    GIT_COMMITTER_NAME: stamp.name,
    GIT_COMMITTER_EMAIL: stamp.email,
    GIT_COMMITTER_DATE: stamp.date,
  };
}

/**
 * Replay one child's ordinary first-parent range using object plumbing only.
 * It creates unreachable objects but never moves a ref, index, or worktree.
 */
export async function replayChildRange(
  range: ChildRange,
  newParent: CommitSha,
  stamp: CommitterStamp,
  git: GitRunner,
  options: ReplayChildRangeOptions = {},
): Promise<ChildRangeReplay> {
  const sign = await commitsAreSigned(git);
  const comparisonPatchIds = await patchIdsForCommits(git, options.comparisonCommits ?? []);
  const rewrites = new Map<CommitSha, CommitSha>();
  const flattenedMerges: CommitSha[] = [];
  const ancestryOnlyMerges: CommitSha[] = [];
  let sideLineageCountTotal = 0;
  let accumulator = newParent;

  for (const commit of await commitsInFirstParentRange(git, range)) {
    // Only patches newly introduced by this operation are already carried.
    // A matching patch in the stack itself (for example a child re-applying a
    // reverted parent change) must remain part of that child's history.
    if (comparisonPatchIds.has(await patchIdForCommit(git, commit) ?? '')) continue;
    const parents = await mergeParents(git, commit);
    const isMerge = parents.length >= 2;
    const merge = isMerge
      ? await classifyReplayMerge(git, commit, newParent, 'stacked')
      : undefined;
    if (merge?.kind === 'ancestry-only') {
      ancestryOnlyMerges.push(commit);
      sideLineageCountTotal += await sideLineageCount(git, requiredSha(merge.firstParent, `first parent for ${commit}`), requiredSha(merge.secondParent, `second parent for ${commit}`));
      continue;
    }
    if (merge !== undefined) {
      sideLineageCountTotal += await sideLineageCount(git, requiredSha(merge.firstParent, `first parent for ${commit}`), requiredSha(merge.secondParent, `second parent for ${commit}`));
      if (merge.kind === 'flattened') flattenedMerges.push(commit);
    }
    const mergeArgs = merge?.kind === 'q-carried'
      ? ['merge-tree', '--write-tree', '--merge-base', merge.autoTree, accumulator, commit]
      : ['merge-tree', '--write-tree', '--merge-base', `${commit}^1`, accumulator, commit];
    const [merged, originalTree, originalParentTree, accumulatorTree, author, message] = await Promise.all([
      git(mergeArgs),
      requiredShaFrom(git, ['rev-parse', `${commit}^{tree}`], `tree for ${commit}`),
      requiredShaFrom(git, ['rev-parse', `${commit}^1^{tree}`], `first-parent tree for ${commit}`),
      requiredShaFrom(git, ['rev-parse', `${accumulator}^{tree}`], `accumulator tree for ${commit}`),
      authorOf(git, commit),
      messageOf(git, commit),
    ]);
    const paths = merged.exitCode === 1 ? conflictPaths(merged.stdout, merged.stderr) : [];
    if (merged.exitCode !== 0 && !(merged.exitCode === 1 && paths.length === 1 && isHaltRecordPath(paths[0]!))) {
      throw new Error(`merge-tree failed for ${commit}: ${merged.stderr}`);
    }
    const mergedTree = paths.length === 1 && isHaltRecordPath(paths[0]!)
      ? await upperChildHaltRecordTree(git, merged.stdout, commit, paths[0]!)
      : requiredSha(merged.stdout, `merge-tree for ${commit}`);

    // Rebase drops a newly-empty patch, but evidence commits that began empty
    // remain meaningful history and must retain their exact correspondence.
    if (mergedTree === accumulatorTree && originalTree !== originalParentTree) continue;

    const replayedMessage = merge === undefined
      ? message
      : `${message}\nFlattened-merge: ${commit}\n`;
    const result = await git([
      'commit-tree',
      ...(sign ? ['-S'] : []),
      mergedTree,
      '-p', accumulator,
    ], { input: replayedMessage, env: commitEnvironment(author, stamp) });
    if (result.exitCode !== 0) throw new Error(`commit-tree failed for ${commit}: ${result.stderr}`);
    const rewritten = requiredSha(result.stdout, `commit-tree for ${commit}`);
    rewrites.set(commit, rewritten);
    accumulator = rewritten;
  }

  return {
    tip: accumulator,
    rewrites,
    audit: { flattenedMerges, ancestryOnlyMerges, sideLineageCount: sideLineageCountTotal },
  };
}
