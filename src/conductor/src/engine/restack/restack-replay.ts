import { withPinnedGitConfig } from '../git-pinned-config.js';
import type { GitRunner } from '../rebase.js';
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

async function commitsInFirstParentRange(git: GitRunner, range: ChildRange): Promise<CommitSha[]> {
  const result = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (result.exitCode !== 0) throw new Error(`could not list restack range: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean).map((value) => requiredSha(value, 'rev-list'));
}

async function commitsAreSigned(git: GitRunner): Promise<boolean> {
  const result = await git(['config', '--bool', 'commit.gpgSign']);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

/**
 * `GitRunner` predates the plumbing replay and deliberately has a minimal
 * options surface.  It captures process.env synchronously when it launches
 * its child, so scope identity/config just around that launch and restore it
 * before another replay command can run.
 */
async function withCommitEnvironment<T>(
  author: AuthorIdentity,
  stamp: CommitterStamp,
  operation: () => Promise<T>,
): Promise<T> {
  const environment = {
    ...withPinnedGitConfig(process.env),
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: author.date,
    GIT_COMMITTER_NAME: stamp.name,
    GIT_COMMITTER_EMAIL: stamp.email,
    GIT_COMMITTER_DATE: stamp.date,
  };
  const prior = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(environment)) {
    prior.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
): Promise<ChildRangeReplay> {
  const sign = await commitsAreSigned(git);
  const rewrites = new Map<CommitSha, CommitSha>();
  let accumulator = newParent;

  for (const commit of await commitsInFirstParentRange(git, range)) {
    const [merged, originalTree, originalParentTree, accumulatorTree, author, message] = await Promise.all([
      git(['merge-tree', '--write-tree', '--merge-base', `${commit}^1`, accumulator, commit]),
      requiredShaFrom(git, ['rev-parse', `${commit}^{tree}`], `tree for ${commit}`),
      requiredShaFrom(git, ['rev-parse', `${commit}^1^{tree}`], `first-parent tree for ${commit}`),
      requiredShaFrom(git, ['rev-parse', `${accumulator}^{tree}`], `accumulator tree for ${commit}`),
      authorOf(git, commit),
      messageOf(git, commit),
    ]);
    if (merged.exitCode !== 0) throw new Error(`merge-tree failed for ${commit}: ${merged.stderr}`);
    const mergedTree = requiredSha(merged.stdout, `merge-tree for ${commit}`);

    // Rebase drops a newly-empty patch, but evidence commits that began empty
    // remain meaningful history and must retain their exact correspondence.
    if (mergedTree === accumulatorTree && originalTree !== originalParentTree) continue;

    const rewritten = await withCommitEnvironment(author, stamp, async () => {
      const result = await git([
        'commit-tree',
        ...(sign ? ['-S'] : []),
        mergedTree,
        '-p', accumulator,
      ], { input: message });
      if (result.exitCode !== 0) throw new Error(`commit-tree failed for ${commit}: ${result.stderr}`);
      return requiredSha(result.stdout, `commit-tree for ${commit}`);
    });
    rewrites.set(commit, rewritten);
    accumulator = rewritten;
  }

  return { tip: accumulator, rewrites };
}
