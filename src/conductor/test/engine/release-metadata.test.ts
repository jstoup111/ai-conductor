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

  describe('Release- lines inside HTML comments', () => {
    // .github/pull_request_template.md documents the note shape inside an HTML
    // comment above the live default line. Engine-seeded draft bodies carry the
    // template verbatim, so the commented example must not count as a declaration.
    const templateRegion = (live: string[]) => [
      '## Release metadata',
      '',
      '<!--',
      'For a reader-visible implementation change, replace the default line with exactly:',
      'Release-Disposition: note',
      'Release-Category: Added',
      'Release-Semver: patch',
      'Release-Note: Reader-facing summary of the delivered change.',
      '-->',
      '',
      ...live,
    ].join('\n');

    it('reads only the live no-note line below the commented example', () => {
      expect(parseReleaseDisposition(templateRegion(['Release-Disposition: no-note']))).toEqual({
        disposition: 'no-note',
      });
    });

    it('reads only the live note block below the commented example', () => {
      expect(parseReleaseDisposition(templateRegion([
        'Release-Disposition: note',
        'Release-Category: Fixed',
        'Release-Semver: patch',
        'Release-Note: Ignore commented release fields.',
      ]))).toEqual({
        disposition: 'note',
        category: 'Fixed',
        semver: 'patch',
        note: 'Ignore commented release fields.',
      });
    });

    it('reads a "none" Migration section below the commented example fence', () => {
      expect(parseReleaseDisposition([
        templateRegion(['Release-Disposition: no-note']),
        '',
        '## Migration',
        '',
        '<!--',
        'Required — even if the answer is "none".',
        '',
        '```bash migration',
        '# commands go here',
        '```',
        '',
        'Otherwise, write "none".',
        '-->',
        '',
        'none',
        '',
        '<!-- /ai-conductor:step -->',
        '',
        '## Documentation',
      ].join('\n'))).toEqual({ disposition: 'no-note' });
    });

    it('keeps comment syntax inside a runnable migration fence', () => {
      expect(parseReleaseDisposition([
        templateRegion([
          'Release-Disposition: note',
          'Release-Category: Fixed',
          'Release-Semver: patch',
          'Release-Note: Ignore commented release fields.',
        ]),
        '',
        '## Migration',
        '```bash migration',
        'echo "<!-- not a comment"',
        '```',
      ].join('\n'))).toMatchObject({ migration: '```bash migration\necho "<!-- not a comment"\n```' });
    });

    it('still rejects a body whose only disposition is commented out', () => {
      expect(() => parseReleaseDisposition(templateRegion([]))).toThrow(
        'Invalid release disposition: Disposition',
      );
    });
  });

  it('accepts a note disposition and runnable migration closed by the release-disposition region marker (Task 13)', () => {
    expect(parseReleaseDisposition([
      '<!-- ai-conductor:step release-disposition -->',
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Preserve the release block.',
      '',
      '## Migration',
      '```bash migration',
      './bin/migrate',
      '```',
      '<!-- /ai-conductor:step -->',
    ].join('\n'))).toEqual({
      disposition: 'note',
      category: 'Fixed',
      semver: 'patch',
      note: 'Preserve the release block.',
      migration: '```bash migration\n./bin/migrate\n```',
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

  describe('Migration section followed by the release metadata block (#1396)', () => {
    // Observed on PR #1396: the authored body puts `## Migration` LAST, with the
    // Release-* block below it and no `---` in between. The section terminator
    // recognised only a heading or a thematic break, so it swallowed the whole
    // metadata block into the migration content, and a correctly-formed PR was
    // rejected at the finish-time release gate with
    // "Invalid release disposition: Migration". Nothing about that body is wrong;
    // the parser required a separator the template never promised.
    const fence = '```bash migration\n./bin/install --update\n```';
    const fields = [
      'Release-Disposition: note',
      'Release-Category: Added',
      'Release-Semver: minor',
      'Release-Note: Adds a thing.',
    ].join('\n');

    it('ends the section at the release metadata block with no thematic break', () => {
      expect(
        parseReleaseDisposition(`## Migration\n\n${fence}\n\n${fields}\n`),
      ).toEqual({
        disposition: 'note',
        category: 'Added',
        semver: 'minor',
        note: 'Adds a thing.',
        migration: fence,
      });
    });

    it('ends a "none" section at the release metadata block', () => {
      expect(parseReleaseDisposition(`## Migration\n\nnone\n\n${fields}\n`)).toEqual({
        disposition: 'note',
        category: 'Added',
        semver: 'minor',
        note: 'Adds a thing.',
      });
    });

    it('ends a "none" section at the shipment plan declaration', () => {
      expect(
        parseReleaseDisposition(
          `## Release metadata\n\n## Migration\n\nnone\nPlan: .docs/plans/capture-all-assigned-issues.md\n\n${fields}\n`,
        ),
      ).toEqual({
        disposition: 'note',
        category: 'Added',
        semver: 'minor',
        note: 'Adds a thing.',
      });
    });

    it('ignores the unreplaced Closes placeholder comment below a "none" section', () => {
      // shipDraftPrBody appends this HTML comment; it survives whenever
      // issue-link injection is skipped, and swallowing it turned a correct
      // `none` into "Invalid release disposition: Migration" at the gate.
      expect(
        parseReleaseDisposition(
          `${fields}\n\n## Migration\n\nnone\n\n<!-- Closes <owner/repo#N> — added automatically when this feature came from an intake issue. -->\n`,
        ),
      ).toEqual({
        disposition: 'note',
        category: 'Added',
        semver: 'minor',
        note: 'Adds a thing.',
      });
    });

    it('tolerates a trailing Closes line after the metadata block', () => {
      expect(
        parseReleaseDisposition(
          `## Migration\n\n${fence}\n\n${fields}\n\nCloses owner/repo#1254\n`,
        ),
      ).toMatchObject({ migration: fence });
    });

    it('does not end the section at a Release- line inside the runnable fence', () => {
      const tricky = '```bash migration\necho "Release-Semver: major"\n```';
      expect(
        parseReleaseDisposition(`## Migration\n\n${tricky}\n\n${fields}\n`),
      ).toMatchObject({ migration: tricky });
    });

    it('still rejects genuine prose that precedes the metadata block', () => {
      expect(() =>
        parseReleaseDisposition(`## Migration\n\nRun the installer.\n\n${fields}\n`),
      ).toThrow(/Invalid release disposition: Migration/);
    });
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

  describe('Migration section that opens with operator prose (#1957)', () => {
    // Observed on PR #1957: `## Migration` is the last heading, opens with a
    // sentence telling the operator what the block does, then the runnable
    // fence, then `Closes …`, then the Release-* block. `docs/contributing/releases.md`
    // defines a migration as a fence *inside* a `## Migration` section and
    // `bin/migrate` reads exactly the fences, so nothing about that body is
    // wrong — but the whole section was handed to `isRunnableMigrationBlock`,
    // whose anchors demand the content BE the fence, and the required
    // release-metadata check failed with "Invalid release disposition: Migration".
    const fence = '```bash migration\n./bin/install --update\n```';
    const prose = 'Remove the retired keys from every configuration file that exists.';
    const fields = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Correct a defect.',
    ].join('\n');
    const pr1957 =
      `## Why\n\nBecause.\n\n## Migration\n\n${prose}\n\n${fence}\n\n` +
      `Closes owner/repo#1025\n\n${fields}\n`;

    it("reads only the fence as the migration in PR #1957's exact body shape", () => {
      expect(parseReleaseDisposition(pr1957)).toEqual({
        disposition: 'note',
        category: 'Fixed',
        semver: 'patch',
        note: 'Correct a defect.',
        migration: fence,
      });
    });

    it('ignores prose that follows the fence as well', () => {
      expect(
        parseReleaseDisposition(
          `${fields}\n\n## Migration\n\n${fence}\n\nRerun the installer afterwards.\n`,
        ),
      ).toMatchObject({ migration: fence });
    });

    it('still rejects a second Migration section that opens with prose', () => {
      expect(() =>
        parseReleaseDisposition(`${pr1957}\n\n## Migration\n\n${prose}\n\n${fence}\n`),
      ).toThrow('Invalid release disposition: Migration');
    });

    it.each([
      ['a fence that bin/migrate will not run', '```bash\n./bin/install --update\n```'],
      ['an unterminated runnable fence', '```bash migration\n./bin/install --update'],
    ])('still rejects prose followed by %s', (_scenario, body) => {
      expect(() =>
        parseReleaseDisposition(`${fields}\n\n## Migration\n\n${prose}\n\n${body}\n`),
      ).toThrow('Invalid release disposition: Migration');
    });

    it('still reads a prose-wrapped "none" section as no migration', () => {
      expect(
        parseReleaseDisposition(`${fields}\n\n## Migration\n\nnone\n\nCloses owner/repo#1025\n`),
      ).toEqual({
        disposition: 'note',
        category: 'Fixed',
        semver: 'patch',
        note: 'Correct a defect.',
      });
    });

    it('still rejects a no-note disposition whose prose section carries a fence', () => {
      expect(() =>
        parseReleaseDisposition(
          `Release-Disposition: no-note\n\n## Migration\n\n${prose}\n\n${fence}\n`,
        ),
      ).toThrow('Invalid release disposition: Migration');
    });
  });

});
