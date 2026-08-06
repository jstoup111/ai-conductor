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

  describe('Migration section terminated by a thematic break', () => {
    // The SHIP-entry draft body (`shipDraftPrBody`) always ends with a `---`
    // rule, the placeholder note, and the injected `Closes` line. When the
    // release-disposition step appends the template's `## Migration` / `none`
    // section above that trailer, no further `##` heading follows it, so a
    // section terminator that only recognises headings swallows the whole
    // trailer and the disposition is rejected as malformed.
    const fields = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: minor',
      'Release-Note: Correct a defect.',
    ].join('\n');
    const trailer = [
      '',
      '---',
      '',
      'Draft opened automatically at the start of the SHIP phase.',
      '',
      'Closes owner/repo#1330',
    ].join('\n');

    it('reads a "none" section above the draft trailer as no migration', () => {
      expect(parseReleaseDisposition(`${fields}\n\n## Migration\n\nnone\n${trailer}`)).toEqual({
        disposition: 'note',
        category: 'Fixed',
        semver: 'minor',
        note: 'Correct a defect.',
      });
    });

    it('retains a runnable fence that sits above the draft trailer', () => {
      const migration = '```bash migration\n./bin/install --update\n```';
      expect(
        parseReleaseDisposition(`${fields}\n\n## Migration\n\n${migration}\n${trailer}`),
      ).toMatchObject({ migration });
    });

    it('does not treat a rule inside the runnable fence as the section end', () => {
      const migration = '```bash migration\ncat <<EOF\n---\nEOF\n```';
      expect(
        parseReleaseDisposition(`${fields}\n\n## Migration\n\n${migration}\n${trailer}`),
      ).toMatchObject({ migration });
    });

    it('still rejects prose that is neither "none" nor a runnable fence', () => {
      expect(() => parseReleaseDisposition(`${fields}\n\n## Migration\n\nTODO\n${trailer}`))
        .toThrow('Invalid release disposition: Migration');
    });

    it('rejects a no-note disposition carrying a real migration above the trailer', () => {
      const migration = '```bash migration\n./bin/install --update\n```';
      expect(() =>
        parseReleaseDisposition(`Release-Disposition: no-note\n\n## Migration\n\n${migration}\n${trailer}`),
      ).toThrow('Invalid release disposition: Migration');
    });
  });
});
