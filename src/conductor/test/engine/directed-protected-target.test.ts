// Covers: task:1, task:4
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

  it('collapses and truncates an oversized multi-line directing clause with an ellipsis', () => {
    const clause = [
      'Amend .docs/stories/another-feature.md with a correction that contains deliberately extensive supporting context',
      'across several lines so the diagnostic quote must be collapsed into one bounded operator-facing line before it',
      'is carried to event persistence or halt evidence.',
    ].join('\n  ');
    const normalized = clause.replace(/\s+/g, ' ').trim();
    const expectedClause = `${normalized.slice(0, 159)}…`;

    expect(expectedClause).toHaveLength(160);
    expect(directedProtectedTarget(clause, 'feature')).toEqual({
      path: '.docs/stories/another-feature.md',
      clause: expectedClause,
    });
  });

  it('collapses whitespace without ellipsizing a directing clause within the quote budget', () => {
    const clause = 'Amend\n  .docs/stories/another-feature.md\twith the correction.';

    expect(directedProtectedTarget(clause, 'feature')).toEqual({
      path: '.docs/stories/another-feature.md',
      clause: 'Amend .docs/stories/another-feature.md with the correction.',
    });
  });

  it('returns undefined when a protected artifact is cited without a directing verb', () => {
    const title = 'See .docs/stories/another-feature.md for the external correction.';

    expect(directedProtectedTarget(title, 'feature')).toBeUndefined();
  });
});
