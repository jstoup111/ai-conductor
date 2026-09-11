// Covers: task:1
import { describe, expect, it } from 'vitest';
import { directedProtectedTarget } from '../../src/engine/conductor.js';

describe('directedProtectedTarget', () => {
  it('returns a foreign protected artifact and its directing title clause', () => {
    const title = 'Amend .docs/stories/another-feature.md with the external correction.';

    expect(directedProtectedTarget(title, 'feature')).toEqual({
      path: '.docs/stories/another-feature.md',
      clause: 'Amend .docs/stories/another-feature.md with the external correction.',
    });
  });

  it('normalizes a directing title target while retaining its directing clause', () => {
    const title = 'Amend ./.docs/stories/another-feature.md with the external correction.';

    expect(directedProtectedTarget(title, 'feature')).toEqual({
      path: '.docs/stories/another-feature.md',
      clause: 'Amend ./.docs/stories/another-feature.md with the external correction.',
    });
  });

  it('returns the scanner-resolved foreign protected artifact with its directing clause', () => {
    const title = 'Amend .docs/stories/feature.md with the local correction; then amend .docs/stories/another-feature.md with the external correction.';

    expect(directedProtectedTarget(title, 'feature')).toEqual({
      path: '.docs/stories/another-feature.md',
      clause: 'then amend .docs/stories/another-feature.md with the external correction.',
    });
  });

  it('returns a foreign protected artifact and its directing rationale clause', () => {
    const rationale = 'The remediation should amend .docs/decisions/another-feature.md before build resumes.';

    expect(directedProtectedTarget(rationale, 'feature')).toEqual({
      path: '.docs/decisions/another-feature.md',
      clause: 'The remediation should amend .docs/decisions/another-feature.md before build resumes.',
    });
  });

  it('returns undefined when a protected artifact is cited without a directing verb', () => {
    const title = 'See .docs/stories/another-feature.md for the external correction.';

    expect(directedProtectedTarget(title, 'feature')).toBeUndefined();
  });
});
