import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyReplayMerge, type GitRunner } from '../rebase.js';
import type { CommitSha, ChildRange } from './restack-types.js';
import { unionRemBlocks } from '../routing/rem-block-merge.js';
import { carryNewestHaltRecord, haltRecordPathFor, haltRecordTree, mapOmittedHaltRecordCommits } from './halt-record-bookkeeping.js';
import { selectReplayCandidates } from './restack-replay-candidates.js';
import { authorOf, mergeParents, messageOf, requiredCommitSha, sideLineageCount, type AuthorIdentity } from './restack-commit-metadata.js';

/** A deterministic append-only plan conflict that must halt without an LLM resolver. */
export class RemBlockBodyMismatchError extends Error {
  constructor(readonly commit: CommitSha, readonly path: string, readonly remId: string) {
    super(`remediation block body mismatch for ${remId}`);
  }
}

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
  /** The append-only plan union is reserved for a journalled routed repair. */
  readonly appendOnlyRemUnion?: boolean;
  /** Omit and pin this feature's halt record while replaying ordinary commits. */
  readonly haltRecordSlug?: string;
  /** Whether the range owns this feature's halt record after carried-merge normalization. */
  readonly haltRecordOwned?: boolean;
}

async function requiredShaFrom(git: GitRunner, args: string[], context: string): Promise<CommitSha> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`${context}: ${result.stderr}`);
  return requiredCommitSha(result.stdout, context);
}

async function commitsAreSigned(git: GitRunner): Promise<boolean> {
  const result = await git(['config', '--bool', 'commit.gpgSign']);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
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

async function pinnedHaltRecordTree(
  git: GitRunner,
  mergeTreeOutput: string,
  commit: CommitSha,
  source: CommitSha,
  path: string,
): Promise<CommitSha> {
  const mergedTree = requiredCommitSha(mergeTreeOutput.split('\n', 1)[0] ?? '', `merge-tree for ${commit}`);
  const record = await haltRecordTree(git, source, path, { kind: 'read' });
  const tree = await haltRecordTree(git, mergedTree, path, { kind: 'write', record });
  return requiredCommitSha(tree, `halt-record tree for ${commit}`);
}

async function textAt(git: GitRunner, revision: string, path: string): Promise<string | undefined> {
  const result = await git(['show', `${revision}:${path}`]);
  return result.exitCode === 0 ? result.stdout : undefined;
}

/** Builds a conflict-free tree from an append-only plan union without touching the worktree. */
async function unionPlanConflictTree(
  git: GitRunner,
  mergeTreeOutput: string,
  commit: CommitSha,
  accumulator: CommitSha,
  path: string,
): Promise<CommitSha | undefined> {
  if (!path.startsWith('.docs/plans/') || !path.endsWith('.md')) return undefined;
  const [base, ours, theirs] = await Promise.all([
    textAt(git, `${commit}^`, path), textAt(git, accumulator, path), textAt(git, commit, path),
  ]);
  if (base === undefined || ours === undefined || theirs === undefined) return undefined;
  const union = unionRemBlocks(base, ours, theirs);
  if (union.kind === 'declined') return undefined;
  if (union.kind === 'body-mismatch') throw new RemBlockBodyMismatchError(commit, path, union.remId);
  const mergedTree = requiredCommitSha(mergeTreeOutput.split('\n', 1)[0] ?? '', `merge-tree for ${commit}`);
  const directory = await mkdtemp(join(tmpdir(), 'restack-rem-union-index-'));
  const indexPath = join(directory, 'index');
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    const read = await git(['read-tree', mergedTree], { env });
    const blob = await git(['hash-object', '-w', '--stdin'], { input: union.text });
    if (read.exitCode !== 0 || blob.exitCode !== 0) throw new Error(`cannot construct remediation plan union for ${commit}`);
    const update = await git(['update-index', '--add', '--cacheinfo', `100644,${requiredCommitSha(blob.stdout, 'remediation plan blob')},${path}`], { env });
    const written = await git(['write-tree'], { env });
    if (update.exitCode !== 0 || written.exitCode !== 0) throw new Error(`cannot write remediation plan union for ${commit}`);
    return requiredCommitSha(written.stdout, `remediation plan union tree for ${commit}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
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
  const rewrites = new Map<CommitSha, CommitSha>();
  const flattenedMerges: CommitSha[] = [];
  const ancestryOnlyMerges: CommitSha[] = [];
  let sideLineageCountTotal = 0;
  let accumulator = newParent;

  for (const commit of await selectReplayCandidates(git, range, options.comparisonCommits, options.haltRecordSlug)) {
    const parents = await mergeParents(git, commit);
    const isMerge = parents.length >= 2;
    const merge = isMerge
      ? await classifyReplayMerge(git, commit, newParent, 'stacked')
      : undefined;
    if (merge?.kind === 'ancestry-only') {
      ancestryOnlyMerges.push(commit);
      sideLineageCountTotal += await sideLineageCount(git, requiredCommitSha(merge.firstParent, `first parent for ${commit}`), requiredCommitSha(merge.secondParent, `second parent for ${commit}`));
      continue;
    }
    if (merge !== undefined) {
      sideLineageCountTotal += await sideLineageCount(git, requiredCommitSha(merge.firstParent, `first parent for ${commit}`), requiredCommitSha(merge.secondParent, `second parent for ${commit}`));
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
    const haltPath = options.haltRecordSlug === undefined ? undefined : haltRecordPathFor(options.haltRecordSlug);
    const pinsHaltRecord = paths.length === 1 && isHaltRecordPath(paths[0]!);
    const pinSource = paths[0] === haltPath ? accumulator : commit;
    const remUnionTree = options.appendOnlyRemUnion === true && merged.exitCode === 1 && paths.length === 1
      ? await unionPlanConflictTree(git, merged.stdout, commit, accumulator, paths[0]!)
      : undefined;
    if (merged.exitCode !== 0 && !(merged.exitCode === 1 && (remUnionTree !== undefined || pinsHaltRecord))) {
      throw new Error(`merge-tree failed for ${commit}: ${merged.stderr}`);
    }
    const mergedTree = remUnionTree ?? (pinsHaltRecord
      ? await pinnedHaltRecordTree(git, merged.stdout, commit, pinSource, paths[0]!)
      : requiredCommitSha(merged.stdout, `merge-tree for ${commit}`));

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
    const rewritten = requiredCommitSha(result.stdout, `commit-tree for ${commit}`);
    rewrites.set(commit, rewritten);
    accumulator = rewritten;
  }

  if (options.haltRecordSlug !== undefined) {
    const carried = await carryNewestHaltRecord(range, newParent, options.haltRecordSlug, accumulator, stamp, options.haltRecordOwned, git);
    accumulator = carried.tip;
    await mapOmittedHaltRecordCommits(range, options.haltRecordSlug, newParent, accumulator, rewrites, git);
  }

  return {
    tip: accumulator,
    rewrites,
    audit: { flattenedMerges, ancestryOnlyMerges, sideLineageCount: sideLineageCountTotal },
  };
}
