/**
 * FR-12 flywheel trend over store ∩ authored-keys ledger (Phase 9.3, ADR-006).
 *
 * `computeFlywheelTrend` computes the learning trajectory of the engineer by
 * computing per-feature metric rates over ONLY the features that:
 *   1. appear in the engineer signal store (have at least one EngineerSignal), AND
 *   2. appear in the authored-keys ledger (the engineer actually planned them).
 *
 * Features in the store but NOT in the ledger (non-engineer signals) are excluded.
 * Features in the ledger but with ZERO store signals are absent from the output
 * (no zero-rate phantom entries are fabricated).
 *
 * Design decisions (documented for callers):
 *
 * ORDERING RULE:
 *   Features are ordered chronologically by their EARLIEST signal `ts` field
 *   (oldest-first). This represents the order in which the engineer first
 *   encountered each feature, producing a natural timeline of learned
 *   experience. When a feature has multiple runs, all signal ts values are
 *   compared and the minimum is used as that feature's anchor timestamp.
 *
 * TREND RATE:
 *   Trend direction is driven by `kickbackRate` (kickbacks per signal run).
 *   Kickbacks represent the engineer being corrected by a gate — a lower rate
 *   means the engineer is producing fewer corrections-needed, i.e. improving.
 *   Direction is computed by comparing the FIRST feature's kickbackRate to
 *   the LAST feature's kickbackRate (after chronological ordering):
 *     - first > last  → "improving"  (kickbacks decreased over time)
 *     - first < last  → "regressing" (kickbacks increased over time)
 *     - first === last → "flat"       (no change)
 *
 * INSUFFICIENT DATA:
 *   When fewer than 2 features survive the store ∩ ledger intersection (after
 *   filtering out ledger-only keys with no signals), the function returns an
 *   `FlywheelTrendInsufficient` sentinel with `kind: "insufficient-data"`.
 *   Callers MUST check `result.kind` before treating the result as a trend.
 */

import type { EngineerStoreReader } from '../engineer-store.js';
import type { AuthoredKey, AuthoredLedgerOpts } from './authored-ledger.js';
import { recordAuthoredKey, readAuthoredKeys } from './authored-ledger.js';
import { computeSignalRates } from './rates.js';
import type { SignalRates } from './rates.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/** Trend direction: kickbackRate first→last comparison. */
export type TrendDirection = 'improving' | 'regressing' | 'flat';

/** Per-feature entry in the trend output. */
export interface FeatureTrendEntry {
  project: string;
  feature: string;
  /** Earliest signal ts for this feature (ISO string; used as ordering anchor). */
  earliestTs: string;
  /** Aggregate rates over all signals for this (project, feature) pair. */
  rates: SignalRates;
}

/**
 * Successful trend result: >=2 engineer-planned features with store signals.
 *
 * `series` is chronologically ordered (oldest earliestTs first).
 * `direction` compares `series[0].rates.kickbackRate` vs
 * `series[series.length - 1].rates.kickbackRate`.
 * `skipped` is the count of malformed / unparseable lines skipped when reading
 * signals.jsonl (FR-12 skipped-count observability). Zero when all lines valid.
 */
export interface FlywheelTrend {
  kind: 'trend';
  /** Chronologically-ordered (earliest ts first) per-feature rate entries. */
  series: FeatureTrendEntry[];
  /** Trend direction driven by kickbackRate (first → last). */
  direction: TrendDirection;
  /**
   * Count of malformed / unparseable lines skipped when reading signals.jsonl
   * (FR-12 observability). Zero when no lines were malformed.
   */
  skipped: number;
}

/**
 * Insufficient-data sentinel: fewer than 2 engineer-planned features survived the
 * store ∩ ledger intersection. No trend direction can be derived.
 *
 * `direction` is always `"insufficient_data"` — never "improving"/"regressing".
 * `skipped` is the count of malformed lines skipped (FR-12 observability).
 */
export interface FlywheelTrendInsufficient {
  kind: 'insufficient-data';
  /** Always "insufficient_data" — distinguishes from valid trend directions. */
  direction: 'insufficient_data';
  /** How many features did survive the intersection (0 or 1). */
  featuresFound: number;
  /**
   * Count of malformed / unparseable lines skipped when reading signals.jsonl
   * (FR-12 observability). Zero when no lines were malformed.
   */
  skipped: number;
}

/** Union of both possible return shapes. Callers must narrow on `kind`. */
export type FlywheelTrendResult = FlywheelTrend | FlywheelTrendInsufficient;

// ─── Authored-ledger object type ──────────────────────────────────────────────

/**
 * Durable ledger object returned by `createAuthoredLedger`.
 *
 * Exposes `record` (mutating, idempotent) and `read` (non-mutating) methods
 * backed by the `authored-ledger.ts` file-based persistence layer.
 */
export interface AuthoredLedger {
  /** Record a (project, feature) pair. Idempotent. */
  record(project: string, feature: string): Promise<void>;
  /** Read all recorded (project, feature) pairs. */
  read(): Promise<AuthoredKey[]>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a durable authored-ledger object backed by `authored-ledger.ts`.
 *
 * `opts` is forwarded to `recordAuthoredKey`/`readAuthoredKeys` — it may
 * include `engineerDir` to override the default engineer directory (driven by
 * `$AI_CONDUCTOR_ENGINEER_DIR` or a default path). When called with no args,
 * the ledger resolves its directory from the environment at call time.
 *
 * @example
 *   const ledger = createAuthoredLedger();
 *   await ledger.record('my-project', 'feature-x');
 *   const keys = await ledger.read();
 */
export function createAuthoredLedger(opts?: AuthoredLedgerOpts): AuthoredLedger {
  return {
    async record(project: string, feature: string): Promise<void> {
      await recordAuthoredKey(project, feature, opts);
    },
    async read(): Promise<AuthoredKey[]> {
      return readAuthoredKeys(opts);
    },
  };
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Compute the flywheel learning trend over `store signals ∩ authored-keys ledger`.
 *
 * @param reader  — A EngineerStoreReader from `createEngineerStoreReader()`.
 * @param ledger  — Either:
 *                  (a) An `AuthoredKey[]` array (raw keys — backward-compatible
 *                      with the original callers that pass `readAuthoredKeys()`
 *                      output directly), OR
 *                  (b) An `AuthoredLedger` object from `createAuthoredLedger()`
 *                      (durable ledger with `record`/`read` methods).
 *                  When an object is passed, its `read()` method is called to
 *                  obtain the keys; when an array is passed, it is used directly.
 * @param _opts   — Reserved for future extension (currently unused).
 *
 * @returns `FlywheelTrend` when >=2 features are present in both store and ledger,
 *          `FlywheelTrendInsufficient` otherwise.
 */
export async function computeFlywheelTrend(
  reader: EngineerStoreReader,
  ledger: AuthoredKey[] | AuthoredLedger,
  _opts?: Record<string, unknown>,
): Promise<FlywheelTrendResult> {
  // Normalize: resolve to AuthoredKey[] regardless of input form.
  const keys: AuthoredKey[] = Array.isArray(ledger) ? ledger : await ledger.read();

  // Step 1: Build a set of authored keys for O(1) intersection lookup.
  // Key format: "project\x00feature" (null-byte separator, same as authored-ledger.ts).
  const ledgerSet = new Set<string>(
    keys.map(({ project, feature }) => `${project}\x00${feature}`),
  );

  // Step 2: Read ALL signals from the store (no filter — we intersect manually
  // so we pull once and group rather than making N per-feature reader calls).
  // Use readSignalsWithStats so we can surface the skipped-malformed-lines count
  // to callers (FR-12 observability). Malformed lines are silently skipped by
  // the reader; the count is propagated in both result shapes.
  const { signals: allSignals, skipped } = await reader.readSignalsWithStats();

  // Step 3: Group signals by (project, feature) and INTERSECT with the ledger.
  // Non-engineer signals (in store, not in ledger) are skipped here.
  const grouped = new Map<string, { project: string; feature: string; signals: (typeof allSignals)[0][] }>();

  for (const sig of allSignals) {
    const key = `${sig.project}\x00${sig.feature}`;
    // INTERSECTION: only include if the (project,feature) pair is in the ledger.
    if (!ledgerSet.has(key)) continue;

    if (!grouped.has(key)) {
      grouped.set(key, { project: sig.project, feature: sig.feature, signals: [] });
    }
    grouped.get(key)!.signals.push(sig);
  }

  // Step 4: Build per-feature trend entries.
  // Features in the ledger with ZERO store signals are absent (never added to
  // `grouped` above), so they cannot produce phantom entries here.
  const entries: FeatureTrendEntry[] = [];

  for (const { project, feature, signals } of grouped.values()) {
    // Earliest ts: minimum of all signal ts values for this feature.
    const earliestTs = signals
      .map((s) => s.ts)
      .reduce((min, ts) => (ts < min ? ts : min));

    const rates = computeSignalRates(signals);

    entries.push({ project, feature, earliestTs, rates });
  }

  // Step 5: Order chronologically by earliestTs (oldest first).
  entries.sort((a, b) => a.earliestTs.localeCompare(b.earliestTs));

  // Step 6: Insufficient-data guard — need >=2 features to derive a trend.
  if (entries.length < 2) {
    return {
      kind: 'insufficient-data',
      direction: 'insufficient_data',
      featuresFound: entries.length,
      skipped,
    };
  }

  // Step 7: Compute trend direction from kickbackRate first→last.
  const firstRate = entries[0]!.rates.kickbackRate;
  const lastRate = entries[entries.length - 1]!.rates.kickbackRate;

  let direction: TrendDirection;
  if (firstRate > lastRate) {
    direction = 'improving';
  } else if (firstRate < lastRate) {
    direction = 'regressing';
  } else {
    direction = 'flat';
  }

  return {
    kind: 'trend',
    series: entries,
    direction,
    skipped,
  };
}
