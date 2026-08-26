import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/** Convert an idea into the bounded branch-name segment used by engineer specs. */
export function slugify(idea: string): string {
  return idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Resolve the checked-out branch used as the base for engineer spec worktrees. */
export async function deriveDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoPath,
    });
    const branch = stdout.trim();
    if (branch && branch !== 'HEAD') return branch;
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error(
    `engineer: could not derive default branch for repo at "${repoPath}". ` +
      'Ensure the repo has at least one commit and is not in a detached HEAD state.',
  );
}
