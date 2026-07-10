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
 * The poll timer is `.unref()`'d (ADR D-3) so a pending watcher can never
 * keep the process alive on its own.
 */
export class BuildProgressWatcher {
  private readonly projectRoot: string;
  private readonly events: ConductorEventEmitter;
  private readonly step: StepName;
  private readonly featureSlug?: string;
  private readonly resolvedConfig: ResolvedBuildProgressConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastResolved: number | null = null;

  constructor(opts: BuildProgressWatcherOptions) {
    this.projectRoot = opts.projectRoot;
    this.events = opts.events;
    this.step = opts.step;
    this.featureSlug = opts.featureSlug;
    this.resolvedConfig = resolveBuildProgressConfig(opts.config ?? {});
  }

  /** No-op if already started, or if `build_progress.enabled` is false. */
  start(): void {
    if (this.timer || !this.resolvedConfig.enabled) return;
    const timer = setInterval(() => {
      void this.tick();
    }, this.resolvedConfig.poll_seconds * 1000);
    timer.unref?.();
    this.timer = timer;
  }

  /** Idempotent — safe to call even if `start()` was never called, or is
   * called more than once. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    // Deliberately reads only `.pipeline/task-status.json` (via
    // `normalizeTasks`), not the full `readSnapshot` — the latter also shells
    // out to `git rev-parse HEAD`, which is unnecessary work on the polling
    // hot path and doesn't reliably settle under fake timers in tests (a
    // real subprocess spawn outruns the synthetic-clock microtask flush).
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

    if (this.lastResolved !== null && resolved === this.lastResolved) {
      return;
    }
    this.lastResolved = resolved;
    await this.events.emit({
      type: 'build_progress',
      step: this.step,
      resolved,
      total,
      featureSlug: this.featureSlug,
    });
  }
}
