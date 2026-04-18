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
