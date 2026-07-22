import { execSync } from 'node:child_process';

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
