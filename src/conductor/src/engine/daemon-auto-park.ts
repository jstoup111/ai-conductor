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

import { writeAutoPark } from './park-marker.js';
import { readNoEvidenceAttempts } from './task-evidence.js';

export interface CheckAndAutoParkOpts {
  /** Park once the durable no-evidence counter reaches this many attempts. */
  maxAttempts: number;
  /** Auto-park is a DAEMON-layer behavior; interactive runs never park. */
  daemon: boolean;
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
      reason = `no completion evidence after ${opts.maxAttempts} attempts`;
    }
  }

  if (reason === null) {
    return { parked: false };
  }

  await writeAutoPark(projectRoot, slug, reason);
  opts.emit?.({ type: 'auto_park', slug, reason });
  return { parked: true };
}
