import { describe, expect, it } from 'vitest';

import { parseReleaseDisposition } from '../../src/engine/release-metadata.js';

describe('engine/release-metadata — structured PR release disposition (Task 1)', () => {
  it('normalizes a categorized reader note and its semver impact', () => {
    expect(
      parseReleaseDisposition([
        'Release-Disposition: note',
        'Release-Category: Changed',
        'Release-Semver: minor',
        'Release-Note: Add structured release metadata to implementation PRs.',
      ].join('\n')),
    ).toEqual({
      disposition: 'note',
      category: 'Changed',
      semver: 'minor',
      note: 'Add structured release metadata to implementation PRs.',
    });
  });

  it('normalizes an explicit no-note disposition', () => {
    expect(parseReleaseDisposition('Release-Disposition: no-note')).toEqual({
      disposition: 'no-note',
    });
  });
});
