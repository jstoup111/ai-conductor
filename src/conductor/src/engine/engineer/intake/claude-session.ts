// engineer/intake/claude-session.ts — claude-session intake adapter
// FR-14, ADR-009, C5.
//
// Implements IntakePort for the claude-session source.
// Builds pending Envelopes from synchronous chat input.
// Polling adapters are deferred to 9.3b.

import { parseEnvelope } from './port.js';
import type { Envelope, EnvelopeStatus, IntakePort } from './port.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Parameters for building a chat Envelope. Caller supplies id and receivedAt
 *  for determinism — no Date.now() or Math.random() inside this module. */
export interface ChatEnvelopeParams {
  /** Unique identifier for this envelope. */
  id: string;
  /** Source-specific reference (e.g. chat turn ID). Must be non-empty. */
  sourceRef: string;
  /** The idea text. */
  text: string;
  /** ISO 8601 timestamp; caller-supplied for deterministic tests. */
  receivedAt: string;
  /** Optional hint toward the target repo. */
  hintRepo?: string;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Thrown when sourceRef is empty or whitespace-only.
 * parseEnvelope checks presence and type, but not non-emptiness for string fields
 * other than `text`. We enforce the sourceRef non-empty constraint here in the adapter.
 */
export class EmptySourceRefError extends Error {
  constructor() {
    super('Envelope field "sourceRef" must not be empty or whitespace-only [field: sourceRef]');
    this.name = 'EmptySourceRefError';
  }
}

// ─── Factory: buildChatEnvelope ───────────────────────────────────────────────

/**
 * Build a pending Envelope from a claude-session chat input.
 * Delegates to parseEnvelope for full boundary validation.
 *
 * Throws:
 * - EmptySourceRefError — sourceRef is empty or whitespace-only
 * - EnvelopeValidationError — any other required field is missing or invalid
 * - EmptyEnvelopeTextError — text is empty or whitespace-only
 */
export function buildChatEnvelope(params: ChatEnvelopeParams): Envelope {
  // Explicit non-empty sourceRef guard (parseEnvelope validates type/presence,
  // not non-emptiness for this field).
  if (params.sourceRef.trim() === '') {
    throw new EmptySourceRefError();
  }

  return parseEnvelope({
    id: params.id,
    source: 'claude-session',
    sourceRef: params.sourceRef,
    text: params.text,
    status: 'pending',
    receivedAt: params.receivedAt,
    ...(params.hintRepo !== undefined ? { hintRepo: params.hintRepo } : {}),
  });
}

// ─── Factory: createClaudeSessionAdapter ─────────────────────────────────────

/**
 * Create a claude-session IntakePort adapter.
 *
 * `report()` is a no-op for this phase (9.3b write-back is deferred).
 * There is no external sink for a synchronous chat idea.
 */
export function createClaudeSessionAdapter(): IntakePort {
  return {
    async report(_sourceRef: string, _status: EnvelopeStatus): Promise<void> {
      // no-op — 9.3b write-back deferred
    },
  };
}
