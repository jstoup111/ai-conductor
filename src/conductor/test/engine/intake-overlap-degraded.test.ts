// Covers: task:13
import { describe, expect, it } from 'vitest';
import { collectOverlaps } from '../../src/engine/engineer/intake/overlap-preflight.js';

describe('degraded overlap collection', () => {
  it('turns failed independent reads into skip notes', async () => {
    const result = await collectOverlaps({ title: 't', body: 'src/a.ts', openIssues: async () => { throw new Error('timed out'); }, inFlight: async () => { throw new Error('no base'); } });
    expect(result.skipNotes).toEqual([{ part: 'open-issues', reason: 'timed out' }, { part: 'in-flight', reason: 'no base' }]);
  });
});
