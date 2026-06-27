// engineer/intake/queue.ts — IntakeQueue interface + file-backed factory stub.
// FR-29, ADR-011, T3.
// C1 constraint: claim uses its own atomic primitive (not the O_EXCL engine lock).
// See T9–T12 for implementation.

import type { Envelope } from './port.js';

// ─── IntakeQueue ──────────────────────────────────────────────────────────────

/**
 * Durable inbox for Envelopes.
 *
 * - enqueue: persist an Envelope; must be idempotent on Envelope.id.
 * - claim:   atomically take the oldest un-claimed Envelope (by receivedAt),
 *            or return null when the inbox is empty.
 * - ack:     mark a previously claimed Envelope as processed (remove from inbox).
 * - release: return a claimed Envelope to the inbox for re-delivery.
 *
 * FR-29/FR-30, ADR-011.
 */
export interface IntakeQueue {
  enqueue(e: Envelope): Promise<void>;
  claim(): Promise<Envelope | null>;
  ack(e: Envelope): Promise<void>;
  release(e: Envelope): Promise<void>;
}

// ─── createFileQueue ──────────────────────────────────────────────────────────

/**
 * Create a file-backed IntakeQueue rooted at `dir`.
 *
 * Stub — implementation provided by T9–T12.
 * All methods throw until the impl tasks fill them in.
 */
export function createFileQueue(dir: string): IntakeQueue {
  return {
    async enqueue(_e: Envelope): Promise<void> {
      throw new Error(`not implemented: T9/T10 (createFileQueue dir=${dir})`);
    },
    async claim(): Promise<Envelope | null> {
      throw new Error(`not implemented: T9/T10 (createFileQueue dir=${dir})`);
    },
    async ack(_e: Envelope): Promise<void> {
      throw new Error(`not implemented: T9/T10 (createFileQueue dir=${dir})`);
    },
    async release(_e: Envelope): Promise<void> {
      throw new Error(`not implemented: T9/T10 (createFileQueue dir=${dir})`);
    },
  };
}
