import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeTasks } from './task-progress.js';
import { readNoEvidenceAttempts } from './task-evidence.js';
import { makeGitRunner } from './rebase.js';
import { resolveBuildProgressConfig } from './config.js';
import type { ResolvedBuildProgressConfig } from './config.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { StepName } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';

/**
 * A point-in-time read of build progress for a project: how many tasks are
 * resolved out of the total, which task (if any) is currently in progress,
 * the worktree's git HEAD (when determinable), and the no-evidence retry
 * counter. Consumed by the intra-step build-progress watcher (Task 5+) to
 * detect change vs. stall.
 *
 * Every field is best-effort: a missing/corrupt `.pipeline/task-status.json`
 * yields the "no data" snapshot (`resolved: 0, total: 0`, no current task)
 * rather than throwing, and a failed git HEAD probe simply omits `head`
 * rather than surfacing the git error. Callers on the polling hot path must
 * never see readSnapshot throw.
 */
export interface BuildProgressSnapshot {
  resolved: number;
  total: number;
  currentTaskId?: string;
  currentTaskName?: string;
  head?: string;
  noEvidenceAttempts: number;
}

/**
 * Read a tolerant snapshot of build progress for `projectRoot`.
 *
 * Sources:
 * - `.pipeline/task-status.json` — resolved/total task counts and the
 *   current in-progress task, tolerating both the new `{tasks: [...]}`
 *   shape and the legacy id-keyed map shape (via
 *   `task-progress.ts#normalizeTasks`). Missing or unparseable → the
 *   "no data" snapshot (0/0, no current task) without throwing.
 * - `.pipeline/task-evidence.json` — `noEvidenceAttempts`, via
 *   `readNoEvidenceAttempts` (already tolerant of missing/corrupt sidecars).
 * - `git rev-parse HEAD` in `projectRoot` — included as `head` when it
 *   succeeds; the property is omitted entirely (not set to `undefined`
 *   loosely, but genuinely absent) when the probe fails, e.g. `projectRoot`
 *   isn't a git repo or has no commits yet.
 */
export async function readSnapshot(projectRoot: string): Promise<BuildProgressSnapshot> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');

  let tasks = normalizeTasks(undefined);
  let explicitTotal: number | undefined;

  try {
    const raw = await readFile(statusPath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      tasks = normalizeTasks(parsed);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).total === 'number'
      ) {
        explicitTotal = (parsed as Record<string, unknown>).total as number;
      }
    } catch {
      // Corrupt JSON — fall through with the empty "no data" task list.
    }
  } catch {
    // File missing — fall through with the empty "no data" task list.
  }

  const resolved = tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').length;
  const total = explicitTotal ?? tasks.length;
  const current = tasks.find((t) => t.status === 'in_progress');

  const snapshot: BuildProgressSnapshot = {
    resolved,
    total,
    currentTaskId: current?.id,
    currentTaskName: current?.title,
    noEvidenceAttempts: 0,
  };

  try {
    snapshot.noEvidenceAttempts = await readNoEvidenceAttempts(projectRoot);
  } catch {
    // Sidecar read is already tolerant internally; belt-and-suspenders here.
  }

  try {
    const git = makeGitRunner(projectRoot);
    const result = await git(['rev-parse', 'HEAD']);
    if (result.exitCode === 0 && result.stdout.trim()) {
      snapshot.head = result.stdout.trim();
    }
  } catch {
    // No head property — probe failed (not a git repo, no commits, etc).
  }

  return snapshot;
}

/**
 * Options for {@link BuildProgressWatcher}. `config` is the (possibly
 * partial) HarnessConfig the watcher resolves its `build_progress:` block
 * from — omit it to use the documented defaults (poll_seconds: 30,
 * quiet_minutes: 15, heartbeat_minutes: 5, enabled: true).
 */
export interface BuildProgressWatcherOptions {
  projectRoot: string;
  events: ConductorEventEmitter;
  step: StepName;
  featureSlug?: string;
  config?: Pick<HarnessConfig, 'build_progress'>;
  /** Absolute path to the active plan file, when known — threaded through so
   * later derivations can resolve the total task count from the plan
   * instead of relying solely on task-status.json. */
  planPath?: string;
}

/**
 * Polls `readSnapshot(projectRoot)` for resolved/total task-count changes
 * while a `build` step is running and emits `build_progress` on the shared
 * ConductorEventEmitter bus (adr-2026-07-10-intra-step-build-progress-events).
 *
 * Lifecycle: construct once per build-step attempt, `start()` immediately
 * before awaiting the step, `stop()` in a `finally` once the await settles.
 * `stop()` is idempotent and safe to call even if `start()` was never
 * called (or was already stopped), so callers never need to guard the
 * teardown call — this is the leak-prevention contract Task 9 wires around
 * the conductor's build-step await.
 *
 * The poll timer is unref-ed (ADR D-3) so a pending watcher can never
 * keep the process alive on its own.
 *
 * Emission is change-driven (adr-2026-07-10-intra-step-build-progress-events,
 * Task 5): each tick diffs the freshly-read `TickSnapshot` (resolved, total,
 * currentTaskId, git HEAD, noEvidenceAttempts) against the last-emitted one
 * and only calls `events.emit` when something moved. A task-count delta, a
 * new commit landing on HEAD with no task delta, a current-task change, or a
 * bare noEvidenceAttempts bump all count as "changed". A HEAD change also
 * populates `commitCount` via `git rev-list --count <old>..<new>` (best
 * effort — omitted if that probe fails). An unchanged tick emits nothing
 * (beyond the heartbeat/quiet-episode checks described below).
 *
 * Quiet-episode tracking (Task 7): the watcher also maintains a
 * `build_no_progress` episode state machine — `lastChangeAt` (the timestamp
 * of the most recent change-driven tick) and `quietFired` (whether this
 * episode has already emitted). Once the time since `lastChangeAt` crosses
 * `quiet_minutes`, `build_no_progress` fires exactly once (guarded by
 * `quietFired`); continued quiet emits nothing further. Any subsequent
 * change-driven tick re-arms the episode (`quietFired` reset to false,
 * `lastChangeAt` bumped to now), so a later quiet stretch fires again.
 */

/**
 * The subset of {@link BuildProgressSnapshot} the watcher diffs tick-over-tick
 * to decide whether to emit. `noEvidenceAttempts` is tracked so a bare
 * evidence-counter change still counts as a change even when task counts and
 * HEAD are both static.
 */
interface TickSnapshot {
  resolved: number;
  total: number;
  currentTaskId?: string;
  currentTaskName?: string;
  head?: string;
  noEvidenceAttempts: number;
}

export class BuildProgressWatcher {
  private readonly projectRoot: string;
  private readonly events: ConductorEventEmitter;
  private readonly step: StepName;
  private readonly featureSlug?: string;
  private readonly planPath?: string;
  private readonly resolvedConfig: ResolvedBuildProgressConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: TickSnapshot | null = null;
  private lastEmitAt: number | null = null;
  private stopped = false;
  private pending: Promise<void> | null = null;
  /**
   * Quiet-episode state (Task 7): `lastChangeAt` is the timestamp of the most
   * recent change-driven tick (task delta, HEAD move, current-task change, or
   * evidence-counter bump); `quietFired` guards against emitting
   * `build_no_progress` more than once per quiet episode. Any subsequent
   * change re-arms the episode (`quietFired` reset to false, `lastChangeAt`
   * bumped) so a later quiet stretch can fire again.
   */
  private lastChangeAt: number | null = null;
  private quietFired = false;

  constructor(opts: BuildProgressWatcherOptions) {
    this.projectRoot = opts.projectRoot;
    this.events = opts.events;
    this.step = opts.step;
    this.featureSlug = opts.featureSlug;
    this.planPath = opts.planPath;
    this.resolvedConfig = resolveBuildProgressConfig(opts.config ?? {});
  }

  /** No-op if already started, or if `build_progress.enabled` is false. */
  start(): void {
    if (this.timer || !this.resolvedConfig.enabled) return;
    this.stopped = false;
    const timer = setInterval(() => {
      this.pending = this.tick().finally(() => {
        this.pending = null;
      });
    }, this.resolvedConfig.poll_seconds * 1000);
    timer.unref?.();
    this.timer = timer;
  }

  /** Idempotent — safe to call even if `start()` was never called, or is
   * called more than once. Also flips a `stopped` guard so any tick already
   * in flight when stop() is called resolves as a no-op instead of emitting
   * on a bus the caller has moved on from. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Await any in-flight interval-fired tick to complete. No-op (resolves
   * immediately) if no tick is currently pending. Used in tests to
   * deterministically settle real fs/git I/O before calling stop(). */
  async settle(): Promise<void> {
    if (this.pending) {
      await this.pending;
    }
  }

  private async tick(): Promise<void> {
    // Task-status read keeps its own try/catch and early-return: a
    // missing/corrupt task-status.json is treated as "no data, skip this
    // tick" (the watcher keeps polling), whereas the git HEAD probe and
    // evidence sidecar read below degrade gracefully in place instead of
    // aborting the whole tick.
    const statusPath = join(this.projectRoot, '.pipeline/task-status.json');
    let tasks: ReturnType<typeof normalizeTasks> = [];
    try {
      const raw = await readFile(statusPath, 'utf-8');
      tasks = normalizeTasks(JSON.parse(raw));
    } catch {
      // Missing/corrupt task-status.json — treat as "no data" and skip this
      // tick rather than emitting a bogus 0/0 progress event.
      return;
    }

    const resolved = tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').length;
    const total = tasks.length;
    const current = tasks.find((t) => t.status === 'in_progress');

    let head: string | undefined;
    try {
      const git = makeGitRunner(this.projectRoot);
      const result = await git(['rev-parse', 'HEAD']);
      if (result.exitCode === 0 && result.stdout.trim()) {
        head = result.stdout.trim();
      }
    } catch {
      // HEAD probe failed (corrupted worktree, not a repo, etc) — degrade to
      // task-file-only diffing rather than throwing.
    }

    let noEvidenceAttempts = 0;
    try {
      noEvidenceAttempts = await readNoEvidenceAttempts(this.projectRoot);
    } catch {
      // Sidecar read is already tolerant internally; belt-and-suspenders here.
    }

    const snapshot: TickSnapshot = {
      resolved,
      total,
      currentTaskId: current?.id,
      currentTaskName: current?.title,
      head,
      noEvidenceAttempts,
    };

    const previous = this.lastSnapshot;
    const changed =
      previous === null ||
      snapshot.resolved !== previous.resolved ||
      snapshot.total !== previous.total ||
      snapshot.currentTaskId !== previous.currentTaskId ||
      snapshot.head !== previous.head ||
      snapshot.noEvidenceAttempts !== previous.noEvidenceAttempts;

    if (!changed) {
      if (this.stopped) return;

      // Quiet-episode check (Task 7): fire build_no_progress exactly once
      // per quiet episode once quiet_minutes has elapsed since the last
      // observed change. `lastChangeAt` is only set once a baseline tick has
      // established one (below / on the first changed tick), so this is a
      // no-op until that happens.
      if (this.lastChangeAt !== null && !this.quietFired) {
        const quietMs = this.resolvedConfig.quiet_minutes * 60 * 1000;
        const quietElapsed = Date.now() - this.lastChangeAt;
        if (quietElapsed >= quietMs) {
          this.quietFired = true;
          await this.events.emit({
            type: 'build_no_progress',
            step: this.step,
            quietMinutes: Math.floor(quietElapsed / 60000),
            resolved,
            total,
            currentTaskId: snapshot.currentTaskId,
            featureSlug: this.featureSlug,
          });
        }
      }

      // No change-driven emission this tick — check whether the heartbeat
      // clock has elapsed since the last emission (change-driven OR
      // heartbeat). A silent build still re-emits its current snapshot once
      // per heartbeat period so subscribers (daemon-log, UI, OTel) see a
      // liveness signal even when nothing moved.
      const heartbeatMs = this.resolvedConfig.heartbeat_minutes * 60 * 1000;
      if (!this.stopped && this.lastEmitAt !== null && Date.now() - this.lastEmitAt >= heartbeatMs) {
        this.lastEmitAt = Date.now();
        await this.events.emit({
          type: 'build_progress',
          step: this.step,
          resolved,
          total,
          currentTaskId: snapshot.currentTaskId,
          currentTaskName: snapshot.currentTaskName,
          commitCount: undefined,
          noEvidenceAttempts,
          featureSlug: this.featureSlug,
        });
      }
      return;
    }

    let commitCount: number | undefined;
    if (head && previous?.head && head !== previous.head) {
      try {
        const git = makeGitRunner(this.projectRoot);
        const result = await git(['rev-list', '--count', `${previous.head}..${head}`]);
        const parsed = Number(result.stdout.trim());
        if (result.exitCode === 0 && Number.isFinite(parsed)) {
          commitCount = parsed;
        }
      } catch {
        // Best-effort — omit commitCount rather than throwing.
      }
    }

    this.lastSnapshot = snapshot;

    if (this.stopped) {
      // stop() was called while this tick's async I/O (fs/git) was in
      // flight — swallow the emission rather than firing on a bus the
      // caller believes is quiescent.
      return;
    }

    // Change-driven tick — (re-)arm the quiet episode: bump lastChangeAt and
    // clear quietFired so a later quiet stretch can fire build_no_progress
    // again.
    this.lastChangeAt = Date.now();
    this.quietFired = false;

    // Change-driven emission resets the heartbeat clock so a heartbeat never
    // fires immediately on the heels of a real change (no interleaved
    // duplicates).
    this.lastEmitAt = Date.now();
    await this.events.emit({
      type: 'build_progress',
      step: this.step,
      resolved,
      total,
      currentTaskId: snapshot.currentTaskId,
      currentTaskName: snapshot.currentTaskName,
      commitCount,
      noEvidenceAttempts,
      featureSlug: this.featureSlug,
    });
  }
}
