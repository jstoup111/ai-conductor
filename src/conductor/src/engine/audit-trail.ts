import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import type {
  StepName,
  Phase,
  ConductorEvent,
  VerdictFreshnessOutcome,
} from '../types/index.js';
import { auditedEventTypes } from './event-sinks.js';
import { phaseForStep } from './resolved-config.js';
import type { ConductorEventEmitter } from '../ui/events.js';

/** The source of an audit record: a pipeline step or an interactive operator action. */
export type AuditRecordOrigin = StepName | 'operator';

export type AuditResealPath = {
  path: string;
  priorFingerprint: string;
  newFingerprint: string;
};

/**
 * A single audit-trail event. `phase` and `at` are derived by the writer —
 * callers supply everything else.
 */
export type AuditRecord = {
  origin: AuditRecordOrigin;
  phase?: Phase;
  event: string;
  reason?: string;
  cause?: string;
  /** Present for an operator-performed protected-artifact reseal. */
  paths?: AuditResealPath[];
  /** Present when an operator protected-artifact reseal is refused. */
  condition?: string;
  /** Present when a specific protected artifact caused a reseal refusal. */
  path?: string;
  fromCommit?: string;
  toCommit?: string;
  attempt?: number;
  artifact?: string;
  outcome?: VerdictFreshnessOutcome;
  at: number;
  /**
   * #647 D3: for `event: 'kickback'` records, distinguishes a kickback that
   * produced real build progress (`'did-work (commits N..M / resolved +K)'`)
   * from one whose target was already evidence-complete before build ever
   * ran (`'derived-already-complete'`). Absent for non-kickback records or
   * kickbacks with no classification computed.
   */
  kickback_outcome?: string;
};

/** Input to `AuditTrailWriter.record` — `phase` and `at` are derived, not supplied. */
export type AuditRecordInput = Omit<AuditRecord, 'phase' | 'at'>;

export type AuditTrailWriterOptions = {
  /**
   * Fail the immediate caller after writing the usual diagnostics. This is
   * for operator commands whose requested action is not complete without its
   * audit entry; normal pipeline subscribers remain best-effort.
   */
  throwOnWriteFailure?: boolean;
};

/**
 * Appends audit-trail events as whole-line JSON to
 * `<projectRoot>/.pipeline/audit-trail/events.jsonl`.
 *
 * Uses `appendFileSync` with `flag: 'a'` (O_APPEND) so concurrent writers
 * never interleave partial lines.
 */
export class AuditTrailWriter {
  private readonly projectRoot: string;
  private readonly throwOnWriteFailure: boolean;

  /**
   * Steps for which a `gate_verdict` has already been observed. Used by
   * `step_completed` handling to avoid emitting a duplicate positive-evidence
   * `gate_pass` record when a real verdict already covered that step.
   */
  private readonly stepsWithVerdicts = new Set<StepName>();

  constructor(projectRoot: string, options: AuditTrailWriterOptions = {}) {
    this.projectRoot = projectRoot;
    this.throwOnWriteFailure = options.throwOnWriteFailure === true;
  }

  private eventsPath(): string {
    return join(this.projectRoot, '.pipeline', 'audit-trail', 'events.jsonl');
  }

  record(input: AuditRecordInput): void {
    const auditDir = join(this.projectRoot, '.pipeline', 'audit-trail');
    const eventsPath = this.eventsPath();

    const record: AuditRecord = {
      ...input,
      ...(input.origin === 'operator' ? {} : { phase: phaseForStep(input.origin) }),
      at: Date.now(),
    };

    try {
      mkdirSync(auditDir, { recursive: true });
      appendFileSync(eventsPath, JSON.stringify(record) + '\n', { flag: 'a' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[audit-trail] WRITE-FAILED: failed to append audit record ` +
          `(origin=${input.origin}, event=${input.event}): error: ${message}\n`
      );

      // Best-effort marker so operators can detect silent audit-trail loss.
      // Normal subscribers remain best-effort; fail-closed callers rethrow below.
      try {
        mkdirSync(auditDir, { recursive: true });
        appendFileSync(
          join(auditDir, 'WRITE-FAILED'),
          `${new Date().toISOString()} origin=${input.origin} event=${input.event} error=${message}\n`,
          { flag: 'a' }
        );
      } catch {
        // Marker write also failed; nothing more we can do without throwing.
      }

      if (this.throwOnWriteFailure) {
        throw new Error(
          `[audit-trail] failed to append audit record ` +
            `(origin=${input.origin}, event=${input.event}): ${message}`,
        );
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
    for (const type of auditedEventTypes()) {
      events.on(type, (event: ConductorEvent) => {
        const input = this.toRecordInput(event);
        if (input) return this.record(input);
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
        this.stepsWithVerdicts.add(event.step);
        return {
          origin: event.step,
          event: event.satisfied ? 'gate_pass' : 'gate_fail',
          reason: event.reason,
        };
      case 'step_retry':
        return {
          origin: event.step,
          event: 'retry',
          reason: event.reason || 'step retry',
          attempt: event.attempt,
        };
      case 'kickback':
        return {
          origin: event.to,
          event: event.type,
          cause: `${event.from} evidence: ${event.evidence}`,
          ...(event.kickback_outcome ? { kickback_outcome: event.kickback_outcome } : {}),
        };
      case 'loop_halt':
        return { origin: event.step ?? 'build', event: 'intervention', cause: event.reason };
      case 'halt_marker_write_failed':
        return {
          origin: 'build',
          event: event.type,
          path: event.path,
          reason: event.reason,
        };
      case 'halt_cleared':
        return {
          origin: event.step ?? 'build',
          event: 'halt_cleared',
          cause: event.cause,
        };
      case 'verdict_freshness':
        return {
          origin: event.step,
          event: 'verdict_freshness',
          artifact: event.artifact,
          outcome: event.outcome,
        };
      case 'protected_artifact_reseal':
        return {
          origin: 'operator',
          event: 'reseal',
          paths: event.paths,
          reason: event.reason,
          fromCommit: event.fromCommit,
          toCommit: event.toCommit,
        };
      case 'protected_artifact_reseal_refused':
        return {
          origin: 'operator',
          event: 'reseal_refused',
          reason: event.reason,
          condition: event.condition,
          ...(event.path ? { path: event.path } : {}),
        };
      case 'step_completed':
        // Positive evidence for steps that never produce a gate_verdict
        // (e.g. early-exit steps). If a gate_verdict was already recorded
        // for this step, that verdict wins — skip to avoid a duplicate
        // pass record.
        if (this.stepsWithVerdicts.has(event.step)) return null;
        return { origin: event.step, event: 'gate_pass', reason: 'step completed' };
      default:
        return null;
    }
  }
}
