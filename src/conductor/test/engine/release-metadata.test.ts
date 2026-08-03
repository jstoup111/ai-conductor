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

  it.each([
    ['missing disposition', 'Release-Category: Fixed\nRelease-Semver: patch\nRelease-Note: Correct a defect.', 'Disposition'],
    ['multiple dispositions', 'Release-Disposition: note\nRelease-Disposition: no-note', 'Disposition'],
    ['invalid category', 'Release-Disposition: note\nRelease-Category: Other\nRelease-Semver: patch\nRelease-Note: Correct a defect.', 'Category'],
    ['invalid semver', 'Release-Disposition: note\nRelease-Category: Fixed\nRelease-Semver: hotfix\nRelease-Note: Correct a defect.', 'Semver'],
    ['empty note', 'Release-Disposition: note\nRelease-Category: Fixed\nRelease-Semver: patch\nRelease-Note:   ', 'Note'],
    ['no-note category', 'Release-Disposition: no-note\nRelease-Category: Fixed', 'Category'],
    ['no-note semver', 'Release-Disposition: no-note\nRelease-Semver: patch', 'Semver'],
    ['no-note note', 'Release-Disposition: no-note\nRelease-Note: Correct a defect.', 'Note'],
  ])('rejects %s', (_scenario, body, invalidField) => {
    expect(() => parseReleaseDisposition(body)).toThrow(`Invalid release disposition: ${invalidField}`);
  });

  it.each([
    ['workflow expression', '${{ github.event.pull_request.title }}'],
    ['shell-like text', '$(touch /tmp/release-metadata-should-not-run)'],
  ])('keeps %s in note content as inert data', (_scenario, note) => {
    expect(
      parseReleaseDisposition([
        'Release-Disposition: note',
        'Release-Category: Changed',
        'Release-Semver: patch',
        `Release-Note: ${note}`,
      ].join('\n')),
    ).toMatchObject({ disposition: 'note', note });
  });

  it('rejects duplicate Migration sections while retaining one runnable migration', () => {
    const metadata = [
      'Release-Disposition: note',
      'Release-Category: Changed',
      'Release-Semver: major',
      'Release-Note: Preserve a consumer migration.',
      '',
      '## Migration',
      '',
      '```bash migration',
      './bin/install --update',
      '```',
    ].join('\n');

    expect(parseReleaseDisposition(metadata)).toMatchObject({
      migration: '```bash migration\n./bin/install --update\n```',
    });
    expect(() => parseReleaseDisposition(`${metadata}\n\n## Migration\n\nnone`))
      .toThrow('Invalid release disposition: Migration');
  });
});
