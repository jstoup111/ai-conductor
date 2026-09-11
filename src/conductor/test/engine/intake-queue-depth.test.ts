// Covers: task:1

import { describe, expect, it } from 'vitest';
import { summarizeQueueDepth } from '../../src/engine/engineer/intake/queue-depth.js';
import type { LedgerEntry } from '../../src/engine/engineer/intake/ledger.js';

const now = Date.UTC(2026, 8, 11, 12, 0, 0);

const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  source: 'github-issues',
  sourceRef: 'owner/repo#1',
  status: 'pending',
  attempts: 0,
  ...overrides,
});

const entries: LedgerEntry[] = [
  entry({ status: 'pending' }),
  entry({ status: 'pending', sourceRef: 'owner/repo#2' }),
  entry({ status: 'claimed', sourceRef: 'owner/repo#3', lastSeenAt: new Date(now - 2_000).toISOString() }),
  entry({ status: 'claimed', sourceRef: 'owner/repo#4', lastSeenAt: new Date(now - 500).toISOString() }),
  entry({ status: 'claimed', sourceRef: 'owner/repo#5' }),
  entry({ status: 'claimed', sourceRef: 'owner/repo#6', lastSeenAt: 'not-a-date' }),
  entry({ status: 'claimed', sourceRef: 'owner/repo#7', lastSeenAt: new Date(now - 2_000).toISOString(), prUrl: 'https://github.com/owner/repo/pull/7' }),
  entry({ status: 'unseen', sourceRef: 'owner/repo#8' }),
  entry({ status: 'routed', sourceRef: 'owner/repo#9' }),
  entry({ status: 'deciding', sourceRef: 'owner/repo#10' }),
  entry({ status: 'done', sourceRef: 'owner/repo#11' }),
  entry({ status: 'needs-manual', sourceRef: 'owner/repo#12' }),
];

describe('summarizeQueueDepth', () => {
  it.each([
    ['a one-second window', 1_000, { pending: 2, claimed: 5, stranded: 1 }],
    ['a three-second window', 3_000, { pending: 2, claimed: 5, stranded: 0 }],
  ])('counts durable statuses with %s', (_label, windowMs, expected) => {
    expect(summarizeQueueDepth(entries, now, windowMs)).toEqual(expected);
  });

  it('does not mutate its input entries', () => {
    const before = structuredClone(entries);

    summarizeQueueDepth(entries, now, 1_000);

    expect(entries).toEqual(before);
  });
});
