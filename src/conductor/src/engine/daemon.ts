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
import { Waker } from './waker.js';
import type { RateLimitEpisode } from './rate-limit-episode.js';

/**
 * Default sleep implementation whose timer HOLDS the event loop.
 *
 * This timer used to be unref'd ("don't block process exit") — but during an
 * idle poll with no wake-watchers registered (a fully drained backlog: zero
 * halted/parked features), the sleep timer is the process's ONLY pending
 * work. Unref'd, the event loop emptied and the continuous daemon exited 0
 * silently mid-await — no log, no HALT, no restart marker (observed live
 * 2026-07-07: three consecutive silent boot-deaths ~10s after startup). An
 * awaited idle-poll sleep IS the daemon's liveness; it must keep the process
 * alive. There is no lingering-handle cost: the loop only exits via `break`
 * paths that run after a sleep has already resolved, so no orphan timer can
 * delay a normal shutdown.
 *
 * `onTimer` is a test-only seam: the ref property is unobservable otherwise
 * (the vitest runner holds the loop itself, so an await-based test passes
 * either way — a false green).
 */
export function createDefaultSleep(
  opts: { onTimer?: (timer: NodeJS.Timeout) => void } = {},
): (ms: number) => Promise<void> {
  return (ms: number) =>
    new Promise<void>((r) => {
      const timer = setTimeout(r, ms);
      opts.onTimer?.(timer);
    });
}

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
  /**
   * Task 8 (D2, progress-gated cross-dispatch re-kick): true when `slug`'s
   * most recent dispatch made forward progress (its worktree's current
   * resolved-task count exceeds the `lastResolvedCount` its build step
   * stamped to the `TaskEvidence` sidecar at that dispatch's end). Consulted
   * ONLY for a slug still sitting in `parked` with a live `isHalted` marker
   * (i.e. no base advance has cleared it) — additive to that path, never a
   * replacement for it. Absent → behavior is unchanged (backward-compatible):
   * a live-HALT parked slug stays parked until `isHalted` clears or an
   * operator un-parks it.
   */
  isProgressReKickEligible?: (slug: string) => Promise<boolean>;
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
      if (!ctx.isHalted || (await ctx.isHalted(b.slug))) {
        // Still parked by the HALT marker (no base advance cleared it). Task 8
        // (D2): a live-HALT parked slug is ALSO eligible when its last dispatch
        // made forward progress — an additive path, checked only once the
        // isHalted-cleared path above has already said "still parked".
        if (ctx.isProgressReKickEligible && (await ctx.isProgressReKickEligible(b.slug))) {
          // progress-gated re-kick → fall through as eligible (re-dispatch + resume)
        } else {
          continue;
        }
      }
      // marker cleared, or progress-gated re-kick eligible → fall through
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
   * Task 8 (D2, progress-gated cross-dispatch re-kick): true when `slug`'s
   * most recent dispatch made forward progress — passed straight through to
   * `pickEligible`'s `isProgressReKickEligible` ctx field (see there for the
   * full contract). Absent → behavior is unchanged (backward-compatible).
   */
  isProgressReKickEligible?: (slug: string) => Promise<boolean>;
  /**
   * Task 9: per-spec bound on progress-gated cross-dispatch re-kicks
   * (`isProgressReKickEligible`), mirroring `build_progress_halt.dispatch_ceiling`
   * (resolved config default: 20 — see `config.ts` `BUILD_PROGRESS_HALT_DEFAULTS`).
   * This is an already-resolved plain number (mirrors `checkAndAutoPark`'s
   * `maxAttempts` seam) — the daemon core has no config-parsing knowledge.
   * Once a slug's re-kick count reaches this ceiling, `isProgressReKickEligible`
   * is treated as permanently false for it for the rest of this run (a single
   * `log()` line records the reason, once, distinct from T5's absolute
   * attempt-ceiling reason) — but this ONLY disables the progress-gated
   * re-kick path; `isHalted`/`isParked`/the base-advance `rekickSweep` and
   * operator-unpark remain fully in effect (FR: spec stays eligible for
   * base-advance re-kick / operator unpark). Absent → defaults to 20 (same
   * numeric default as the prior hardcoded interim cap, so unconfigured
   * behavior is unchanged).
   */
  progressReKickDispatchCeiling?: number;
  /**
   * Watch for HALT marker cleared on a parked feature and invoke `onCleared` when
   * detected. Returns an unsubscribe function to tear down the watch. Used by
   * event-driven re-dispatch to re-kick a halted slug without polling.
   *
   * Optimization-never-authority seam: only used for efficiency (event-driven vs
   * poll-driven); never drives dispatch authority (that flows through existing
   * `isHalted` path, FR-8). Pre-bound by CLI with projectRoot + log; this core
   * accepts a pre-bound two-arg function so it needs no knowledge of projectRoot.
   *
   * Pure-core default: absent (no-op, no watching). Production wires from
   * halt-reconciliation hooks (see daemon-deps.ts).
   */
  watchHaltCleared?: (slug: string, onCleared: () => void) => () => void;
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
  /**
   * Task 13 (FR-6): true while the daemon's build credential (daemon-token
   * mode) is missing/stale/unreadable. Consulted beside `isPaused` in the
   * fill-pool gate — no NEW feature is picked/dispatched while true. Does
   * NOT affect in-flight work: features already dispatched keep running to
   * completion/park. Re-polled every loop iteration (including each idle
   * tick), so a credential restored mid-run resumes dispatch at the next
   * boundary without a restart (auto-resume, no operator un-park needed).
   * Absent → never missing (pure-core default; production wires the real
   * predicate from `readDaemonBuildToken` + `resolveSelfHostConfig`, and
   * always reports false in api-key mode — the gate is inert there).
   */
  isBuildAuthMissing?: () => Promise<boolean>;
  /**
   * Optional rate-limit episode coordinator (optimization-never-authority).
   * If provided and active, gates new dispatch to avoid thundering herd.
   * If undefined or inactive, behaves as today (no change to existing code path).
   * @internal Daemon-scoped seam; never blocks on missing dep or stale state.
   */
  rateLimitEpisode?: RateLimitEpisode;
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
   * Task 5: Returns { fired: boolean } to indicate if restart was fired (true) or aborted (false).
   */
  requestRestart?: (opts: {
    fromIdentity: string | null;
    targetIdentity: string | null;
  }) => Promise<{ fired: boolean }>;

  /**
   * Task 11: Check if the current engine identity is suppressed due to
   * non-convergence at boot. Returns true if suppressed (hold restart),
   * false if not suppressed (proceed with restart) or on error (re-arm).
   * Optional for backward compatibility; tests inject to verify gate behavior.
   */
  isSuppressed?: (currentIdentity: string | null) => Promise<boolean>;

  /**
   * Rebuild the engine from the current (fast-forwarded) source before the
   * staleness check runs. Since #309 untracked `dist`/`dist-versions`, a merge
   * advances SOURCE only — the untracked `dist` artifact never moves on its
   * own, so the content-hash `staleEngineChecker` can never observe drift from
   * a merge. This hook rebuilds so `dist` reflects the new source; the checker
   * then detects the flip and drives a restart. Production wiring runs the
   * content-addressed `publish` (a no-op when content is unchanged, an atomic
   * `dist` flip otherwise), so the running version dir is never disturbed.
   * Only wired for self-host daemons; absent (no-op) everywhere else. A throw
   * is caught and logged — a failed rebuild degrades to the current engine.
   */
  rebuildEngine?: () => Promise<void>;

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
   * Task 18 (ADR-013): optional reconciliation hook for halt-PR state.
   * Invoked on startup and once per idle poll tick, BEFORE sweepMergeableLabels
   * so labels are correct when the mergeable sweep evaluates. Best-effort: a throw
   * is caught and logged; the daemon loop is never disrupted. Absent → no-op.
   */
  reconcileHaltPrs?: () => Promise<void>;

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
   * Task 13 (queued-restart relink wiring): Relink harness skills before firing
   * the self-restart trigger at the idle boundary. Called BEFORE triggerSelfRestart
   * to ensure fresh skills are available in the restarted daemon. If relink fails,
   * error is logged, trigger is NOT called, and the marker remains for retry at
   * the next idle boundary. Absence → no relink (skip directly to trigger).
   */
  relink?: () => Promise<void>;
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

  // ── #561: cooperative stop signal ───────────────────────────────────
  /**
   * Checked at loop top; when it returns true, stop STARTING new features
   * and drain in-flight before returning.
   */
  shouldStop?: () => boolean;

  // ── Task 3: per-sweep pidfile ownership gate ──────────────────────────
  /**
   * Return true ONLY on a definitive loss-of-ownership reading — absent,
   * corrupt, or different-uuid holder. Inconclusive/transient reads
   * should return false (fail-safe toward continuing).
   */
  lockOwnershipLost?: () => Promise<boolean>;

  // ── Task 20: Episode-caused HALT self-heal sweep ─────────────────────────
  /**
   * Fired by the daemon when it parks a halted/error outcome (both leave a
   * durable HALT marker in the worktree). This is the ONE choke point that
   * sees every halt path — step halts, rebase conflict halts, diagnostic
   * error HALTs — so causality is recorded here rather than at the many
   * marker-write sites inside the conductor.
   * @param slug - The feature slug
   * @param episodeCaused - true if a rate-limit episode was active when the
   *   outcome was collected (the daemon's best signal for "this HALT is
   *   rate-limit fallout, recover it when the episode ends")
   */
  onHaltWritten?: (slug: string, episodeCaused: boolean) => Promise<void>;
  /**
   * Sweep for and recover episode-caused HALTs when the rate-limit episode ends.
   * Should iterate over all HALT markers that were written during the episode
   * and recover them using existing rekick logic, respecting operator-park.
   * @param isParked - Optional function to check if a slug is operator-parked
   */
  sweepEpisodeHalts?: (isParked?: (slug: string) => Promise<boolean>) => Promise<void>;
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
  | 'repo_root_missing'
  | 'engine_restart'
  | 'lock_lost'
  | 'signal_teardown';

export interface DaemonResult {
  processed: FeatureOutcome[];
  stoppedReason: DaemonStopReason;
}

/** A runFeature promise tagged with its slug so a race can identify the winner. */
type Tagged = Promise<{ slug: string; outcome: FeatureOutcome }>;

/**
 * Task 1 (#651): the park check consulted immediately before every
 * build-start. `pickEligible`'s selection-time check (:137) filters the
 * backlog, but selection and the actual `dispatch` call are separated by an
 * `await` (stale-engine rebuild/restart) — a marker written in that window
 * would otherwise be dispatched anyway. `isParked` is awaited again right
 * here, immediately before `onDispatch` runs, closing that race.
 *
 * A throwing (or rejecting) `isParked` is treated as parked — fail-closed
 * toward the emergency-stop, mirroring `isOperatorParked`'s own contract.
 * Absent `isParked` is a no-op guard: `onDispatch` always runs, preserving
 * pre-#651 behavior exactly.
 *
 * Exported as a standalone function (params instead of closure state) so the
 * gate itself is unit-testable without driving the full pool.
 */
export async function guardedDispatchWith(
  item: BacklogItem,
  isParked: ((slug: string) => boolean | Promise<boolean>) | undefined,
  onDispatch: (item: BacklogItem) => void,
  log: (msg: string) => void,
): Promise<boolean> {
  let parked = false;
  try {
    parked = !!(await isParked?.(item.slug));
  } catch {
    parked = true; // fail-closed toward the emergency-stop
  }
  if (parked) {
    log(`park: skipped dispatch of ${item.slug} — operator-parked`);
    return false;
  }
  onDispatch(item);
  return true;
}

export async function runDaemon(
  deps: DaemonDeps,
  options: DaemonOptions,
): Promise<DaemonResult> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const sleep = deps.sleep ?? createDefaultSleep();
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});

  /** Task 18 + FR-14: best-effort sweep; reconcile halt-PRs before merge-sweep; never throws, never disrupts the daemon loop. */
  const sweepBestEffort = async (): Promise<void> => {
    try {
      await deps.reconcileHaltPrs?.();
    } catch (err) {
      log(`[daemon] reconcileHaltPrs error: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  // Task 13 (FR-6): sibling gate to `checkPaused` for the build-auth
  // credential. Same fail-closed-on-throw posture, same transition-only
  // logging discipline (a stuck missing credential must not spam the log
  // every idle tick) — the exact log-once behavior is Task 14's scope; this
  // gate only needs to not crash the loop or silently proceed on a throw.
  let buildAuthErrorActive = false;
  // Transition-only waiting-condition log (Task 14 owns the full transition
  // model; this is the minimal single-entry version needed so a stuck
  // missing credential doesn't spam the log every idle tick).
  let buildAuthMissingLogged = false;
  const checkBuildAuthMissing = async (): Promise<boolean> => {
    if (!deps.isBuildAuthMissing) return false;
    try {
      const result = await deps.isBuildAuthMissing();
      if (buildAuthErrorActive) {
        buildAuthErrorActive = false;
        log('[daemon] isBuildAuthMissing predicate recovered — resuming normal credential polling');
      }
      if (result) {
        if (!buildAuthMissingLogged) {
          buildAuthMissingLogged = true;
          log('[daemon] build credential missing — skipping new picks until it is restored');
        }
      } else {
        buildAuthMissingLogged = false;
      }
      return result;
    } catch (err) {
      if (!buildAuthErrorActive) {
        buildAuthErrorActive = true;
        log(
          `[daemon] isBuildAuthMissing predicate threw (${err instanceof Error ? err.message : String(err)}); failing closed — treating as missing`,
        );
      }
      if (!buildAuthMissingLogged) {
        buildAuthMissingLogged = true;
        log('[daemon] build credential missing — skipping new picks until it is restored');
      }
      return true; // fail-closed: an unreadable/erroring credential must never look "present"
    }
  };

  const idlePollMs = options.idlePollMs ?? 5000;
  const maxIdlePolls = options.maxIdlePolls ?? Infinity;
  const startedAt = now();

  const waker = Waker();
  const watchers = new Map<string, () => void>();

  // Task 9: per-spec dispatch-ceiling bound on `isProgressReKickEligible`.
  // Defaults to 20 (same numeric value as the prior hardcoded interim cap —
  // T8's safety valve — so unconfigured behavior is unchanged); production
  // wires `deps.progressReKickDispatchCeiling` from the resolved
  // `build_progress_halt.dispatch_ceiling` config. Once a slug's count
  // reaches the ceiling, the progress-gated re-kick path is disabled for it
  // (permanently, for this run) and a distinct reason is logged exactly
  // once — this does NOT touch isHalted/isParked/rekickSweep/operator-unpark,
  // so the slug stays eligible for base-advance re-kick or operator unpark.
  const progressReKickDispatchCeiling = deps.progressReKickDispatchCeiling ?? 20;
  const progressReKickCounts = new Map<string, number>();
  const progressReKickCeilingLogged = new Set<string>();
  const isProgressReKickEligibleBounded = deps.isProgressReKickEligible
    ? async (slug: string): Promise<boolean> => {
        const count = progressReKickCounts.get(slug) ?? 0;
        if (count >= progressReKickDispatchCeiling) {
          if (!progressReKickCeilingLogged.has(slug)) {
            progressReKickCeilingLogged.add(slug);
            log(
              `[daemon] ${slug}: progress-gated re-kick dispatch ceiling (${progressReKickDispatchCeiling}) reached — stopping re-kicks for this run; spec remains eligible for base-advance rekickSweep / operator unpark`,
            );
          }
          return false;
        }
        let eligible = false;
        try {
          eligible = await deps.isProgressReKickEligible!(slug);
        } catch (err) {
          log(
            `[daemon] isProgressReKickEligible(${slug}) threw (${err instanceof Error ? err.message : String(err)}); treating as not eligible`,
          );
          return false;
        }
        if (eligible) progressReKickCounts.set(slug, count + 1);
        return eligible;
      }
    : undefined;

  // Register a watchHaltCleared watcher for a newly-parked slug, if the seam
  // is present and no watcher already exists for it. Shared by both park
  // sites: collectOne (a feature this run just halted/errored) and
  // pickEligible's "durable HALT from a prior run" branch (a feature this
  // run never dispatched but whose worktree carries a live HALT marker).
  const registerWatcher = (slug: string): void => {
    if (deps.watchHaltCleared && !watchers.has(slug)) {
      const dispose = deps.watchHaltCleared(slug, () => {
        waker.wake();
      });
      watchers.set(slug, dispose);
    }
  };

  const processed: FeatureOutcome[] = [];
  const inFlight = new Map<string, Tagged>();
  // Task T28: track whether the restart trigger has been successfully called
  // in this run. Once successful, don't retry (the respawn would exit the process).
  let restartTriggeredSuccessfully = false;
  // Task 21: track whether a stale-engine restart request has been made in this
  // run. Once requested, don't retry (the restart would exit the process).
  let staleEngineRestartRequested = false;
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
    // Task 16: Detect if this is a re-dispatch (slug was parked)
    const isResume = parked.has(item.slug);

    started.add(item.slug);
    parked.delete(item.slug); // re-dispatching a cleared feature un-parks it
    // Dispose any existing watcher before re-dispatching (to avoid stale watchers
    // from the previous dispatch)
    const dispose = watchers.get(item.slug);
    if (dispose) {
      dispose();
      watchers.delete(item.slug);
    }

    // Task 16: Emit resume marker for re-dispatches, start for fresh dispatches
    if (isResume) {
      log(`${chalk.cyan('↻')} resume ${chalk.bold(item.slug)}`);
    } else {
      log(`${chalk.cyan('▶')} start ${chalk.bold(item.slug)}`);
    }
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

  // Task 1 (#651): park check immediately before every build-start, closing
  // the selection→dispatch race — pickEligible's selection-time check
  // (:137) can pass, then `await rebuildAndMaybeRestartForStaleEngine()`
  // (below) opens a window where an operator-park marker can land before
  // this slug is actually dispatched. Delegates to the module-level
  // `guardedDispatchWith` so the gate itself is unit-testable without
  // driving the full pool.
  const guardedDispatch = (item: BacklogItem): Promise<boolean> =>
    guardedDispatchWith(item, deps.isParked, dispatch, log);

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
    if (outcome.status === 'halted' || outcome.status === 'error') {
      parked.add(slug);
      // Register a watcher for event-driven wake when this feature's HALT is cleared
      registerWatcher(slug);
      // Task 20: stamp the park with the episode state at collection time so
      // the episode-end sweep can recover episode-caused HALTs. Awaited so the
      // tracker is consistent before the next pickEligible consults isHalted.
      if (deps.onHaltWritten) {
        const episodeCaused = deps.rateLimitEpisode?.active?.() ?? false;
        await deps.onHaltWritten(slug, episodeCaused).catch(() => {
          // Best-effort: tracking failures never disrupt the park/collect flow.
        });
      }
    }
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

  // Stale-engine restart gate chain (Task 12, gates 1-4) — constant per run.
  const staleGatesArmed =
    !options.once && // gate 1: continuous mode (not once)
    options.isSelfHost === true && // gate 2: self-host enabled
    options.autoRestartOnStaleEngine === true && // gate 3: flag enabled
    deps.staleEngineChecker !== undefined; // gate 4: checker armed

  /**
   * Rebuild the engine from the current source, then restart if it is now
   * stale. Returns true when a restart was requested — in production
   * `requestRestart` has already exited the process; the return value only
   * informs tests and the caller's decision not to dispatch the pending item.
   *
   * Fires only when quiescent (`inFlight` empty) so a restart never interrupts
   * an in-flight build. Reuses the shipped suppression + requestRestart path.
   */
  const rebuildAndMaybeRestartForStaleEngine = async (): Promise<boolean> => {
    if (!staleGatesArmed || !deps.staleEngineChecker) return false;
    if (inFlight.size !== 0) return false;

    // Gap A (#309): rebuild so the untracked `dist` reflects fast-forwarded
    // source; without this the content-hash checker never sees merge-driven
    // drift. Never fatal — a failed rebuild degrades to the current engine.
    if (deps.rebuildEngine) {
      try {
        await deps.rebuildEngine();
      } catch (err) {
        log(
          `[daemon] engine rebuild failed: ${err instanceof Error ? err.message : String(err)}; continuing on current engine`,
        );
      }
    }

    if (deps.staleEngineChecker.check() !== 'stale') return false;

    const targetIdentity = deps.staleEngineChecker.targetIdentity?.() ?? null;
    if (deps.isSuppressed && (await deps.isSuppressed(targetIdentity))) return false;
    if (inFlight.size !== 0) return false; // re-verify after the async suppression check

    const fromIdentity = deps.staleEngineChecker.capturedIdentity?.() ?? null;
    if (!deps.requestRestart) return false;
    log(`[daemon] engine stale after rebuild — captured: ${fromIdentity}, target: ${targetIdentity} — restarting before next task`);
    const result = await deps.requestRestart({ fromIdentity, targetIdentity });
    return result.fired;
  };

  let stopReason: DaemonStopReason | null = null;
  // Task 20: Track episode state to detect when it ends so we can sweep
  // episode-caused HALTs and recover them via the existing rekick path.
  let wasEpisodeActive = false;

  while (true) {
    if (deps.shouldStop?.()) {
      log('[daemon] teardown requested — draining in-flight, no new dispatch');
      stopReason = 'signal_teardown';
      break;
    }

    const missingRoot = deps.repoRootMissing?.();
    if (missingRoot != null) {
      log(`[daemon] repo root missing: ${missingRoot} — stopping`);
      stopReason = 'repo_root_missing';
      break;
    }

    if (await deps.lockOwnershipLost?.()) {
      log('[daemon] lock no longer held — stopping dispatch');
      stopReason = 'lock_lost';
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

      // Task 13 (FR-6): re-poll the build-auth credential gate every
      // iteration, same cadence as `checkPaused`. Missing → no NEW item is
      // picked this tick; in-flight work is unaffected. Non-blocking: the
      // loop still services watchers/waker/idle-poll bookkeeping below.
      const buildAuthMissing = await checkBuildAuthMissing();

      // Task 7: Rate-limit episode gate. When an episode is active, skip new
      // feature dispatch to avoid thundering herd. In-flight features remain
      // untouched. Optional dep: absence or inactive episode → proceed normally.
      const episodeActive = deps.rateLimitEpisode?.active?.() ?? false;

      // First-in-backlog-order eligible item (Task 14: `pickEligible` consumes
      // only `items`, never `waiting`, so a dependency-gated spec never causes
      // head-of-line blocking of a later, unblocked one).
      const pickCtx: PickEligibleCtx = {
        inFlight,
        parked,
        started,
        isHalted: deps.isHalted,
        isParked: deps.isParked,
        isProgressReKickEligible: isProgressReKickEligibleBounded,
      };

      let next: BacklogItem | undefined;
      if (!paused && !episodeActive && !buildAuthMissing) {
        // Local-only discovery first (no remote fetch): cheap, and it keeps a build
        // from being re-based onto specs that landed on origin while work is running.
        const parkedBeforeLocal = new Set(parked);
        next = await pickEligible({ items: await deps.discoverBacklog({ refresh: false }) }, pickCtx);
        // pickEligible's "durable HALT from a prior run" branch adds directly to
        // `parked` for a slug this run never dispatched — register its watcher
        // here (collectOne never sees it, since it never went through runFeature).
        for (const slug of parked) {
          if (!parkedBeforeLocal.has(slug)) registerWatcher(slug);
        }

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
          const parkedBeforeRefresh = new Set(parked);
          next = await pickEligible({ items: refreshed }, pickCtx);
          for (const slug of parked) {
            if (!parkedBeforeRefresh.has(slug)) registerWatcher(slug);
          }
        }
      }

      if (next) {
        // Before starting a feature, ensure the running engine matches current
        // source: rebuild + restart-if-stale so the next feature is built by
        // fresh code (Gap A/B — the shipped idle-only gate never fires here
        // because a merge that lands new specs takes THIS dispatch branch, not
        // the drained-idle branch below). Only acts when quiescent, so at
        // concurrency 1 it runs before every feature. In production
        // `requestRestart` exits the process; the break matters only to tests.
        if (await rebuildAndMaybeRestartForStaleEngine()) {
          stopReason = 'engine_restart';
          break;
        }
        // Task 20: Update episode state when dispatching
        wasEpisodeActive = episodeActive;
        // Task 1 (#651): re-check park immediately before this dispatch — closes
        // the selection→dispatch race opened by the rebuild/restart await above.
        const dispatched = await guardedDispatch(next);
        if (dispatched) {
          continue; // try to fill another slot before awaiting
        }
        // Parked between selection and here: fall through to the idle/await
        // section below instead of `continue`, so the tick doesn't tight-loop
        // re-picking the same parked slug.
      }
      // Nothing new to start.
      if (inFlight.size === 0) {
        // Task T28/T30: at idle boundary, check for pending restart marker and either
        // fire the supervisor trigger (T28) or consume in bare-run (T30).
        // This check happens BEFORE the once/idle-timeout checks so restart is honored
        // at the earliest idle boundary, even in once mode.
        // Task 21: Defer restart trigger while episode is active to avoid interference.
        // - T28 (supervisor mode): triggerSelfRestart is injected, fire it to respawn
        // - T30 (bare-run): triggerSelfRestart is absent, consume marker and exit cleanly
        // The daemon continues normally if supervisor trigger fails (no crash on failure).
        // Once the trigger succeeds, we never retry (the respawn would exit the process).
        if (!restartTriggeredSuccessfully && deps.hasRestartPending) {
          try {
            const hasRestart = await deps.hasRestartPending();
            if (hasRestart) {
              // Task 21 (#392): never fire restart triggers while a rate-limit
              // episode is active — a respawn mid-episode discards the shared
              // backoff state and re-enters the API storm.
              const episodeActive = deps.rateLimitEpisode?.active?.() ?? false;

              if (!episodeActive) {
                // T28 path: supervisor mode — fire respawn trigger
                if (deps.triggerSelfRestart) {
                  log('[daemon] self-restart marker found at idle boundary; firing trigger');
                  // Task 13 (#393): relink BEFORE firing the trigger (queued-restart
                  // relink wiring); a relink failure keeps the marker for retry.
                  let relinkFailed = false;
                  if (deps.relink) {
                    try {
                      await deps.relink();
                    } catch (err) {
                      log(
                        `[daemon] relink failed: ${err instanceof Error ? err.message : String(err)}; will retry at next idle boundary`,
                      );
                      relinkFailed = true;
                    }
                  }
                  // Only fire trigger if relink succeeded (or was absent)
                  if (!relinkFailed) {
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
              } else {
                // Episode is active: defer the restart trigger but keep the marker
                log('[daemon] restart marker present but episode active; deferring trigger');
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
                // Task 21: Check if episode is active before requesting restart
                const episodeActive = deps.rateLimitEpisode?.active?.() ?? false;
                if (episodeActive) {
                  // Defer restart request while episode is active
                  log('[daemon] stale engine detected but episode active; deferring restart request');
                } else if (!staleEngineRestartRequested) {
                  // All gates still pass, request restart with identities (only once per run)
                  const fromIdentity = deps.staleEngineChecker.capturedIdentity?.() ?? null;
                  // Task 11: Log the stale verdict with both identities before requesting restart
                  log(`[daemon] stale engine detected — captured: ${fromIdentity}, target: ${targetIdentity}`);

                  if (deps.requestRestart) {
                    const result = await deps.requestRestart({
                      fromIdentity,
                      targetIdentity,
                    });
                    // Only break if restart was actually fired. If fired: false,
                    // the restart request was aborted and the loop retries at the next idle boundary.
                    if (result.fired) {
                      stopReason = 'engine_restart';
                      break;
                    }
                    // If fired: false, fall through to continue idle polling and retry
                  }
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
        const idleTimeoutHit = idlePolls > maxIdlePolls;

        if (idleTimeoutHit) {
          stopReason = 'idle_timeout';
          break;
        }

        // Race the idle sleep against event-driven wake: if a watched HALT is
        // cleared before the poll timeout, waker.armed() resolves first and we
        // loop back to discovery without waiting the full idle interval (refresh:false).
        // If the timeout wins, sleep resolves and we proceed normally (next iteration's
        // fully-idle discovery will use refresh:true). The dummy test sleep never
        // resolves, so only wake can unblock test-mode daemons.
        await Promise.race([sleep(idlePollMs), waker.armed()]);
        // FR-14: sweep once per idle poll tick.
        await sweepBestEffort();

        // Task 20: Episode-end sweep. Detect when an active episode becomes
        // inactive and sweep for episode-caused HALTs to recover them via rekick.
        const isEpisodeActive = deps.rateLimitEpisode?.active?.() ?? false;
        if (wasEpisodeActive && !isEpisodeActive && deps.sweepEpisodeHalts) {
          try {
            await deps.sweepEpisodeHalts(deps.isParked);
          } catch (err) {
            log(
              `[daemon] sweepEpisodeHalts error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        wasEpisodeActive = isEpisodeActive;

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

  // Dispose all remaining watchers before exiting
  for (const dispose of watchers.values()) {
    dispose();
  }
  watchers.clear();

  return { processed, stoppedReason: stopReason ?? 'backlog_drained' };
}
