import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { join, dirname, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, rm, readFile, writeFile, readlink } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { formatRetryReason, formatProgressDelta, displayBuildPosition } from './engine/format-retry-line.js';
import { closeIssueOnImplementationMerge } from './engine/engineer/issue-ref.js';
import { isEligibleForResolve, resolveConflictingPr } from './engine/autoresolve.js';
import {
  isEligibleForCiFix,
  runCiFix,
  buildCiFixHint,
  productionCiFixRunner,
  classifyFixError,
  preflightCiFixInvocation,
  defaultCiFixProbe,
} from './engine/ci-fix.js';
import { resolveRebaseResolutionAttempts, resolveSelfHostConfig } from './engine/resolved-config.js';
import { readDaemonBuildToken } from './engine/self-host/daemon-build-token.js';
import { buildAuthRemediationMessage } from './engine/self-host/build-auth-message.js';
import type { LLMProvider } from './execution/llm-provider.js';
import { PluginRegistry } from './engine/plugin-registry.js';
import { registerBuiltins } from './engine/plugin-loader.js';
import { ConductorEventEmitter } from './ui/events.js';
import { DefaultStepRunner } from './engine/step-runners.js';
import { ensureInstallFresh, relinkSkillsForSelfBuild } from './engine/install-freshness.js';
import { Conductor } from './engine/conductor.js';
import { AuditTrailWriter } from './engine/audit-trail.js';
import { classifySelfHost, defaultSelfHostDetector } from './engine/self-host/detector.js';
import { loadConfig, resolveMemoryProvider, BUILD_PROGRESS_HALT_DEFAULTS } from './engine/config.js';
import type { HarnessConfig } from './types/config.js';
import { readLastResolvedCount } from './engine/task-evidence.js';
import { countResolvedTasks } from './engine/task-progress.js';
import { holdLock, readPidRecord, ownsLock, selfGuardEnv } from './engine/daemon-lock.js';
import {
  openDaemonLog,
  formatDaemonLogLine,
  type DaemonLogSink,
} from './engine/daemon-log.js';
import type { ConductState, ConductorEvent, StepName } from './types/index.js';
import { runDaemon, type BacklogItem } from './engine/daemon.js';
import { createDaemonTeardown } from './engine/daemon-teardown.js';
import { discoverBacklog, fastForwardRoot, gitTreeSource, type DiscoveryLogger } from './engine/daemon-backlog.js';
import { createRefreshThrottle, createStalenessWarner } from './engine/engine-refresh.js';
import { makeIsProcessed } from './engine/shipped-record.js';
import { localWorkSource, type WorkSource } from './engine/daemon-work-source.js';
import { type GhRunner } from './engine/owner-gate/identity.js';
import { makeProductionGh } from './engine/tracker-client.js';
import { makeMachineOwnerResolver } from './engine/owner-gate/machine-identity.js';
import { readSpecOwnerStamp } from './engine/owner-gate/provenance.js';
import { firstAppearanceTime } from './engine/owner-gate/merge-time.js';
import { clampDaemonConcurrency } from './engine/daemon-command.js';
import { makeRunFeature, type FeatureWorktree } from './engine/daemon-runner.js';
import { createBlockerResolver } from './engine/blocker-resolver.js';
import { createGhBlockerRunner } from './engine/gh-blocker-runner.js';
import { resolveSpecPrUrl } from './engine/pr-labels.js';
import { captureEngineIdentity, createStaleEngineChecker } from './engine/engine-identity.js';
import { initStaleEngineState } from './engine/stale-engine-init.js';
import {
  readRestartMarkerWithStatus,
  clearRestartMarker,
  isSuppressed,
  recordSuppression,
  writeRestartMarker,
} from './engine/restart-intent.js';
import {
  isHalted,
  isProcessed,
  hasWarned,
  markWarned,
  repairProcessed,
  makeFeatureRunnerDeps,
  makeWatchHaltClearedSeam,
} from './engine/daemon-deps.js';
import { isOperatorParked, reconcileStrandedParkMarkers } from './engine/park-marker.js';
import { listOperatorParkedSlugs, getProvenanceType } from './engine/park-marker.js';
import { readState, writeState, getStepStatus } from './engine/state.js';
import { makeGitRunner, originDefaultBranch, type RebaseResolver } from './engine/rebase.js';
import { prepareWorktree } from './engine/worktree-prepare.js';
import { runTriage, fixSession, type GitRunner } from './engine/setup-triage.js';
import {
  readBaseSha,
  readPersistedBaseSha,
  writePersistedBaseSha,
} from './engine/daemon-sha.js';
import { scanInheritedState, renderDashboard, type ParkedEntry } from './engine/daemon-dashboard.js';
import { writeGatedSnapshot } from './engine/gated-snapshot.js';
import { announceGatedPr, announceGatedIssue } from './engine/gate-writeback.js';
import {
  rekickSweep,
  resumeRebaseFirst,
  listHaltedWorktrees,
  readHaltReason,
  hasRebaseInProgress,
  abortRebase,
  clearMarker,
  type RekickSweepDeps,
} from './engine/daemon-rekick.js';
import { sweepMergeableLabels } from './engine/mergeable-sweep.js';
import { reconcileHaltPrs, type PrSweepOutcome } from './engine/halt-pr-reconciliation.js';
import { createPriorityResolver, ghIssueLabelReader } from './engine/backlog-priority.js';
import { isPaused } from './engine/pause-marker.js';
import { readRestartPending, consumeOnBoot, type RestartIntent } from './engine/restart-marker.js';
import { create as createRateLimitEpisode } from './engine/rate-limit-episode.js';
import { createEpisodeHaltTracker } from './engine/episode-halt-tracker.js';

const execFile = promisify(execFileCb);

/**
 * Task 17: Create a transition-aware discovery logger that tracks fetch state
 * and logs only on state transitions (idle→failed, failed→succeeded).
 * Logs once on first failure (onset) and once on recovery, suppressing
 * consecutive retries to avoid spam in the persistent daemon log.
 */
export function createDiscoveryLogger(log: (msg: string) => void): DiscoveryLogger {
  let lastState: 'idle' | 'failed' | 'succeeded' = 'idle';

  return {
    onFetchFailed(err: Error) {
      if (lastState !== 'failed') {
        log(`[fetch] FAILED: ${err.message}`);
        lastState = 'failed';
      }
    },
    onFetchSucceeded() {
      if (lastState === 'failed') {
        log(`[fetch] recovered`);
        lastState = 'succeeded';
      }
    },
  };
}

/**
 * Rebuild the engine from source into the versioned store (self-host only),
 * so the stale-engine checker can observe merge-driven drift that the untracked
 * `dist` artifact (#309) would otherwise hide. Runs the package's own
 * `npm run build` — a content-addressed `publish` that no-ops when unchanged
 * and atomically flips `dist` when it changes — in a subprocess, so the running
 * daemon (executing from its pinned `dist-versions/<id>`) is never disturbed.
 * Throws on a non-zero build so the caller (daemon loop) logs it and degrades
 * to the current engine; it never restarts on a failed rebuild.
 */
async function rebuildEngineFromSource(conductorRoot: string): Promise<void> {
  const { stderr } = await execFile('npm', ['run', 'build'], {
    cwd: conductorRoot,
    maxBuffer: 32 * 1024 * 1024,
  }).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`engine rebuild (\`npm run build\`) failed: ${detail}`);
  });
  void stderr;
}

/**
 * Absolute path to the running engine's entry file for a harness checkout:
 * `<projectRoot>/src/conductor/dist/index.js` — the `<conductorRoot>/dist`
 * symlink target that `publish`/`flipCurrent` maintain (`engine-store.ts`).
 * The stale-engine checker hashes THIS file to detect drift, so it must be the
 * real engine artifact. The prior wiring hashed the repo root's `dist/index.js`
 * (`join(projectRoot, 'dist', ...)`), which never exists — capture always
 * failed and silently disabled the checker, so no daemon ever auto-restarted.
 */
export function engineEntryPathForRepo(projectRoot: string): string {
  return join(projectRoot, 'src', 'conductor', 'dist', 'index.js');
}

/** Sidecar filename stamped by `publish-engine.mjs` at finalize (Task 4). */
const ENGINE_SOURCE_SHA_SIDECAR = '.engine-source-sha';

/**
 * Read the source-commit SHA stamped into the pinned `dist-versions/<id>`
 * directory this daemon is booting out of (`.engine-source-sha`, written by
 * `publish-engine.mjs` at finalize — Task 4). Resolves `dist` (a symlink to
 * `dist-versions/<id>`) relative to the given engine entry path
 * (`<conductorRoot>/dist/index.js`).
 *
 * Never throws: returns `'unknown'` whenever `dist` isn't a symlink (e.g. a
 * plain directory in tests, or a corrupt layout) or the sidecar is absent
 * (pre-feature published versions never wrote it) — the boot log must never
 * crash over a missing/optional stamp.
 */
export async function readEngineSourceSha(engineEntryPath: string): Promise<string> {
  const distDir = dirname(engineEntryPath);
  try {
    const target = await readlink(distDir);
    const versionDir = isAbsolute(target) ? target : join(dirname(distDir), target);
    const sha = await readFile(join(versionDir, ENGINE_SOURCE_SHA_SIDECAR), 'utf-8');
    return sha.trim();
  } catch {
    return 'unknown';
  }
}

/**
 * RestartRequester is the injected dependency for restart sequence execution.
 * Called when a stale engine is detected in the idle branch (Task 14+).
 * Implements: write marker → release lock → exit(0).
 * On error, the catch block ensures lock release + exit(1).
 * Task 5: Returns { fired: boolean } to indicate if restart was fired (true) or aborted (false).
 */
export type RestartRequester = (opts: {
  fromIdentity: string | null;
  targetIdentity: string | null;
}) => Promise<{ fired: boolean }>;

export interface DaemonModeOptions {
  projectRoot: string;
  /** Parallel workers (>= 1). */
  concurrency: number;
  /** Stop after this many features (default: drain the backlog once). */
  maxItems?: number;
  /** Branch the worktrees fork from. */
  baseBranch?: string;
  /** Continuous: idle-poll for new features instead of draining once. */
  continuous?: boolean;
  /** Global output-token ceiling across all features. */
  maxCostTokens?: number;
  /** Wall-clock ceiling in seconds. */
  maxRuntimeSeconds?: number;
  /** Idle poll interval in seconds (continuous mode). */
  idlePollSeconds?: number;
  /** Stop after this many consecutive empty polls (continuous mode). */
  maxIdlePolls?: number;
  /**
   * Override the backlog discovery source (tests / alternative adapters).
   * Defaults to the local git-backed adapter that reproduces the former
   * discoverTick closure.
   */
  workSource?: WorkSource;
  /**
   * Install-freshness backstop (tests inject a spy). Defaults to a
   * NON-interactive ensureInstallFresh: every daemon launch path (daemon start,
   * engineer handoff auto-launch, manual `daemon --continuous`) funnels through
   * runDaemonMode, so a stale install crashes here with an actionable message
   * rather than silently HALTing features on unregistered skills. The
   * interactive prompt lives at `daemon start` (dispatchDaemonSupervisor).
   */
  ensureFresh?: () => Promise<void>;
  /**
   * Task T28: callback to fire when a restart marker is queued and the daemon
   * reaches idle boundary. Injected from supervisor-cli or bare-run handler.
   * Must handle async failures gracefully: a throw is logged and retried at
   * the next idle boundary. Absent → no self-restart (default, for tests).
   */
  triggerSelfRestart?: () => Promise<void>;
  /**
   * Task 14: Enable event-driven HALT marker watching (default: true).
   * When true, the daemon watches for HALT marker removal and re-kicks halted
   * features immediately without waiting for the next idle poll. When false,
   * the daemon relies on polling alone.
   */
  watch?: boolean;
  /**
   * Task 14: Injectable exit seam for lock-loser explicit exit (default: process.exit).
   * Called with exit code when another daemon holds the lock.
   * Tests inject a fake to verify the exit call is made.
   */
  exitProcess?: (code: number) => void;
  /**
   * Task 3: Show completed (PROCESSED) features in the startup dashboard's
   * console output. Defaults to false/undefined — the persisted log sink
   * NEVER includes PROCESSED regardless of this flag.
   */
  showCompleted?: boolean;
}

// Front-half steps the daemon treats as already done — the human authored the
// specs, so the loop starts at BUILD (acceptance_specs onward).
const PRESEEDED_DONE: StepName[] = [
  'worktree',
  'memory',
  'explore',
  'prd',
  'complexity',
  'stories',
  'conflict_check',
  'plan',
  'architecture_diagram',
  'architecture_review',
];

// Strip ANSI SGR color codes (chalk, #88) so the persistent daemon.log is always
// plain text. When the daemon runs non-interactively (no attached TTY) chalk is already disabled, so
// this is a no-op there; it only matters for a foreground/TTY `conduct daemon` run.
// eslint-disable-next-line no-control-regex -- ESC (\x1b) is intrinsic to ANSI SGR
const ANSI_SGR = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR, '');
}

/**
 * Task 4: RestartRequester accepts injected relink + trigger; session-hosted happy ordering
 * Task 5: Handle relink failure with abort-alive semantics in session-hosted mode
 *
 * ADR-2026-07-07-single-generation-stale-respawn Decision item 1:
 * Predecessor must terminate unconditionally on FIRED trigger.
 *
 * Create a RestartRequester that implements two flows:
 *
 * Session-hosted mode (triggerSelfRestart provided):
 *   1. Call relink (if provided)
 *   2. Write restart marker
 *   3. Call triggerSelfRestart
 *   4. On success (fired): Release lock and exit(0) — predecessor terminates unconditionally
 *   5. On error: Stay alive, don't release lock, don't exit (abort-alive)
 *
 * Headless mode (triggerSelfRestart not provided):
 *   1. Call relink (if provided)
 *   2. Write restart marker
 *   3. Release lock
 *   4. Exit with code 0
 *
 * Error handling:
 * - If relink throws in session-hosted mode: log error, return alive (abort-alive)
 * - If relink throws in headless mode: log error, release lock, exit(1)
 * - If marker write throws in headless mode: release lock, exit(1)
 * - If marker write throws in session-hosted mode: log error, return alive
 *
 * @param daemonDir - project root directory
 * @param log - logging function
 * @param lock - lock object with releaseSync method
 * @param process - Node process object (injected for testability)
 * @param deps - optional dependencies: { relink, triggerSelfRestart }
 * @returns RestartRequester function
 */
export function createRestartRequester(
  daemonDir: string,
  log: (msg: string) => void,
  lock: { releaseSync(): void },
  process: NodeJS.Process,
  deps?: {
    relink?: () => Promise<void>;
    triggerSelfRestart?: () => Promise<void>;
  },
): RestartRequester {
  return async (opts: { fromIdentity: string | null; targetIdentity: string | null }) => {
    const triggerSelfRestart = deps?.triggerSelfRestart;
    const isSessionHosted = triggerSelfRestart !== undefined;

    // Step 1: Call relink if provided (Task 5: separate error handling for relink)
    if (deps?.relink) {
      try {
        await deps.relink();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log(`relink failed: ${detail}`);
        // Task 5: abort-alive in session-hosted mode
        if (isSessionHosted) {
          // Don't release lock, don't exit, just return and stay alive
          return { fired: false };
        }
        // In headless mode: release lock and exit(1)
        lock.releaseSync();
        process.exit(1);
        return { fired: false }; // Never reached but clarifies intent
      }
    }

    try {
      // Step 2: Write marker (can fail)
      await writeRestartMarker(
        {
          reason: 'stale-engine',
          fromIdentity: opts.fromIdentity,
          targetIdentity: opts.targetIdentity,
          at: Date.now(),
        },
        daemonDir,
        log,
      );
    } catch (err) {
      // Backstop: ensure lock is released even if marker write fails
      // Only applies to headless mode (session-hosted should not reach here)
      const detail = err instanceof Error ? err.message : String(err);
      log(`marker write failed: ${detail}`);
      if (!isSessionHosted) {
        lock.releaseSync();
        process.exit(1);
      }
      return { fired: false }; // Never reached in production, but clarifies intent
    }

    // Step 3: Handle session-hosted vs headless paths
    // (moved outside try-catch so exit(0) is not caught on failure in tests)
    if (isSessionHosted && triggerSelfRestart) {
      // Session-hosted: call triggerSelfRestart and release lock + exit on success
      // Task 7: catch errors from trigger and stay alive (marker already written)
      try {
        await triggerSelfRestart();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log(`triggerSelfRestart failed: ${detail}`);
        // Stay alive: don't release lock, don't exit
        // Marker is already written, so this can be retried at next idle boundary
        return { fired: false };
      }
      // Trigger succeeded: release lock and exit (ADR Decision item 1)
      lock.releaseSync();
      process.exit(0);
      return { fired: true };
    } else {
      // Headless: release lock and exit(0)
      lock.releaseSync();
      process.exit(0);
      return { fired: true };
    }
  };
}

/**
 * T14 (daemon-halts-a-build-that-is-making-forward-progre): construct the
 * REAL `DaemonDeps.isProgressReKickEligible` predicate and
 * `progressReKickDispatchCeiling` from `config.build_progress_halt` — the
 * production wiring that was missing despite T8/T9/T10's full unit coverage
 * at the daemon.ts/pickEligible level (with hand-injected stub predicates)
 * and `readLastResolvedCount`'s existence in task-evidence.ts. Without this,
 * a parked-but-progressing build in the real daemon stayed parked exactly as
 * it did before the feature shipped.
 *
 * Gated on `build_progress_halt.enabled`: when disabled (or config/the block
 * is absent), `isProgressReKickEligible` is OMITTED entirely (not merely a
 * function that always returns false) so pickEligible's optional-chaining
 * guard (`ctx.isProgressReKickEligible && ...`) never even consults it —
 * true end-to-end inertness, matching the pre-feature behavior byte for
 * byte. `progressReKickDispatchCeiling` is always threaded (mirrors
 * `BUILD_PROGRESS_HALT_DEFAULTS.dispatch_ceiling` when the block/field is
 * absent), since daemon.ts already defaults it — this just avoids a second,
 * possibly-drifting default living in two places.
 *
 * Eligibility per slug: the live resolved-task count in that slug's worktree
 * (`countResolvedTasks`, reads the pipeline task-status sidecar) strictly
 * exceeds the count its last build-step dispatch stamped to the
 * `TaskEvidence` sidecar (`readLastResolvedCount`, reads
 * `.pipeline/task-evidence.json`) —
 * i.e. forward progress happened since the dispatch that halted/parked it.
 * Both readers are tolerant of a missing/corrupt file (read as 0), so an
 * absent worktree degrades to "no progress" rather than throwing.
 */
export function buildProgressReKickDeps(
  config: HarnessConfig | undefined,
  worktreeBase: string,
): {
  isProgressReKickEligible?: (slug: string) => Promise<boolean>;
  progressReKickDispatchCeiling: number;
} {
  const block = config?.build_progress_halt;
  const progressReKickDispatchCeiling =
    block?.dispatch_ceiling ?? BUILD_PROGRESS_HALT_DEFAULTS.dispatch_ceiling;

  if (!block?.enabled) {
    return { progressReKickDispatchCeiling };
  }

  return {
    progressReKickDispatchCeiling,
    isProgressReKickEligible: async (slug: string) => {
      const slugRoot = join(worktreeBase, slug);
      const [lastResolvedCount, liveResolvedCount] = await Promise.all([
        readLastResolvedCount(slugRoot),
        countResolvedTasks(slugRoot),
      ]);
      return liveResolvedCount > lastResolvedCount;
    },
  };
}

/**
 * Daemon entry (Phase 6). Drains the backlog of features with existing
 * stories+plan, running each in its own worktree via the gate loop
 * (verifyArtifacts + the engine's unconditional fresh-session-per-step),
 * opening a PR on finish, and tearing
 * the worktree down on success. Unattended; ceilings + supervision live in
 * runDaemon / makeRunFeature.
 */
export async function runDaemonMode(opts: DaemonModeOptions): Promise<void> {
  const { projectRoot, showCompleted } = opts;
  // Backstop for every daemon launch path: refuse to run on a stale harness
  // install (missing/stale skill symlinks) — non-interactively, so it throws an
  // actionable error rather than silently dispatching unregistered skills (which
  // surfaces as a cryptic "no parseable result" HALT). The interactive prompt to
  // self-heal lives at `daemon start`.
  const ensureFresh = opts.ensureFresh ?? (() => ensureInstallFresh({ interactive: false }));
  // The local branch worktrees fork from and discovery reads. Resolve origin's
  // real default (main/master/trunk) rather than hardcoding 'main'; the daemon
  // fast-forwards this branch on each idle poll (see fastForwardRoot).
  const baseBranch =
    opts.baseBranch ?? (await originDefaultBranch(makeGitRunner(projectRoot))) ?? 'main';
  // Tee every daemon log line to a file so the daemon stays observable via
  // `conduct daemon logs` even when no one is attached to its tmux session. Console
  // (the session PTY) gets the colorized line
  // (#88); the file gets ANSI-stripped plain text so the persistent log never
  // carries escape codes — `daemon logs`/grep stay clean regardless of whether the
  // run had color on. The sink is opened once we own the repo (below); until then
  // `log` goes to the console only.
  let logSink: DaemonLogSink | null = null;

  // ci-fix startup preflight (CF-5/CF-6) result is disabled below, right
  // after `log` is defined.
  let ciFixEnabled = true;

  // Task 16: Transition-only per-slug status logging + resume line
  // Track the last status for each slug so we only emit log lines when status changes
  const lastStatus = new Map<string, string>();

  // Task 4 (#521): own the halt-PR reconciliation outcome cache for the lifetime
  // of this daemon run. Constructed once, outside the sweep loop, and reused on
  // every startup + idle-poll sweep so steady-state (unchanged) PRs stay silent
  // instead of re-logging every tick. A fresh daemon run always starts with a
  // fresh (empty) cache — in-memory only, never persisted across process restarts.
  const haltPrSweepCache = new Map<string, PrSweepOutcome>();

  const log = (msg: string) => {
    // Task 16: Parse per-feature log lines and suppress unchanged status
    // Pattern 1: "▶ start <slug>" → { slug, status: 'start' }
    const startMatch = msg.match(/▶.*start\s+(\S+)/);
    if (startMatch) {
      const slug = startMatch[1];
      const status = 'start';
      if (lastStatus.get(slug) === status) {
        return; // Suppress unchanged status
      }
      lastStatus.set(slug, status);
      // Fall through to log
    }

    // Pattern 2: "↻ resume <slug>" → { slug, status: 'resume' }
    const resumeMatch = msg.match(/↻.*resume\s+(\S+)/);
    if (resumeMatch) {
      const slug = resumeMatch[1];
      const oldStatus = lastStatus.get(slug);
      const newMsg = oldStatus ? `${msg} (was: ${oldStatus})` : msg;
      lastStatus.set(slug, 'resume');
      console.log(`${chalk.dim('[daemon]')} ${newMsg}`);
      logSink?.write(formatDaemonLogLine(`[daemon] ${stripAnsi(newMsg)}`));
      return; // Resume lines always logged with (was: ...) appended
    }

    // Pattern 3: "■ done <slug>: <outcome_status>" → { slug, status: outcome_status }
    // This captures the outcome status (done, halted, error)
    const doneMatch = msg.match(/■.*done\s+(\S+):\s+(\S+)/);
    if (doneMatch) {
      const slug = doneMatch[1];
      const outcomeStatus = doneMatch[2]; // e.g., "done", "halted", "error"
      if (lastStatus.get(slug) === outcomeStatus) {
        return; // Suppress unchanged status
      }
      lastStatus.set(slug, outcomeStatus);
      // Fall through to log
    }

    // For all other lines (discovery, sweeps, etc.), always log
    console.log(`${chalk.dim('[daemon]')} ${msg}`);
    // The persisted record gets a leading ISO-8601 UTC timestamp so activity read
    // back via `conduct daemon logs` can be correlated in time; the console stays
    // uncluttered for live watching.
    logSink?.write(formatDaemonLogLine(`[daemon] ${stripAnsi(msg)}`));
  };

  // Task 17: Create the transition-aware discovery logger
  // Logs fetch failures/recovery only on state transitions
  const discoveryLogger = createDiscoveryLogger(log);

  // CF-5/CF-6 (intake #666): run the ci-fix startup preflight exactly once,
  // before the sweep loop starts, so a broken `claude` fix-invocation surface
  // (missing binary, bad auth, stale flag) disables ci-fix for this daemon
  // run instead of crashing or silently retrying a broken invocation on every
  // PR. Never repeated per-PR — the `ciFix.dispatch` closure only reads the
  // resulting `ciFixEnabled` flag.
  const ciFixPreflight = await preflightCiFixInvocation({ probe: defaultCiFixProbe });
  if (!ciFixPreflight.ok) {
    ciFixEnabled = false;
    log(`[ci-fix] startup preflight failed, disabling ci-fix for this run: ${ciFixPreflight.reason}`);
  }

  // ADR-010: claim the 1-per-repo pidfile so this daemon's liveness is observable
  // (the pidfile under .daemon/ holds our pid) and a second daemon for the same repo
  // refuses to start. A live owner → exit now; we release the lock on completion below.
  // ADR Decision item 3: enable bounded-wait polling for takeover scenario (10s/250ms)
  const LOCK_HELD_EXIT_CODE = 3;
  const lock = await holdLock(projectRoot, { takeoverWaitMs: 10_000, pollMs: 250 });
  if (lock === null) {
    const holder = await readPidRecord(projectRoot);
    if (holder && holder.pid) {
      log(
        `another daemon is already running (pid ${holder.pid})${holder.engineDir ? ` engineDir ${holder.engineDir}` : ''} for ${projectRoot}; exiting`
      );
    } else {
      log(`another daemon is already running for ${projectRoot}; exiting`);
    }
    const exitProcess = opts.exitProcess ?? process.exit;
    exitProcess(LOCK_HELD_EXIT_CODE);
    return;
  }
  // We own the repo: open the activity log and start teeing. renderDaemonEvent and
  // every feature start/finish line already route through `log`, so this single tee
  // captures the full BUILD-phase narrative (per-step results, shipped/failed + PR).
  logSink = await openDaemonLog(projectRoot);
  // #405: engine diagnostics (console.warn/console.error from autoheal, task-seed,
  // etc.) were visible only in the live pane and absent from daemon.log
  // (`grep 'Path corroboration' daemon.log` → 0 while the pane was full of them).
  // Tee them into the activity log so post-hoc forensics see what the operator saw.
  // Conductors run in-process, so this process-level tee covers all engine warnings.
  const originalConsoleWarn = console.warn.bind(console);
  const originalConsoleError = console.error.bind(console);
  const teeConsoleLine = (level: string, args: unknown[]): void => {
    try {
      const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      logSink?.write(formatDaemonLogLine(`[${level}] ${stripAnsi(line)}`));
    } catch {
      // Best-effort: the tee must never disrupt the warning path itself.
    }
  };
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn(...args);
    teeConsoleLine('warn', args);
  };
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    teeConsoleLine('error', args);
  };
  log(
    lock.owned
      ? `holding daemon lock (pid ${lock.pid}) for ${projectRoot}`
      : `WARNING: could not write pidfile for ${projectRoot}; liveness is not observable`,
  );
  // Crash/signal backstop: best-effort sync unlink + log flush if the process exits
  // abnormally (the normal path removes this and releases asynchronously below). A
  // missed release is self-healing — the next daemon reclaims a dead-pid pidfile.
  const releaseBackstop = (): void => {
    logSink?.closeSync();
    lock.releaseSync();
  };
  process.once('exit', releaseBackstop);

  // Task 5: run the install-freshness check (which may trigger publish/GC)
  // only AFTER holdLock has succeeded and the exit backstop above is
  // registered. This closes the pre-lock startup window where GC could
  // self-evict the running daemon's own dist before any pidfile/backstop
  // protection existed — a throw here (stale-install refusal) now
  // propagates with the lock already guarded by releaseBackstop on exit.
  // Stamp this process's own engine version onto env BEFORE any GC-triggering
  // step runs, so publish-engine.mjs's gcVersions call (Task 3) can never
  // delete the dist-versions/<id> this daemon is currently running out of.
  Object.assign(process.env, selfGuardEnv());
  await ensureFresh();

  // #561 (Story 1 + Story 3): SIGTERM must drain in-flight work before the
  // lock is released — force-exiting on SIGTERM (the old behavior) let a
  // second daemon race the pidfile while a conductor was still mid-write.
  // The teardown controller gives the daemon loop a bounded window to drain
  // (via shouldStop, wired into runDaemon below); if the drain doesn't
  // finish within FORCE_RELEASE_TIMEOUT_MS, onForceRelease fires as a
  // last-resort backstop: release the lock synchronously and exit non-zero,
  // logged with a greppable marker for post-hoc forensics.
  const FORCE_RELEASE_TIMEOUT_MS = 30_000;
  const teardown = createDaemonTeardown({
    timeoutMs: FORCE_RELEASE_TIMEOUT_MS,
    onForceRelease: () => {
      log(
        `[daemon] teardown force-release: drain did not complete within ${FORCE_RELEASE_TIMEOUT_MS / 1000}s — releasing lock and exiting`,
      );
      releaseBackstop();
      const exitProcess = opts.exitProcess ?? process.exit;
      exitProcess(1);
    },
  });

  // Task 22: Process-level SIGTERM handler for daemon mode. Track all in-flight
  // rate-limit waits across N concurrent conductors so a single process-level
  // handler can abort them all and coordinate state saves before exit.
  // Conductors running in daemon mode (daemon:true) will register their
  // AbortControllers here instead of installing per-conductor handlers.
  const allWaitSignals = new Set<AbortController>();

  // Task 22 / #561: Install ONE process-level SIGTERM handler (not N
  // per-conductor). When SIGTERM fires, abort all in-flight waits so they
  // unblock promptly, then request the bounded drain-then-release teardown
  // — runDaemon's shouldStop dep (wired below) sees the request at the top
  // of its loop and exits normally, after which the completion path
  // releases the lock. No direct process.exit here: the only force-exit
  // path is the teardown's bounded onForceRelease backstop above.
  const daemonSigtermHandler = async () => {
    // Abort all in-flight rate-limit waits across all conductors
    for (const controller of allWaitSignals) {
      controller.abort();
    }
    // Note: State saves are handled by individual conductors' exit handlers.
    // Request the drain — runDaemon observes shouldStop() at its next loop
    // boundary and stops with stoppedReason 'signal_teardown'; the normal
    // completion path below then releases the lock and exits.
    teardown.requestStop();
  };
  process.on('SIGTERM', daemonSigtermHandler);

  // FR-4/FR-7: honor a pause marker set BEFORE this daemon even booted (e.g. the
  // daemon was stopped, `conduct daemon pause` ran, then the daemon was started
  // again). isPaused is fail-closed (pause-marker.ts) — a corrupt marker still
  // reads as paused, so ambiguity here never dispatches. Logged once at boot so
  // `conduct daemon logs` makes the paused state visible immediately, in
  // addition to the same isPaused() gate re-polled every loop iteration below.
  const pausedAtBoot = await isPaused(projectRoot);
  if (pausedAtBoot) {
    log('daemon is paused — booting with zero dispatch until resumed (see `conduct daemon resume`).');
  }

  // Task T29: consume the pending-restart marker at boot. A fresh boot IS the
  // restart (whether self-spawned or manually started), so consume exactly once
  // here and log the fulfilled intent for observability. consumeOnBoot is
  // idempotent (absent marker returns null, no-op); multiple writes while busy
  // produce one logical intent that fires once (latest payload) at boot.
  const consumedRestartIntent = await consumeOnBoot(projectRoot);
  if (consumedRestartIntent) {
    const blockingSlug = consumedRestartIntent.blockingSlug
      ? ` (was waiting behind ${consumedRestartIntent.blockingSlug})`
      : '';
    const requestedBy = consumedRestartIntent.requestedBy
      ? ` by ${consumedRestartIntent.requestedBy}`
      : '';
    log(`restart marker consumed${blockingSlug}${requestedBy} at boot.`);
  }

  const configResult = await loadConfig(projectRoot);
  const config = configResult.ok ? configResult.config : undefined;

  // Self-host classification (Phase 6). Decided ONCE per daemon against the MAIN
  // repo root (`projectRoot`) — "is this daemon building the harness itself?" — not
  // per-worktree (a worktree path never equals the harness root). Honors the
  // config activation override (`auto`/`force_on`/`force_off`). Constant for every
  // feature this daemon builds; threaded to each Conductor as `selfHost`. For any
  // non-harness repo this is false and the build path is byte-for-byte unchanged.
  const isSelfHost = await classifySelfHost(defaultSelfHostDetector(), config, projectRoot);
  if (isSelfHost) {
    log('self-host mode active — harness self-build guardrails enabled for this daemon.');
  }

  // Tasks 8-10: Boot sequence wired through initStaleEngineState primitive
  // - Capture engine identity at startup
  // - Log ARMED/DISARMED status (gated by config + self-host mode)
  // - Startup handshake (read, log, clear RESTART_PENDING marker if present)
  // - Handle non-convergence suppression (target ≠ fresh identity)
  const engineEntryPath = engineEntryPathForRepo(projectRoot);
  const isArmed = (config?.auto_restart_on_stale_engine ?? false) && isSelfHost;
  // Task 8: append the pinned version's stamped source SHA to the boot
  // "daemon identity: ..." log line (never crashes — 'unknown' when the
  // `.engine-source-sha` sidecar is absent, e.g. pre-feature versions).
  const engineSourceSha = await readEngineSourceSha(engineEntryPath);
  const logWithEngineSourceSha = (msg: string): void => {
    log(msg.startsWith('daemon identity: ') ? `${msg} (source sha: ${engineSourceSha})` : msg);
  };
  const engineIdentity = await initStaleEngineState({
    repoPath: projectRoot,
    entryPath: engineEntryPath,
    flag: isArmed,
    log: logWithEngineSourceSha,
  });

  // Production stale-engine checker (adr-2026-07-03-daemon-auto-restart-stale-engine §1-2):
  // capture failure ⇒ permanently disabled checker (always 'current', warns once).
  const staleEngineChecker =
    engineIdentity !== null
      ? createStaleEngineChecker(engineIdentity, engineEntryPath, log)
      : createStaleEngineChecker(null, log);

  // One shared provider + event bus across workers (rate limits are shared).
  const events = new ConductorEventEmitter();
  const rateLimitEpisode = createRateLimitEpisode();
  // Task 20: track which parks were episode-caused so the episode-end sweep
  // (runDaemon's active→inactive transition hook) can recover exactly those.
  const episodeHaltTracker = createEpisodeHaltTracker();
  const registry = new PluginRegistry();
  // Surface per-step loop progress on the console. Without this the daemon was
  // silent between `▶ start` and `✓ shipped` (the no-op renderer threw every
  // step_started/gate_verdict/kickback away). Events don't carry a feature slug,
  // so with concurrency > 1 lines from different workers interleave; the `·`
  // prefix marks them as inner-loop progress under the active feature.
  const subscriber = registerBuiltins(registry, events, (event) =>
    renderDaemonEvent(event, log),
  );
  registry.markInitialized();
  subscriber.start();
  const provider = registry.get<LLMProvider>('llm_provider', config?.llm_provider ?? 'claude');
  // Resolve the active memory provider once at run start so all steps see the
  // same single provider (adr-2026-06-29-per-project-memory-provider-selection / FR-10). Uses a per-run ctx so warnings are
  // bounded and no module-level state is mutated (resolver is pure over config).
  const memoryResolveCtx = { warnings: [] as string[] };
  const memoryProvider = await resolveMemoryProvider(config ?? {}, registry, memoryResolveCtx);
  if (memoryResolveCtx.warnings.length > 0) {
    for (const w of memoryResolveCtx.warnings) log(`WARNING: ${w}`);
  }

  const worktreeBase = join(projectRoot, '.worktrees');
  await mkdir(worktreeBase, { recursive: true });

  const runConductorInWorktree = async (wt: FeatureWorktree, item: BacklogItem) => {
    const pipelineDir = join(wt.path, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    // Sweep stale session markers before constructing the runner. A KEPT
    // worktree (reused on a later daemon cycle after a prior halt/error —
    // createWorktree is idempotent) still carries the previous run's
    // `session-created` / `conduct-session-id`. Without this sweep the new
    // runner inherits `sessionStarted = true` (lazy-init reads the marker) and
    // its FIRST step would `--resume` a brand-new session id that was never
    // created → "No conversation found" → "session unavailable (expired or in
    // use)" → the feature errors out. The conductor also resets per step
    // before every step, but sweeping here guarantees a clean start.
    await rm(join(pipelineDir, 'session-created'), { force: true });
    await rm(join(pipelineDir, 'conduct-session-id'), { force: true });

    // Pre-seed: specs are authored, so DECIDE is stamped done and the loop
    // resumes at BUILD for a fresh feature. On re-dispatch of a halted feature,
    // preserve any BUILD/SHIP progress already recorded in the existing state
    // file so the resume picks up from the real next step (see `resume: true`).
    const stateFilePath = join(pipelineDir, 'conduct-state.json');
    const existingResult = await readState(stateFilePath);
    // Seed the complexity tier from the engineer-assessed value carried on the
    // backlog item (parsed from `.docs/complexity/<slug>.md`). Fall back to 'M'
    // for legacy/non-engineer specs that have no marker — that preserves the
    // exact prior behavior (M and L are BUILD-identical; only Small skips steps).
    const baseState: ConductState =
      existingResult.ok && Object.keys(existingResult.value).length > 0
        ? existingResult.value
        : { complexity_tier: item.tier ?? 'M', track: item.track ?? 'product', feature_desc: item.slug };

    // Always stamp DECIDE steps as done regardless of whether this is a fresh
    // start or a resume — the human authored them and they never re-run.
    for (const name of PRESEEDED_DONE) {
      (baseState as Record<string, unknown>)[name] = 'done';
    }
    if (!baseState.complexity_tier) baseState.complexity_tier = item.tier ?? 'M';
    // Seed the work track (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location) so the conductor's track-skip applies
    // (prd + prd-audit skipped on technical). Default product (back-compat).
    if (!baseState.track) baseState.track = item.track ?? 'product';
    // On the technical track there is no PRD — record it as skipped, not done.
    if (baseState.track === 'technical') {
      (baseState as Record<string, unknown>)['prd'] = 'skipped';
    }
    if (!baseState.feature_desc) baseState.feature_desc = item.slug;

    await writeState(stateFilePath, baseState);

    const stepRunner = new DefaultStepRunner(provider, uuidv4(), wt.path, {
      featureDesc: item.slug,
      pipelineDir,
      config,
      mode: 'auto',
    });

    // Wire AuditTrailWriter: appends friction/positive-evidence records to
    // <worktree>/.pipeline/audit-trail/events.jsonl, rooted at the worktree
    // path (never process.cwd() or the daemon's projectRoot) so retro can
    // reconstruct this feature's run history from inside its own worktree.
    // Daemon runs the engine in-process, so one writer per run covers all
    // steps for this worktree.
    const auditWriter = new AuditTrailWriter(wt.path);
    auditWriter.subscribe(events);

    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events,
      mode: 'auto',
      config,
      projectRoot: wt.path,
      // Self-host guardrails (Phase 6): activate the bundle only when this daemon
      // is building the harness itself. `baseBranch` feeds the release-artifact
      // migration classifier (`<base>...HEAD`).
      selfHost: isSelfHost,
      baseBranch,
      verifyArtifacts: true,
      // Resume from the first unsatisfied step rather than hardcoding the entry
      // point. With the DECIDE steps stamped done (PRESEEDED_DONE above), a
      // FRESH feature resumes at `acceptance_specs` — the first pending step —
      // exactly as before. A RE-DISPATCH of a feature with recorded BUILD/SHIP
      // progress resumes at its real next step (e.g. prd_audit / finish) instead
      // of re-entering at acceptance_specs every cycle. (`fromStep` forced
      // acceptance_specs and, being `explicitlyTargeted`, re-ran it on every
      // resume.)
      resume: true,
      // Phase 9.1: daemon runs skip the in-loop retro; the emission step writes
      // the narrative to the engineer store instead of the repo's .docs/retros/.
      daemon: true,
      rateLimitEpisode,
      // Task 22: Register in-flight wait AbortControllers with daemon-level handler
      // so process-level SIGTERM can abort all waits across N concurrent conductors.
      registerAbortController: (controller) => allWaitSignals.add(controller),
    });

    // FR-12 (ADR-013): a re-kick dropped a `.pipeline/REKICK` sentinel. Integrate
    // the advanced base FIRST — run 9.0's rebase-onto-latest BEFORE the conductor
    // resumes the pending gate, so a gate halt (e.g. prd-audit) re-verifies on the
    // new base instead of the stale one. One-shot (sentinel consumed). A
    // re-conflict re-parks via 9.0's existing HALT path — skip `conductor.run()`.
    const ranManualTest = getStepStatus(baseState, 'manual_test') !== 'skipped';
    // Task 8 (operator-park): a human-placed halt must survive re-kick sweeps
    // unconditionally — that includes NOT consuming a pending `.pipeline/REKICK`
    // sentinel. Checked BEFORE `resumeRebaseFirst` (which is one-shot: it
    // deletes the sentinel up front regardless of outcome) so a parked
    // worktree's sentinel is left completely untouched for a human to inspect
    // or for the eventual un-park to resume normally.
    const parked = await isOperatorParked(projectRoot, item.slug);
    if (parked) {
      log(`re-kick resume ${item.slug}: skipped — operator-parked (sentinel preserved)`);
      return;
    }
    const resume = await resumeRebaseFirst({
      worktreePath: wt.path,
      localBase: baseBranch,
      events,
      ranManualTest,
      // #300: give the play-forward conflict the SAME gated /rebase attempts the
      // finish-time step gets, before parking for a human.
      resolveAttempts: resolveRebaseResolutionAttempts(config),
      resolveConflict: stepRunner.resolveRebaseConflict
        ? (ctx) => stepRunner.resolveRebaseConflict(ctx)
        : undefined,
      // ADR-2026-07-09-mid-run-merged-pr-guard: pass the gh runner and recorded PR URL
      // so the guard can check if the feature was merged out-of-band before rebasing.
      runGh: ownerGh,
      prUrl: baseState.pr_url,
      log,
    });
    if (resume === 'halted') return; // re-parked: HALT re-written, do not resume the gate
    if (resume === 'already_shipped') {
      // ADR-2026-07-09: the recorded PR is merged out-of-band. Write the synthetic
      // verified-ship markers and return without invoking conductor.run().
      const headSha = await (async () => {
        try {
          const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: wt.path });
          return stdout.trim();
        } catch {
          return 'unknown';
        }
      })();
      await mkdir(join(wt.path, '.pipeline'), { recursive: true });
      const finishChoicePath = join(wt.path, '.pipeline', 'finish-choice');
      const donePath = join(wt.path, '.pipeline', 'DONE');
      await writeFile(finishChoicePath, 'pr', 'utf-8');
      await writeFile(donePath, '', 'utf-8');
      log(`already shipped out-of-band; local branch retained at ${headSha}`);
      return;
    }

    await conductor.run();

    // Link & close the originating issue (intake specs only): once the
    // implementation PR exists, add `Closes owner/repo#N` to its body so GitHub
    // auto-closes the issue when the PR merges to the default branch. Best-effort
    // and idempotent — a gh failure or a halted build (no pr_url) never affects
    // the feature outcome.
    const finalState = await readState(stateFilePath);
    const ghRunner = makeProductionGh();
    await closeIssueOnImplementationMerge({
      gh: ghRunner,
      sourceRef: item.sourceRef,
      prUrl: finalState.ok ? finalState.value.pr_url : undefined,
      cwd: wt.path,
      slug: item.slug,
      log,
    });

  };

  // Task 15: Production wiring of setup-failure triage in daemon-cli.
  // Construct runSetupTriage with real deps: git runner for worktree,
  // prepareWorktree for retry, and fix-session dispatcher that constructs
  // fresh DefaultStepRunner per dispatch (uuid session).
  const runSetupTriage = async (
    error: any, // SetupFailureError
    worktree: FeatureWorktree,
    item: BacklogItem,
  ) => {
    // Kill-switch for testing: prevent actual LLM dispatch
    if (process.env.CONDUCT_SETUP_TRIAGE_KILLSWITCH) {
      return { kind: 'park' as const, outputTail: 'setup-triage disabled by env killswitch' };
    }

    // Create a git runner rooted at the worktree path
    const git: GitRunner = makeGitRunner(worktree.path);

    // Inject prepareWorktree for retry after quarantine
    const runPrepare = (worktreePath: string) =>
      prepareWorktree(worktreePath, log, { verbose: config?.daemon_verbose ?? false });

    // Triage stage 1: run-triage (TS-2/TS-3)
    // Classify tree state and route: clean → pass, dirty → quarantine+retry
    const triageOutcome = await runTriage(git, worktree.path, item.slug, error, runPrepare, { log });

    // A park with no quarantineRef is a genuine PRESERVATION failure (the
    // quarantine commit/branch itself could not be created) — stop immediately,
    // never risk a fix-session on top of an unsafe tree. A park WITH a
    // quarantineRef means quarantine succeeded but the post-quarantine retry
    // still failed (committed breakage at a now-clean HEAD) — per the ADR this
    // must still proceed to the bounded fix-session (Stage 2), not stop here.
    if (triageOutcome.kind === 'park' && !triageOutcome.quarantineRef) {
      return triageOutcome;
    }

    // A quarantined-pass outcome means stage-1 retry succeeded and setup is now
    // passing at a clean HEAD. Per adr-2026-07-09-setup-failure-triage sub-decision 4,
    // stage 2 (fix-session) should only run 'if setup still fails at a clean HEAD',
    // so quarantined-pass skips directly to normal build dispatch.
    if (triageOutcome.kind === 'quarantined-pass') {
      return triageOutcome;
    }

    // Triage stage 2: fix-session (Task 10)
    // For non-park outcomes, dispatch LLM fix session and mechanically verify
    const dispatchFixSession = async () => {
      // Construct a fresh DefaultStepRunner for this fix session
      const sessionId = uuidv4();
      const stepRunner = new DefaultStepRunner(provider, sessionId, worktree.path, {
        featureDesc: `setup-fix-${item.slug}`,
        config,
        mode: 'auto',
      });
      log(`[setup-triage] fix-session dispatched for ${item.slug} (session ${sessionId})`);
      await stepRunner.resolveSetupFailure({
        worktreePath: worktree.path,
        outputTail: error.outputTail ?? '',
        slug: item.slug,
      });
    };

    // Run fix-session: dispatch LLM, verify contract (prepare + clean tree)
    const fixOutcome = await fixSession(git, worktree.path, item.slug, dispatchFixSession, runPrepare);

    // A stage-1 quarantine ref must never be lost from the final outcome —
    // fixSession() doesn't know about it, so carry it forward if the fix
    // itself also failed (park) and didn't already attach its own ref.
    if (fixOutcome.kind === 'park' && !fixOutcome.quarantineRef && triageOutcome.quarantineRef) {
      return { ...fixOutcome, quarantineRef: triageOutcome.quarantineRef };
    }

    return fixOutcome;
  };

  const deps = makeFeatureRunnerDeps({
    projectRoot,
    worktreeBase,
    baseBranch,
    runConductorInWorktree,
    provider,
    memoryProvider,
    log,
    verbose: config?.daemon_verbose ?? false,
    runSetupTriage,
  });
  const runFeature = makeRunFeature(deps);

  const continuous = opts.continuous ?? false;
  // Continuous with no ceiling at all runs unbounded — surface that loudly
  // rather than silently looping forever (Phase 7 "hard ceilings" intent).
  const hasCeiling =
    opts.maxItems != null ||
    opts.maxCostTokens != null ||
    opts.maxRuntimeSeconds != null ||
    opts.maxIdlePolls != null;
  if (continuous && !hasCeiling) {
    log(
      'WARNING: --continuous with no ceiling (--max-items/--max-cost/--max-runtime/--max-idle-polls) runs unbounded; Ctrl-C to stop.',
    );
  }

  log(
    `scanning backlog (concurrency ${opts.concurrency}${continuous ? ', continuous' : ''})…`,
  );

  // Shared backlog discovery — used both by the pool and the startup dashboard's
  // ELIGIBLE group, so they stay in lockstep. `refresh` is true only when the pool
  // is fully idle: there we fast-forward the local default branch to origin so
  // newly merged specs become present (and discoverable on the local tree). While
  // builds are in flight (`refresh:false`) there is NO fetch/ff, so an in-flight
  // build is never advanced onto specs that merged mid-run.
  //
  // ADR-014: the discoverTick closure is now encapsulated in a WorkSource adapter
  // so the run-loop is decoupled from direct fs/git I/O and tests can inject fakes.
  // Owner-gate wiring (adr-2026-06-30-* / adr-2026-07-01-machine-scoped-operator-identity):
  // resolve the daemon owner FRESH each pass (no caching) so a reconfigured
  // `spec_owner` / changed gh login takes effect next pass (FR-14); back the
  // committed stamp + first-appearance readers with the real git runner (the main
  // checkout, never a worktree). The grandfather cutover comes from validated
  // config; MISSING → null, the documented default (un-owned specs skip as
  // indeterminate).
  //
  // D1 (machine-scoped identity): the owner is resolved via
  // `makeMachineOwnerResolver`, which reads `spec_owner` ONLY from the user config
  // (~/.ai-conductor/config.yml) → `gh` login → unresolved. The PROJECT config
  // (`config`, from loadConfig) is deliberately NOT consulted for identity, so a
  // committed `spec_owner` can never leak one operator's identity onto everyone.
  // D3 (fail-closed): when neither the user-config owner nor a gh login resolves,
  // the resolver returns `{ resolved: false }` and discovery builds NOTHING.
  // ADR-1 naming: `daemonOwner`, never a bare `owner`.
  const ownerGh: GhRunner = makeProductionGh();
  const ownerGit = makeGitRunner(projectRoot);

  // Task 13: Construct ONE priority resolver per daemon run (process-local state,
  // never persisted to disk). The resolver backs the REAL gh CLI runner so cross-repo
  // issue refs are fetched from GitHub (ghIssueLabelReader wraps the runner in
  // parseIssueRef → gh argv → JSON label extraction). Passed to localWorkSource for
  // post-gate ordering and to the dashboard for fallback-mode display.
  // Wrap ownerGh (GhRunner) to match ExecRunner signature (args only, cwd implicit).
  const execRunnerWrapper = (args: string[]) => ownerGh(args, { cwd: projectRoot });
  const priorityResolver = createPriorityResolver(ghIssueLabelReader(execRunnerWrapper), log);

  // Task 12 (adr-2026-07-03-gated-snapshot-status-read-model): the daemon
  // directory backing `.daemon/gated.json` — every discovery pass rewrites
  // it via `onGatedDiscovered` below, the SAME `gated` list `discoverBacklog`
  // just computed (populated, empty, or the identity-unresolved
  // early-return's repo-warning-only list alike).
  const daemonDir = join(projectRoot, '.daemon');

  // Task 21 (adr-2026-07-03-gate-writeback-daemon-tick, Tasks 17-20): announce
  // each owner-gated spec on its implementation PR (if one was already opened
  // by an earlier build attempt, e.g. a halted worktree whose ownership later
  // changed) and on its originating Source-Ref issue (intake specs only).
  // Both `announceGatedPr`/`announceGatedIssue` are fire-and-forget/
  // never-throw (see gate-writeback.ts), so a `gh` failure here never blocks
  // or aborts the discovery pass that produced the gated list. Runs AFTER the
  // snapshot write (Task 12) so `.daemon/gated.json` is never delayed behind
  // network calls to GitHub.
  const gatedWritebackDeps = {
    cwd: projectRoot,
    log,
    warnedSkips: new Set<string>(),
    verbose: config?.daemon_verbose ?? false,
  };
  const announceGated = async (gated: Awaited<ReturnType<typeof discoverBacklog>>['gated']) => {
    for (const entry of gated) {
      if (entry.kind !== 'spec') continue;
      // The spec's implementation PR, if a prior build attempt already opened
      // one (e.g. halted mid-build before ownership changed underneath it).
      // Gated specs are discovered pre-dispatch, so per-slug worktree state
      // is normally absent — fall back to resolving the merged spec PR from
      // origin by its spec/<slug> branch (lookup-only, never creates a PR).
      const perSlugStateFile = join(worktreeBase, entry.slug, '.pipeline', 'conduct-state.json');
      const slugState = await readState(perSlugStateFile);
      const prUrl =
        (slugState.ok ? slugState.value.pr_url : undefined) ??
        (await resolveSpecPrUrl(ownerGh, projectRoot, `spec/${entry.slug}`, log));
      await announceGatedPr(entry, prUrl as string, gatedWritebackDeps);
      await announceGatedIssue(entry, entry.sourceRef, gatedWritebackDeps);
    }
  };

  const workSource =
    opts.workSource ??
    localWorkSource({
      projectRoot,
      baseBranch,
      log,
      isProcessed: (slug) => isProcessed(projectRoot, slug),
      hasWarned: (slug) => hasWarned(projectRoot, slug),
      markWarned: (slug) => markWarned(projectRoot, slug),
      // ADR Decisions 2b/2c: a shipped-record skip repairs the local ledger
      // cache so later polls take the fast path (record → marker backfill).
      repairProcessed: (slug, record) => repairProcessed(projectRoot, slug, record),
      fastForwardRoot,
      discoverBacklog,
      resolveDaemonOwner: makeMachineOwnerResolver(ownerGh, projectRoot),
      readStamp: (slug) => readSpecOwnerStamp(ownerGit, baseBranch, slug),
      readMergeTime: (slug) =>
        firstAppearanceTime(ownerGit, baseBranch, `.docs/plans/${slug}.md`),
      cutover: config?.owner_gate_cutover ?? null,
      // Dependency gate (rem-fr4-2): fresh BlockerResolver per discover() pass
      // — see LocalWorkSourceDeps.makeResolver doc — so the per-pass memo in
      // createBlockerResolver() never leaks stale verdicts across polls. The
      // real `gh` binary backs the runner in production, the only production
      // caller of createGhBlockerRunner().
      makeResolver: () => createBlockerResolver({ run: createGhBlockerRunner(), cwd: projectRoot }),
      // Priority resolution (Task 13): post-gate ordering by issue priority bands.
      // The resolver is constructed once per daemon run with process-local caching
      // (no disk persistence). Passed to discover() for ordering and available to
      // the dashboard for fallback-mode display.
      priorityResolver,
      // Task 12: single call site for the owner-gate snapshot write — fires
      // on EVERY discover() pass this WorkSource drives. `writeGatedSnapshot`
      // is itself advisory (never throws, see gated-snapshot.ts), so a write
      // failure never blocks or aborts the discovery pass that produced it.
      onGatedDiscovered: async (gated) => {
        await writeGatedSnapshot(daemonDir, { gated });
        await announceGated(gated);
      },
    });
  const discoverTick = (o: { refresh: boolean }) => workSource.discover(o);

  const processedDir = join(projectRoot, '.daemon/processed');

  // ADR-013 re-kick sweep: per-feature last-rekick SHA (FR-9) persists across the
  // startup + live sweeps of ONE run. Real fs/git primitives; clearing a marker
  // is the ONLY side effect — re-dispatch flows through PR #109's un-park path.
  const lastRekickSha = new Map<string, string>();
  // Content-aware dedup (ADR Decision 3): the sweep consults the SHARED
  // ledger-or-shipped-record resolver before re-kicking, so a shipped
  // duplicate stays parked instead of burning an abort/clear/re-park cycle
  // per base advance (#205). The resolver is rebuilt fresh per sweep (see the
  // rekickSweep binding below): a sweep fires precisely because main advanced,
  // which is exactly when a newly merged shipped record must become visible.
  // Warn-once markers are the durable `.daemon/warned/` fs markers shared with
  // discovery's skip logs.
  const rekickDeps: RekickSweepDeps = {
    listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
    readHaltReason: (slug) => readHaltReason(worktreeBase, slug),
    hasRebaseInProgress: (slug) => hasRebaseInProgress(join(worktreeBase, slug)),
    abortRebase: (slug) => abortRebase(join(worktreeBase, slug)),
    clearMarker: (slug) => clearMarker(join(worktreeBase, slug)),
    lastRekickSha,
    log,
    hasWarned: (slug) => hasWarned(projectRoot, slug),
    markWarned: (slug) => markWarned(projectRoot, slug),
    // Task 6 (operator-park): the same real `park-marker.ts` primitive backing
    // the dispatch-eligibility `isParked` dep above, threaded into the re-kick
    // sweep so a human-placed halt survives sweeps across daemon restarts
    // (FR-2). Read errors are logged as anomalies rather than thrown — the
    // sweep already fails toward parked on error (see daemon-rekick.ts).
    isOperatorParked: (slug) =>
      isOperatorParked(projectRoot, slug, (err) =>
        log(`anomaly checking if ${slug} is parked: ${err.message}`),
      ),
  };

  // Task 4: Create the real restart requester with injected lock + process
  // Task 9: Wire real deps (relink, triggerSelfRestart) at construction site
  // relink rebuilds the harness skill symlinks before self-host dispatches
  // triggerSelfRestart is injected from opts (respawn pane in session-hosted mode)
  const requestRestart = createRestartRequester(projectRoot, log, lock, process, {
    relink: () => relinkSkillsForSelfBuild({ log }),
    triggerSelfRestart: opts.triggerSelfRestart,
  });

  // Task 11: Create the suppression check wrapper that binds projectRoot
  const suppressionChecker = (currentIdentity: string | null) =>
    isSuppressed(currentIdentity, projectRoot, log);

  const watch = opts.watch ?? true;
  const watchHaltCleared = watch !== false
    ? (slug: string, onCleared: () => void) =>
        makeWatchHaltClearedSeam(worktreeBase)(slug, onCleared)
    : undefined;

  const result = await runDaemon(
    {
      discoverBacklog: discoverTick,
      isHalted: (slug) => isHalted(worktreeBase, slug),
      // Task 14: wire the filesystem watcher for HALT marker removal.
      // When watch is false, the watcher is undefined and the daemon falls
      // back to polling alone. Otherwise, the daemon uses event-driven re-kick
      // when a halted feature's HALT marker is cleared.
      watchHaltCleared,
      // Task 7 (operator-park): consulted alongside `isHalted` — a
      // `.daemon/parked/<slug>` marker is durable across restarts and is
      // never lifted by clearing the HALT marker (halt-clear resume, PR-#109).
      isParked: (slug) => isOperatorParked(projectRoot, slug),
      // T14 (daemon-halts-a-build-that-is-making-forward-progre): wire the
      // real progress-gated cross-dispatch re-kick (T8/T9/T10) into runDaemon
      // — previously constructed and fully unit-tested only at the
      // daemon.ts/pickEligible level, never reachable from this entrypoint.
      ...buildProgressReKickDeps(config, worktreeBase),
      // FR-1 (Task 11): gate dispatch on the durable `.daemon/PAUSED` marker,
      // re-polled every loop iteration by runDaemon so a pause lifted mid-run
      // resumes dispatch at the next boundary (no restart required).
      isPaused: () => isPaused(projectRoot),
      // Task 13 (FR-6): gate new picks while the daemon's own build
      // credential is missing/stale/unreadable. Resolved fresh each poll
      // (mode + token path rarely change, but re-reading keeps this in sync
      // with a config reload without requiring a daemon restart). API-key
      // mode never consults the token file — the gate is inert there (FR-2).
      isBuildAuthMissing: async () => {
        const { buildAuthMode, buildAuthTokenPath } = resolveSelfHostConfig(config);
        if (buildAuthMode !== 'daemon-token') return false;
        const tokenState = await readDaemonBuildToken(buildAuthTokenPath);
        return tokenState.state !== 'ok';
      },
      // Task 14 (FR-6): supply the shared remediation message (Task 7) so the
      // daemon's transition-edge waiting-condition log carries the mint
      // command, resolved token path, and pitfalls instead of a bare status
      // line.
      getBuildAuthRemediationMessage: () => {
        const { buildAuthTokenPath } = resolveSelfHostConfig(config);
        return buildAuthRemediationMessage(buildAuthTokenPath);
      },
      rateLimitEpisode,
      // Task 20: record episode causality when the daemon parks a halted/error
      // outcome, and recover exactly those parks when the episode ends. The
      // sweep clears each stamped worktree's HALT non-destructively via the
      // existing rekick primitive (reason → HALT.cleared + REKICK sentinel),
      // which also fires the watchHaltCleared wake for immediate re-dispatch.
      // NOTE: this binding must stay wired — removing it silently no-ops
      // episode-caused HALT recovery (daemon.ts guards with ?.()).
      onHaltWritten: async (slug, episodeCaused) =>
        episodeHaltTracker.onHaltWritten(slug, episodeCaused),
      sweepEpisodeHalts: async (isParkedDep) => {
        const stamped = await episodeHaltTracker.getEpisodeHalts((slug) =>
          isHalted(worktreeBase, slug),
        );
        for (const slug of stamped) {
          // Operator intent outranks automatic recovery (same rule as rekickSweep).
          if (isParkedDep && (await isParkedDep(slug))) {
            log(`episode-end sweep: ${slug} operator-parked — left for a human`);
            continue;
          }
          await clearMarker(join(worktreeBase, slug));
          log(`episode-end sweep: re-kicked ${slug} (episode-caused HALT cleared)`);
        }
      },
      runFeature,
      log,
      staleEngineChecker,
      requestRestart,
      // Rebuild the engine from source before each dispatch (self-host only) so
      // the stale-engine checker sees merge-driven drift the untracked `dist`
      // (#309) hides. projectRoot is the harness root under self-host, so
      // src/conductor is its build package.
      rebuildEngine: isSelfHost
        ? () => rebuildEngineFromSource(join(projectRoot, 'src', 'conductor'))
        : undefined,
      // Fast-forward the harness checkout to origin before each dispatch
      // (self-host only, NP4) so rebuildEngine above builds from
      // merge-driven drift instead of a stale local branch (TI-1 HP1).
      // Throttled (TI-2) via engine_refresh_min_interval_seconds so an idle
      // daemon does not fetch on every poll. Degraded outcomes (dirty,
      // diverged, fetch-failed) with a determinable originHead are routed
      // into the deduped staleness warner (TI-4 HP1/HP2); other causes
      // (no-origin, unknown-default, not-default-branch) and clean outcomes
      // (current, advanced) never warn.
      refreshEngineSource: isSelfHost
        ? (() => {
            const minIntervalMs =
              (config?.engine_refresh_min_interval_seconds ?? 300) * 1000;
            const throttle = createRefreshThrottle(minIntervalMs, Date.now);
            const warner = createStalenessWarner(log);
            return async () => {
              if (!throttle.shouldRun()) return;
              throttle.markRan();
              const outcome = await fastForwardRoot(projectRoot, log);
              if (
                outcome.status === 'skipped' &&
                (outcome.cause === 'dirty' ||
                  outcome.cause === 'diverged' ||
                  outcome.cause === 'fetch-failed') &&
                outcome.originHead
              ) {
                warner.warn(outcome.cause, outcome.originHead, baseBranch);
              }
            };
          })()
        : undefined,
      isSuppressed: suppressionChecker,
      // ── Halt-reconciliation (ADR-013) real-I/O hooks ──────────────────────
      // FR-1: scan inherited state and render the dashboard to both sinks
      // (console + daemon.log via `log`) before any dispatch. Pass the priority
      // resolver so the dashboard can capture and display band annotations / fallback mode.
      renderStartupDashboard: async () => {
        // Task 14 (FR-4/FR-7): a daemon booting paused must dispatch/discover
        // NOTHING — including the informational startup dashboard's backlog
        // scan, which would otherwise call discoverBacklog({refresh:true})
        // unconditionally (before the pause-gated loop below ever runs). Skip
        // the scan entirely when paused at boot; the boot-time log line above
        // already told the operator why nothing is happening.
        if (pausedAtBoot) return;
        const state = await scanInheritedState({
          worktreeBase,
          processedDir,
          discover: () => discoverTick({ refresh: true }),
          log,
        });
        // Task 11 (operator-park, FR-6): PARKED outranks every other group.
        // `scanInheritedState` has no concept of parking, so compute the
        // parked overlay here — every slug the scan surfaced, PLUS a listing
        // of `.daemon/parked/` itself so a stale park (no worktree, no
        // backlog entry) still renders instead of vanishing silently.
        const candidateSlugs = new Set<string>([
          ...state.halted.map((h) => h.slug),
          ...state.inProgress.map((p) => p.slug),
          ...state.eligible.map((e) => e.slug),
          ...state.processed.map((p) => p.slug),
          ...(state.waiting ?? []).map((w) => w.slug),
        ]);
        for (const slug of await listOperatorParkedSlugs(projectRoot)) {
          candidateSlugs.add(slug);
        }
        const parked: ParkedEntry[] = [];
        for (const slug of candidateSlugs) {
          if (await isOperatorParked(projectRoot, slug, (err) =>
            log(`anomaly checking if ${slug} is parked: ${err.message}`),
          )) {
            // Fetch provenance (auto vs operator) and reason if available
            const provenance = await getProvenanceType(projectRoot, slug);
            let reason: string | undefined;

            // For auto-parks, try to extract reason from marker body
            if (provenance === 'auto') {
              try {
                const markerPath = join(projectRoot, '.daemon', 'parked', slug);
                const content = await readFile(markerPath, 'utf-8');
                const lines = content.split('\n');
                if (lines[0]?.startsWith('auto-parked:')) {
                  reason = lines[0].substring('auto-parked:'.length).trim();
                }
              } catch {
                // Ignore read errors — marker exists but reason extraction failed
              }
            }

            parked.push({ slug, provenance: provenance || undefined, reason });
          }
        }
        // Task 3: split the previously single tee'd call so the persisted
        // daemon.log NEVER carries the PROCESSED group (kept lean for
        // grep/tail), while the console optionally shows it per
        // `showCompleted` (--completed/--all). Uses the same formatting
        // conventions as the `log()` closure above.
        const dashboardState = { ...state, parked };
        logSink?.write(
          formatDaemonLogLine(`[daemon] ${stripAnsi(`\n${renderDashboard(dashboardState)}`)}`),
        );
        console.log(
          `${chalk.dim('[daemon]')} \n${renderDashboard(dashboardState, { includeCompleted: showCompleted })}`,
        );
      },
      // FR-4: resolve the base-branch tip SHA from the SAME local default branch
      // the backlog reads. On idle refresh we fast-forward it first so the SHA
      // reflects origin's latest (driving ADR-013 re-kick when main advances).
      resolveBaseSha: async ({ refresh }) => {
        if (refresh) await fastForwardRoot(projectRoot, log, undefined, discoveryLogger);
        return readBaseSha(makeGitRunner(projectRoot), baseBranch);
      },
      readPersistedBaseSha: () => readPersistedBaseSha(projectRoot),
      writePersistedBaseSha: (sha) => writePersistedBaseSha(projectRoot, sha, log),
      rekickSweep: async (sha) => {
        // Reconcile stranded park markers at the TOP of the sweep so the same
        // sweep that moves them also skips them (#486).
        await reconcileStrandedParkMarkers(projectRoot, log);
        // Fresh resolver per sweep: makeIsProcessed caches the shipped-record
        // listing per instance, and this sweep runs because the base branch
        // just advanced — a run-long cache would miss records merged mid-run.
        await rekickSweep(
          {
            ...rekickDeps,
            isProcessed: makeIsProcessed(processedDir, gitTreeSource(projectRoot, baseBranch)),
          },
          sha,
        );
      },
      // ai-conductor#274: wire the startup + per-idle-poll-tick halt-PR
      // reconciliation sweep. NOTE: this binding must stay wired — removing it
      // silently no-ops the "ultimate safety net" for halt-PR presentation
      // (daemon.ts guards with ?.()), same failure mode as sweepMergeableLabels below.
      reconcileHaltPrs: async () => {
        await reconcileHaltPrs({ projectRoot, log, cache: haltPrSweepCache });
      },
      // FR-14: wire the startup + per-idle-poll-tick mergeable label sweep.
      // NOTE: this binding must stay wired — removing it silently no-ops all
      // startup and idle-poll sweeps in production (daemon.ts guards with ?.()).
      sweepMergeableLabels: async () => {
        await sweepMergeableLabels({
          projectRoot,
          log,
          // Task 17: dispatch autoresolve for the first eligible CONFLICTING
          // PR after the label pass, gated on `mergeable_autoresolve.enabled`
          // so a disabled/absent config leaves the sweep unchanged (AC4).
          autoresolve: {
            enabled: config?.mergeable_autoresolve?.enabled ?? false,
            isEligible: (entry, state) =>
              isEligibleForResolve(
                entry,
                state,
                config,
                new Date(),
                { worktreeExists: async (p) => existsSync(join(projectRoot, p)) },
                log,
              ),
            dispatch: async (entry) => {
              log(`[mergeable-sweep] autoresolve dispatch: ${entry.prUrl} (attempt ${entry.resolveAttempts})`);

              try {
                // Fetch the branch name from the PR
                const prViewResult = await execFile('sh', [
                  '-c',
                  `gh pr view "${entry.prUrl}" --json headRefName --jq '.headRefName'`,
                ], { cwd: entry.repoCwd });

                const branch = (prViewResult.stdout || '').toString().trim();
                if (!branch) {
                  log(`[autoresolve] empty branch name for ${entry.prUrl}`);
                  return { kind: 'escalated' };
                }

                // Create a gh runner (wrapper around gh commands)
                const productionGh = makeProductionGh();
                const ghRunner = async (args: string[]) =>
                  productionGh(args, { cwd: entry.repoCwd });

                // Create a suite runner (executes the suite command in the worktree)
                const runSuite = async (projectRoot: string) => {
                  const cmd = config?.mergeable_autoresolve?.suiteCommand;
                  if (!cmd) {
                    return { exitCode: 0, durationMs: 0, configured: false };
                  }

                  const startMs = Date.now();
                  try {
                    await execFile('sh', ['-c', cmd], {
                      cwd: projectRoot,
                      encoding: 'utf-8',
                    });
                    return {
                      exitCode: 0,
                      durationMs: Date.now() - startMs,
                      configured: true,
                    };
                  } catch (err: any) {
                    return {
                      exitCode: err.code === 'ERR_CHILD_PROCESS_EXIT' ? (err.status || 1) : 1,
                      durationMs: Date.now() - startMs,
                      configured: true,
                    };
                  }
                };

                // Create a real Tier-2 resolver that dispatches to the /rebase skill
                // FR-7: wire stepRunner and events for rebase resolution dispatch
                let attempt = 0;
                const attemptCap = resolveRebaseResolutionAttempts(config);
                const resolver: RebaseResolver = async (ctx) => {
                  attempt += 1;
                  try {
                    await events.emit({ type: 'rebase_resolution_attempt', index: attempt, cap: attemptCap });
                  } catch {
                    /* best-effort: event emission must not block resolution */
                  }
                  try {
                    // Create a fresh step runner for this rebase resolution attempt
                    const sessionId = uuidv4();
                    const stepRunner = new DefaultStepRunner(provider, sessionId, ctx.projectRoot, {
                      featureDesc: `rebase-resolution-${entry.slug}`,
                      config,
                      mode: 'auto',
                    });
                    return await stepRunner.resolveRebaseConflict(ctx);
                  } catch (err) {
                    return {
                      resolved: false,
                      reason: err instanceof Error ? err.message : String(err),
                    };
                  }
                };

                // Run the full resolution pipeline
                const outcome = await resolveConflictingPr(
                  entry,
                  branch,
                  {
                    enabled: config?.mergeable_autoresolve?.enabled ?? false,
                    suiteCommand: config?.mergeable_autoresolve?.suiteCommand ?? '',
                    cooldownMinutes: config?.mergeable_autoresolve?.cooldownMinutes ?? 60,
                    attemptCap,
                  },
                  { runGh: ghRunner, runSuite, resolver, log },
                );

                log(`[autoresolve] outcome for ${entry.prUrl}: ${outcome.kind}`);
                return { kind: outcome.kind };
              } catch (err: any) {
                log(`[autoresolve] error resolving ${entry.prUrl}: ${err?.message || err}`);
                return { kind: 'escalated' };
              }
            },
          },
          // Task 23: dispatch ci-fix for the first eligible failed-CI PR after
          // the label pass, gated on `ci_watch.enabled` (default true — fail-safe
          // per CiWatchConfig) so a disabled config leaves the sweep unchanged
          // (AC3), and mirrors the `autoresolve` binding above (AC4).
          ciFix: {
            enabled: config?.ci_watch?.enabled ?? true,
            isEligible: (entry, state) =>
              isEligibleForCiFix(entry, state, config, new Date(), log),
            dispatch: async (entry) => {
              if (!ciFixEnabled) {
                return;
              }
              log(`[mergeable-sweep] ci-fix dispatch: ${entry.prUrl} (attempt ${entry.ciFixAttempts})`);

              try {
                const prViewResult = await execFile('sh', [
                  '-c',
                  `gh pr view "${entry.prUrl}" --json headRefName --jq '.headRefName'`,
                ], { cwd: entry.repoCwd });

                const branch = (prViewResult.stdout || '').toString().trim();
                if (!branch) {
                  log(`[ci-fix] empty branch name for ${entry.prUrl}`);
                  return;
                }

                const productionGh = makeProductionGh();
                const ghRunner = async (args: string[]) =>
                  productionGh(args, { cwd: entry.repoCwd });

                const hint = await buildCiFixHint(ghRunner, entry.repoCwd, entry.prUrl);

                // Route the ci-fix dispatch through resolveCiFailure (T4):
                // adapt a real DefaultStepRunner into productionCiFixRunner's
                // dispatcher seam instead of wiring the bare exec-based
                // runner directly — mirrors the resolveRebaseConflict /
                // DefaultStepRunner pattern used for rebase resolution above.
                const ciFixDispatcher = {
                  resolveCiFailure: async (ctx: { worktreePath: string; hint: string; entry: typeof entry }) => {
                    const sessionId = uuidv4();
                    const stepRunner = new DefaultStepRunner(provider, sessionId, ctx.worktreePath, {
                      featureDesc: `ci-fix-resolution-${ctx.entry.slug}`,
                      config,
                      mode: 'auto',
                    });
                    await stepRunner.resolveCiFailure({
                      worktreePath: ctx.worktreePath,
                      prUrl: ctx.entry.prUrl,
                      hint: ctx.hint,
                      slug: ctx.entry.slug,
                    });
                    return { kind: 'changed' as const };
                  },
                };

                const outcome = await runCiFix(
                  entry,
                  branch,
                  hint,
                  {
                    fixRunner: {
                      run: (opts) => productionCiFixRunner.run({ ...opts, dispatcher: ciFixDispatcher }),
                    },
                    suiteCommand: config?.mergeable_autoresolve?.suiteCommand,
                  },
                  log,
                );

                log(`[ci-fix] outcome for ${entry.prUrl}: ${outcome.kind}`);
                if (outcome.kind === 'changed') {
                  return { kind: 'green-verified' };
                }
                return;
              } catch (err: any) {
                log(
                  `[ci-fix] error resolving ${entry.prUrl} [${classifyFixError(err)}]: ${err?.message || err}`,
                );
                return;
              }
            },
          },
        });
      },
      // Task T28: check for pending restart marker at idle boundary.
      hasRestartPending: async () => {
        const intent = await readRestartPending(projectRoot);
        return intent !== null;
      },
      // Task T28: trigger self-restart when marker is pending (injected from supervisor/bare-run).
      triggerSelfRestart: opts.triggerSelfRestart,
      // Task T30: consume restart marker in bare-run mode (when triggerSelfRestart absent).
      consumeRestartPending: async () => {
        return await consumeOnBoot(projectRoot);
      },
      // TS-2: repo-root vanished self-termination
      repoRootMissing: () => (existsSync(projectRoot) ? null : projectRoot),
      // Task 4: per-sweep ownership check — stop dispatch if pidfile was overwritten
      lockOwnershipLost: async () => !(await ownsLock(projectRoot, lock.uuid)),
      // #561: SIGTERM requests a drain via the teardown controller instead of
      // force-exiting; runDaemon polls this at the top of its loop and stops
      // with 'signal_teardown' once true.
      shouldStop: () => teardown.shouldStop(),
    },
    {
      concurrency: clampDaemonConcurrency(opts.concurrency, log),
      maxItems: opts.maxItems,
      maxTotalCostTokens: opts.maxCostTokens,
      maxRuntimeMs:
        opts.maxRuntimeSeconds != null ? opts.maxRuntimeSeconds * 1000 : undefined,
      once: !continuous,
      idlePollMs:
        opts.idlePollSeconds != null ? opts.idlePollSeconds * 1000 : undefined,
      maxIdlePolls: opts.maxIdlePolls,
      // Task 12: wire stale-engine detection gate inputs
      isSelfHost,
      autoRestartOnStaleEngine: config?.auto_restart_on_stale_engine ?? false,
    },
  );

  subscriber.stop();
  log(`finished: ${result.processed.length} feature(s) (${result.stoppedReason})`);
  for (const o of result.processed) {
    log(
      `  ${o.slug}: ${o.status}${o.prUrl ? ` ${o.prUrl}` : ''}${o.reason ? ` — ${o.reason}` : ''}`,
    );
  }

  // Normal completion: drop the crash backstop, restore the console tee,
  // flush+close the log, and release the lock asynchronously.
  // #561: cancel the teardown's force-release timer first — the drain (or
  // ordinary completion) is finishing on its own, so the bounded backstop
  // must not fire after the lock is already released below.
  const teardownWasRequested = teardown.shouldStop();
  teardown.cancel();
  process.off('exit', releaseBackstop);
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  await logSink.close();
  await lock.release();
  // #561 (Story 1): only force a clean process exit when this completion was
  // driven by a SIGTERM-requested drain — ordinary (non-signal) completion
  // keeps today's return-and-let-the-event-loop-drain behavior.
  if (teardownWasRequested) {
    (opts.exitProcess ?? process.exit)(0);
  }
}

/**
 * Render the meaningful inner-loop events to the daemon console. Keeps the
 * signal high: step boundaries, failures/retries, unsatisfied gates, kickbacks,
 * halts/convergence, and rate limits — not the full event firehose.
 */
export function renderDaemonEvent(event: ConductorEvent, log: (msg: string) => void): void {
  // Colors mirror the TTY dashboard palette (ui/dashboard-text.ts): green ✓,
  // cyan ▶, red ✗, yellow warnings, dim chrome. chalk auto-disables under
  // NO_COLOR / non-TTY, so piped or redirected daemon logs stay plain text.
  //
  // Task 11: a throwing renderer must never crash the daemon run — the whole
  // switch is wrapped defensively so a malformed/unexpected event payload
  // (e.g. from a future event kind whose formatter assumes a field that
  // isn't there) degrades to a dropped line, not a process crash.
  try {
    renderDaemonEventUnsafe(event, log);
  } catch {
    // Best-effort: rendering a daemon.log line must never disrupt the run.
  }
}

function renderDaemonEventUnsafe(event: ConductorEvent, log: (msg: string) => void): void {
  const dot = chalk.dim('·');
  switch (event.type) {
    case 'step_started':
      log(`${dot} ${chalk.cyan('▶')} ${event.step}`);
      break;
    case 'step_completed':
      log(`${dot}   ${event.step} ${chalk.green('✓')} ${chalk.green(event.status)}`);
      break;
    case 'step_failed':
      log(
        `${dot} ${chalk.red('✗')} ${chalk.red(`${event.step} failed (try ${event.retryCount}): ${event.error}`)}`,
      );
      break;
    case 'step_retry': {
      const delta = formatProgressDelta(event.resolvedBefore, event.resolvedAfter);
      const deltaFragment = delta ? ' ' + delta : '';
      log(`${dot} ${chalk.yellow('↻')} ${event.step} retry (try ${event.attempt}/${event.maxAttempts}: ${formatRetryReason(event.reason)})${deltaFragment}`);
      break;
    }
    case 'gate_verdict':
      if (!event.satisfied) {
        log(
          `${dot} ${chalk.yellow(`gate ${event.step}: unsatisfied`)}${event.reason ? chalk.dim(` — ${event.reason}`) : ''}`,
        );
      }
      break;
    case 'kickback':
      log(
        `${chalk.bold.yellow(`↩ KICKBACK: ${event.from} re-opened ${event.to}${event.evidence ? ` — ${event.evidence}` : ''}`)} (×${event.count})`,
      );
      break;
    case 'navigation_back':
      log(chalk.yellow(`↰ BACK: ${event.from} → ${event.to} (operator)`));
      break;
    case 'loop_halt':
      log(`${dot} ${chalk.red('✋')} ${chalk.red(`loop halted: ${event.reason}`)}`);
      break;
    case 'loop_converged':
      log(`${dot} ${chalk.green('✓')} ${chalk.green('gate loop converged')}`);
      break;
    case 'ci_failed':
      log(
        `${dot} ${chalk.red('✋')} ${chalk.red(`ci_failed[${event.slug}]: phase=${event.phase} attempts=${event.attempts} checks=[${event.checks.join(',')}]`)}`,
      );
      break;
    case 'rate_limit':
      log(`${dot} ${chalk.yellow('⏳')} ${chalk.yellow(`rate limited: waiting ${event.waitSeconds}s`)}`);
      break;
    case 'session_reset':
      log(`${dot} ${chalk.dim(`session reset: ${event.reason}`)}`);
      break;
    case 'build_progress': {
      // Plain heartbeat line (adr-2026-07-10-intra-step-build-progress-events):
      // step, N/total, current task, feature slug. No warning coloring —
      // this is routine progress, kept visually distinct from no_progress/stall.
      const task = event.currentTaskName
        ? ` — ${event.currentTaskName}`
        : event.currentTaskId
          ? ` — task ${event.currentTaskId}`
          : '';
      const slug = event.featureSlug ? ` · ${event.featureSlug}` : '';
      const position = displayBuildPosition(event.resolved, event.total, Boolean(event.currentTaskId || event.currentTaskName));
      log(`${dot} ${chalk.cyan('▶')} ${event.step} ${position}/${event.total}${task}${slug}`);
      break;
    }
    case 'build_no_progress': {
      // Warning line: distinct glyph + yellow coloring so it stands out from
      // the plain build_progress heartbeat above during a quiet episode.
      const slug = event.featureSlug ? ` · ${event.featureSlug}` : '';
      const position = displayBuildPosition(event.resolved, event.total, Boolean(event.currentTaskId));
      log(
        `${dot} ${chalk.yellow('⚠')} ${chalk.yellow(`${event.step} quiet ${event.quietMinutes}m (${position}/${event.total})`)}${slug}`,
      );
      break;
    }
    case 'build_stall':
      log(
        `${dot} ${chalk.red('✋')} ${chalk.red(`${event.step} stall: ${event.reason} (${event.resolvedBefore} → ${event.resolvedAfter})`)}`,
      );
      break;
    case 'auto_park_contradiction': {
      // Loud refusal line (#612): a would-be `empty/missing plan` auto-park
      // was refused because the run's own evidence disagrees — surface the
      // slug, verdict, and the disagreeing evidence counts unmissably.
      const { summaryTasksCompleted, evidenceStamps, resolvedTasks } = event.evidence;
      log(
        `${dot} ${chalk.red('✋')} ${chalk.red(
          `auto_park_contradiction[${event.slug}]: refused verdict="${event.verdict}" — evidence: summaryTasksCompleted=${summaryTasksCompleted} evidenceStamps=${evidenceStamps} resolvedTasks=${resolvedTasks}`,
        )}`,
      );
      break;
    }
    default:
      break;
  }
}
