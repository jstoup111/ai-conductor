// engineer/intake/port.ts — Envelope contract + parseEnvelope + IntakePort interface
// FR-13, FR-16, ADR-009, C5.

// ─── Envelope ────────────────────────────────────────────────────────────────

/** Status values for an Envelope's lifecycle. */
export type EnvelopeStatus = 'pending' | 'routed' | 'deciding' | 'done';

const VALID_STATUSES: ReadonlySet<string> = new Set(['pending', 'routed', 'deciding', 'done']);

/**
 * Envelope — the sole data contract crossing the intake port boundary.
 * Produced by an adapter (e.g. claude-session); consumed by the engineer core.
 */
export interface Envelope {
  /** Unique identifier for this envelope. */
  id: string;
  /** Which source produced this envelope (e.g. "claude-session"). */
  source: string;
  /** Source-specific reference (e.g. chat turn ID). Idempotency key with source. */
  sourceRef: string;
  /** The idea text — never empty/whitespace. */
  text: string;
  /** Optional hint toward the target repo. */
  hintRepo?: string;
  /** Optional resolved routing target repo (set by origin enrichment). */
  target?: string;
  /** Lifecycle status. */
  status: EnvelopeStatus;
  /** ISO 8601 timestamp of when the envelope entered the system. */
  receivedAt: string;
}

// ─── EmptyEnvelopeTextError ───────────────────────────────────────────────────

/**
 * Thrown by parseEnvelope when the `text` field is empty or whitespace-only.
 * C5: empty/whitespace text must be explicitly rejected, not silently dropped.
 */
export class EmptyEnvelopeTextError extends Error {
  constructor() {
    super('Envelope field "text" must not be empty or whitespace-only');
    this.name = 'EmptyEnvelopeTextError';
  }
}

// ─── EnvelopeValidationError ──────────────────────────────────────────────────

/**
 * Thrown by parseEnvelope when a required field is missing or has an invalid value.
 * The message names the offending field.
 */
export class EnvelopeValidationError extends Error {
  constructor(field: string, reason: string) {
    super(`Envelope field "${field}" ${reason} [field: ${field}]`);
    this.name = 'EnvelopeValidationError';
  }
}

// ─── parseEnvelope ────────────────────────────────────────────────────────────

/**
 * Parse and validate an unknown input as an Envelope.
 * Parse-don't-validate: all checks are at this boundary; downstream receives
 * a typed Envelope and can trust it.
 *
 * Throws:
 * - EnvelopeValidationError — missing required field or invalid status value
 * - EmptyEnvelopeTextError  — text is empty or whitespace-only
 */
export function parseEnvelope(input: Record<string, unknown>): Envelope {
  // ── Required string fields ────────────────────────────────────────────────
  const requiredStringFields = ['id', 'source', 'sourceRef', 'receivedAt'] as const;
  for (const field of requiredStringFields) {
    if (!(field in input) || input[field] === undefined || input[field] === null) {
      throw new EnvelopeValidationError(field, 'is required');
    }
    if (typeof input[field] !== 'string') {
      throw new EnvelopeValidationError(field, 'must be a string');
    }
  }

  // ── text field — required, must not be empty/whitespace ──────────────────
  if (!('text' in input) || input.text === undefined || input.text === null) {
    throw new EnvelopeValidationError('text', 'is required');
  }
  if (typeof input.text !== 'string') {
    throw new EnvelopeValidationError('text', 'must be a string');
  }
  if (input.text.trim() === '') {
    throw new EmptyEnvelopeTextError();
  }

  // ── status — required, must be one of the allowed values ─────────────────
  if (!('status' in input) || input.status === undefined || input.status === null) {
    throw new EnvelopeValidationError('status', 'is required');
  }
  if (typeof input.status !== 'string' || !VALID_STATUSES.has(input.status)) {
    throw new EnvelopeValidationError(
      'status',
      `must be one of ${[...VALID_STATUSES].join('|')} (got: ${String(input.status)})`,
    );
  }

  // ── optional hintRepo ─────────────────────────────────────────────────────
  const hintRepo =
    'hintRepo' in input && typeof input.hintRepo === 'string' ? input.hintRepo : undefined;

  return {
    id: input.id as string,
    source: input.source as string,
    sourceRef: input.sourceRef as string,
    text: input.text,
    hintRepo,
    status: input.status as EnvelopeStatus,
    receivedAt: input.receivedAt as string,
  };
}

// ─── ReportMeta ───────────────────────────────────────────────────────────────

/**
 * Optional metadata passed to IntakePort.report() during 9.3b write-back.
 * Carrying the resolved repo and the spec PR URL back to the originating source.
 * FR-36: widened from the original 2-arg signature.
 */
export interface ReportMeta {
  /** The target repository name that was resolved for this envelope. */
  repo?: string;
  /** The URL of the spec PR opened for this envelope. */
  prUrl?: string;
}

// ─── ReportOutcome ────────────────────────────────────────────────────────────

/**
 * Result of an IntakePort.report() call.
 * `ok: true` — the write-back succeeded (or is a no-op, as with claude-session).
 * `ok: false` — the write-back failed; `remediation` carries human-readable
 * steps the caller/operator can act on (e.g. re-authenticate `gh`).
 */
export type ReportOutcome = { ok: true } | { ok: false; remediation: string[] };

// ─── IntakePort ───────────────────────────────────────────────────────────────

/**
 * IntakePort — the hexagonal port the engineer core depends on.
 * Adapters (e.g. claude-session) implement this interface.
 * FR-13: engineer core imports this interface only, never the concrete adapter.
 *
 * `report()` is reserved for 9.3b write-back (bidirectional port).
 * claude-session's implementation is a no-op; there is no external sink for
 * a synchronous chat idea.
 */
export interface IntakePort {
  /**
   * Report status back to the originating source.
   * The optional `meta` carries write-back context (resolved repo, PR URL).
   * No-op for the claude-session adapter; future adapters (github-issues) will use it.
   * FR-36: `meta` widens the original 2-arg signature — existing callers are unaffected.
   */
  report(sourceRef: string, status: EnvelopeStatus, meta?: ReportMeta): Promise<ReportOutcome>;
}
