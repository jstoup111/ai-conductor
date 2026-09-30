// Covers: task:12
import { describe, expect, it } from 'vitest';
import { runOverlapPreflight } from '../../src/engine/engineer/intake/overlap-preflight.js';

describe('invalid overlap declines', () => {
  it('rejects malformed and unsuggested decline values before filing', async () => {
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], declineOverlap: ['not-a-ref'], interactive: false }, { suggestions: async () => ({ shown: [], preAccepted: [], advisory: [] }) });
    expect(result).toEqual({ kind: 'invalid-decline', invalid: ['not-a-ref'], advisory: [], skipNotes: [], omittedCount: 0 });
  });
});
