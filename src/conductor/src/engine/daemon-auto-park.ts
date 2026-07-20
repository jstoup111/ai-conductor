// daemon-auto-park.ts — the single trigger primitive for the survivable
// auto-park (ADR "last resort" + H7 durable counter, plan Task 23, #280
// reconciliation).
//
// When a daemon feature's plan yields NO completion evidence after N gate
// evaluations (durable sidecar counter — survives engine restarts and
// re-kicks), or the plan is empty/missing at seed time, the feature must STOP
// dispatching visibly instead of looping: a `.daemon/parked/<slug>` marker
// with machine provenance (`auto-parked: <reason>`), which the existing
// existence-based `isOperatorParked` check and the re-kick sweep both honor.
// Interactive runs (daemon: false) NEVER park — they keep the stall-REPL and
// recovery-menu path.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAutoPark } from './park-marker.js';
import { readNoEvidenceAttempts } from './task-evidence.js';

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
  /** Park once the durable no-evidence counter reaches this many attempts. */
  maxAttempts: number;
  /** Auto-park is a DAEMON-layer behavior; interactive runs never park. */
  daemon: boolean;
  /**
   * Snapshot of the durable no-evidence counter observed at the start of
   * this dispatch cycle. When the counter was already at/over `maxAttempts`
   * before this cycle burned any attempts (e.g. inherited from a prior
   * halted run via unpark/re-kick), the composed reason names the budget as
   * inherited rather than implying it was exhausted just now. Optional —
   * omitting it preserves today's wording (same-cycle crossing).
   */
  cycleStartAttempts?: number;
  /**
   * Explicit immediate-park reason (e.g. 'empty/missing plan' at seed time).
   * When set, the counter is not consulted — the condition is already
   * terminal for dispatch.
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

  let reason: string | null = null;
  if (opts.reason !== undefined) {
    reason = opts.reason;
  } else {
    const attempts = await readNoEvidenceAttempts(projectRoot);
    if (attempts >= opts.maxAttempts) {
      const inherited =
        opts.cycleStartAttempts !== undefined &&
        opts.cycleStartAttempts >= opts.maxAttempts;
      reason = inherited
        ? `no completion evidence — inherited an already-exhausted budget of ${opts.maxAttempts} attempts`
        : `no completion evidence after ${opts.maxAttempts} attempts`;
    }
  }

  if (reason === null) {
    return { parked: false };
  }

  await writeAutoPark(projectRoot, slug, reason);
  opts.emit?.({ type: 'auto_park', slug, reason });
  return { parked: true };
}
