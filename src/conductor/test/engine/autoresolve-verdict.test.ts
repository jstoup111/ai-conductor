// Covers: task:3
import { describe, expect, it } from 'vitest';
import { validateResolutionVerdict } from '../../src/engine/autoresolve.js';

describe('validateResolutionVerdict', () => {
  const valid = { choice: 'superseded', rationale: 'upstream contains it', superseded: ['abc'] };
  it('accepts only replayed test-only declarations from the closed schema', () => {
    expect(validateResolutionVerdict(valid, { scope: 'test-only', replayedShas: ['abc'] }).ok).toBe(true);
    expect(validateResolutionVerdict({ ...valid, choice: 'other' }, { scope: 'test-only', replayedShas: ['abc'] })).toMatchObject({ ok: false, reason: expect.stringMatching(/^malformed verdict:/) });
    expect(validateResolutionVerdict({ ...valid, rationale: '' }, { scope: 'test-only', replayedShas: ['abc'] })).toMatchObject({ ok: false });
    expect(validateResolutionVerdict(valid, { scope: 'mixed', replayedShas: ['abc'] })).toMatchObject({ ok: false });
    expect(validateResolutionVerdict(valid, { scope: 'test-only', replayedShas: [] })).toMatchObject({ ok: false });
  });
});
