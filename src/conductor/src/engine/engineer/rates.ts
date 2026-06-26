/**
 * Shared canonical metric-rate function (Phase 9.3, FR-9 + FR-12, ADR-006).
 *
 * `computeSignalRates` is the SINGLE source of truth for aggregate metric rates
 * over a set of EngineerSignals. It is distinct from the 429-backoff rate in
 * conductor.ts — those are separate concerns. This one covers gate-loop quality
 * metrics: kickback, halt, and retry rates, plus aggregate token spend.
 *
 * Design:
 *   - Reuses `EngineerSignal.tokens`, `EngineerSignal.kickbacks`, `EngineerSignal.halts`,
 *     and `EngineerSignal.retryHotspots` — already assembled by `assembleSignal`
 *     via `aggregateTokens`, `aggregateKickbacks`, `aggregateHalts`, and
 *     `aggregateRetryHotspots` from report-renderer.ts. No re-aggregation.
 *   - Denominators and counts mirror the 9.1 signal-assembly contract.
 *   - Edge-case guards (empty array / zero denominator) are Task 9 scope.
 */

import type { EngineerSignal } from '../engineer-store.js';

/**
 * Return shape of `computeSignalRates`. All rate fields are fractions in
 * [0, ∞) (counts per signal run, not capped to 1 — a single run can carry
 * multiple kickbacks, giving a rate > 1).
 */
export interface SignalRates {
  /** Total signals (= denominator for rate calculations). */
  totalSignals: number;
  /** Aggregate token spend across all signals. */
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  /**
   * Total kickback events (sum of KickbackEntry.count) / totalSignals.
   * Per 9.1 signal assembly, each KickbackEntry.count records the number
   * of times that specific from→to gate pair triggered a kickback.
   */
  kickbackRate: number;
  /**
   * Total halt events (sum of HaltEntry lengths) / totalSignals.
   * A halt is a loop_halt event; each HaltEntry is one such event.
   */
  haltRate: number;
  /**
   * Total retry events (sum of RetryHotspot.count) / totalSignals.
   * Per 9.1 signal assembly, each RetryHotspot.count is the total retries
   * for that step in the run.
   */
  retryRate: number;
}

/**
 * Compute aggregate metric rates over a set of EngineerSignals.
 *
 * Reuses the pre-aggregated fields on each EngineerSignal (assembled via
 * report-renderer.ts helpers in engineer-store.ts#assembleSignal) — no
 * re-parsing of raw events.
 *
 * Denominators:
 *   kickbackRate = Σ(signal.kickbacks[i].count) / signals.length
 *   haltRate     = Σ(signal.halts.length)       / signals.length
 *   retryRate    = Σ(signal.retryHotspots[i].count) / signals.length
 *
 * Token spend: simple field-by-field sum across all signals.
 *
 * Note: Edge-case guards for empty arrays / zero denominator are Task 9 scope.
 * Happy-path callers are expected to pass a non-empty array.
 */
export function computeSignalRates(signals: EngineerSignal[]): SignalRates {
  const totalSignals = signals.length;

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalKickbacks = 0;
  let totalHalts = 0;
  let totalRetries = 0;

  for (const sig of signals) {
    // Token spend — already summed per-run by assembleSignal via aggregateTokens.
    totalInput += sig.tokens.input;
    totalOutput += sig.tokens.output;
    totalCacheRead += sig.tokens.cacheRead;
    totalCacheCreation += sig.tokens.cacheCreation;

    // Kickback count — sum KickbackEntry.count fields (each entry records how
    // many times that from→to pair fired; assembled by aggregateKickbacks).
    // Guard: treat missing/undefined count as 1 (one kickback event per entry)
    // to remain correct when kickback entries omit the count field.
    for (const kb of sig.kickbacks) {
      totalKickbacks += typeof (kb as any).count === 'number' ? (kb as any).count : 1;
    }

    // Halt count — one HaltEntry per loop_halt event (assembled by aggregateHalts).
    totalHalts += sig.halts.length;

    // Retry count — sum RetryHotspot.count fields (assembled by aggregateRetryHotspots).
    for (const rh of sig.retryHotspots) {
      totalRetries += rh.count;
    }
  }

  // Guard: when totalSignals === 0 (empty array), all rate denominators are
  // zero. Return 0 rather than NaN so downstream consumers (governor report,
  // flywheel trend) always receive a finite, safe value (FR-9, FR-12).
  // Token spend sums are also 0 for an empty array — no special case needed
  // there since summing over an empty loop already yields 0.
  const safeTotal = totalSignals > 0 ? totalSignals : 1;

  return {
    totalSignals,
    tokens: {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheCreation: totalCacheCreation,
    },
    kickbackRate: totalKickbacks / safeTotal,
    haltRate: totalHalts / safeTotal,
    retryRate: totalRetries / safeTotal,
  };
}
