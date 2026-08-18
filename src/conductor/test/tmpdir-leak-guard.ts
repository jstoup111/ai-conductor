import { mkdtempSync, realpathSync } from 'fs';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { join } from 'path';

/**
 * Temp-directory leak containment for the vitest suite (two mechanisms).
 *
 * THE BUG: 1,426 `mkdtemp(join(tmpdir(), '<prefix>-'))` calls across ~398 test
 * files, and only a fraction ever remove what they created. Each full run left
 * thousands of directories behind in the operator's real `/tmp`. On a tmpfs
 * `/tmp` that eventually exhausted inodes and space, which broke unrelated
 * production processes with `ENOSPC` — the leak escaped the test suite.
 *
 * MECHANISM 1 — redirect (`createRunTmpRoot` + `TMPDIR`): one run-scoped root
 * is created inside the REAL tmpdir and `process.env.TMPDIR` is pointed at it.
 * Node's `os.tmpdir()` reads `TMPDIR` on every call, so every existing and
 * every future `mkdtemp(join(tmpdir(), ...))` lands inside the run root with
 * zero test-file edits. Teardown removes the root wholesale, so a test that
 * forgets to clean up costs one run's disk, not the machine's.
 *
 * MECHANISM 2 — guard (`snapshotTmpdirEntries` + `diffTmpdirEntries`): the
 * redirect only contains calls that go through `os.tmpdir()`. A test that
 * hardcodes `/tmp`, caches `os.tmpdir()` before the redirect, or spawns a
 * process with a scrubbed env still escapes. So snapshot the REAL tmpdir's
 * top-level entries at setup, diff at teardown, and FAIL the run on any new
 * entry that is not the run root and not known concurrent-tooling noise. This
 * is the same snapshot/diff/fail shape already used by the `.pipeline`,
 * tmux, and engineer-signals guards.
 */

/** Name prefix of the per-run temp root created by `createRunTmpRoot`. */
export const RUN_TMP_ROOT_PREFIX = 'ai-conductor-vitest-run-';

/**
 * Env var carrying the run root's absolute path into the forked test workers.
 *
 * `TMPDIR` alone would be enough for the redirect, but a test cannot assert
 * "the redirect reached this worker" against `TMPDIR` without restating the
 * value it is trying to verify. Publishing the root under its own name lets a
 * worker-side test prove propagation by comparing `os.tmpdir()` to it.
 */
export const RUN_TMP_ROOT_ENV = 'AI_CONDUCTOR_TEST_TMP_ROOT';

/**
 * Top-level real-tmpdir entry prefixes that are NOT test leaks.
 *
 * The real tmpdir is shared with whatever else the operator is running while
 * the suite runs — the ai-conductor daemon (`self-host-*` provider homes),
 * Claude Code sessions (`claude-*` scratchpads), editors, browsers, systemd.
 * Those appear mid-run through no fault of the suite, and failing on them
 * would make the guard flaky and get it deleted. Everything NOT matched here
 * is treated as a leak.
 *
 * Widening this list is the intended fix for a false positive from a new
 * concurrent tool — never widening it to cover a test that actually leaks.
 */
export const IGNORED_TMPDIR_PREFIXES: readonly string[] = [
  RUN_TMP_ROOT_PREFIX,
  '.', // dotfiles/dotdirs: .X11-unix, .ICE-unix, .font-unix, …
  'self-host-', // live provider homes owned by the running daemon
  'claude-', // active Claude Code session scratchpads
  'cc-daemon-', // daemon tmux session scratch
  'moshi-codex-rl.json.tmp', // Codex runtime rate-limit scratch file
  'systemd-', // systemd-private-*, systemd-*.service-*
  'snap.',
  'dbus-',
  'pulse-',
  'tmux-',
  'nvim.',
  'v8-compile-cache-',
  'puppeteer_dev_chrome_profile',
];

/** Snapshot of a directory's top-level entry names at a moment in time. */
export interface TmpdirSnapshot {
  exists: boolean;
  entries: string[];
}

/** Entries that appeared in the real tmpdir during the run, split by verdict. */
export interface TmpdirDiff {
  /** New entries attributed to the suite — these FAIL the run. */
  stray: string[];
  /** New entries matched by `IGNORED_TMPDIR_PREFIXES` — reported, never fatal. */
  ignored: string[];
}

/**
 * Create the run-scoped temp root inside `realTmpdir`.
 *
 * Deliberately takes the real tmpdir as an argument rather than calling
 * `os.tmpdir()` internally: the caller mutates `TMPDIR` immediately after, and
 * a self-reading helper would create the next run's root inside the previous
 * one if it were ever called twice.
 *
 * @param realTmpdir The operator's actual tmpdir, before any redirect
 * @returns Absolute path of the created run root
 */
export async function createRunTmpRoot(realTmpdir: string): Promise<string> {
  return mkdtemp(join(realTmpdir, RUN_TMP_ROOT_PREFIX));
}

/**
 * Idempotently install the run root and the `TMPDIR` redirect into `env`.
 *
 * Called from `vitest.config.ts` module scope rather than from `globalSetup`,
 * one stage earlier than it looks like it needs to be. vitest's own
 * `WorkspaceProject.tmpDir` is a class field — `join(tmpdir(), nanoid())` —
 * evaluated when the project is constructed, which happens AFTER the config
 * module is evaluated but BEFORE `globalSetup` runs. Redirecting only in
 * `globalSetup` therefore leaves vitest's own SSR transform cache (a
 * random-named, un-prefix-matchable directory) in the operator's real tmpdir
 * every single run — observed failing the guard, which is how this ordering
 * was found. Redirecting here contains it.
 *
 * Idempotent because a watch-mode config reload re-evaluates this module; a
 * second root per reload would be a new leak of exactly the kind being fixed.
 *
 * Sync because a config module body cannot await.
 *
 * @param realTmpdir The operator's actual tmpdir
 * @param env Environment object to mutate (defaults to the real process env)
 * @returns The run root path, newly created or already installed
 */
export function ensureRunTmpRootSync(
  realTmpdir: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const existing = env[RUN_TMP_ROOT_ENV];
  const createdRunRoot = existing ?? mkdtempSync(join(realTmpdir, RUN_TMP_ROOT_PREFIX));
  let runRoot: string;

  try {
    // A symlinked real tmpdir makes mkdtemp return a non-canonical path. Git
    // compares ceiling paths against its canonical traversal path, so install
    // the resolved root rather than relying on equivalent-looking strings.
    runRoot = realpathSync(createdRunRoot);
  } catch (error) {
    throw new Error(
      `tmpdir-leak-guard: unable to resolve realpath for run root ${createdRunRoot}`,
      { cause: error }
    );
  }

  env[RUN_TMP_ROOT_ENV] = runRoot;
  env.TMPDIR = runRoot;

  const ceilings = env.GIT_CEILING_DIRECTORIES;
  if (!ceilings) {
    env.GIT_CEILING_DIRECTORIES = runRoot;
  } else if (!ceilings.split(':').includes(runRoot)) {
    // Config modules are re-evaluated in watch mode, while forked workers
    // inherit this environment. Preserve any caller-installed ceilings and
    // append ours exactly once so either path gets the same Git boundary.
    env.GIT_CEILING_DIRECTORIES = `${ceilings}:${runRoot}`;
  }

  return runRoot;
}

/**
 * Remove the run root and everything the suite leaked into it.
 *
 * `force: true` so a run root already gone (interrupted run, operator cleanup)
 * is not an error; the caller treats any remaining failure as non-fatal, since
 * failing to reclaim disk must not mask a real test failure.
 *
 * @param runRoot Absolute path returned by `createRunTmpRoot`
 */
export async function removeRunTmpRoot(runRoot: string): Promise<void> {
  await rm(runRoot, { recursive: true, force: true });
}

/**
 * Snapshot the top-level entry names of a directory.
 *
 * Top level only, deliberately: the point is to catch a fixture directory
 * created directly in the real tmpdir, and a recursive walk of a 15G tmpfs at
 * setup and again at teardown would cost more than the guard is worth.
 * Unreadable/missing directory → `{ exists: false, entries: [] }`, matching
 * `snapshotPipeline`'s resilient convention, so a transient read failure
 * degrades to "no leaks observed" rather than throwing inside setup.
 *
 * @param dir Directory to snapshot (the REAL tmpdir)
 * @returns Snapshot of its top-level entry names
 */
export async function snapshotTmpdirEntries(dir: string): Promise<TmpdirSnapshot> {
  try {
    const entries = await readdir(dir);
    return { exists: true, entries };
  } catch {
    return { exists: false, entries: [] };
  }
}

/**
 * Compare two real-tmpdir snapshots and classify what appeared during the run.
 *
 * An entry is new if it is in `after` but not in `before`. New entries are
 * `ignored` when they match a prefix in `ignoredPrefixes` (the run root itself
 * and concurrent operator tooling), otherwise `stray` — a temp directory the
 * suite created outside the run root, i.e. a leak the `TMPDIR` redirect did
 * not contain.
 *
 * Entries that DISAPPEARED are not reported: another process cleaning up its
 * own temp state is none of the suite's business.
 *
 * Pure and exported for direct unit testing, separate from the fs/vitest
 * wiring — same split as `diffPipeline` and `diffEngineerSignals`.
 *
 * @param before Snapshot taken during global setup
 * @param after Snapshot taken during global teardown
 * @param ignoredPrefixes Prefixes exempt from the leak verdict
 * @returns The stray/ignored classification of newly appeared entries
 */
export function diffTmpdirEntries(
  before: TmpdirSnapshot,
  after: TmpdirSnapshot,
  ignoredPrefixes: readonly string[] = IGNORED_TMPDIR_PREFIXES
): TmpdirDiff {
  // A failed BEFORE snapshot has no baseline, so every entry would read as
  // new. Fail open (report nothing) rather than fail the run on a phantom
  // 80,000-entry diff — the same fail-safe stance the tmux guard takes when
  // its baseline snapshot fails.
  if (!before.exists || !after.exists) {
    return { stray: [], ignored: [] };
  }

  const baseline = new Set(before.entries);
  const stray: string[] = [];
  const ignored: string[] = [];

  for (const entry of after.entries) {
    if (baseline.has(entry)) continue;
    if (ignoredPrefixes.some(prefix => entry.startsWith(prefix))) {
      ignored.push(entry);
    } else {
      stray.push(entry);
    }
  }

  return { stray, ignored };
}
