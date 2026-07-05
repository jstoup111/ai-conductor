/**
 * Gate-loop daemon (Phase 6) — the parallel worker-pool orchestration core.
 *
 * It pulls features from a backlog and runs up to N in parallel, each fully
 * isolated (own worktree/branch/.pipeline via `runFeature`). It enforces hard
 * ceilings (max items, global token cost, wall-clock runtime), honors `once`
 * (drain) vs continuous idle-poll, and
 * never lets one feature's failure take down the pool — a thrown `runFeature`
 * becomes an `error` outcome and the pool keeps going.
 *
 * The heavy I/O (git worktree, artifact materialization, running the conductor,
 * opening a PR) lives behind the injected `runFeature` dep so this core is pure
 * and unit-testable.
 */

import chalk from 'chalk';
import type { ComplexityTier, Track } from '../types/index.js';

export interface BacklogItem {
  /** Stable feature identifier (also the worktree/branch slug). The vetted
   *  stories + plan live on the default branch each worktree is cut from, so the
   *  item carries no paths — a fresh worktree already contains them. */
  slug: string;
  /** Engineer-assessed complexity tier, parsed from `.docs/complexity/<slug>.md`
   *  on the base branch (FR: tier propagation). Drives BUILD-phase step skipping
   *  in the conductor (Small skips acceptance_specs/retro). Absent for legacy or
   *  non-engineer specs → the daemon falls back to 'M' (unchanged behavior). */
  tier?: ComplexityTier;
  /** Originating GitHub issue reference (`owner/repo#N`), parsed from
   *  `.docs/intake/<slug>.md` on the base branch. When present, the daemon links
   *  the implementation PR to the issue with `Closes owner/repo#N` so it
   *  auto-closes on merge. Absent for hand-authored / non-intake specs. */
  sourceRef?: string;
  /** Work track, parsed from `.docs/track/<slug>.md` on the base branch
   *  (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location). `technical` features skip the `prd` step + `prd-audit` at
   *  SHIP. Absent → the daemon treats it as `product` (back-compat). */
  track?: Track;
  /** Priority band assigned by the backlog-priority resolver (banded mode only).
   *  When present, indicates the item was reordered by priority. Absent when
   *  resolution was off or when the resolver threw (fallback mode). */
  band?: string;
  /** Resolution mode used for priority ordering. Indicates whether items were
   *  reordered (banded), fell back due to resolver error (fallback), or were
   *  not prioritized (off). Used by the dashboard to render band annotations. */
  resolutionMode?: 'banded' | 'fallback' | 'off';
}

/**
 * Backlog shape as consumed by `pickEligible` (Task 14 / FR-4 negative). Only
 * `items` is ever read — `waiting` (dependency-gated specs, Task 11) is
 * accepted for shape-compatibility with `discoverBacklog`'s widened return
 * but deliberately never inspected, so a spec parked in `waiting` can never
 * cause head-of-line blocking of a later, unblocked item in `items`.
 */
export interface PickEligibleBacklog {
  items: BacklogItem[];
  waiting?: unknown;
}

/** In-run dispatch bookkeeping `pickEligible` consults to skip ineligible slugs. */
export interface PickEligibleCtx {
  inFlight: { has(slug: string): boolean };
  parked: Set<string>;
  started: Set<string>;
  isHalted?: (slug: string) => Promise<boolean>;
  /**
   * True while `slug` carries a durable `.daemon/parked/<slug>` operator-park
   * marker (Task 7, operator-park). Unlike `isHalted`, an operator park is
   * never lifted by clearing `.pipeline/HALT` — only an explicit un-park
   * (Task 8+) makes the slug eligible again. Consulted alongside `isHalted`,
   * at the same eligibility-guard layer.
   */
  isParked?: (slug: string) => Promise<boolean>;
}

/**
 * First-in-`items`-order eligible feature. `inFlight`/`started` guard against
 * double-dispatch. The one slug allowed back past `started` is a parked
 * (halted) one — and only once its HALT marker is gone, detected by the
 * injected `isHalted`. Without that dep a parked feature stays parked.
 *
 * Consumes ONLY `backlog.items` — `backlog.waiting` is never read (FR-4
 * negative, Task 14). A spec diverted to `waiting` by the dependency gate
 * therefore never blocks dispatch of a later, unblocked item in `items`.
 */
export async function pickEligible(
  backlog: PickEligibleBacklog,
  ctx: PickEligibleCtx,
): Promise<BacklogItem | undefined> {
  for (const b of backlog.items) {
    if (ctx.inFlight.has(b.slug)) continue;
    // Operator-park (Task 7): a durable, HALT-independent stop. Checked
    // alongside `isHalted` below, but never lifted by a cleared HALT marker —
    // only an explicit un-park makes the slug eligible again.
    if (ctx.isParked && (await ctx.isParked(b.slug))) continue;
    if (ctx.parked.has(b.slug)) {
      if (!ctx.isHalted || (await ctx.isHalted(b.slug))) continue; // still parked
      // marker cleared → fall through as eligible (re-dispatch + resume)
    } else if (ctx.started.has(b.slug)) {
      continue; // done/error — permanently excluded this run
    } else if (ctx.isHalted && (await ctx.isHalted(b.slug))) {
      // A feature this process never dispatched but whose worktree carries a
      // live `.pipeline/HALT` marker — parked for a human by a PRIOR run. The
      // `parked`/`started` sets are in-memory only and are empty after a daemon
      // restart, so without this the feature looks fresh (its merged spec is
      // still on the base branch, and only `done` features are in the durable
      // processed ledger) and gets re-dispatched, re-entering the conductor over
      // the kept worktree and clobbering its persisted state. Honor the durable
      // marker: park it so the un-park-on-clear path above governs re-dispatch.
      ctx.parked.add(b.slug);
      continue;
    }
    return b;
  }
  return undefined;
}

export type FeatureStatus = 'done' | 'halted' | 'error';

export interface FeatureOutcome {
  slug: string;
  status: FeatureStatus;
  /** PR URL when the feature shipped (finish = open PR, never merge). */
  prUrl?: string;
  /** Why, for halted/error outcomes. */
  reason?: string;
  /** Output tokens this feature spent, for the global cost ceiling. */
  costTokens?: number;
}

export interface DaemonDeps {
  /**
   * Features eligible to run: stories + plan present, not yet at .pipeline/DONE.
   *
   * `refresh` requests a remote refresh (e.g. `git fetch origin <default>`) before
   * discovery. The pool sets it ONLY when fully idle with no local work left to start
   * — i.e. "between work, looking for more". While features are in flight (or local
   * queued work remains), discovery runs with `refresh:false` so a build is never
   * re-based onto specs that landed on origin mid-run.
   */
  discoverBacklog: (opts: { refresh: boolean }) => Promise<BacklogItem[]>;
  /** Run one feature to DONE/HALT in isolation. Must not throw for normal
   *  halts — return `{status:'halted'}` — but a thrown error is caught and
   *  recorded as `{status:'error'}` so the pool survives. */
  runFeature: (item: BacklogItem) => Promise<FeatureOutcome>;
  /**
   * True while a previously-halted feature's HALT marker is still present.
   * Keeps a parked feature un-dispatched until a human clears it, then lets it
   * be re-dispatched (reusing its worktree). Pure-core default: never halted —
   * production wires the real `.pipeline/HALT` check (see daemon-deps.ts).
   */
  isHalted?: (slug: string) => Promise<boolean>;
  /**
   * True while `slug` carries a durable `.daemon/parked/<slug>` operator-park
   * marker (Task 7, operator-park). Consulted alongside `isHalted` in
   * `pickEligible` — but never lifted by clearing HALT; only an explicit
   * un-park makes the slug eligible again. Pure-core default: never parked —
   * production wires `isOperatorParked` (see park-marker.ts / daemon-deps.ts).
   */
  isParked?: (slug: string) => Promise<boolean>;
  /**
   * FR-1 (Task 11): true while dispatch is paused (`.daemon/PAUSED`). Gates the
   * fill-pool block — no NEW feature is picked/dispatched while paused. Does
   * NOT affect in-flight work: features already dispatched keep running to
   * completion/park. Re-polled every loop iteration (including each idle
   * tick), so lifting the pause mid-run resumes dispatch at the next boundary
   * without a restart. Absent → never paused (pure-core default; production
   * wires the real `isPaused` from `pause-marker.ts`).
   */
  isPaused?: () => Promise<boolean>;
  /** Optional progress line (narrator). */
  log?: (msg: string) => void;
  /** Injectable sleep (tests pass a no-op / fake clock). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for the wall-clock ceiling (tests pass a fake). */
  now?: () => number;

  // ── Stale-engine detection (Task 12+) ──────────────────────────────────────
  /**
   * Stale-engine checker: detects if the captured engine binary differs from the
   * current on-disk binary. If capture failed, returns a disabled checker that
   * always reports 'current' (conservative: assume fresh until proven otherwise).
   * Optional for backward compatibility; tests inject this to simulate detection.
   *
   * Task 13: Extended to optionally provide identity methods for restart requests.
   */
  staleEngineChecker?: {
    check(): 'stale' | 'current' | 'indeterminate';
    /** Task 13: Optional method to retrieve the captured engine identity. */
    capturedIdentity?: () => string | null;
    /** Task 13: Optional method to retrieve the current (target) engine identity. */
    targetIdentity?: () => string | null;
  };
  /**
   * Called when a stale engine is detected AND all gates pass (continuous,
   * self-host, flag enabled, checker armed, not suppressed). Implements the
   * restart sequence: write marker → release lock → exit(0). Optional for
   * backward compatibility; tests inject a no-op to verify gate behavior.
   * Task 13 implements the real requester wiring in daemon-cli.ts.
   */
  requestRestart?: (opts: {
    fromIdentity: string | null;
    targetIdentity: string | null;
  }) => Promise<void>;

  /**
   * Task 11: Check if the current engine identity is suppressed due to
   * non-convergence at boot. Returns true if suppressed (hold restart),
   * false if not suppressed (proceed with restart) or on error (re-arm).
   * Optional for backward compatibility; tests inject to verify gate behavior.
   */
  isSuppressed?: (currentIdentity: string | null) => Promise<boolean>;

  // ── Halt-reconciliation hooks (ADR-013) — all OPTIONAL so the pure core
  //    (and its no-git tests) run unchanged when they are absent. ──────────────
  /**
   * FR-1: scan inherited state and render the startup dashboard to both sinks.
   * Invoked ONCE, before any dispatch.
   */
  renderStartupDashboard?: () => Promise<void>;
  /**
   * FR-4: resolve the current base-branch tip SHA from the discovery ref
   * (`refresh` requests a remote fetch first). Returns `null` when the SHA
   * cannot be resolved (offline / unset HEAD) — treated as "no advance".
   */
  resolveBaseSha?: (opts: { refresh: boolean }) => Promise<string | null>;
  /** FR-5/FR-11: the persisted last-seen base SHA, or `null` when absent/corrupt. */
  readPersistedBaseSha?: () => Promise<string | null>;
  /** FR-4: persist the last-seen base SHA (best-effort; never throws). */
  writePersistedBaseSha?: (sha: string) => Promise<void>;
  /**
   * FR-7: re-kick sweep over every halted worktree for a genuine base advance
   * `sha`. Clears markers only — issues NO dispatch (FR-8). The per-feature
   * FR-9 bound lives inside the wired impl.
   */
  rekickSweep?: (sha: string) => Promise<void>;
  /**
   * FR-14: sweep mergeable labels on startup (after reconciliation) and once per
   * idle poll tick. The caller binds projectRoot + log when wiring production
   * deps — this core accepts a pre-bound zero-arg function so it needs no
   * knowledge of projectRoot. Best-effort: a throw is caught and logged by
   * `runDaemon`; the daemon loop is never disrupted.
   */
  sweepMergeableLabels?: () => Promise<void>;

  // ── Task T28: daemon self-restart at idle boundary ──────────────────────
  /**
   * Check whether a pending restart marker exists (e.g., `.daemon/RESTART-PENDING`).
   * Called at each idle boundary to decide whether to fire the self-restart trigger.
   * Returns true if the marker is present, false otherwise. Absent → no self-restart.
   */
  hasRestartPending?: () => Promise<boolean>;
  /**
   * Fire the self-restart callback when a restart marker is pending and the daemon
   * reaches idle boundary with no in-flight work. This is the respawn hook injected
   * from supervisor-cli or bare-run handler. Must handle async failures gracefully:
   * a throw is logged and retried at the next idle boundary, never silent exit.
   * Daemon continues running if trigger fails (no crash on failure).
   */
  triggerSelfRestart?: () => Promise<void>;

  // ── Task T30: bare-run restart pending consume ─────────────────────────
  /**
   * Consume (remove and return) the pending-restart marker under the project.
   * Called at idle boundary in bare-run mode (when triggerSelfRestart is absent)
   * to consume the marker and exit cleanly. Idempotent: absent marker returns null.
   * Only used when bare-run is detected (triggerSelfRestart undefined).
   */
  consumeRestartPending?: () => Promise<unknown>;

  // ── TS-2: repo-root vanished self-termination ──────────────────────────
  /**
   * Check whether the repo root the daemon is operating on has been removed
   * (e.g. worktree deleted out from under the daemon). Called at the top of
   * every loop iteration. Must be DEFINITIVE ABSENCE ONLY — return `null` on
   * doubt/transient errors (permission issues, flaky FS, etc.) so a spurious
   * error never self-terminates a healthy daemon. Returns the missing path
   * when confirmed gone, `null` otherwise. Absent → never checked.
   */
  repoRootMissing?: () => string | null;
}

export interface DaemonOptions {
  /** Parallel worker count (clamped to >= 1). */
  concurrency: number;
  /** Stop STARTING new features after this many have completed. */
  maxItems?: number;
  /** Global output-token ceiling across all features. */
  maxTotalCostTokens?: number;
  /** Wall-clock ceiling in ms; stop STARTING new features past this. */
  maxRuntimeMs?: number;
  /** Process the current backlog then exit instead of idle-polling for more. */
  once?: boolean;
  /** Idle poll interval when the backlog is empty (default 5000ms). */
  idlePollMs?: number;
  /** Stop after this many consecutive empty polls (default Infinity). */
  maxIdlePolls?: number;

  // ── Stale-engine detection gate chain (Task 12+) ───────────────────────────
  /** True when this daemon is building the harness itself (self-host mode). */
  isSelfHost?: boolean;
  /** Config flag: auto-restart on stale engine (default false). */
  autoRestartOnStaleEngine?: boolean;
}

export type DaemonStopReason =
  | 'backlog_drained'
  | 'max_items'
  | 'cost_ceiling'
  | 'time_ceiling'
  | 'idle_timeout'
  | 'repo_root_missing';

export interface DaemonResult {
  processed: FeatureOutcome[];
  stoppedReason: DaemonStopReason;
}

/** A runFeature promise tagged with its slug so a race can identify the winner. */
type Tagged = Promise<{ slug: string; outcome: FeatureOutcome }>;

export async function runDaemon(
  deps: DaemonDeps,
  options: DaemonOptions,
): Promise<DaemonResult> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});

  /** FR-14: best-effort sweep; never throws, never disrupts the daemon loop. */
  const sweepBestEffort = async (): Promise<void> => {
    try {
      await deps.sweepMergeableLabels?.();
    } catch (err) {
      log(`[daemon] sweepMergeableLabels error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // FR-1 (Task 13): `isPaused` is a caller-injected predicate — it can throw
  // (unreadable marker, permissions, etc.), not just resolve. A throw must
  // fail closed (treated as paused, zero dispatch) rather than crash the loop
  // or silently resume dispatch. The warning is logged once per transition
  // into/out of the error state, not on every poll, so a stuck unreadable
  // marker doesn't spam the log every idle tick.
  let pauseErrorActive = false;
  const checkPaused = async (): Promise<boolean> => {
    if (!deps.isPaused) return false;
    try {
      const result = await deps.isPaused();
      if (pauseErrorActive) {
        pauseErrorActive = false;
        log('[daemon] isPaused predicate recovered — resuming normal pause polling');
      }
      return result;
    } catch (err) {
      if (!pauseErrorActive) {
        pauseErrorActive = true;
        log(
          `[daemon] isPaused predicate threw (${err instanceof Error ? err.message : String(err)}); failing closed — treating as paused`,
        );
      }
      return true; // fail-closed: an unreadable/erroring marker must never look "not paused"
    }
  };

  const idlePollMs = options.idlePollMs ?? 5000;
  const maxIdlePolls = options.maxIdlePolls ?? Infinity;
  const startedAt = now();

  const processed: FeatureOutcome[] = [];
  const inFlight = new Map<string, Tagged>();
  // Task T28: track whether the restart trigger has been successfully called
  // in this run. Once successful, don't retry (the respawn would exit the process).
  let restartTriggeredSuccessfully = false;
  // Slugs dispatched this run, to prevent double-dispatch. Stays populated for
  // the run's lifetime; `done`/`error` slugs remain permanently excluded.
  const started = new Set<string>();
  // Slugs that halted this run and are parked for a human. A parked slug is the
  // one exception to `started`'s permanent exclusion: it becomes eligible again
  // once its `.pipeline/HALT` marker is cleared, detected via the injected
  // `isHalted`. Without that dep (pure-core default) a parked feature stays
  // parked for the run — exactly the pre-fix behavior.
  const parked = new Set<string>();
  let totalCost = 0;
  let idlePolls = 0;

  // Ceilings stop STARTING new features; in-flight work always drains.
  const ceilingHit = (): DaemonStopReason | null => {
    if (options.maxItems != null && processed.length >= options.maxItems) {
      return 'max_items';
    }
    if (options.maxTotalCostTokens != null && totalCost >= options.maxTotalCostTokens) {
      return 'cost_ceiling';
    }
    if (options.maxRuntimeMs != null && now() - startedAt >= options.maxRuntimeMs) {
      return 'time_ceiling';
    }
    return null;
  };

  const dispatch = (item: BacklogItem): void => {
    started.add(item.slug);
    parked.delete(item.slug); // re-dispatching a cleared feature un-parks it

    log(`${chalk.cyan('▶')} start ${chalk.bold(item.slug)}`);
    const tagged: Tagged = deps
      .runFeature(item)
      .then((outcome) => ({ slug: item.slug, outcome }))
      .catch((err) => ({
        slug: item.slug,
        outcome: {
          slug: item.slug,
          status: 'error' as const,
          reason: err instanceof Error ? err.message : String(err),
        },
      }));
    inFlight.set(item.slug, tagged);
  };

  const collectOne = async (): Promise<void> => {
    const { slug, outcome } = await Promise.race(inFlight.values());
    inFlight.delete(slug);
    processed.push(outcome);
    if (outcome.costTokens) totalCost += outcome.costTokens;
    // A halted OR errored feature is parked for a human, not finished. Both now
    // leave a `.pipeline/HALT` marker (errors get a diagnostic one written in
    // makeRunFeature), so a later scan can re-dispatch once the operator fixes
    // the cause and clears the marker (gated by `isHalted` below). Only `done`
    // stays permanently excluded.
    if (outcome.status === 'halted' || outcome.status === 'error') parked.add(slug);
    const ok = outcome.status === 'done';
    const marker = ok ? chalk.green('■') : chalk.red('■');
    const status = ok ? chalk.green(outcome.status) : chalk.red(outcome.status);
    // Surface the reason for non-done outcomes — without it the log showed a bare
    // `error`/`halted` and the operator had to re-run by hand to find the cause.
    const why = !ok && outcome.reason ? ` — ${outcome.reason.split('\n')[0]}` : '';
    log(
      `${marker} done ${chalk.bold(slug)}: ${status}${why}${outcome.prUrl ? ` ${chalk.cyan(outcome.prUrl)}` : ''}`,
    );
  };

  // ── Startup (ADR-013): dashboard before any dispatch, then base-SHA seed +
  //    downtime-advance re-kick. All hooks are optional; absent → the pure
  //    pre-fix behavior (PR #109 markers honored, no re-kick). ────────────────
  await deps.renderStartupDashboard?.();

  // Seed the last-seen SHA from the persisted value. A genuine advance is
  // `current !== lastSeenSha` with `lastSeenSha != null`; a null seed (first
  // run / corrupt file) initializes WITHOUT a sweep (FR-5 first-run path).
  let lastSeenSha: string | null = deps.readPersistedBaseSha
    ? await deps.readPersistedBaseSha()
    : null;

  /**
   * Detect a base-SHA advance and, on a genuine one, run the re-kick sweep then
   * persist the new SHA. Crash-safe (FR-10): an unresolved or throwing
   * resolution is treated as "no advance" and never propagates out of the loop.
   * A first observation (null seed) initializes without re-kicking (FR-5).
   *
   * FR-1 (Task 12): gated on the pause predicate — while paused, a base-SHA
   * advance is not observed/persisted and no re-kick sweep runs, so a
   * HALT-parked feature stays parked (no re-kick dispatch) until resume.
   * Re-evaluated at the same call sites as the fill-pool pause check, so
   * lifting the pause mid-run makes re-kick eligible again at the next call.
   */
  const maybeRekick = async (refresh: boolean): Promise<void> => {
    if (!deps.resolveBaseSha) return;
    if (await checkPaused()) return;
    let current: string | null = null;
    try {
      current = await deps.resolveBaseSha({ refresh });
    } catch (err) {
      log(`base-SHA resolution failed (${err instanceof Error ? err.message : String(err)}); treating as no advance`);
      return;
    }
    if (!current) return; // unresolved → no advance this tick (FR-10)
    if (current === lastSeenSha) return; // no advance (PR #109 invariant preserved)
    // A genuine advance only re-kicks when there is a prior SHA to advance FROM;
    // a null seed is first-run init (record, no sweep — FR-5).
    if (lastSeenSha != null) {
      await deps.rekickSweep?.(current);
    }
    lastSeenSha = current;
    await deps.writePersistedBaseSha?.(current);
  };

  // Startup advance check: refresh so a base that moved on origin while the
  // daemon was DOWN is caught (FR-5 downtime-advance path).
  await maybeRekick(true);

  // FR-14: sweep mergeable labels on startup (after reconciliation).
  await sweepBestEffort();

  let stopReason: DaemonStopReason | null = null;

  while (true) {
    const missingRoot = deps.repoRootMissing?.();
    if (missingRoot != null) {
      log(`[daemon] repo root missing: ${missingRoot} — stopping`);
      stopReason = 'repo_root_missing';
      break;
    }

    stopReason = ceilingHit();
    if (stopReason) break;

    // Fill the pool while slots are free.
    if (inFlight.size < concurrency) {
      // FR-1 (Task 11): re-poll the pause predicate every iteration (including
      // idle ticks) so a pause lifted mid-run resumes dispatch at the next
      // boundary. Paused → no NEW item is picked this tick; in-flight work
      // (handled below/at drain) is completely unaffected.
      const paused = await checkPaused();

      // First-in-backlog-order eligible item (Task 14: `pickEligible` consumes
      // only `items`, never `waiting`, so a dependency-gated spec never causes
      // head-of-line blocking of a later, unblocked one).
      const pickCtx: PickEligibleCtx = {
        inFlight,
        parked,
        started,
        isHalted: deps.isHalted,
        isParked: deps.isParked,
      };

      let next: BacklogItem | undefined;
      if (!paused) {
        // Local-only discovery first (no remote fetch): cheap, and it keeps a build
        // from being re-based onto specs that landed on origin while work is running.
        next = await pickEligible({ items: await deps.discoverBacklog({ refresh: false }) }, pickCtx);

        // Only when fully idle (nothing running) AND nothing left locally do we reach
        // out to origin for newly-merged specs — "drained, now find more".
        if (!next && inFlight.size === 0) {
          const refreshed = await deps.discoverBacklog({ refresh: true });
          // FR-6: the refresh above already fetched origin, so the discovery ref is
          // current — re-read the base SHA WITHOUT a second fetch and, on a genuine
          // advance, re-kick before consuming the backlog so a freshly-cleared
          // marker is un-parked in THIS iteration (its dispatch still flows through
          // the existing un-park path, FR-8 — the sweep issues none).
          await maybeRekick(false);
          next = await pickEligible({ items: refreshed }, pickCtx);
        }
      }

      if (next) {
        idlePolls = 0;
        dispatch(next);
        continue; // try to fill another slot before awaiting
      }
      // Nothing new to start.
      if (inFlight.size === 0) {
        // Task T28/T30: at idle boundary, check for pending restart marker and either
        // fire the supervisor trigger (T28) or consume in bare-run (T30).
        // This check happens BEFORE the once/idle-timeout checks so restart is honored
        // at the earliest idle boundary, even in once mode.
        // - T28 (supervisor mode): triggerSelfRestart is injected, fire it to respawn
        // - T30 (bare-run): triggerSelfRestart is absent, consume marker and exit cleanly
        // The daemon continues normally if supervisor trigger fails (no crash on failure).
        // Once the trigger succeeds, we never retry (the respawn would exit the process).
        if (!restartTriggeredSuccessfully && deps.hasRestartPending) {
          try {
            const hasRestart = await deps.hasRestartPending();
            if (hasRestart) {
              // T28 path: supervisor mode — fire respawn trigger
              if (deps.triggerSelfRestart) {
                log('[daemon] self-restart marker found at idle boundary; firing trigger');
                try {
                  await deps.triggerSelfRestart();
                  // If trigger succeeds, it respawns the process and we never reach here.
                  // But if it doesn't respawn immediately, track that we succeeded so we
                  // don't retry (in production, the process exits on respawn).
                  restartTriggeredSuccessfully = true;
                  log('[daemon] self-restart trigger completed (no respawn yet)');
                } catch (err) {
                  log(
                    `[daemon] self-restart trigger failed: ${err instanceof Error ? err.message : String(err)}; will retry at next idle boundary`,
                  );
                }
              }
              // T30 path: bare-run mode — no supervisor, consume marker and exit cleanly
              else if (deps.consumeRestartPending) {
                log('[daemon] restart-pending honored (bare-run, no supervisor available)');
                try {
                  await deps.consumeRestartPending();
                  log('[daemon] restart marker consumed; exiting cleanly');
                  restartTriggeredSuccessfully = true;
                  // Break from the loop to exit cleanly with the current processed results
                  stopReason = 'backlog_drained';
                  break;
                } catch (err) {
                  log(
                    `[daemon] bare-run consume failed: ${err instanceof Error ? err.message : String(err)}; will retry at next idle boundary`,
                  );
                }
              }
            }
          } catch (err) {
            log(
              `[daemon] hasRestartPending check failed: ${err instanceof Error ? err.message : String(err)}; skipping restart check`,
            );
          }
        }

        // Task 12: stale-engine detection gate chain. Evaluate gates in order:
        // 1. continuous mode (NOT once-mode)
        // 2. self-host enabled
        // 3. config flag enabled
        // 4. checker armed (checker exists)
        // 5. (Task 11 addition) not suppressed
        // If all gates pass, call the checker. On 'stale' verdict, (Task 13) call
        // requestRestart. If ANY gate fails, skip the check and continue idle behavior.
        const isSharedMode = !options.once; // continuous mode = shared/not-once
        const shouldCheckStale =
          isSharedMode && // gate 1: continuous mode (not once)
          options.isSelfHost === true && // gate 2: self-host enabled
          options.autoRestartOnStaleEngine === true && // gate 3: flag enabled
          deps.staleEngineChecker !== undefined; // gate 4: checker armed

        if (shouldCheckStale && deps.staleEngineChecker) {
          const verdict = deps.staleEngineChecker.check();

          // Task 13: Handle stale verdict with in-flight re-verify
          if (verdict === 'stale') {
            // Task 11: Check if this identity is suppressed before proceeding.
            // Suppressed identities hold (no restart request) and log once per session.
            const targetIdentity = deps.staleEngineChecker.targetIdentity?.() ?? null;
            const suppressed = deps.isSuppressed ? await deps.isSuppressed(targetIdentity) : false;

            if (suppressed) {
              // Restart suppressed for this identity: hold and don't request restart.
              // The suppression check has already logged once per session.
              // Fall through to idle behavior (sleep/sweep), don't request restart.
            } else {
              // Not suppressed: proceed with restart request (if gates still pass).
              // Re-verify that inFlight is still empty before requesting restart.
              // A task could have been added between the verdict check and now.
              if (inFlight.size === 0) {
                // All gates still pass, request restart with identities
                const fromIdentity = deps.staleEngineChecker.capturedIdentity?.() ?? null;

                if (deps.requestRestart) {
                  await deps.requestRestart({
                    fromIdentity,
                    targetIdentity,
                  });
                }
              }
              // If inFlight not empty, someone added a task while we checked.
              // Fall through to next iteration; will not enter idle branch again.
            }
          }
        }

        if (options.once) {
          stopReason = 'backlog_drained';
          break;
        }
        idlePolls++;
        if (idlePolls > maxIdlePolls) {
          stopReason = 'idle_timeout';
          break;
        }

        await sleep(idlePollMs);
        // FR-14: sweep once per idle poll tick.
        await sweepBestEffort();
        continue;
      }
      // Workers still running — wait for one, then re-evaluate.
    }

    await collectOne();
  }

  // Drain remaining workers before returning (in-flight features finish).
  while (inFlight.size > 0) {
    await collectOne();
  }

  return { processed, stoppedReason: stopReason ?? 'backlog_drained' };
}
