// Covers: task:9
import { describe, expect, it } from 'vitest';
import { runOverlapPreflight } from '../../src/engine/engineer/intake/overlap-preflight.js';

describe('non-interactive overlap refusal', () => {
  it('refuses only shown undecided linkable suggestions', async () => {
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], interactive: false }, { suggestions: async () => ({
      shown: [{ issue: 'acme/app#1579', sharedPaths: ['src/review/rubric.ts'] }], preAccepted: [], advisory: [{ branch: 'feat/daemon-x', sharedPaths: ['x.ts'], issue: null }],
    }) });
    expect(result).toEqual({ kind: 'refused', undecided: [{ issue: 'acme/app#1579', sharedPaths: ['src/review/rubric.ts'] }], advisory: [{ branch: 'feat/daemon-x', sharedPaths: ['x.ts'], issue: null }], skipNotes: [], omittedCount: 0 });
  });
});
