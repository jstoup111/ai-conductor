import { rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { snapshotPipeline, diffPipeline } from './pipeline-leak-guard.js';
import {
  diffParkedMarkers,
  resolveRealParkedDir,
  snapshotParkedMarkers,
  type ParkedMarkersDiff,
  type ParkedMarkersSnapshot,
} from './park-leak-guard.js';
import {
  createRunTmpRoot,
  diffTmpdirEntries,
  removeRunTmpRoot,
  snapshotTmpdirEntries,
  RUN_TMP_ROOT_ENV,
  type TmpdirDiff,
} from './tmpdir-leak-guard.js';
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
import { ensureEngineDist } from './engine-dist-guard.js';

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
 * Decide whether real parked-marker ledger changes make the test run fail.
 *
 * This stays separate from global teardown wiring so its fail-fast policy is
 * directly unit-testable before the parked-ledger lifecycle is introduced.
 */
export function applyParkTeardownDecision(diff: ParkedMarkersDiff): void {
  const leakedSlugs = [...diff.added, ...diff.removed, ...diff.modified];
  if (leakedSlugs.length > 0) {
    throw new Error(
      `park-leak-guard: parked marker ledger changed during test run: ` +
        `${leakedSlugs.join(', ')} (#1251)`
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
 * Decide the teardown outcome from a real-tmpdir diff (#1112).
 *
 * Any entry that appeared in the REAL tmpdir during the run and is neither the
 * run root nor known concurrent-tooling noise is a temp directory the suite
 * created OUTSIDE the run root — the `TMPDIR` redirect installed in `setup()`
 * did not contain it (hardcoded `/tmp`, an `os.tmpdir()` value cached before
 * the redirect, or a subprocess spawned with a scrubbed env). Those are the
 * calls that filled the operator's tmpfs to the point of breaking unrelated
 * production processes with `ENOSPC`, so the run FAILS naming them.
 *
 * Ignored entries are reported through the logger only — a browser or the
 * daemon writing to `/tmp` mid-run is not the suite's fault and must never
 * fail it (same warn-don't-fail stance as the tmux guard's indeterminate set).
 *
 * Exported for direct unit testing of the throw-vs-warn decision, separate
 * from the real fs/vitest wiring — mirrors the two decisions above.
 */
export function applyTmpdirTeardownDecision(
  diff: TmpdirDiff,
  realTmpdir: string,
  logger: (message: string) => void = console.error
): void {
  if (diff.ignored.length > 0) {
    logger(
      `tmpdir-leak-guard: ignored ${diff.ignored.length} new ${realTmpdir} entry/entries ` +
        `attributed to concurrent tooling (not the test suite): ${diff.ignored.join(', ')}`
    );
  }

  if (diff.stray.length > 0) {
    throw new Error(
      `tmpdir-leak-guard: ${diff.stray.length} temp entry/entries leaked into the REAL ` +
        `tmpdir (${realTmpdir}) during this test run (#1112): ${diff.stray.join(', ')} — the ` +
        `run-scoped TMPDIR redirect in src/conductor/test/global-setup.ts should have ` +
        `contained these; find the path that bypassed it (hardcoded '/tmp', an os.tmpdir() ` +
        `value read before setup, or a subprocess spawned without the inherited env) and ` +
        `fix it there rather than widening IGNORED_TMPDIR_PREFIXES`
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
  logger: (message: string) => void,
  runTmpRoot: string
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
    }
    try {
      // Same bypassed-teardown problem the reap above exists for: a Ctrl-C
      // would otherwise strand this run's whole temp root, and an operator who
      // interrupts often is exactly the operator whose tmpfs fills up. Sync
      // removal because the process exits on the next line.
      rmSync(runTmpRoot, { recursive: true, force: true });
    } catch {
      // Best-effort only — never let cleanup failure block shutdown.
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
  // Tmpdir leak guard (#1112), part 1 of 2 — the REDIRECT. It is installed one
  // stage earlier, in vitest.config.ts module scope (see `ensureRunTmpRootSync`
  // for why it cannot wait until here), so by now `TMPDIR` and `os.tmpdir()`
  // already point at this run's root. Recover the root from the env and derive
  // the operator's REAL tmpdir from it — every guard below is defined against
  // the real one, and the fallback keeps this file runnable as a globalSetup
  // even if the config-level install is ever missing.
  const runTmpRoot = process.env[RUN_TMP_ROOT_ENV] ?? (await createRunTmpRoot(tmpdir()));
  process.env[RUN_TMP_ROOT_ENV] = runTmpRoot;
  process.env.TMPDIR = runTmpRoot;
  const realTmpdir = dirname(runTmpRoot);

  // Engine-dist guard: 13 test files spawn the real `bin/conduct-ts`, which
  // exits 1 when `src/conductor/dist` is missing or dangling. `dist` is a
  // gitignored symlink absent from a fresh clone/worktree, and there is no
  // `pretest` hook, so it used to appear only partway through a run — failing
  // every real-binary test scheduled before that point. Satisfy the dependency
  // once, here, before the first test. No-op on a warm checkout.
  if (await ensureEngineDist(process.cwd())) {
    console.error(
      'engine-dist-guard: built the engine before the run — src/conductor/dist was ' +
        'missing or dangling, which would have failed every test that spawns bin/conduct-ts'
    );
  }

  const beforeState = await snapshotPipeline(process.cwd());
  const realParkedDir = await resolveRealParkedDir(process.cwd());
  const parkedMarkersBefore: ParkedMarkersSnapshot = realParkedDir
    ? await snapshotParkedMarkers(realParkedDir)
    : { exists: false, markers: {} };

  // Tmpdir leak guard (#1112), part 2 of 2 — the GUARD. Baseline the REAL
  // tmpdir's top-level entries here, before any test has run, so the teardown
  // diff sees only what appeared during the run and escaped the redirect.
  const tmpdirBefore = await snapshotTmpdirEntries(realTmpdir);

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
  //
  // Run this whole tmux window against the REAL tmpdir: the sweep and the reap
  // decide what to kill via `isTmpdirRooted`, i.e. `os.tmpdir()` at call time.
  // Under the redirect that would narrow to this run's root and blind the
  // sweep to debris left under a PREVIOUS run's root. Nothing in the window
  // writes temp files, so nothing escapes containment; teardown restores the
  // real tmpdir before the reap for exactly the same reason.
  process.env.TMPDIR = realTmpdir;
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

  // Close the real-tmpdir window opened for the tmux sweep: from here on —
  // crucially, before the pool forks its workers — TMPDIR points back at this
  // run's root, which is what contains every test's `mkdtemp`.
  process.env.TMPDIR = runTmpRoot;

  const removeInterruptHandlers = installInterruptReap(
    () => globalThis.__tmuxSnapshot ?? daemonSnapshot,
    console.error,
    runTmpRoot
  );

  // Return the async teardown function
  return async () => {
    removeInterruptHandlers();

    // Restore the real tmpdir FIRST so every guard below observes exactly the
    // `os.tmpdir()` it observed before this redirect existed — in particular
    // the tmux reap's `isTmpdirRooted` corroboration, which must still match a
    // pane cwd anywhere under the real tmpdir, not only under the run root.
    process.env.TMPDIR = realTmpdir;
    delete process.env[RUN_TMP_ROOT_ENV];

    try {
      await runTeardownGuards();
    } finally {
      // Reclaim the run root whatever the guards decided. In `finally` so a
      // guard failure still frees the disk, and self-contained try/catch so a
      // removal failure can never mask the guard error being propagated.
      try {
        await removeRunTmpRoot(runTmpRoot);
      } catch (err) {
        console.error(
          `tmpdir-leak-guard: could not remove the run temp root ${runTmpRoot} — remove it ` +
            `manually to reclaim the space: ${err}`
        );
      }
    }
  };

  async function runTeardownGuards(): Promise<void> {
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

    // Tmpdir leak guard (#1112): re-snapshot the REAL tmpdir and fail on any
    // entry that appeared outside the run root. Runs LAST so it can never
    // pre-empt an existing guard's verdict — a .pipeline, tmux, or signals
    // failure is the more specific diagnosis and still throws first.
    const tmpdirAfter = await snapshotTmpdirEntries(realTmpdir);
    applyTmpdirTeardownDecision(diffTmpdirEntries(tmpdirBefore, tmpdirAfter), realTmpdir);

    // Parked-marker leak guard (#1251): runs last, after every established
    // teardown guard. It observes the actual repository ledger, not any
    // test-process redirect, and never repairs a marker it detects.
    try {
      const parkedMarkersAfter: ParkedMarkersSnapshot = realParkedDir
        ? await snapshotParkedMarkers(realParkedDir)
        : { exists: false, markers: {} };
      applyParkTeardownDecision(diffParkedMarkers(parkedMarkersBefore, parkedMarkersAfter));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('park-leak-guard:')) {
        throw err;
      }
      console.error(
        `park-leak-guard: NOT enforced (fail-safe): unexpected error while checking the ` +
          `real parked marker ledger — investigate manually: ${err}`
      );
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __tmuxSnapshot: ReturnType<typeof snapshotDaemonSessions> | undefined;
}
