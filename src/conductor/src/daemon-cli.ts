import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import type { LLMProvider } from './execution/llm-provider.js';
import { PluginRegistry } from './engine/plugin-registry.js';
import { registerBuiltins } from './engine/plugin-loader.js';
import { ConductorEventEmitter } from './ui/events.js';
import { DefaultStepRunner } from './engine/step-runners.js';
import { Conductor } from './engine/conductor.js';
import { loadConfig, resolveMemoryProvider } from './engine/config.js';
import { holdLock } from './engine/daemon-lock.js';
import { openDaemonLog, type DaemonLogSink } from './engine/daemon-log.js';
import type { ConductState, ConductorEvent, StepName } from './types/index.js';
import { runDaemon, type BacklogItem } from './engine/daemon.js';
import { discoverBacklog, fastForwardRoot } from './engine/daemon-backlog.js';
import { makeRunFeature, type FeatureWorktree } from './engine/daemon-runner.js';
import {
  isHalted,
  isProcessed,
  hasWarned,
  markWarned,
  makeFeatureRunnerDeps,
} from './engine/daemon-deps.js';
import { readState, writeState, getStepStatus } from './engine/state.js';
import { makeGitRunner, originDefaultBranch } from './engine/rebase.js';
import {
  readBaseSha,
  readPersistedBaseSha,
  writePersistedBaseSha,
} from './engine/daemon-sha.js';
import { scanInheritedState, renderDashboard } from './engine/daemon-dashboard.js';
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
}

// Front-half steps the daemon treats as already done — the human authored the
// specs, so the loop starts at BUILD (acceptance_specs onward).
const PRESEEDED_DONE: StepName[] = [
  'worktree',
  'memory',
  'brainstorm',
  'complexity',
  'stories',
  'conflict_check',
  'plan',
  'architecture_diagram',
  'architecture_review',
];

// Strip ANSI SGR color codes (chalk, #88) so the persistent daemon.log is always
// plain text. In the real detached daemon (non-TTY) chalk is already disabled, so
// this is a no-op there; it only matters for a foreground/TTY `conduct daemon` run.
// eslint-disable-next-line no-control-regex -- ESC (\x1b) is intrinsic to ANSI SGR
const ANSI_SGR = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR, '');
}

/**
 * Daemon entry (Phase 6). Drains the backlog of features with existing
 * stories+plan, running each in its own worktree via the gate loop
 * (verifyArtifacts + freshContextPerStep), opening a PR on finish, and tearing
 * the worktree down on success. Unattended; ceilings + supervision live in
 * runDaemon / makeRunFeature.
 */
export async function runDaemonMode(opts: DaemonModeOptions): Promise<void> {
  const { projectRoot } = opts;
  // The local branch worktrees fork from and discovery reads. Resolve origin's
  // real default (main/master/trunk) rather than hardcoding 'main'; the daemon
  // fast-forwards this branch on each idle poll (see fastForwardRoot).
  const baseBranch =
    opts.baseBranch ?? (await originDefaultBranch(makeGitRunner(projectRoot))) ?? 'main';
  // Tee every daemon log line to a file so a detached `stdio:'ignore'` launch is
  // still observable via `conduct daemon logs`. Console gets the colorized line
  // (#88); the file gets ANSI-stripped plain text so the persistent log never
  // carries escape codes — `daemon logs`/grep stay clean regardless of whether the
  // run had color on. The sink is opened once we own the repo (below); until then
  // `log` goes to the console only.
  let logSink: DaemonLogSink | null = null;
  const log = (msg: string) => {
    console.log(`${chalk.dim('[daemon]')} ${msg}`);
    logSink?.write(`[daemon] ${stripAnsi(msg)}`);
  };

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

  const configResult = await loadConfig(projectRoot);
  const config = configResult.ok ? configResult.config : undefined;

  // One shared provider + event bus across workers (rate limits are shared).
  const events = new ConductorEventEmitter();
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
  // same single provider (ADR-016 / FR-10). Uses a per-run ctx so warnings are
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
    // (freshContextPerStep), but sweeping here guarantees a clean start.
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
        : { complexity_tier: item.tier ?? 'M', feature_desc: item.slug };

    // Always stamp DECIDE steps as done regardless of whether this is a fresh
    // start or a resume — the human authored them and they never re-run.
    for (const name of PRESEEDED_DONE) {
      (baseState as Record<string, unknown>)[name] = 'done';
    }
    if (!baseState.complexity_tier) baseState.complexity_tier = item.tier ?? 'M';
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
      verifyArtifacts: true,
      freshContextPerStep: true,
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
    });

    // FR-12 (ADR-013): a re-kick dropped a `.pipeline/REKICK` sentinel. Integrate
    // the advanced base FIRST — run 9.0's rebase-onto-latest BEFORE the conductor
    // resumes the pending gate, so a gate halt (e.g. prd-audit) re-verifies on the
    // new base instead of the stale one. One-shot (sentinel consumed). A
    // re-conflict re-parks via 9.0's existing HALT path — skip `conductor.run()`.
    const ranManualTest = getStepStatus(baseState, 'manual_test') !== 'skipped';
    const resume = await resumeRebaseFirst({
      worktreePath: wt.path,
      localBase: baseBranch,
      events,
      ranManualTest,
      log,
    });
    if (resume === 'halted') return; // re-parked: HALT re-written, do not resume the gate

    await conductor.run();
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
  const discoverTick = async ({ refresh }: { refresh: boolean }): Promise<BacklogItem[]> => {
    if (refresh) await fastForwardRoot(projectRoot, log);
    return discoverBacklog(projectRoot, (slug) => isProcessed(projectRoot, slug), log, {
      baseBranch,
      // Surface a merged-but-unbuildable spec ONCE (per .daemon/warned/<slug>)
      // instead of re-logging the identical skip on every poll.
      hasWarned: (slug) => hasWarned(projectRoot, slug),
      markWarned: (slug) => markWarned(projectRoot, slug),
    });
  };

  const processedDir = join(projectRoot, '.daemon/processed');

  // ADR-013 re-kick sweep: per-feature last-rekick SHA (FR-9) persists across the
  // startup + live sweeps of ONE run. Real fs/git primitives; clearing a marker
  // is the ONLY side effect — re-dispatch flows through PR #109's un-park path.
  const lastRekickSha = new Map<string, string>();
  const rekickDeps: RekickSweepDeps = {
    listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
    readHaltReason: (slug) => readHaltReason(worktreeBase, slug),
    hasRebaseInProgress: (slug) => hasRebaseInProgress(join(worktreeBase, slug)),
    abortRebase: (slug) => abortRebase(join(worktreeBase, slug)),
    clearMarker: (slug) => clearMarker(join(worktreeBase, slug)),
    lastRekickSha,
    log,
  };

  const result = await runDaemon(
    {
      discoverBacklog: discoverTick,
      isHalted: (slug) => isHalted(worktreeBase, slug),
      runFeature,
      log,
      // ── Halt-reconciliation (ADR-013) real-I/O hooks ──────────────────────
      // FR-1: scan inherited state and render the dashboard to both sinks
      // (console + daemon.log via `log`) before any dispatch.
      renderStartupDashboard: async () => {
        const state = await scanInheritedState({
          worktreeBase,
          processedDir,
          discover: () => discoverTick({ refresh: true }),
          log,
        });
        log(`\n${renderDashboard(state)}`);
      },
      // FR-4: resolve the base-branch tip SHA from the SAME local default branch
      // the backlog reads. On idle refresh we fast-forward it first so the SHA
      // reflects origin's latest (driving ADR-013 re-kick when main advances).
      resolveBaseSha: async ({ refresh }) => {
        if (refresh) await fastForwardRoot(projectRoot, log);
        return readBaseSha(makeGitRunner(projectRoot), baseBranch);
      },
      readPersistedBaseSha: () => readPersistedBaseSha(projectRoot),
      writePersistedBaseSha: (sha) => writePersistedBaseSha(projectRoot, sha, log),
      rekickSweep: async (sha) => {
        await rekickSweep(rekickDeps, sha);
      },
    },
    {
      concurrency: opts.concurrency,
      maxItems: opts.maxItems,
      maxTotalCostTokens: opts.maxCostTokens,
      maxRuntimeMs:
        opts.maxRuntimeSeconds != null ? opts.maxRuntimeSeconds * 1000 : undefined,
      once: !continuous,
      idlePollMs:
        opts.idlePollSeconds != null ? opts.idlePollSeconds * 1000 : undefined,
      maxIdlePolls: opts.maxIdlePolls,
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
        `${dot} ${chalk.yellow('↩')} kickback: ${event.from} re-opened ${event.to}${event.evidence ? ` — ${event.evidence}` : ''} ${chalk.dim(`(×${event.count})`)}`,
      );
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
