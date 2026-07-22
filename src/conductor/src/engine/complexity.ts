import type { ComplexityTier } from '../types/index.js';

export type Signal =
  | 'models'
  | 'integrations'
  | 'auth'
  | 'stateMachines'
  | 'stories';

type ThresholdDef = { s: number; m: number };

// Each signal defines upper bounds: count <= s => S, count <= m => M, else L
const THRESHOLDS: Record<Signal, ThresholdDef> = {
  models: { s: 3, m: 7 },
  integrations: { s: 0, m: 2 },
  auth: { s: 0, m: 1 },
  stateMachines: { s: 0, m: 1 },
  stories: { s: 5, m: 15 },
};

export function classifySignal(signal: Signal, count: number): ComplexityTier {
  const t = THRESHOLDS[signal];
  if (count <= t.s) return 'S';
  if (count <= t.m) return 'M';
  return 'L';
}

const TIER_ORDER: Record<ComplexityTier, number> = { S: 0, M: 1, L: 2 };

export function assessTier(
  signals: Record<Signal, ComplexityTier>,
): ComplexityTier {
  const counts: Record<ComplexityTier, number> = { S: 0, M: 0, L: 0 };
  for (const tier of Object.values(signals)) {
    counts[tier]++;
  }

  // Find max count
  const maxCount = Math.max(counts.S, counts.M, counts.L);

  // Collect tiers with max count (could be a tie)
  const candidates = (['S', 'M', 'L'] as ComplexityTier[]).filter(
    (t) => counts[t] === maxCount,
  );

  // Tie breaks toward higher tier
  return candidates.reduce((a, b) =>
    TIER_ORDER[b] > TIER_ORDER[a] ? b : a,
  );
}

export function hasInsufficientInfo(signalCount: number): boolean {
  return signalCount < 3;
}

/**
 * Deterministic label→tier seed (issue #765, T7). Maps a size label of the
 * `size: <S|M|L>` shape (as produced by intake's `label-sync.ts` GitHub
 * labeling) to its `ComplexityTier`, so a caller can short-circuit the
 * full `assessTier` signal-based classification when the label is already
 * known. Returns `undefined` for anything that doesn't match — callers
 * fall back to `assessTier`.
 *
 * Scope note (T7): this is a narrowly-scoped label-parsing helper only. It
 * is not yet wired into the `.docs/complexity/<slug>.md` generation path
 * (parseComplexityTier/assessTier callers) — see commit message for the
 * scope decision.
 */
export function tierFromSizeLabel(label: string): ComplexityTier | undefined {
  const m = label.match(/\bsize:\s*([SML])\b/i);
  if (!m) return undefined;
  return m[1].toUpperCase() as ComplexityTier;
}

/**
 * Scan an array of GitHub label names (e.g. an Envelope's `labels`) for a
 * `size: <S|M|L>` label and return its parsed tier. Returns `undefined` when
 * no label matches — callers fall back to the existing assessTier signal walk.
 */
export function tierFromSizeLabels(labels: string[]): ComplexityTier | undefined {
  for (const label of labels) {
    const tier = tierFromSizeLabel(label);
    if (tier) return tier;
  }
  return undefined;
}
