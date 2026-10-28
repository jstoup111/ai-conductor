import { type GitRunner } from '../rebase.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';

/** A ref that is absent, invalid, or could not be resolved by Git. */
export interface UnresolvedGitRef {
  readonly kind: 'unresolved';
}

/** The immutable object name Git resolved for a ref, or its typed failure. */
export type GitRefResolution = CommitSha | UnresolvedGitRef;

/**
 * Resolve a Git ref to a validated commit/object SHA.
 *
 * Git's nonzero result and a runner exception are deliberately equivalent to
 * callers: neither yields a usable immutable object name.
 */
export async function resolveGitRef(git: GitRunner, ref: string): Promise<GitRefResolution> {
  try {
    const result = await git(['rev-parse', '-q', '--verify', ref]);
    const sha = result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
    return sha ?? { kind: 'unresolved' };
  } catch {
    return { kind: 'unresolved' };
  }
}
