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

export interface BacklogItem {
  /** Stable feature identifier (also the worktree/branch slug). */
  slug: string;
  /** Path(s) to the human-authored stories + plan that make it daemon-eligible. */
  storiesPath: string;
  planPath: string;
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
  /** Optional progress line (narrator). */
  log?: (msg: string) => void;
  /** Injectable sleep (tests pass a no-op / fake clock). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for the wall-clock ceiling (tests pass a fake). */
  now?: () => number;
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
}

export type DaemonStopReason =
  | 'backlog_drained'
  | 'max_items'
  | 'cost_ceiling'
  | 'time_ceiling'
  | 'idle_timeout';

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
  const idlePollMs = options.idlePollMs ?? 5000;
  const maxIdlePolls = options.maxIdlePolls ?? Infinity;
  const startedAt = now();

  const processed: FeatureOutcome[] = [];
  const inFlight = new Map<string, Tagged>();
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

  let stopReason: DaemonStopReason | null = null;

  while (true) {
    stopReason = ceilingHit();
    if (stopReason) break;

    // Fill the pool while slots are free.
    if (inFlight.size < concurrency) {
      // First-in-backlog-order eligible item. `inFlight`/`started` guard against
      // double-dispatch. The one slug allowed back past `started` is a parked
      // (halted) one — and only once its HALT marker is gone, detected by the
      // injected `isHalted`. Without that dep a parked feature stays parked.
      const pickEligible = async (
        backlog: BacklogItem[],
      ): Promise<BacklogItem | undefined> => {
        for (const b of backlog) {
          if (inFlight.has(b.slug)) continue;
          if (parked.has(b.slug)) {
            if (!deps.isHalted || (await deps.isHalted(b.slug))) continue; // still parked
            // marker cleared → fall through as eligible (re-dispatch + resume)
          } else if (started.has(b.slug)) {
            continue; // done/error — permanently excluded this run
          } else if (deps.isHalted && (await deps.isHalted(b.slug))) {
            // A feature this process never dispatched but whose worktree carries a
            // live `.pipeline/HALT` marker — parked for a human by a PRIOR run. The
            // `parked`/`started` sets are in-memory only and are empty after a daemon
            // restart, so without this the feature looks fresh (its merged spec is
            // still on the base branch, and only `done` features are in the durable
            // processed ledger) and gets re-dispatched, re-entering the conductor over
            // the kept worktree and clobbering its persisted state. Honor the durable
            // marker: park it so the un-park-on-clear path above governs re-dispatch.
            parked.add(b.slug);
            continue;
          }
          return b;
        }
        return undefined;
      };

      // Local-only discovery first (no remote fetch): cheap, and it keeps a build
      // from being re-based onto specs that landed on origin while work is running.
      let next = await pickEligible(await deps.discoverBacklog({ refresh: false }));

      // Only when fully idle (nothing running) AND nothing left locally do we reach
      // out to origin for newly-merged specs — "drained, now find more".
      if (!next && inFlight.size === 0) {
        next = await pickEligible(await deps.discoverBacklog({ refresh: true }));
      }

      if (next) {
        idlePolls = 0;
        dispatch(next);
        continue; // try to fill another slot before awaiting
      }
      // Nothing new to start.
      if (inFlight.size === 0) {
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
