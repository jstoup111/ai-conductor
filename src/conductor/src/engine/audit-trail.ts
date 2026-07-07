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
    const eventsPath = this.eventsPath();
    mkdirSync(join(this.projectRoot, '.pipeline', 'audit-trail'), { recursive: true });

    const record: AuditRecord = {
      ...input,
      phase: phaseForStep(input.step),
      at: Date.now(),
    };

    appendFileSync(eventsPath, JSON.stringify(record) + '\n', { flag: 'a' });
  }
}
