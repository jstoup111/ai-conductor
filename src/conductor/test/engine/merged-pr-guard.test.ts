import { describe, it, expect } from 'vitest';

import { verifyMergedPrShipment } from '../../src/engine/merged-pr-guard.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const PR_URL = 'https://github.com/foo/bar/pull/42';

function fakeGh(
  verdict: 'MERGED' | 'throw',
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args, _opts) => {
    calls.push([...args]);
    if (verdict === 'throw') throw new Error('gh runner failure');
    return {
      stdout: JSON.stringify({
        state: verdict,
        mergeCommit: { oid: '1234567890abcdef1234567890abcdef12345678' },
      }),
    };
  };
  return { gh, calls };
}

describe('engine/merged-pr-guard — verified merged shipment (Task 8)', () => {
  it('valid merged history is eligible for normal completion', async () => {
    const { gh } = fakeGh('MERGED');

    const result = await verifyMergedPrShipment(gh, '/repo', PR_URL, 'feature-a', {
      evaluate: async () => ({
        kind: 'valid',
        slug: 'feature-a',
        pr: PR_URL,
        recordPath: '.docs/shipped/feature-a.md',
        hash: 'a'.repeat(64),
        commit: '1234567890abcdef1234567890abcdef12345678',
      }),
    });

    expect(result).toEqual({ kind: 'verified' });
  });

  it('recordless merged history refuses convergence', async () => {
    const { gh } = fakeGh('MERGED');

    const result = await verifyMergedPrShipment(gh, '/repo', PR_URL, 'feature-a', {
      evaluate: async () => ({
        kind: 'refusal',
        code: 'shipped-record-missing',
        expected: '.docs/shipped/feature-a.md',
        observed: null,
      }),
    });

    expect(result).toMatchObject({ kind: 'halt', reason: 'shipped-record-missing' });
  });

  it('a hash-mismatched record refuses convergence', async () => {
    const { gh } = fakeGh('MERGED');

    const result = await verifyMergedPrShipment(gh, '/repo', PR_URL, 'feature-a', {
      evaluate: async () => ({
        kind: 'refusal',
        code: 'shipped-record-hash-mismatch',
        expected: 'expected canonical hash',
        observed: 'recorded hash',
      }),
    });

    expect(result).toMatchObject({ kind: 'halt', reason: 'shipped-record-hash-mismatch' });
  });

  it('unavailable merge state refuses convergence', async () => {
    const { gh } = fakeGh('throw');

    const result = await verifyMergedPrShipment(gh, '/repo', PR_URL, 'feature-a');

    expect(result).toMatchObject({
      kind: 'halt',
      reason: expect.stringContaining('merge-state-unavailable'),
    });
  });

  it('unavailable merged-history evidence refuses convergence', async () => {
    const { gh } = fakeGh('MERGED');

    const result = await verifyMergedPrShipment(gh, '/repo', PR_URL, 'feature-a', {
      evaluate: async () => {
        throw new Error('git object unavailable');
      },
    });

    expect(result).toMatchObject({
      kind: 'halt',
      reason: expect.stringContaining('merged-history-unavailable'),
    });
  });
});
