import { snapshotPipeline, diffPipeline } from './pipeline-leak-guard.js';
import { snapshotDaemonSessions, reapLeakedDaemonSessions, type ReapResult } from './tmux-leak-guard.js';

/**
 * Global vitest setup/teardown: detect .pipeline leaks during test runs.
 *
 * This is the vitest globalSetup entry point (see vitest.config.ts).
 * On test suite startup, we snapshot the .pipeline directory state.
 * After all tests complete, we re-snapshot and diff. If any files were
 * added or modified in .pipeline, we fail the suite with a detailed error.
 *
 * TRIP TEST CASE (manual verification):
 * To verify the guard works, temporarily add a file to .pipeline during a test:
 *   1. Add `await mkdir(join(process.cwd(), '.pipeline'), { recursive: true });`
 *   2. Add `await writeFile(join(process.cwd(), '.pipeline', 'HALT'), 'leak');`
 *      to any .test.ts file (e.g., in backlog-priority.test.ts afterEach cleanup)
 *   3. Run tests: expect teardown to fail with ".pipeline leak into <cwd>"
 *   4. Remove the plant and re-run: suite passes silently
 *
 * Once verified, this guard is active for all future test runs.
 */
/**
 * Decide the teardown outcome from a reap result (#437, TR-1 + TR-2).
 *
 * Killed leaks are corroborated (baseline succeeded, new session, tmpdir-
 * rooted pane cwd) — the run FAILS, naming the sessions and pointing at
 * #377 so the spawning path gets fixed.
 *
 * Indeterminate sessions could NOT be corroborated (snapshot failure or a
 * non-tmpdir pane cwd) — they are left running and reported via
 * `console.error` as a warning, but do NOT fail the run: a transient
 * snapshot failure must not take down the production daemon session or the
 * whole suite (TR-1).
 *
 * Exported for direct unit testing of the throw-vs-warn decision, separate
 * from the real tmux/vitest wiring.
 */
export function applyTeardownDecision(
  result: ReapResult,
  logger: (message: string) => void = console.error
): void {
  const { killed, indeterminate } = result;

  if (indeterminate.length > 0) {
    logger(
      `tmux-leak-guard: NOT killed (fail-closed): tmux daemon-session(s) appeared during ` +
        `the run but could not be corroborated as leaks (baseline snapshot failure or ` +
        `non-tmpdir pane cwd) — left running, investigate manually: ${indeterminate.join('; ')}`
    );
  }

  if (killed.length > 0) {
    throw new Error(
      `tmux-leak-guard: KILLED leaked session(s) during test run (killed at teardown, ` +
        `but the spawning path must be fixed — see #377): ${killed.join('; ')}`
    );
  }
}

export default async function setup() {
  const beforeState = await snapshotPipeline(process.cwd());
  // Tmux leak guard (#377): snapshot the operator's pre-existing cc-daemon-*
  // sessions so only sessions CREATED during this run count as leaks.
  const daemonSnapshot = snapshotDaemonSessions();
  globalThis.__tmuxSnapshot = daemonSnapshot;

  // Return the async teardown function
  return async () => {
    const afterState = await snapshotPipeline(process.cwd());
    const diff = diffPipeline(beforeState, afterState);

    if (diff.added.length > 0 || diff.modified.length > 0) {
      const leakedFiles = [...diff.added, ...diff.modified].join(', ');
      throw new Error(
        `.pipeline leak into ${process.cwd()} during test run: ${leakedFiles}`
      );
    }

    // Tmux leak guard (#377): any cc-daemon-* session created during the run
    // is a kill-switch escape — a REAL daemon idle-polling a (likely deleted)
    // fixture repo. Kill it, then fail the run naming it; the pane cwd's
    // fixture prefix (loop-test-, intake-life-, …) attributes the leaking file.
    const result = reapLeakedDaemonSessions(globalThis.__tmuxSnapshot ?? daemonSnapshot);
    applyTeardownDecision(result);
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __tmuxSnapshot: ReturnType<typeof snapshotDaemonSessions> | undefined;
}
