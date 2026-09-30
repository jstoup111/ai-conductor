// Covers: task:19
import { describe, expect, it } from 'vitest';

import { buildSuggestions } from '../../src/engine/engineer/intake/overlap-suggestions.js';

describe('intake overlap suggestions ranking', () => {
  it('ranks shared paths descending, breaks ties by issue number, caps at five, and is deterministic', () => {
    const input = {
      issueOverlaps: [
        { issue: '#20', sharedPaths: ['a.ts', 'b.ts', 'c.ts'] },
        { issue: '#13', sharedPaths: ['d.ts', 'e.ts'] },
        { issue: '#7', sharedPaths: ['f.ts', 'g.ts'] },
        { issue: '#11', sharedPaths: ['h.ts'] },
        { issue: '#9', sharedPaths: ['i.ts'] },
        { issue: '#5', sharedPaths: ['j.ts'] },
        { issue: '#2', sharedPaths: ['k.ts'] },
        { issue: '#1', sharedPaths: ['l.ts'] },
      ],
      branchOverlaps: [],
      alreadyNamed: [],
    };

    expect([buildSuggestions(input), buildSuggestions(input)]).toEqual([
      {
        shown: [
          { issue: '#20', sharedPaths: ['a.ts', 'b.ts', 'c.ts'] },
          { issue: '#7', sharedPaths: ['f.ts', 'g.ts'] },
          { issue: '#13', sharedPaths: ['d.ts', 'e.ts'] },
          { issue: '#1', sharedPaths: ['l.ts'] },
          { issue: '#2', sharedPaths: ['k.ts'] },
        ],
        preAccepted: [],
        advisory: [],
        omittedCount: 3,
      },
      {
        shown: [
          { issue: '#20', sharedPaths: ['a.ts', 'b.ts', 'c.ts'] },
          { issue: '#7', sharedPaths: ['f.ts', 'g.ts'] },
          { issue: '#13', sharedPaths: ['d.ts', 'e.ts'] },
          { issue: '#1', sharedPaths: ['l.ts'] },
          { issue: '#2', sharedPaths: ['k.ts'] },
        ],
        preAccepted: [],
        advisory: [],
        omittedCount: 3,
      },
    ]);
  });
});
