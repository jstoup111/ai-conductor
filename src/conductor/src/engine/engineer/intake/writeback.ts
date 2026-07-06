// engineer/intake/writeback.ts — shared intake write-back helpers.
//
// One implementation of the routed/done write-back used by BOTH the test-only
// runEngineerMode loop AND the deterministic CLI primitives (`engineer land`
// / `engineer handoff --source-ref`). Keeping it in one place means the live
// skill-driven path (CLI) and the scripted harness can never drift in how they
// comment back, apply the `engineer:handled` label, or advance the ledger.
//
// Both helpers are ADVISORY (FR-37): a gh outage or an absent ledger entry must
// never abort spec authoring or revert a delivered spec PR. They therefore
// swallow every error internally and never throw.

import type { IntakePort, ReportOutcome } from './port.js';
import type { Ledger } from './ledger.js';

/** Common write-back context: the source/sourceRef pair plus optional sinks. */
export interface WritebackTarget {
  source: string;
  sourceRef: string;
  port?: IntakePort;
  ledger?: Ledger;
}

/**
 * Report that an idea was ROUTED: comment "Routed to <repo>" on the originating
 * source and advance the ledger to `routed`. Best-effort — never throws.
 */
export async function reportRouted(target: WritebackTarget, repo: string): Promise<void> {
  if (target.port) {
    try {
      await target.port.report(target.sourceRef, 'routed', { repo });
    } catch {
      // write-back is advisory (FR-37) — a failed comment never blocks authoring.
    }
  }
  try {
    await target.ledger?.transition(target.source, target.sourceRef, 'routed');
  } catch {
    // ledger entry absent (non-recording source) — transition is advisory.
  }
}

/**
 * Report that an idea is DONE: comment the spec PR URL, apply the
 * `engineer:handled` label (via the adapter), and advance the ledger to `done`.
 * Best-effort — never throws (the spec PR is the real artifact).
 */
export async function reportDone(
  target: WritebackTarget,
  prUrl: string,
  branch?: string,
): Promise<void> {
  let outcome: ReportOutcome | undefined;
  if (target.port) {
    try {
      outcome = await target.port.report(target.sourceRef, 'done', { prUrl });
    } catch {
      // FR-37: a failed done comment never reverts a delivered spec PR — but it
      // does leave a pending write-back marker for later reconciliation.
      outcome = { ok: false, remediation: [] };
    }
  }
  try {
    await target.ledger?.transition(target.source, target.sourceRef, 'done', {
      prUrl,
      ...(branch !== undefined ? { branch } : {}),
      // Only thread the flag when the port actually reported an outcome — an
      // absent port (or one that resolved with no outcome) leaves the flag
      // untouched (TR-3: a pre-seeded stale flag is only cleared on ok:true).
      ...(outcome !== undefined ? { writebackPending: outcome.ok === false } : {}),
    });
  } catch {
    // advisory ledger transition.
  }
}
