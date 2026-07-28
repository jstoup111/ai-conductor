import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

/**
 * Engine-dist guard: guarantee `src/conductor/dist` resolves BEFORE any test
 * runs.
 *
 * Thirteen test files spawn the real `bin/conduct-ts` binary. That wrapper
 * refuses to run when `src/conductor/dist` is absent or its symlink is
 * dangling:
 *
 *     conduct-ts: missing .../dist/index.js
 *     conduct-ts: run 'npm run build' in src/conductor/
 *     exit 1
 *
 * `dist` is a gitignored symlink into `dist-versions/<id>/`, so it does not
 * exist in a fresh clone or a fresh `git worktree` after `npm ci`. There is no
 * `pretest` hook — `npm test` runs vitest directly — so nothing built it up
 * front. It only appeared partway through a run, when whichever test happens to
 * publish an engine got there. Every real-binary test scheduled before that
 * point failed on exit 1, and every run afterwards passed because `dist` was
 * now warm.
 *
 * Observed on a fresh worktree: `dist` was created 86 seconds into the run;
 * 10 tests across 2 files failed, and three consecutive re-runs were green
 * with no code change. That reads exactly like flakiness, but it is an
 * ordering dependency, not a race in the code under test.
 *
 * The fix is to make the dependency explicit and satisfied once, before the
 * first test — not to retry, extend timeouts, or let test order decide.
 */

/**
 * True when `dist/index.js` cannot be resolved and the engine must be built.
 *
 * `stat` follows symlinks, so this reports `true` for all three broken states
 * the wrapper rejects: no `dist` at all, a `dist` symlink dangling at a
 * garbage-collected version dir, and a `dist` directory with no `index.js`.
 */
export async function distNeedsBuild(conductorRoot: string): Promise<boolean> {
  try {
    await stat(join(conductorRoot, 'dist', 'index.js'));
    return false;
  } catch {
    return true;
  }
}

/**
 * Build the engine if — and only if — `dist` does not already resolve.
 *
 * A no-op on a warm checkout, so the steady-state suite pays nothing. On a cold
 * one it pays the build once, up front, instead of paying it mid-run at the
 * cost of whichever real-binary tests were scheduled first.
 *
 * Returns whether a build actually ran, so the caller can say so.
 */
export async function ensureEngineDist(
  conductorRoot: string,
  runBuild: (cwd: string) => Promise<void> = defaultBuild
): Promise<boolean> {
  if (!(await distNeedsBuild(conductorRoot))) return false;

  await runBuild(conductorRoot);

  // Fail loudly and immediately rather than letting 13 files fail one by one
  // with a message that points at the wrong thing.
  if (await distNeedsBuild(conductorRoot)) {
    throw new Error(
      `engine-dist-guard: built the engine but ${join(conductorRoot, 'dist', 'index.js')} ` +
        `still does not resolve — real-binary tests would fail with "conduct-ts: missing dist". ` +
        `Run 'npm run build' in src/conductor/ and investigate before re-running the suite.`
    );
  }
  return true;
}

async function defaultBuild(cwd: string): Promise<void> {
  await execa('node', ['scripts/publish-engine.mjs'], { cwd, stdio: 'inherit' });
}
