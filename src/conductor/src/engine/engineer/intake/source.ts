// engineer/intake/source.ts — IntakeSource async capture interface (FR-25).
// Distinct from IntakePort (synchronous push boundary); IntakeSource is a pull
// interface for async adapters that batch-poll an external source.

import type { Envelope } from './port.js';

/**
 * IntakeSource — async pull interface for external idea sources.
 * An adapter (e.g. github-issues) implements this; the engineer core
 * depends only on this interface, never on any concrete adapter.
 */
export interface IntakeSource {
  /** Fetch zero or more envelopes from the source. Must not throw on empty. */
  poll(): Promise<Envelope[]>;
}

/**
 * Runtime guard: returns true iff `x` is an object with a function-typed `poll`.
 * Use this wherever untrusted values need to be narrowed to IntakeSource.
 */
export function isIntakeSource(x: unknown): x is IntakeSource {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as Record<string, unknown>)['poll'] === 'function'
  );
}
