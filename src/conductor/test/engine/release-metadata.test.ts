import { describe, expect, it } from 'vitest';

import {
  mergeReleaseMetadataBlock,
  parseReleaseDisposition,
  snapshotReleaseMetadataBlock,
} from '../../src/engine/release-metadata.js';

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

  describe('snapshot accepts the Migration section on either side of the metadata', () => {
    // The two parsers disagreed about ordering and neither was checked at
    // authoring time. `parseReleaseDisposition` (after #1404) accepts Migration
    // ABOVE the Release-* block; `snapshotReleaseMetadataBlock` sliced from the
    // end of that block to the Migration heading, so it only ever worked when
    // Migration came BELOW it. A body satisfying one failed the other, and the
    // author only learned at the finish-time release gate, as a needs-human HALT
    // ("pre-finish snapshot unavailable: release metadata is malformed or
    // non-canonical"). Observed on #1396.
    const fence = '```bash migration\n./bin/install --update\n```';
    const fields = [
      'Release-Disposition: note',
      'Release-Category: Added',
      'Release-Semver: minor',
      'Release-Note: Adds a thing.',
    ].join('\n');
    const canonical = `${fields}\n\n## Migration\n\n${fence}`;

    it('snapshots a body whose Migration section sits ABOVE the metadata block', () => {
      const body = `## Why\n\nBecause.\n\n## Migration\n\n${fence}\n\n${fields}\n`;
      expect(snapshotReleaseMetadataBlock(body)).toBe(canonical);
    });

    it('still snapshots the canonical below-the-metadata ordering', () => {
      expect(snapshotReleaseMetadataBlock(`## Why\n\nBecause.\n\n${canonical}\n`)).toBe(
        canonical,
      );
    });

    it('stays idempotent for the above-the-metadata ordering', () => {
      const body = `## Migration\n\n${fence}\n\n${fields}\n`;
      const snapshot = snapshotReleaseMetadataBlock(body)!;
      expect(snapshotReleaseMetadataBlock(snapshot)).toBe(snapshot);
    });

    it('merges a body whose Migration section sits ABOVE the metadata block', () => {
      const body = `## Why\n\nBecause.\n\n## Migration\n\n${fence}\n\n${fields}\n`;
      const snapshot = snapshotReleaseMetadataBlock(body)!;
      expect(mergeReleaseMetadataBlock(body, snapshot)).toBe(`## Why\n\nBecause.\n\n${canonical}`);
    });

    it('merges without duplicating the section when a Closes trailer follows it', () => {
      // The exact shape of the SHIP draft body that halted #1396: Migration above
      // the metadata, and a `Closes` trailer below both.
      const body =
        `## Why\n\nBecause.\n\n## Migration\n\n${fence}\n\n${fields}\n\nCloses owner/repo#1254\n`;
      const snapshot = snapshotReleaseMetadataBlock(body)!;
      const merged = mergeReleaseMetadataBlock(body, snapshot)!;
      expect(merged.match(/## Migration/g)).toHaveLength(1);
      expect(merged.match(/Release-Disposition:/g)).toHaveLength(1);
      expect(merged).toContain('Closes owner/repo#1254');
    });

    it('returns null when the declared migration fence is absent entirely', () => {
      expect(
        snapshotReleaseMetadataBlock(`## Migration\n\nnone\n\n${fields}\n`),
      ).toBe(fields);
    });
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

  describe('pre-finish snapshot of a body the parser already accepts', () => {
    // Every producer in this repo — the PR template, the release-disposition
    // skill, and the CHANGELOG renderer — writes a blank line between the
    // `## Migration` heading and its runnable fence, and the parser accepts
    // that form. A snapshot that demanded the fence on the very next line
    // therefore rejected bodies it had just parsed, and the pre-finish
    // snapshot HALTed the publication with "release metadata is malformed or
    // non-canonical" (observed on PR #1349).
    const fields = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Correct a defect.',
    ].join('\n');
    const migration = '```bash migration\n./bin/install --update\n```';

    it('captures a migration separated from its heading by a blank line', () => {
      const body = `## Summary\n\nReader prose.\n\n${fields}\n\n## Migration\n\n${migration}`;
      expect(snapshotReleaseMetadataBlock(body)).toBe(
        `${fields}\n\n## Migration\n\n${migration}`,
      );
    });

    it('captures a migration on the line immediately after its heading', () => {
      const body = `${fields}\n\n## Migration\n${migration}`;
      expect(snapshotReleaseMetadataBlock(body)).toBe(`${fields}\n\n## Migration\n${migration}`);
    });

    it('re-snapshots its own output unchanged, so a restore can be verified', () => {
      const body = `## Summary\n\nReader prose.\n\n${fields}\n\n## Migration\n\n${migration}`;
      const block = snapshotReleaseMetadataBlock(body);
      expect(block).not.toBeNull();
      expect(snapshotReleaseMetadataBlock(block!)).toBe(block);
    });

    it('restores the captured block over a body finish rewrote, keeping reader prose', () => {
      const body = `## Summary\n\nReader prose.\n\n${fields}\n\n## Migration\n\n${migration}`;
      const block = snapshotReleaseMetadataBlock(body);
      expect(block).not.toBeNull();
      const merged = mergeReleaseMetadataBlock('## Summary\n\nRewritten by finish.', block!);
      expect(merged).toBe(`## Summary\n\nRewritten by finish.\n\n${block}`);
      expect(snapshotReleaseMetadataBlock(merged!)).toBe(block);
    });
  });
});
