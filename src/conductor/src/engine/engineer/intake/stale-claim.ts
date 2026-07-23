// stale-claim.ts — shared age-past-window predicate for stranded `claimed` ledger
// entries (FR-2, FR-3). Never reaps on an unparseable/missing lastSeenAt.

import type { LedgerEntry } from './ledger.js';

/**
 * True iff `entry` is `claimed` and its age (nowMs − lastSeenAt) exceeds
 * `windowMs`. Missing or unparseable `lastSeenAt` never counts as stale —
 * fail closed rather than reap on bad data.
 */
export function isStaleClaim(entry: LedgerEntry, nowMs: number, windowMs: number): boolean {
  if (entry.status !== 'claimed') return false;
  if (!entry.lastSeenAt) return false;

  const lastSeenMs = Date.parse(entry.lastSeenAt);
  if (Number.isNaN(lastSeenMs)) return false;

  return nowMs - lastSeenMs > windowMs;
}
