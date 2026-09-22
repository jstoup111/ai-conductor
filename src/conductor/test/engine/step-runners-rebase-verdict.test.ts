// Covers: task:2
import { describe, expect, it } from 'vitest';
import { parseRebaseResolutionOutput } from '../../src/engine/step-runners.js';

describe('parseRebaseResolutionOutput — resolution verdict', () => {
  it('preserves a verdict from resolved JSON while leaving a bare success verdict-free', () => {
    const verdict = {
      choice: 'merged',
      rationale: 'The base already contains the source change.',
      superseded: ['src/engine/rebase.ts'],
    };

    expect(parseRebaseResolutionOutput(JSON.stringify({ resolved: true, verdict }))).toEqual({
      resolved: true,
      verdict,
    });
    expect(parseRebaseResolutionOutput('{"resolved": true}')).toEqual({ resolved: true });
  });
});
