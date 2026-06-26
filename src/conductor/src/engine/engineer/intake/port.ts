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
   * Reserved for 9.3b write-back. Report status back to the originating source.
   * No-op for the claude-session adapter this phase.
   */
  report(sourceRef: string, status: EnvelopeStatus): Promise<void>;
}
