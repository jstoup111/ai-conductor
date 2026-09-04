import { execa } from 'execa';
import { mkdir, writeFile, readFile, access, stat } from 'node:fs/promises';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { HALT_MARKER } from './halt-marker.js';
import { supersedeHaltRecord } from './halt-record.js';
import type { BacklogItem } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import type { ProviderExecutionContext } from './provider-execution.js';
import type {
  FeatureRunScope,
  FeatureRunnerDeps,
  FeatureWorktree,
  WorktreeOutcome,
} from './daemon-runner.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import { prepareWorktree, runProjectTeardown } from './worktree-prepare.js';
import { makeProductionGh } from './pr-labels.js';
import { ensureWorktree } from './worktree-shared.js';
import { WorktreeLifecycleQueue } from './worktree.js';
import { FINISH_CHOICE_MARKER, FINISH_CHOICE_VALUES } from './artifacts.js';
import { escalateBuildFailure } from './build-failure-escalation.js';
import { makeGitRunner } from './rebase.js';
import { surfaceQuarantine } from './setup-triage.js';
import type { WorkOrder } from './work-order.js';
import type { SetupFailureError } from './worktree-prepare.js';
import type { TriageOutcome } from './setup-triage.js';
import type { OperatorParkedTermination } from './conductor.js';
import type { WorkClaims } from './work-claims.js';

/** Read-only liveness view of the daemon's active work-claim registry. */
export type IsWorkClaimActive = (slug: string) => boolean;

/**
 * Keep every maintenance boundary on the daemon's one active-work authority.
 * A claim is intentionally process-local: after a restart, durable worktree
 * state drives re-dispatch as before.
 */
export function makeWorkClaimLivenessPredicate(claims: WorkClaims): IsWorkClaimActive {
  return (slug) => claims.list().includes(slug);
}

/**
 * Turns active-claim liveness into a worktree-removal decision. The refusal is
 * deliberately loud and stable so `daemon logs` can identify why a terminal
 * worktree was retained for the running executor.
 */
export function makeWorktreeRemovalPredicate(
  isWorkClaimActive: IsWorkClaimActive,
  log: (message: string) => void,
): (slug: string) => boolean {
  return (slug) => {
    if (!isWorkClaimActive(slug)) return true;
    log(`[daemon] worktree removal refused ${slug} — reason: active work claim`);
    return false;
  };
}

export interface RealDepsConfig {
  /** The main checkout the daemon runs from. */
  projectRoot: string;
  /** Directory under which per-feature worktrees are created. */
  worktreeBase: string;
  /** Branch the worktrees fork from (e.g. 'main'). */
  baseBranch: string;
  /** Run the gate loop in a worktree to DONE/HALT (assembled by the CLI). */
  runConductorInWorktree: (
    worktree: FeatureWorktree,
    item: BacklogItem,
    providerExecution?: ProviderExecutionContext,
    featureEvents?: ConductorEventEmitter,
    log?: (message: string) => void,
    sessionId?: string,
  ) => Promise<void | OperatorParkedTermination>;
  /** Legacy narrative provider when provider-aware feature execution is absent. */
  provider?: LLMProvider;
  providerExecution?: () => ProviderExecutionContext;
  beginFeatureRun?: (
    worktree: FeatureWorktree,
    item: BacklogItem,
  ) => FeatureRunScope | Promise<FeatureRunScope>;
  /**
   * The resolved active memory provider for this run (adr-2026-06-29-per-project-memory-provider-selection). Computed at
   * run start by `resolveMemoryProvider` and carried on context so every
   * memory-using step sees the same single active provider (FR-10).
   */
  memoryProvider?: unknown;
  log?: (msg: string) => void;
  /**
   * Echo `bin/setup`'s full output into the log on success (`daemon_verbose`).
   * Default false: a one-line summary instead. Failure output is unaffected.
   */
  verbose?: boolean;
  /** Resolved bounded runtime for the project teardown hook. */
  teardownTimeoutSeconds?: number;
  /** Resolved bounded runtime for the project dispatch-start hook. */
  dispatchStartTimeoutSeconds?: number;
  /** Deterministic setup-failure triage (adr-2026-07-09-setup-failure-triage), daemon-only. */
  runSetupTriage?: (
    error: SetupFailureError,
    worktree: FeatureWorktree,
    item: BacklogItem,
    providerExecution?: ProviderExecutionContext,
    log?: (message: string) => void,
    events?: ConductorEventEmitter,
  ) => Promise<TriageOutcome>;
}

/**
 * Daemon adapter surface that accepts a dispatcher-built order when one is
 * available. It remains assignable to FeatureRunnerDeps during the seam
 * migration, whose runner still supplies only a slug.
 */
export interface DaemonFeatureRunnerDeps extends FeatureRunnerDeps {
  createWorktree: (slug: string, order?: WorkOrder) => Promise<FeatureWorktree>;
}

const PROCESSED_SUBDIR = '.daemon/processed';
const WARNED_SUBDIR = '.daemon/warned';

/** Concrete (git/fs) implementation of the feature-runner primitives. */
export function makeFeatureRunnerDeps(cfg: RealDepsConfig): DaemonFeatureRunnerDeps {
  const processedDir = join(cfg.projectRoot, PROCESSED_SUBDIR);
  // The dispatcher owns this queue for its lifetime. All linked worktree
  // add/remove operations share cfg.projectRoot's `.git` bookkeeping.
  const worktreeLifecycle = new WorktreeLifecycleQueue();

  return {
    log: cfg.log,
    // The real daemon path always emits to the engineer store on completion
    // (Phase 9.1). Manual `/conduct` runs don't go through makeFeatureRunnerDeps.
    daemon: true,
    provider: cfg.provider,
    providerExecution: cfg.providerExecution,
    beginFeatureRun: cfg.beginFeatureRun,
    // Thread the resolved active memory provider onto run context (adr-2026-06-29-per-project-memory-provider-selection/FR-10).
    memoryProvider: cfg.memoryProvider,
    // Project key for the engineer store = the main checkout's basename (NOT the
    // worktree path, which is always `<projectRoot>/.worktrees/<slug>`).
    project: basename(cfg.projectRoot),
    // FR-9: the MAIN checkout path — the watch registry lives here, and gh ops
    // are issued from here after the worktree is torn down on ship.
    projectRoot: cfg.projectRoot,
    // FR-16: production gh runner for clear-on-success label ops.
    runGh: makeProductionGh(),

    createWorktree: async (slug, order?: WorkOrder) => worktreeLifecycle.run(async () => {
      const branch = `feat/daemon-${slug}`;
      const path = join(cfg.worktreeBase, slug);
      const root = cfg.projectRoot;
      // Idempotent create/reconcile via the shared worktree mechanism (parity with
      // the engineer). The base ref is resolved lazily — only when a fresh branch is
      // cut — so the reuse/attach paths issue no extra git call.
      const { path: p, branch: b } = await ensureWorktree({
        root,
        path,
        branch,
        resolveBase: async () => {
          const baseSha = order?.baseSha ?? await resolveWorktreeBase(root, cfg.baseBranch);
          cfg.log?.(`[daemon] work claim ${slug} pinned base ${baseSha}`);
          return baseSha;
        },
        log: cfg.log,
      });
      return { path: p, branch: b };
    }),

    // Write WORKTREE_NAMESPACE into the worktree .env and run the project's
    // bin/setup (no-op if absent). Keeps the daemon stack-agnostic while letting
    // each project translate the namespace into its own shared/namespaced infra.
    prepareWorktree: async (wt, log, events, order) => {
      const baseSha = order?.baseSha ?? await resolveDaemonBaseSha(cfg.projectRoot, cfg.baseBranch);
      await prepareWorktree(wt.path, log ?? cfg.log, {
        verbose: cfg.verbose ?? false,
        baseSha,
        events,
        dispatchStart: true,
        dispatchStartTimeoutSeconds: cfg.dispatchStartTimeoutSeconds,
      });
    },

    runConductor: (wt, item, providerExecution, featureEvents, log, sessionId) =>
      cfg.runConductorInWorktree(wt, item, providerExecution, featureEvents, log, sessionId),

    readOutcome: (wt) => readWorktreeOutcome(wt.path),

    teardownWorktree: async (wt, keep) => {
      if (keep) return; // halt/error → leave it for the human
      await runProjectTeardown(wt.path, cfg.log, {
        verbose: cfg.verbose ?? false,
        timeoutSeconds: cfg.teardownTimeoutSeconds,
      });
      await worktreeLifecycle.run(async () => {
        await execa('git', ['worktree', 'remove', '--force', wt.path], {
          cwd: cfg.projectRoot,
        }).catch(() => {
          /* best-effort cleanup */
        });
      });
    },

    markProcessed: async (slug, prUrl) => {
      await mkdir(processedDir, { recursive: true });
      // Persist as JSON so the startup dashboard can surface the shipped PR link.
      // Legacy ledgers held the plain text `shipped`; readProcessedEntries still
      // parses those (no PR), so this is backward-compatible.
      await writeFile(
        join(processedDir, slug),
        `${JSON.stringify({ status: 'shipped', prUrl: prUrl ?? null })}\n`,
        'utf-8',
      );
    },

    // NOTE (#204/#205, as-built review): the shipped record is NOT written
    // here. Per adr-2026-07-03-committed-shipped-record-dispatch-dedup
    // Decision 1, `/finish` commits `.docs/shipped/<slug>.md` on the
    // IMPLEMENTATION branch (via `conduct shipped-record`) before the final
    // push, so the human merge lands code + shipped-fact atomically. A
    // daemon-side write here would land on the main checkout's base branch —
    // never pushed, and it permanently breaks fastForwardRoot's --ff-only
    // advance once local main is ahead of origin.

    // Escalate a false-ship outcome by pushing the worktree branch and opening a
    // draft needs-remediation PR. Called when an outcome converges DONE but fails
    // the ship-eligibility guard. Best-effort: push failure resolves to {} (FR-7
    // degradation), never throws (non-throwing contract).
    escalateBuildFailure: async (opts) => {
      return escalateBuildFailure({
        projectRoot: opts.projectRoot,
        failureReason: opts.failureReason,
        log: opts.log ?? cfg.log,
      });
    },

    // Task 15: Thread the setup-triage handler when present (daemon mode only).
    // The handler uses git runner for worktree, prepareWorktree for retry,
    // and fix-session dispatcher constructing fresh DefaultStepRunner per dispatch.
    runSetupTriage: cfg.runSetupTriage,

    // Task 14 (TS-5): surface quarantine evidence to the resuming build agent.
    // Rooted at the feature's own worktree (not the main checkout) so
    // `rev-parse --verify wip/setup-quarantine-<slug>` sees that worktree's refs.
    surfaceQuarantineRef: (wt, slug, outcome, log) =>
      surfaceQuarantine(makeGitRunner(wt.path), wt.path, slug, outcome, { log: log ?? cfg.log ?? (() => {}) }),
  };
}

/**
 * The SHA a fresh feature worktree forks from. Prefer the remote-tracking
 * `origin/<baseBranch>` so the build starts from the latest *fetched* origin tip
 * rather than the LOCAL `<baseBranch>`, which can lag origin: `fastForwardRoot`
 * only advances local `<baseBranch>` while the root checkout is actually on it,
 * so whenever another process leaves the root on a different branch (or detached
 * HEAD), local `<baseBranch>` goes stale and worktrees cut from it would build
 * against old code.
 *
 * Falls back to the local `<baseBranch>` when `origin/<baseBranch>` cannot be
 * resolved (local-only repo with no origin, or never fetched) — preserving the
 * prior behavior for those repos.
 */
async function resolveWorktreeBase(projectRoot: string, baseBranch: string): Promise<string> {
  const remote = `origin/${baseBranch}`;
  try {
    return (await execa('git', ['rev-parse', '--verify', '--quiet', remote], { cwd: projectRoot })).stdout.trim();
  } catch {
    return (await execa('git', ['rev-parse', '--verify', '--quiet', baseBranch], { cwd: projectRoot })).stdout.trim();
  }
}

/**
 * The base SHA the setup marker is keyed on
 * (adr-2026-08-26-setup-once-per-worktree-marker, decision 2).
 *
 * Every path that may write the marker resolves it HERE — the ordinary dispatch
 * prepare and setup-triage's forced verification runs alike. Two resolutions
 * that could drift would silently break the gate: a forced run stamping a
 * different base than the next dispatch computes reads as `base-moved` and
 * re-runs setup forever.
 *
 * `undefined` when the base cannot be resolved; `prepareWorktree` then writes no
 * marker at all, leaving the gate fail-closed.
 */
export async function resolveDaemonBaseSha(
  projectRoot: string,
  baseBranch: string,
): Promise<string | undefined> {
  try {
    const base = await resolveWorktreeBase(projectRoot, baseBranch);
    return (await execa('git', ['rev-parse', '--verify', base], { cwd: projectRoot })).stdout.trim();
  } catch {
    // Missing base evidence deliberately leaves the marker gate fail-closed.
    return undefined;
  }
}

/** Has this slug already been shipped by the daemon? (for discoverBacklog). */
export async function isProcessed(projectRoot: string, slug: string): Promise<boolean> {
  try {
    await access(join(projectRoot, PROCESSED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}

/**
 * Cache repair (ADR Decisions 2b/2c): a discovery skip driven by a base-branch
 * shipped record writes the missing `.daemon/processed/<slug>` marker so later
 * polls take the ledger fast path instead of re-reading shipped records. Uses
 * the same JSON shape `markProcessed` writes; a malformed record still repairs
 * (the stem match alone proved the ship) with a null prUrl. Callers treat
 * failures as best-effort — discoverBacklog already catches and logs.
 */
export async function repairProcessed(
  projectRoot: string,
  slug: string,
  record: { pr?: string } | { malformed: true },
): Promise<void> {
  const processedDir = join(projectRoot, PROCESSED_SUBDIR);
  await mkdir(processedDir, { recursive: true });
  const prUrl = 'malformed' in record ? null : (record.pr ?? null);
  await writeFile(
    join(processedDir, slug),
    `${JSON.stringify({ status: 'shipped', prUrl })}\n`,
    'utf-8',
  );
}

/**
 * Has this slug's "merged spec cannot build" skip already been surfaced once?
 * Mirrors `isProcessed` but for the `.daemon/warned/` markers — lets
 * `discoverBacklog` log a persistently-unbuildable merged spec exactly once
 * instead of on every poll tick.
 */
export async function hasWarned(projectRoot: string, slug: string): Promise<boolean> {
  try {
    await access(join(projectRoot, WARNED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}

/** Record that this slug's skip has been surfaced, suppressing repeat skip logs. */
export async function markWarned(projectRoot: string, slug: string): Promise<void> {
  const warnedDir = join(projectRoot, WARNED_SUBDIR);
  await mkdir(warnedDir, { recursive: true });
  await writeFile(join(warnedDir, slug), 'warned\n', 'utf-8');
}

/**
 * True while a halted feature's worktree HALT marker is still present — the
 * park-gate the daemon checks before re-dispatching (see daemon.ts `isHalted`).
 * A human clears `.pipeline/HALT` to make the feature re-eligible. Takes the
 * worktree base so it stays in lockstep with `createWorktree`'s path convention
 * (`<worktreeBase>/<slug>`), not a re-derived `.worktrees`.
 */
export async function isHalted(worktreeBase: string, slug: string): Promise<boolean> {
  return exists(join(worktreeBase, slug, HALT_MARKER));
}

/** Read the loop outcome from a worktree's `.pipeline` markers. */
export async function readWorktreeOutcome(worktreePath: string): Promise<WorktreeOutcome> {
  const done = await exists(join(worktreePath, '.pipeline/DONE'));
  const haltPath = join(worktreePath, HALT_MARKER);
  const halted = await exists(haltPath);

  let reason: string | undefined;
  if (halted) {
    reason = (await readFile(haltPath, 'utf-8').catch(() => '')).trim() || undefined;
  }

  let prUrl: string | undefined;
  try {
    const state = JSON.parse(
      await readFile(join(worktreePath, '.pipeline/conduct-state.json'), 'utf-8'),
    ) as { pr_url?: string };
    prUrl = state.pr_url;
  } catch {
    /* no state / no pr_url */
  }

  // Task 12 (#204, #205): read the finish skill's recorded outcome so the
  // ship-record write can be skipped for `discard`/`keep` — the gate-driven
  // loop converges (DONE) for every finish choice, so `done` alone can't
  // distinguish a real ship from "the operator chose not to ship."
  // Tolerant of a missing/malformed marker (undefined → treated as ship, the
  // pre-Task-12 default for `pr`/`merge-local`).
  let finishChoice: WorktreeOutcome['finishChoice'];
  try {
    const raw = (
      await readFile(join(worktreePath, FINISH_CHOICE_MARKER), 'utf-8')
    ).trim();
    if ((FINISH_CHOICE_VALUES as readonly string[]).includes(raw)) {
      finishChoice = raw as WorktreeOutcome['finishChoice'];
    }
  } catch {
    /* no marker — leave undefined */
  }

  return { done, halted, reason, prUrl, finishChoice };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Task 15: append a `halt_cleared` audit-trail record to the halted feature's
 * OWN worktree ledger (`<worktreePath>/.pipeline/audit-trail/events.jsonl`),
 * synchronously and best-effort. The worktree can legitimately be removed
 * between the fs-watcher's unlink event and this call (e.g. a fast
 * teardown race) — that must never crash the daemon process, so failures are
 * caught, logged loudly to stderr, and swallowed (never rethrown).
 */
async function appendHaltClearedRecord(worktreePath: string, cause: 'operator' | 'rekick'): Promise<void> {
  try {
    await supersedeHaltRecord(worktreePath, basename(worktreePath), cause);
  } catch {
    /* best-effort halt-record supersession */
  }

  try {
    const auditDir = join(worktreePath, '.pipeline', 'audit-trail');
    mkdirSync(auditDir, { recursive: true });
    const record = { event: 'halt_cleared', cause, at: Date.now() };
    appendFileSync(join(auditDir, 'events.jsonl'), `${JSON.stringify(record)}\n`, { flag: 'a' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[daemon] WRITE-FAILED: failed to append halt_cleared audit record ` +
        `(worktree=${worktreePath}, cause=${cause}): ${message}\n`,
    );
  }
}

/**
 * Watch a halted feature's worktree for HALT marker removal, calling `onCleared`
 * when the `.pipeline/HALT` file is deleted or renamed away.
 *
 * Uses chokidar to watch for filesystem events as the fast path, plus a
 * polling fallback (default HALT_CLEARED_POLL_INTERVAL_MS) that bounds
 * worst-case detection: fs event delivery is best-effort, so a clear that
 * lands before the watcher is ready — or an event the OS drops — is still
 * detected within one poll interval. On either path the marker is re-verified
 * gone before the callback fires, and the callback fires at most once.
 * Returns a dispose function that closes the watcher and stops the poll
 * (idempotent).
 *
 * Errors and missing directories are handled gracefully:
 * - If the worktree directory doesn't exist, returns a no-op dispose function
 * - Watcher errors are swallowed (best-effort monitoring)
 * - Calling dispose multiple times is safe
 *
 * Internal implementation. Use `makeWatchHaltClearedSeam` to create the
 * DaemonDeps-compatible seam.
 *
 * @param worktreeBase Directory under which per-feature worktrees live
 * @param slug Feature slug (worktree is at `<worktreeBase>/<slug>`)
 * @param onCleared Callback fired exactly once when HALT marker is confirmed gone
 * @returns Dispose function that closes the watcher
 */
export interface WatchHaltClearedOptions {
  /**
   * Interval for the polling fallback that guarantees a cleared HALT is
   * detected even when no filesystem event is delivered. Defaults to
   * HALT_CLEARED_POLL_INTERVAL_MS.
   */
  pollIntervalMs?: number;
}

/**
 * Default polling-fallback interval for `watchHaltCleared`. Filesystem events
 * remain the fast path; this bounds worst-case detection latency when an
 * event is dropped or the clear lands before the watcher is ready.
 */
export const HALT_CLEARED_POLL_INTERVAL_MS = 1000;

export function watchHaltCleared(
  worktreeBase: string,
  slug: string,
  onCleared: () => void,
  options?: WatchHaltClearedOptions,
): () => void {
  const worktreePath = join(worktreeBase, slug);
  const haltPath = join(worktreePath, HALT_MARKER);
  const clearedPath = join(worktreePath, '.pipeline', 'HALT.cleared');
  let watcher: FSWatcher | null = null;
  let disposed = false;
  let fired = false;

  // Contract: a missing worktree directory yields a no-op dispose and the
  // callback is never invoked. Checked up front so the polling fallback
  // below cannot fire for a worktree that never existed.
  if (!existsSync(worktreePath)) {
    return () => {
      /* no-op */
    };
  }

  // Fire-once path shared by the fs-event fast path and the polling
  // fallback. Re-verifies the marker is truly gone, attributes the clear
  // (Task 15), appends the audit record, then calls onCleared exactly once.
  const fireIfCleared = async (): Promise<void> => {
    if (disposed || fired) return;
    const stillExists = await exists(haltPath);
    // Re-check after the await: a concurrent caller may have fired, or
    // dispose may have run while we were checking the filesystem.
    if (disposed || fired || stillExists) return;
    fired = true;
    // Task 15: attribute the clear to its cause before waking the
    // daemon. A `HALT.cleared` sibling means the rekick flow renamed
    // HALT away (cause='rekick'); its absence means an operator deleted
    // HALT directly (cause='operator'). The append is synchronous and
    // happens BEFORE onCleared() fires, so the record always precedes
    // any re-dispatch/dispose race (AC5).
    const cause: 'operator' | 'rekick' = existsSync(clearedPath) ? 'rekick' : 'operator';
    await appendHaltClearedRecord(worktreePath, cause);
    onCleared();
  };

  // Fast path: filesystem events.
  try {
    watcher = chokidar.watch(haltPath, { ignoreInitial: true });

    // Handler returns the fireIfCleared promise so direct invocations (and
    // tests driving the handler) can await the full clear flow.
    watcher.on('unlink', async () => {
      await fireIfCleared();
    });

    // Watcher errors do not risk a missed pickup (the poll below is the
    // guaranteed path), but surface them loudly: a silent swallow hides
    // real operational limits like inotify instance exhaustion.
    watcher.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[daemon] WATCH-ERROR: HALT watcher error (slug=${slug}); ` +
          `falling back to polling: ${message}\n`,
      );
    });
  } catch {
    // If the watcher fails to start, the polling fallback still covers
    // detection.
    watcher = null;
  }

  // Guaranteed path: fs event delivery is best-effort (a clear that lands
  // before the watcher is ready, or an event the OS drops, is otherwise
  // missed forever and the feature is never picked back up). Poll bounds
  // worst-case detection latency deterministically.
  const pollIntervalMs = options?.pollIntervalMs ?? HALT_CLEARED_POLL_INTERVAL_MS;
  const pollTimer = setInterval(() => {
    void fireIfCleared();
  }, pollIntervalMs);
  pollTimer.unref?.();

  // Return idempotent dispose function
  return () => {
    if (disposed) return;
    disposed = true;
    clearInterval(pollTimer);
    if (watcher) {
      watcher.close().catch(() => {
        /* best-effort cleanup */
      });
    }
  };
}

/**
 * Factory for the DaemonDeps watchHaltCleared seam (Task 12).
 *
 * Creates a seam-compatible function `(slug: string, onCleared: () => void) => () => void`
 * that uses the real filesystem watcher to detect HALT marker removal.
 *
 * @param worktreeBase Directory under which per-feature worktrees live
 * @returns DaemonDeps-compatible watchHaltCleared function
 */
export function makeWatchHaltClearedSeam(
  worktreeBase: string,
  options?: WatchHaltClearedOptions,
): (slug: string, onCleared: () => void) => () => void {
  return (slug: string, onCleared: () => void) => {
    return watchHaltCleared(worktreeBase, slug, onCleared, options);
  };
}
