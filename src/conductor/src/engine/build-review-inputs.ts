import { readFile } from 'node:fs/promises';
import { originDefaultBranch, type GitRunner } from './rebase.js';

// ── Grader input assembly (build_review) ────────────────────────────────────
//
// Assembles the ONLY inputs the build_review grader sees: the diff since the
// repo's default branch, and the plan body. No task-status, transcript, or
// maker-summary access here — input isolation is the whole point (the grader
// must judge the diff against the plan, not the maker's narrative about it).

/** Grader inputs: the diff to review and the plan text it must satisfy. */
export interface BuildReviewInputs {
  /** `git diff <merge-base(defaultBranch, HEAD)>..HEAD`. Empty string signals
   * no changes to grade — the caller must write a FAIL verdict
   * "no diff to grade" rather than dispatch a grader. */
  diff: string;
  /** Raw contents of the plan file at `planPath`. */
  planBody: string;
}

/** Raised when the default branch's merge-base with HEAD cannot be computed. */
export class MergeBaseError extends Error {
  constructor(message: string, readonly ref: string) {
    super(message);
    this.name = 'MergeBaseError';
  }
}

/**
 * Discover the default branch name, never hardcoding `main`. Prefers
 * origin's discovered default (`refs/remotes/origin/HEAD`); falls back to
 * `init.defaultBranch` config, then to whichever of the common local
 * candidates actually exists as a branch.
 */
async function detectDefaultBranch(git: GitRunner): Promise<string> {
  const originBranch = await originDefaultBranch(git);
  if (originBranch) return originBranch;

  const cfg = await git(['config', '--get', 'init.defaultBranch']);
  if (cfg.exitCode === 0 && cfg.stdout.trim()) return cfg.stdout.trim();

  for (const candidate of ['main', 'master']) {
    const check = await git(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`]);
    if (check.exitCode === 0) return candidate;
  }

  throw new MergeBaseError('Unable to determine the repo default branch', '');
}

/**
 * Assemble the build_review grader's inputs: the diff since the merge-base
 * of the repo's (derived, never hardcoded) default branch and HEAD, plus the
 * plan body. Inputs are strictly `(git, planPath)` — no conductor state.
 */
export async function assembleBuildReviewInputs(
  git: GitRunner,
  planPath: string,
): Promise<BuildReviewInputs> {
  const defaultBranch = await detectDefaultBranch(git);

  const mergeBase = await git(['merge-base', defaultBranch, 'HEAD']);
  const mergeBaseSha = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || !mergeBaseSha) {
    throw new MergeBaseError(
      `git merge-base ${defaultBranch} HEAD failed: ${mergeBase.stderr || 'no merge base found'}`,
      defaultBranch,
    );
  }

  const diffResult = await git(['diff', `${mergeBaseSha}..HEAD`]);
  if (diffResult.exitCode !== 0) {
    throw new MergeBaseError(
      `git diff ${mergeBaseSha}..HEAD failed: ${diffResult.stderr || 'unknown error'}`,
      defaultBranch,
    );
  }

  const planBody = await readFile(planPath, 'utf-8');

  return { diff: diffResult.stdout, planBody };
}
