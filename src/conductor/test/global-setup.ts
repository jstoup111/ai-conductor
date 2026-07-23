import { homedir } from 'node:os';
import { join } from 'node:path';
import { snapshotPipeline, diffPipeline } from './pipeline-leak-guard.js';
import {
  snapshotDaemonSessions,
  reapLeakedDaemonSessions,
  sweepStaleDaemonSessions,
  type ReapResult,
} from './tmux-leak-guard.js';
import {
  snapshotEngineerSignals,
  diffEngineerSignals,
  type EngineerSignalsDiff,
} from './signals-leak-guard.js';

/**
 * REAL engineer signals dir (the operator's actual store) — deliberately NOT
 * `process.env.AI_CONDUCTOR_ENGINEER_DIR`, since test/setup.ts redirects that
 * env var to a tmpdir for the whole test process. This guard must watch the
 * real default path regardless of that redirect (#861): the redirect is what
 * should be preventing pollution, and this guard is the backstop that proves
 * it's actually working.
 */
const REAL_ENGINEER_DIR = join(homedir(), '.ai-conductor', 'engineer');

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

/**
 * Decide the teardown outcome from an engineer-signals diff (#861).
 *
 * Any test-project-tagged lines added to the REAL engineer signals store
 * during the run means the test-process env redirect (src/conductor/test/
 * setup.ts, which points AI_CONDUCTOR_ENGINEER_DIR at a tmpdir) failed to
 * isolate some write path — the run FAILS, naming the delta count.
 *
 * Exported for direct unit testing of the throw-vs-warn decision, separate
 * from the real fs/vitest wiring — mirrors `applyTeardownDecision` above.
 */
export function applyEngineerSignalsTeardownDecision(
  diff: EngineerSignalsDiff,
  logger: (message: string) => void = console.error
): void {
  if (diff.addedTestProjectLines > 0) {
    throw new Error(
      `signals-leak-guard: ${diff.addedTestProjectLines} test-project-tagged signal(s) ` +
        `leaked into the REAL engineer signals store (${REAL_ENGINEER_DIR}) during this ` +
        `test run (#861) — the test-process env redirect in src/conductor/test/setup.ts ` +
        `(AI_CONDUCTOR_ENGINEER_DIR -> tmpdir) should have prevented this; find the write ` +
        `path that bypassed the redirect and fix it there`
    );
  }
}

/**
 * Best-effort reap on graceful interruption (SIGINT/SIGTERM). vitest's
 * `globalTeardown` only runs on a normal process exit — Ctrl-C, an external
 * `timeout`-style SIGTERM, or a killed worker all bypass it entirely, which
 * is exactly how sessions escaped the post-run reap in the first place. This
 * cannot catch SIGKILL (uncatchable by design); the pre-run sweep in
 * `setup()` is the backstop for whatever this can't reach.
 */
function installInterruptReap(
  getSnapshot: () => ReturnType<typeof snapshotDaemonSessions>,
  logger: (message: string) => void
): () => void {
  let handled = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (handled) return;
    handled = true;
    try {
      const result = reapLeakedDaemonSessions(getSnapshot());
      if (result.killed.length > 0) {
        logger(`tmux-leak-guard: reaped on ${signal} before exit: ${result.killed.join('; ')}`);
      }
    } catch {
      // Best-effort only — never let reap failure block shutdown.
    } finally {
      process.exit(1);
    }
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return () => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  };
}

export default async function setup() {
  const beforeState = await snapshotPipeline(process.cwd());

  // Signals leak guard (#861): snapshot the REAL engineer signals store
  // before the run so only test-project-tagged lines ADDED during this run
  // count as pollution leaked past the test-process env redirect.
  const engineerSignalsBefore = await snapshotEngineerSignals(REAL_ENGINEER_DIR);

  // Pre-run sweep (see tmux-leak-guard.ts header: "PERMANENT-BASELINE-
  // BLINDSPOT FIX"): kill any cc-daemon-* session already running whose pane
  // cwd is tmpdir-rooted — debris left behind by a previous run that was
  // interrupted before ITS teardown could reap it. Runs BEFORE the baseline
  // snapshot below so that debris is never silently absorbed as "pre-existing,
  // therefore never inspected again".
  const sweep = sweepStaleDaemonSessions();
  if (sweep.killed.length > 0) {
    console.error(
      `tmux-leak-guard: swept ${sweep.killed.length} stale tmpdir-rooted daemon ` +
        `session(s) left behind by a previous interrupted run (killed at pre-run ` +
        `sweep — this run is not at fault): ${sweep.killed.join('; ')}`
    );
  }

  // Tmux leak guard (#377): snapshot the operator's pre-existing cc-daemon-*
  // sessions so only sessions CREATED during this run count as leaks.
  const daemonSnapshot = snapshotDaemonSessions();
  globalThis.__tmuxSnapshot = daemonSnapshot;

  const removeInterruptHandlers = installInterruptReap(
    () => globalThis.__tmuxSnapshot ?? daemonSnapshot,
    console.error
  );

  // Return the async teardown function
  return async () => {
    removeInterruptHandlers();

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

    // Signals leak guard (#861): re-snapshot the REAL engineer signals store
    // and diff against the pre-run baseline. snapshotEngineerSignals already
    // catches its own read errors internally (returns exists: false) rather
    // than throwing, but this is wrapped defensively anyway — an unexpected
    // error here must degrade to a warning, not fail the whole suite (same
    // fail-safe policy as the tmux guard's indeterminate branch above).
    try {
      const engineerSignalsAfter = await snapshotEngineerSignals(REAL_ENGINEER_DIR);
      const engineerSignalsDiff = diffEngineerSignals(engineerSignalsBefore, engineerSignalsAfter);
      applyEngineerSignalsTeardownDecision(engineerSignalsDiff);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('signals-leak-guard:')) {
        throw err;
      }
      console.error(
        `signals-leak-guard: NOT enforced (fail-safe): unexpected error while checking the ` +
          `real engineer signals store for leaked test-project lines — investigate manually: ${err}`
      );
    }
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __tmuxSnapshot: ReturnType<typeof snapshotDaemonSessions> | undefined;
}
