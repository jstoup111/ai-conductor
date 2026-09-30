// Covers: task:8
import { describe, expect, it } from 'vitest';
import { runOverlapPreflight } from '../../src/engine/engineer/intake/overlap-preflight.js';

describe('interactive overlap decisions', () => {
  it('re-asks invalid answers and records acceptance and decline', async () => {
    const answers = ['maybe', 'accept', 'd']; let calls = 0;
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], interactive: true,
      prompt: async () => { calls++; return answers.shift()!; } }, { suggestions: async () => ({
      shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }, { issue: 'acme/app#1487', sharedPaths: ['b.ts'] }], preAccepted: [], advisory: [],
    }) });
    expect({ result, calls }).toEqual({ result: { kind: 'proceed', accepted: ['acme/app#1579'], declined: ['acme/app#1487'], advisory: [], skipNotes: [], omittedCount: 0 }, calls: 3 });
  });
});
