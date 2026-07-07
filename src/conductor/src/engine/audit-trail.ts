import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import type { StepName, Phase } from '../types/index.js';
import { phaseForStep } from './resolved-config.js';

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
}
