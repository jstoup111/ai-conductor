import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import type { Dirent } from 'fs';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { basename, join } from 'path';

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

/** Owner marker persisted inside each run root for cross-namespace liveness checks. */
export const RUN_TMP_ROOT_OWNER_MARKER = '.owner';

/** Frequency at which a live run refreshes its owner marker. */
export const RUN_TMP_ROOT_HEARTBEAT_MS = 60_000;

/** A marker older than this is stale, unless the caller overrides the policy. */
export const RUN_TMP_ROOT_STALE_AFTER_MS = 3 * 60 * 60 * 1_000;

/** Legacy roots without a marker get a longer retention window. */
export const RUN_TMP_ROOT_LEGACY_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

/** Identity recorded when a run root becomes live. */
export interface RunRootOwnerMarker {
  pid: number;
  hostname: string;
  startedAt: string;
}

/** A candidate run-root and its already-read owner marker state. */
export interface RunRootEntry {
  name: string;
  isDirectory: boolean;
  dirMtimeMs: number;
  marker:
    | { kind: 'present'; mtimeMs: number }
    | { kind: 'absent' }
    | { kind: 'unreadable'; error: unknown };
}

/** Pure stale-run-root sweep result, retaining any ambiguous candidate. */
export interface StaleRunRootDecision {
  reap: string[];
  retain: {
    name: string;
    reason: 'live' | 'own-root' | 'unmarked-recent' | 'marker-unreadable' | 'not-a-directory';
  }[];
}

/** Filesystem sweep result, including failures that were retained fail-open. */
export interface StaleRunTmpRootsResult {
  reaped: string[];
  retained: StaleRunRootDecision['retain'];
  failures: { name: string; error: unknown }[];
}

/**
 * Decide which enumerated run roots can safely be reaped.
 *
 * This deliberately consumes marker readings rather than reaching for the
 * filesystem itself: callers own the I/O boundary, while this policy remains
 * deterministic and conservative around incomplete observations.
 */
export function decideStaleRunRoots({
  entries,
  ownRoot,
  now,
  staleAfterMs,
  legacyStaleAfterMs,
}: {
  entries: RunRootEntry[];
  ownRoot: string;
  now: number;
  staleAfterMs: number;
  legacyStaleAfterMs: number;
}): StaleRunRootDecision {
  const reap: string[] = [];
  const retain: StaleRunRootDecision['retain'] = [];
  const ownRootName = basename(ownRoot);

  for (const entry of entries) {
    if (!entry.name.startsWith(RUN_TMP_ROOT_PREFIX)) continue;

    if (!entry.isDirectory) {
      retain.push({ name: entry.name, reason: 'not-a-directory' });
    } else if (entry.name === ownRootName) {
      retain.push({ name: entry.name, reason: 'own-root' });
    } else if (entry.marker.kind === 'unreadable') {
      retain.push({ name: entry.name, reason: 'marker-unreadable' });
    } else if (entry.marker.kind === 'present') {
      if (now - entry.marker.mtimeMs > staleAfterMs) {
        reap.push(entry.name);
      } else {
        retain.push({ name: entry.name, reason: 'live' });
      }
    } else if (now - entry.dirMtimeMs > legacyStaleAfterMs) {
      reap.push(entry.name);
    } else {
      retain.push({ name: entry.name, reason: 'unmarked-recent' });
    }
  }

  return { reap, retain };
}

type GuardLogger = (message: string) => void;

function logOwnerMarkerError(logger: GuardLogger, action: string, error: unknown): void {
  logger(
    `tmpdir-leak-guard: owner marker ${action} failed — ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

/**
 * Persist this run's owner identity inside its root.
 *
 * Marker failures are deliberately non-fatal: cleanup must remain possible
 * even when a filesystem edge condition prevents stale-root attribution.
 */
export function writeRunRootOwnerMarker(
  runRoot: string,
  owner: RunRootOwnerMarker,
  logger: GuardLogger = console.error
): void {
  try {
    writeFileSync(join(runRoot, RUN_TMP_ROOT_OWNER_MARKER), JSON.stringify(owner), 'utf8');
  } catch (error) {
    logOwnerMarkerError(logger, 'write', error);
  }
}

/** Start an unref'd liveness heartbeat for an existing run-root owner marker. */
export function startRunRootHeartbeat(
  runRoot: string,
  {
    intervalMs = RUN_TMP_ROOT_HEARTBEAT_MS,
    logger = console.error,
  }: { intervalMs?: number; logger?: GuardLogger } = {}
): { stop: () => void } {
  const markerPath = join(runRoot, RUN_TMP_ROOT_OWNER_MARKER);
  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(markerPath, now, now);
    } catch (error) {
      logOwnerMarkerError(logger, 'heartbeat refresh', error);
    }
  }, intervalMs);
  heartbeat.unref(); // portability-ok: heartbeat must not keep an interrupted test run alive

  return { stop: () => clearInterval(heartbeat) };
}

/** Make nested directories removable without following symlinks. */
function makeDirectoriesWritableSync(path: string): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isDirectory()) return;

  for (const entry of readdirSync(path)) {
    makeDirectoriesWritableSync(join(path, entry));
  }
  chmodSync(path, 0o700);
}

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
  'moshi-codex-rl.json', // active Codex rate-limit state
  'cc-daemon-', // daemon tmux session scratch
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
 * The package scripts install the run root before importing Vitest because
 * Vitest 4 allocates its root instance tmpDir before loading this config.
 * This config-level call remains the idempotent fallback for callers that
 * construct a Vitest project after importing its API (including nested smoke
 * discovery). Waiting until `globalSetup` is always too late: project tmpDir
 * fields have already been initialized by then.
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
  makeDirectoriesWritableSync(runRoot);
  await rm(runRoot, { recursive: true, force: true });
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function logSweepFailure(logger: GuardLogger, name: string, error: unknown): void {
  try {
    logger(
      `tmpdir-leak-guard: stale run root sweep failed for ${name} — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } catch {
    // A best-effort diagnostic must not turn a fail-open sweep into a setup failure.
  }
}

function logUnreadableOwnerMarker(logger: GuardLogger, name: string, error: unknown): void {
  try {
    logger(
      `tmpdir-leak-guard: owner marker unreadable for ${name}; retaining run root — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } catch {
    // A best-effort diagnostic must not turn a fail-open sweep into a setup failure.
  }
}

/**
 * Reap stale run roots from the real tmpdir while retaining any ambiguous entry.
 *
 * The root itself is always inspected with `lstatSync`, so a prefixed symlink
 * is never followed or presented to the recursive remover as a directory.
 */
export async function sweepStaleRunTmpRoots(
  realTmpdir: string,
  {
    ownRoot,
    now,
    staleAfterMs,
    legacyStaleAfterMs,
    remove = removeRunTmpRoot,
    logger = console.error,
  }: {
    ownRoot: string;
    now: number;
    staleAfterMs: number;
    legacyStaleAfterMs: number;
    remove?: (runRoot: string) => Promise<void>;
    logger?: GuardLogger;
  }
): Promise<StaleRunTmpRootsResult> {
  const failures: StaleRunTmpRootsResult['failures'] = [];
  let dirents: Dirent[];

  try {
    dirents = await readdir(realTmpdir, { withFileTypes: true });
  } catch (error) {
    failures.push({ name: realTmpdir, error });
    logSweepFailure(logger, realTmpdir, error);
    return { reaped: [], retained: [], failures };
  }

  const entries: RunRootEntry[] = [];
  for (const dirent of dirents.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!dirent.name.startsWith(RUN_TMP_ROOT_PREFIX)) continue;

    const rootPath = join(realTmpdir, dirent.name);
    let rootStat: ReturnType<typeof lstatSync>;
    try {
      rootStat = lstatSync(rootPath);
    } catch (error) {
      failures.push({ name: dirent.name, error });
      logSweepFailure(logger, rootPath, error);
      entries.push({
        name: dirent.name,
        isDirectory: false,
        dirMtimeMs: 0,
        marker: { kind: 'unreadable', error },
      });
      continue;
    }

    let marker: RunRootEntry['marker'];
    try {
      const markerPath = join(rootPath, RUN_TMP_ROOT_OWNER_MARKER);
      const markerStat = statSync(markerPath);
      JSON.parse(readFileSync(markerPath, 'utf8'));
      marker = { kind: 'present', mtimeMs: markerStat.mtimeMs };
    } catch (error) {
      if (isMissing(error)) {
        marker = { kind: 'absent' };
      } else {
        marker = { kind: 'unreadable', error };
        logUnreadableOwnerMarker(logger, rootPath, error);
      }
    }

    entries.push({
      name: dirent.name,
      isDirectory: rootStat.isDirectory(),
      dirMtimeMs: rootStat.mtimeMs,
      marker,
    });
  }

  const decision = decideStaleRunRoots({
    entries,
    ownRoot,
    now,
    staleAfterMs,
    legacyStaleAfterMs,
  });
  const reaped: string[] = [];

  for (const name of decision.reap) {
    try {
      await remove(join(realTmpdir, name));
      reaped.push(name);
    } catch (error) {
      failures.push({ name, error });
      logSweepFailure(logger, join(realTmpdir, name), error);
    }
  }

  return { reaped, retained: decision.retain, failures };
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
