// Covers: task:2
import { describe, expect, it } from 'vitest';

import { buildSuggestions } from '../../src/engine/engineer/intake/overlap-suggestions.js';

describe('intake overlap suggestions', () => {
  it('merges duplicate routes, pre-accepts named issues, and keeps unlinked branches advisory', () => {
    expect(buildSuggestions({
      issueOverlaps: [
        { issue: '#1487', sharedPaths: ['a.ts'] },
        { issue: '#1579', sharedPaths: ['named.ts'] },
      ],
      branchOverlaps: [
        { branch: 'feat/daemon-one', sharedPaths: ['b.ts'], issue: '#1487' },
        { branch: 'spec/duplicate', sharedPaths: ['a.ts'], issue: '#1487' },
        { branch: 'feat/daemon-unlinked', sharedPaths: ['advisory.ts'], issue: null },
      ],
      alreadyNamed: ['#1579'],
      cap: 5,
    })).toEqual({
      shown: [{ issue: '#1487', sharedPaths: ['a.ts', 'b.ts'] }],
      preAccepted: [{ issue: '#1579', sharedPaths: ['named.ts'] }],
      advisory: [{ branch: 'feat/daemon-unlinked', sharedPaths: ['advisory.ts'], issue: null }],
    });
  });
});
