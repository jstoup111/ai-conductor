/**
 * Read-only governor report (Phase 9.3, FR-9, Task 29).
 *
 * `governorReport` reads the brain signal store via a `BrainStoreReader`,
 * computes aggregate metric rates via `computeSignalRates`, and returns a
 * structured `GovernorReport`. It is STRICTLY READ-ONLY: it must never write
 * to the store, registry, or any file; it never calls `appendSignal` or any
 * other mutating function.
 *
 * Design:
 *   - Uses `reader.readSignalsWithStats()` (not `readSignals`) to also capture
 *     the count of malformed / skipped lines for observability (FR-5).
 *   - Delegates all rate math to `computeSignalRates` (single source of truth,
 *     ADR-006). No rates are computed inline.
 *   - All edge cases (empty store, missing file, all-bad lines) are safe: the
 *     upstream `createBrainStoreReader` returns `[]` for missing/unreadable
 *     files, and `computeSignalRates` guards against zero-denominator NaN.
 */

import type { BrainStoreReader } from '../brain-store.js';
import { computeSignalRates } from './rates.js';

/**
 * Structured governor report returned by `governorReport`.
 *
 * All rate fields are fractions in [0, ∞) — see `SignalRates` for semantics.
 * `skipped` is the count of malformed / unparseable lines that were ignored
 * when reading signals.jsonl (FR-5 skipped-count observability).
 */
export interface GovernorReport {
  /** Total number of valid signals read from the store. */
  totalSignals: number;
  /** Aggregate token spend across all valid signals. */
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  /**
   * Total kickback events / totalSignals (per-run rate).
   * Always 0 when totalSignals === 0; never NaN.
   */
  kickbackRate: number;
  /**
   * Total halt events / totalSignals (per-run rate).
   * Always 0 when totalSignals === 0; never NaN.
   */
  haltRate: number;
  /**
   * Total retry events / totalSignals (per-run rate).
   * Always 0 when totalSignals === 0; never NaN.
   */
  retryRate: number;
  /**
   * Number of malformed / unparseable lines skipped when reading signals.jsonl.
   * Zero means all lines were valid (or the file was empty / absent).
   */
  skipped: number;
}

/**
 * Optional filter for `governorReport` — forwarded to `readSignalsWithStats`
 * so the report can be scoped to a specific project or feature.
 */
export interface GovernorReportOpts {
  filter?: { project?: string; feature?: string };
}

/**
 * Compute a read-only aggregate governor report from the brain signal store.
 *
 * READ-ONLY CONTRACT: this function MUST NEVER write to the store, registry,
 * or any file. It only calls `reader.readSignalsWithStats()` (a read
 * operation) and `computeSignalRates()` (a pure function). No throttling,
 * no backoff, no `appendSignal`, no filesystem writes.
 *
 * @param reader  A `BrainStoreReader` (e.g. from `createBrainStoreReader`).
 * @param opts    Optional filter to scope the report to a project/feature.
 * @returns       A `GovernorReport` with aggregate metrics + skipped count.
 */
export async function governorReport(
  reader: BrainStoreReader,
  opts?: GovernorReportOpts,
): Promise<GovernorReport> {
  // Read signals — readSignalsWithStats gives us both the valid signals and the
  // count of malformed lines that were skipped (FR-5 observability).
  const { signals, skipped } = await reader.readSignalsWithStats(opts?.filter);

  // Delegate all rate math to the canonical computeSignalRates function.
  // This handles empty-array / zero-denominator guards (returns 0, not NaN).
  const rates = computeSignalRates(signals);

  return {
    totalSignals: rates.totalSignals,
    tokens: rates.tokens,
    kickbackRate: rates.kickbackRate,
    haltRate: rates.haltRate,
    retryRate: rates.retryRate,
    skipped,
  };
}
