import type { LedgerEntry } from './ledger.js';
import { isStaleClaim } from './stale-claim.js';

export interface QueueDepth {
  pending: number;
  claimed: number;
  stranded: number;
}

/** Summarize the durable intake state without reading or changing its ledger. */
export function summarizeQueueDepth(
  entries: readonly LedgerEntry[],
  nowMs: number,
  staleClaimWindowMs: number,
): QueueDepth {
  let pending = 0;
  let claimed = 0;
  let stranded = 0;

  for (const entry of entries) {
    if (entry.status === 'pending') pending += 1;
    if (entry.status === 'claimed') {
      claimed += 1;
      if (isStaleClaim(entry, nowMs, staleClaimWindowMs)) stranded += 1;
    }
  }

  return { pending, claimed, stranded };
}
