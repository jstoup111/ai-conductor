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
  /** Features eligible to run: stories + plan present, not yet at .pipeline/DONE. */
  discoverBacklog: () => Promise<BacklogItem[]>;
  /** Run one feature to DONE/HALT in isolation. Must not throw for normal
   *  halts — return `{status:'halted'}` — but a thrown error is caught and
   *  recorded as `{status:'error'}` so the pool survives. */
  runFeature: (item: BacklogItem) => Promise<FeatureOutcome>;
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
  const started = new Set<string>(); // slugs started this run (no double-dispatch)
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
    const ok = outcome.status === 'done';
    const marker = ok ? chalk.green('■') : chalk.red('■');
    const status = ok ? chalk.green(outcome.status) : chalk.red(outcome.status);
    log(
      `${marker} done ${chalk.bold(slug)}: ${status}${outcome.prUrl ? ` ${chalk.cyan(outcome.prUrl)}` : ''}`,
    );
  };

  let stopReason: DaemonStopReason | null = null;

  while (true) {
    stopReason = ceilingHit();
    if (stopReason) break;

    // Fill the pool while slots are free.
    if (inFlight.size < concurrency) {
      const backlog = await deps.discoverBacklog();
      const next = backlog.find((b) => !started.has(b.slug) && !inFlight.has(b.slug));
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
