// daemon-auto-park.ts — the single trigger primitive for the survivable
// auto-park (ADR "last resort", plan Task 23, #280 reconciliation).
//
// When a daemon feature's plan is empty/missing at seed time, the feature
// must STOP dispatching visibly instead of looping: a `.daemon/parked/<slug>`
// marker with machine provenance (`auto-parked: <reason>`), which the
// existing existence-based `isOperatorParked` check and the re-kick sweep
// both honor. Interactive runs (daemon: false) NEVER park — they keep the
// stall-REPL and recovery-menu path.
//
// Feature #773 Task 13 removed the durable no-evidence counter park path
// (the commit-stamping evidence ledger is demoted to non-gating telemetry) —
// a park now fires only for an explicit caller-supplied `reason`.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAutoPark } from './park-marker.js';

export interface CompletionSignals {
  summaryTasksCompleted: number;
}

/**
 * Tolerant read of the run's own completion evidence from
 * `.pipeline/summary.json` (session-authored input — never trusted blindly).
 * Mirrors the fail-closed tolerance in `task-evidence.ts`: a missing file,
 * corrupt JSON, or an absent/non-numeric `tasks_completed` field all resolve
 * to `0`, never throw. Feeds the contradiction guard (#612) that refuses an
 * `empty/missing plan` auto-park when the run's own evidence disagrees.
 */
export async function readCompletionSignals(
  projectRoot: string,
): Promise<CompletionSignals> {
  const summaryPath = join(projectRoot, '.pipeline/summary.json');

  let summaryTasksCompleted = 0;
  try {
    const raw = await readFile(summaryPath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      const tasksCompleted = (parsed as Record<string, unknown> | null)?.[
        'tasks_completed'
      ];
      if (typeof tasksCompleted === 'number' && Number.isFinite(tasksCompleted)) {
        summaryTasksCompleted = tasksCompleted;
      }
    } catch (parseErr) {
      console.warn(
        `[daemon-auto-park] corrupt or unparseable file at ${summaryPath}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }
  } catch {
    // File missing — fail closed to 0
  }

  return { summaryTasksCompleted };
}

export interface DetectParkContradictionOpts {
  /** Number of tasks the plan currently records as resolved. */
  resolvedTasks: number;
  /** Number of task-evidence stamps written for this run. */
  evidenceStampCount: number;
}

export interface ParkContradiction {
  summaryTasksCompleted: number;
  evidenceStamps: number;
  resolvedTasks: number;
}

/**
 * Pure decision function (#612): refuses an `empty/missing plan` auto-park
 * when the run's own completion evidence disagrees. Composes
 * `readCompletionSignals` with the caller-supplied resolved-task count and
 * evidence-stamp count. Returns `null` only when all three signals are
 * genuinely zero (a truly empty plan); otherwise returns a non-null
 * contradiction descriptor. No marker writes, no events emitted.
 */
export async function detectParkContradiction(
  projectRoot: string,
  opts: DetectParkContradictionOpts,
): Promise<ParkContradiction | null> {
  const { summaryTasksCompleted } = await readCompletionSignals(projectRoot);

  if (
    summaryTasksCompleted === 0 &&
    opts.evidenceStampCount === 0 &&
    opts.resolvedTasks === 0
  ) {
    return null;
  }

  return {
    summaryTasksCompleted,
    evidenceStamps: opts.evidenceStampCount,
    resolvedTasks: opts.resolvedTasks,
  };
}

export interface CheckAndAutoParkOpts {
  /** Auto-park is a DAEMON-layer behavior; interactive runs never park. */
  daemon: boolean;
  /**
   * Explicit immediate-park reason (e.g. 'empty/missing plan' at seed time).
   * A park only fires when this is set — the no-evidence durable-counter
   * park path was removed (Feature #773 Task 13: the commit-stamping
   * evidence ledger is demoted to non-gating telemetry).
   */
  reason?: string;
  /** Optional event sink; receives one `auto_park` event when a park fires. */
  emit?: (evt: unknown) => void;
}

/**
 * Decide (and, when warranted, perform) the auto-park for `slug`. Returns
 * `{ parked: true }` when a park marker was written — the caller must stop
 * dispatching this feature. Idempotent via `writeAutoPark` (an already-parked
 * slug is a no-op re-park, never an error).
 */
export async function checkAndAutoPark(
  projectRoot: string,
  slug: string,
  opts: CheckAndAutoParkOpts,
): Promise<{ parked: boolean }> {
  if (!opts.daemon) {
    return { parked: false };
  }

  if (opts.reason === undefined) {
    return { parked: false };
  }

  const reason = opts.reason;
  await writeAutoPark(projectRoot, slug, reason);
  opts.emit?.({ type: 'auto_park', slug, reason });
  return { parked: true };
}
