// stale-claim.test.ts — boundary tests for isStaleClaim predicate (FR-2, FR-3).

import { describe, it, expect } from 'vitest';
import { isStaleClaim } from '../../../../src/engine/engineer/intake/stale-claim.js';
import type { LedgerEntry } from '../../../../src/engine/engineer/intake/ledger.js';

const baseEntry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  source: 'github',
  sourceRef: 'owner/repo#1',
  status: 'claimed',
  attempts: 0,
  ...overrides,
});

describe('isStaleClaim', () => {
  const windowMs = 1000;

  it('returns true for a claimed entry older than the window', () => {
    const now = 10_000;
    const entry = baseEntry({ lastSeenAt: new Date(now - windowMs - 1).toISOString() });
    expect(isStaleClaim(entry, now, windowMs)).toBe(true);
  });

  it('returns false for a claimed entry within the window', () => {
    const now = 10_000;
    const entry = baseEntry({ lastSeenAt: new Date(now - windowMs + 1).toISOString() });
    expect(isStaleClaim(entry, now, windowMs)).toBe(false);
  });

  it('returns false for a claimed entry exactly at the window boundary', () => {
    const now = 10_000;
    const entry = baseEntry({ lastSeenAt: new Date(now - windowMs).toISOString() });
    expect(isStaleClaim(entry, now, windowMs)).toBe(false);
  });

  it('returns false for a non-claimed entry, even if very old', () => {
    const now = 10_000;
    const entry = baseEntry({
      status: 'pending',
      lastSeenAt: new Date(now - windowMs * 1000).toISOString(),
    });
    expect(isStaleClaim(entry, now, windowMs)).toBe(false);
  });

  it('returns false when lastSeenAt is missing', () => {
    const now = 10_000;
    const entry = baseEntry({ lastSeenAt: undefined });
    expect(isStaleClaim(entry, now, windowMs)).toBe(false);
  });

  it('returns false when lastSeenAt is an invalid date string', () => {
    const now = 10_000;
    const entry = baseEntry({ lastSeenAt: 'not-a-date' });
    expect(isStaleClaim(entry, now, windowMs)).toBe(false);
  });
});
