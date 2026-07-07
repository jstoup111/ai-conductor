import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import type { StepName, Phase, ConductorEvent } from '../types/index.js';
import { phaseForStep } from './resolved-config.js';
import type { ConductorEventEmitter } from '../ui/events.js';

/**
 * Event types the audit trail cares about. Anything else emitted on the bus
 * is deliberately ignored — no handler is registered for it, so it neither
 * appends nor errors.
 */
const SUBSCRIBED_EVENT_TYPES: Array<ConductorEvent['type']> = [
  'gate_verdict',
  'step_retry',
  'kickback',
  'loop_halt',
  'step_completed',
];

/**
 * A single audit-trail event. `phase` and `at` are derived by the writer —
 * callers supply everything else.
 */
export type AuditRecord = {
  step: StepName;
  phase: Phase;
  event: string;
  reason?: string;
  cause?: string;
  attempt?: number;
  at: number;
};

/** Input to `AuditTrailWriter.record` — `phase` and `at` are derived, not supplied. */
export type AuditRecordInput = Omit<AuditRecord, 'phase' | 'at'>;

/**
 * Appends audit-trail events as whole-line JSON to
 * `<projectRoot>/.pipeline/audit-trail/events.jsonl`.
 *
 * Uses `appendFileSync` with `flag: 'a'` (O_APPEND) so concurrent writers
 * never interleave partial lines.
 */
export class AuditTrailWriter {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private eventsPath(): string {
    return join(this.projectRoot, '.pipeline', 'audit-trail', 'events.jsonl');
  }

  record(input: AuditRecordInput): void {
    const auditDir = join(this.projectRoot, '.pipeline', 'audit-trail');
    const eventsPath = this.eventsPath();

    const record: AuditRecord = {
      ...input,
      phase: phaseForStep(input.step),
      at: Date.now(),
    };

    try {
      mkdirSync(auditDir, { recursive: true });
      appendFileSync(eventsPath, JSON.stringify(record) + '\n', { flag: 'a' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[audit-trail] WRITE-FAILED: failed to append audit record ` +
          `(step=${input.step}, event=${input.event}): error: ${message}\n`
      );

      // Best-effort marker so operators can detect silent audit-trail loss.
      // Deliberately not rethrown — audit-trail failures must never break the caller.
      try {
        mkdirSync(auditDir, { recursive: true });
        appendFileSync(
          join(auditDir, 'WRITE-FAILED'),
          `${new Date().toISOString()} step=${input.step} event=${input.event} error=${message}\n`,
          { flag: 'a' }
        );
      } catch {
        // Marker write also failed; nothing more we can do without throwing.
      }
    }
  }

  /**
   * Subscribe to the allowlisted subset of ConductorEvent types on `events`.
   * Unmapped event types are never registered, so they emit on the bus and
   * are silently ignored by the audit trail — no handler runs, no error.
   *
   * Per-type field mapping here is intentionally minimal; tasks 7–12 refine
   * how each event type is translated into an AuditRecordInput.
   */
  subscribe(events: ConductorEventEmitter): void {
    for (const type of SUBSCRIBED_EVENT_TYPES) {
      events.on(type, (event: ConductorEvent) => {
        const input = this.toRecordInput(event);
        if (input) this.record(input);
      });
    }
  }

  private toRecordInput(event: ConductorEvent): AuditRecordInput | null {
    switch (event.type) {
      case 'gate_verdict':
        // Non-divergent mapping: `reason` is taken directly from the verdict
        // (no transformation), and `at` is stamped by `record()` as
        // `Date.now()`, which is always >= the verdict's `checkedAt` since
        // the verdict is computed before this handler runs.
        return {
          step: event.step,
          event: event.satisfied ? 'gate_pass' : 'gate_fail',
          reason: event.reason,
        };
      case 'step_retry':
        return {
          step: event.step,
          event: 'retry',
          reason: event.reason || 'step retry',
          attempt: event.attempt,
        };
      case 'kickback':
        return {
          step: event.to,
          event: event.type,
          cause: `${event.from} evidence: ${event.evidence}`,
        };
      case 'loop_halt':
        return { step: 'build', event: 'intervention', cause: event.reason };
      case 'step_completed':
        return { step: event.step, event: event.type };
      default:
        return null;
    }
  }
}
