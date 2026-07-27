import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Initializes a git repo at `dir` for test use, scoped entirely to that
 * repo's local git config (never global or $HOME).
 */
export async function initTestRepo(dir: string): Promise<void> {
  execSync('git init -b main', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });

  // Durability + no-repack config, local to this repo only. Some tokens
  // (e.g. core.fsync values) are unsupported on older git versions -
  // treat failures here as advisory, never fatal to the test.
  const localConfig: Array<[string, string]> = [
    ['gc.auto', '0'],
    ['maintenance.auto', 'false'],
    ['core.fsync', 'loose-object'],
    ['core.fsyncObjectFiles', 'true'],
  ];

  for (const [key, value] of localConfig) {
    try {
      execSync(`git config ${key} "${value}"`, { cwd: dir });
    } catch (err) {
      // Non-fatal: log and continue so unsupported config doesn't kill tests.
      // eslint-disable-next-line no-console
      console.warn(`initTestRepo: could not set ${key}=${value} (advisory only): ${(err as Error).message}`);
    }
  }
}

/**
 * Stages all changes and commits them in a test repo.
 */
export async function commitAll(dir: string, message: string): Promise<void> {
  execSync('git add -A', { cwd: dir });
  execSync(`git commit -m "${message}"`, { cwd: dir });
}

/** Fixture for the "stale tracking ref" regression (#870/#872 incident). */
export interface StaleTrackingFixture {
  /** The feature-branch clone under test — `feat` is checked out, already
   * rebased onto the TRUE remote head, but its `origin/main` tracking ref
   * has been rolled back to simulate a worktree that never re-fetched. */
  repo: string;
  /** The bare "remote" — `git ls-remote origin main` against this always
   * reports the TRUE current head, regardless of `repo`'s stale tracking ref. */
  bare: string;
  /** `origin/main` tracking ref sha as left stale in `repo` (S, an ancestor
   * of `freshRemoteSha`). */
  staleTrackingSha: string;
  /** The true remote head sha (R) that `git ls-remote origin main` reports. */
  freshRemoteSha: string;
  /** Repo-relative path of a file that exists only in the S..R range — i.e.
   * content that belongs to main, not to the feature branch's own work. */
  mergedOnlyPath: string;
}

/**
 * Reproduces the incident behind #870/#872: a feature branch correctly
 * rebased onto the remote's true head, sitting in a worktree whose
 * `origin/<default>` tracking ref was never refreshed afterward (or was
 * cached stale). `git ls-remote origin main` still reports the true head;
 * only the local tracking ref lags.
 */
export async function setupStaleTrackingRefFixture(dir: string): Promise<StaleTrackingFixture> {
  const bare = join(dir, 'bare.git');
  const seed = join(dir, 'seed');
  const repo = join(dir, 'repo');
  const upstream = join(dir, 'upstream');

  execSync(`git init --bare -b main "${bare}"`);

  execSync(`git init -b main "${seed}"`);
  execSync('git config user.email "test@example.com"', { cwd: seed });
  execSync('git config user.name "Test User"', { cwd: seed });
  writeFileSync(join(seed, 'base.txt'), 'base\n');
  execSync('git add -A', { cwd: seed });
  execSync('git commit -q -m "init"', { cwd: seed });
  execSync(`git remote add origin "${bare}"`, { cwd: seed });
  execSync('git push -q origin main', { cwd: seed });

  execSync(`git clone -q "${bare}" "${repo}"`);
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test User"', { cwd: repo });
  const staleTrackingSha = execSync('git rev-parse origin/main', { cwd: repo }).toString().trim();

  execSync('git checkout -q -b feat', { cwd: repo });
  writeFileSync(join(repo, 'feat.txt'), 'feature work\n');
  execSync('git add -A', { cwd: repo });
  execSync('git commit -q -m "feat: add feature work"', { cwd: repo });

  // A separate clone lands "merged PR" work on main after `repo` last synced.
  execSync(`git clone -q "${bare}" "${upstream}"`);
  execSync('git config user.email "test@example.com"', { cwd: upstream });
  execSync('git config user.name "Test User"', { cwd: upstream });
  const mergedOnlyPath = 'merged-pr.txt';
  writeFileSync(join(upstream, mergedOnlyPath), 'merged PR content\n');
  execSync('git add -A', { cwd: upstream });
  execSync('git commit -q -m "merge PR #870"', { cwd: upstream });
  execSync('git push -q origin main', { cwd: upstream });
  const freshRemoteSha = execSync('git rev-parse HEAD', { cwd: upstream }).toString().trim();

  // `repo` fetches and rebases onto the true head R (a healthy rebase), then
  // its origin/main tracking ref is rolled back to S — simulating the
  // worktree never re-fetching afterward. `ls-remote` still reports R.
  execSync('git fetch -q origin', { cwd: repo });
  execSync('git rebase -q origin/main', { cwd: repo });
  execSync(`git update-ref refs/remotes/origin/main ${staleTrackingSha}`, { cwd: repo });

  return { repo, bare, staleTrackingSha, freshRemoteSha, mergedOnlyPath };
}
