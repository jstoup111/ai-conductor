// Covers: task:10
import { describe, expect, it } from 'vitest';
import { runOverlapPreflight } from '../../src/engine/engineer/intake/overlap-preflight.js';

describe('overlap reruns', () => {
  it('treats explicit declines as decided and leaves new suggestions undecided', async () => {
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], declineOverlap: ['acme/app#1487'], interactive: false }, { suggestions: async () => ({
      shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }, { issue: 'acme/app#1487', sharedPaths: ['b.ts'] }], preAccepted: [], advisory: [],
    }) });
    expect(result).toMatchObject({ kind: 'refused', undecided: [{ issue: 'acme/app#1579' }] });
  });
});
