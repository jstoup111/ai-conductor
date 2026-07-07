import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { closeIssueOnImplementationMerge } from './engine/engineer/issue-ref.js';
import { rehabilitateHaltPr } from './engine/halt-pr-rehabilitation.js';
import { isEligibleForResolve, resolveConflictingPr } from './engine/autoresolve.js';
import { resolveRebaseResolutionAttempts } from './engine/resolved-config.js';
import type { LLMProvider } from './execution/llm-provider.js';
import { PluginRegistry } from './engine/plugin-registry.js';
import { registerBuiltins } from './engine/plugin-loader.js';
import { ConductorEventEmitter } from './ui/events.js';
import { DefaultStepRunner } from './engine/step-runners.js';
import { ensureInstallFresh } from './engine/install-freshness.js';
import { Conductor } from './engine/conductor.js';
import { classifySelfHost, defaultSelfHostDetector } from './engine/self-host/detector.js';
import { loadConfig, resolveMemoryProvider } from './engine/config.js';
import { holdLock } from './engine/daemon-lock.js';
import {
  openDaemonLog,
  formatDaemonLogLine,
  type DaemonLogSink,
} from './engine/daemon-log.js';
import type { ConductState, ConductorEvent, StepName } from './types/index.js';
import { runDaemon, type BacklogItem } from './engine/daemon.js';
import { discoverBacklog, fastForwardRoot, gitTreeSource, type DiscoveryLogger } from './engine/daemon-backlog.js';
import { makeIsProcessed } from './engine/shipped-record.js';
import { localWorkSource, type WorkSource } from './engine/daemon-work-source.js';
import { type GhRunner } from './engine/owner-gate/identity.js';
import { makeMachineOwnerResolver } from './engine/owner-gate/machine-identity.js';
import { readSpecOwnerStamp } from './engine/owner-gate/provenance.js';
import { firstAppearanceTime } from './engine/owner-gate/merge-time.js';
import { clampDaemonConcurrency } from './engine/daemon-command.js';
import { makeRunFeature, type FeatureWorktree } from './engine/daemon-runner.js';
import { createBlockerResolver } from './engine/blocker-resolver.js';
import { createGhBlockerRunner } from './engine/gh-blocker-runner.js';
import { resolveSpecPrUrl } from './engine/pr-labels.js';
import { captureEngineIdentity, createStaleEngineChecker } from './engine/engine-identity.js';
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
import { isOperatorParked } from './engine/park-marker.js';
import { listOperatorParkedSlugs, getProvenanceType } from './engine/park-marker.js';
import { readState, writeState, getStepStatus } from './engine/state.js';
import { makeGitRunner, originDefaultBranch, type RebaseResolver } from './engine/rebase.js';
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
import { reconcileHaltPrs } from './engine/halt-pr-reconciliation.js';
import { createPriorityResolver, ghIssueLabelReader } from './engine/backlog-priority.js';
import { isPaused } from './engine/pause-marker.js';
import { readRestartPending, consumeOnBoot, type RestartIntent } from './engine/restart-marker.js';
import { create as createRateLimitEpisode } from './engine/rate-limit-episode.js';

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

/**
 * RestartRequester is the injected dependency for restart sequence execution.
 * Called when a stale engine is detected in the idle branch (Task 14+).
 * Implements: write marker → release lock → exit(0).
 * On error, the catch block ensures lock release + exit(1).
 */
export type RestartRequester = (opts: {
  fromIdentity: string | null;
  targetIdentity: string | null;
}) => Promise<void>;

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
 * Task 14: Create a RestartRequester that implements the restart sequence:
 * 1. Write a restart marker with identity metadata
 * 2. Release the lock
 * 3. Exit with code 0
 *
 * On error during marker write, a catch block ensures the lock is released and exit(1) is called.
 *
 * @param daemonDir - project root directory
 * @param log - logging function
 * @param lock - lock object with releaseSync method
 * @param process - Node process object (injected for testability)
 * @returns RestartRequester function
 */
export function createRestartRequester(
  daemonDir: string,
  log: (msg: string) => void,
  lock: { releaseSync(): void },
  process: NodeJS.Process,
): RestartRequester {
  return async (opts: { fromIdentity: string | null; targetIdentity: string | null }) => {
    try {
      // Step 1: Write marker (can fail)
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
      lock.releaseSync();
      process.exit(1);
      return; // Never reached in production, but clarifies intent
    }

    // Step 2: Release lock (marker write succeeded)
    lock.releaseSync();

    // Step 3: Exit with 0 (marker and lock release succeeded)
    process.exit(0);
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
  const { projectRoot } = opts;
  // Backstop for every daemon launch path: refuse to run on a stale harness
  // install (missing/stale skill symlinks) — non-interactively, so it throws an
  // actionable error rather than silently dispatching unregistered skills (which
  // surfaces as a cryptic "no parseable result" HALT). The interactive prompt to
  // self-heal lives at `daemon start`.
  const ensureFresh = opts.ensureFresh ?? (() => ensureInstallFresh({ interactive: false }));
  await ensureFresh();
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

  // Task 16: Transition-only per-slug status logging + resume line
  // Track the last status for each slug so we only emit log lines when status changes
  const lastStatus = new Map<string, string>();

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

  // ADR-010: claim the 1-per-repo pidfile so this daemon's liveness is observable
  // (the pidfile under .daemon/ holds our pid) and a second daemon for the same repo
  // refuses to start. A live owner → exit now; we release the lock on completion below.
  const lock = await holdLock(projectRoot);
  if (lock === null) {
    log(`another daemon is already running for ${projectRoot}; exiting (1-per-repo).`);
    return;
  }
  // We own the repo: open the activity log and start teeing. renderDaemonEvent and
  // every feature start/finish line already route through `log`, so this single tee
  // captures the full BUILD-phase narrative (per-step results, shipped/failed + PR).
  logSink = await openDaemonLog(projectRoot);
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

  // Task 22: Process-level SIGTERM handler for daemon mode. Track all in-flight
  // rate-limit waits across N concurrent conductors so a single process-level
  // handler can abort them all and coordinate state saves before exit.
  // Conductors running in daemon mode (daemon:true) will register their
  // AbortControllers here instead of installing per-conductor handlers.
  const allWaitSignals = new Set<AbortController>();

  // Task 22: Install ONE process-level SIGTERM handler (not N per-conductor).
  // When SIGTERM fires, abort all in-flight waits and coordinate state saves.
  const daemonSigtermHandler = async () => {
    // Abort all in-flight rate-limit waits across all conductors
    for (const controller of allWaitSignals) {
      controller.abort();
    }
    // Note: State saves are handled by individual conductors' exit handlers.
    // The daemon-cli process cleanup (releaseBackstop) will flush logs + release lock.
    process.exit(1);
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

  // Task 8: Capture engine identity at startup and log ARMED/DISARMED status
  const engineEntryPath = engineEntryPathForRepo(projectRoot);
  const engineIdentity = await captureEngineIdentity(engineEntryPath);
  if (engineIdentity) {
    log(`daemon identity: ${engineIdentity}`);
  }
  // Production stale-engine checker (adr-2026-07-03-daemon-auto-restart-stale-engine §1-2):
  // capture failure ⇒ permanently disabled checker (always 'current', warns once).
  const staleEngineChecker =
    engineIdentity !== null
      ? createStaleEngineChecker(engineIdentity, engineEntryPath, log)
      : createStaleEngineChecker(null, log);
  const isArmed = (config?.auto_restart_on_stale_engine ?? false) && isSelfHost;
  log(`${isArmed ? 'ARMED' : 'DISARMED'} — stale-engine auto-restart`);

  // Task 9: Startup handshake — check for restart marker and log if present
  // If engineIdentity is null, the check was disabled (capture failed), so skip handshake.
  if (engineIdentity !== null) {
    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    if (markerStatus.kind === 'present') {
      const marker = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${marker.fromIdentity} to ${marker.targetIdentity}, fresh ${engineIdentity}`,
      );

      // Task 10: Suppression — record when fresh identity differs from target
      // (non-convergence at boot). This prevents restart loops when the engine
      // identity hasn't reached the target yet.
      if (engineIdentity !== marker.targetIdentity) {
        log(
          `suppressing restart loop — target was ${marker.targetIdentity}, now ${engineIdentity}`,
        );
        await recordSuppression(engineIdentity, projectRoot, log);
      }

      await clearRestartMarker(projectRoot);
    }
    // If absent or absent-corrupt: no handshake log.
    // Task 6 (readRestartMarkerWithStatus) already logs + removes corrupt markers.
  }

  // One shared provider + event bus across workers (rate limits are shared).
  const events = new ConductorEventEmitter();
  const rateLimitEpisode = createRateLimitEpisode();
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
      log,
    });
    if (resume === 'halted') return; // re-parked: HALT re-written, do not resume the gate

    await conductor.run();

    // Link & close the originating issue (intake specs only): once the
    // implementation PR exists, add `Closes owner/repo#N` to its body so GitHub
    // auto-closes the issue when the PR merges to the default branch. Best-effort
    // and idempotent — a gh failure or a halted build (no pr_url) never affects
    // the feature outcome.
    const finalState = await readState(stateFilePath);
    const ghRunner = async (args: string[], opts: { cwd: string }) => {
      const r = await execFile('gh', args, { cwd: opts.cwd });
      return { stdout: String(r.stdout) };
    };
    await closeIssueOnImplementationMerge({
      gh: ghRunner,
      sourceRef: item.sourceRef,
      prUrl: finalState.ok ? finalState.value.pr_url : undefined,
      cwd: wt.path,
      slug: item.slug,
      log,
    });

    // Halt-PR rehabilitation (adr-2026-07-03-halt-pr-rehabilitation-at-finish):
    // if the recorded PR was born as a needs-remediation halt PR, flip it ready,
    // clear the label, and ensure the Closes ref — warn-only, never affects the
    // feature outcome.
    const finalPrUrl = finalState.ok ? finalState.value.pr_url : undefined;
    if (finalPrUrl) {
      const outcome = await rehabilitateHaltPr({
        gh: ghRunner,
        cwd: wt.path,
        prUrl: finalPrUrl,
        sourceRef: item.sourceRef,
        log,
      });
      if (outcome !== 'not-halt-pr') {
        log(`[${item.slug}] halt-pr rehabilitation: ${outcome} (${finalPrUrl})`);
      }
    }
  };

  const deps = makeFeatureRunnerDeps({
    projectRoot,
    worktreeBase,
    baseBranch,
    runConductorInWorktree,
    provider,
    memoryProvider,
    log,
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
  const ownerGh: GhRunner = async (args, o) => {
    const { stdout } = await execFile('gh', args, { cwd: o.cwd });
    return { stdout: String(stdout) };
  };
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
  const gatedWritebackDeps = { cwd: projectRoot, log };
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
      makeResolver: () => createBlockerResolver({ run: createGhBlockerRunner() }),
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

  // Task 14: Create the real restart requester with injected lock + process
  const requestRestart = createRestartRequester(projectRoot, log, lock, process);

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
      // FR-1 (Task 11): gate dispatch on the durable `.daemon/PAUSED` marker,
      // re-polled every loop iteration by runDaemon so a pause lifted mid-run
      // resumes dispatch at the next boundary (no restart required).
      isPaused: () => isPaused(projectRoot),
      rateLimitEpisode,
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
        log(`\n${renderDashboard({ ...state, parked })}`);
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
        await reconcileHaltPrs({ projectRoot, log });
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
                const ghRunner = async (args: string[]) => {
                  const result = await execFile('gh', args, {
                    cwd: entry.repoCwd,
                    encoding: 'utf-8',
                  });
                  return { stdout: result.stdout || '' };
                };

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

  // Normal completion: drop the crash backstop, flush+close the log, and release
  // the lock asynchronously.
  process.off('exit', releaseBackstop);
  await logSink.close();
  await lock.release();
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
    case 'step_retry':
      log(`${dot} ${chalk.yellow('↻')} ${event.step} ${chalk.yellow('retry')}`);
      break;
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
    case 'rate_limit':
      log(`${dot} ${chalk.yellow('⏳')} ${chalk.yellow(`rate limited: waiting ${event.waitSeconds}s`)}`);
      break;
    case 'session_reset':
      log(`${dot} ${chalk.dim(`session reset: ${event.reason}`)}`);
      break;
    default:
      break;
  }
}
