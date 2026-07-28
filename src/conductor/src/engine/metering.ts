import type { TokenUsage } from '../execution/llm-provider.js';

export type MeteringClassification = 'fully-metered' | 'cost-unmetered' | 'unmetered';

/** Classify a dispatch's provider-reported usage without inventing a cost. */
export function classifyMetering(
  tokenUsage: TokenUsage | undefined,
): MeteringClassification {
  if (!tokenUsage) return 'unmetered';
  return typeof tokenUsage.costUsd === 'number' && Number.isFinite(tokenUsage.costUsd)
    ? 'fully-metered'
    : 'cost-unmetered';
}
