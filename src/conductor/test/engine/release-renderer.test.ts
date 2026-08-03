import { describe, expect, it } from 'vitest';

import {
  renderReleaseCandidateAudit,
  renderReleaseCandidate,
} from '../../src/engine/release-renderer.js';

describe('engine/release-renderer — deterministic release candidates (Task 6)', () => {
  // Semver aggregation is internal to rendering; it is proven through the version
  // the renderer proposes, which is the only surface the release flow consumes.
  it.each([
    [['patch'], '1.2.4'],
    [['patch', 'minor', 'patch'], '1.3.0'],
    [['patch', 'minor', 'major', 'patch'], '2.0.0'],
  ] as const)('proposes the version dictated by the highest impact in %j', (impacts, expected) => {
    const rendered = renderReleaseCandidate({
      currentVersion: '1.2.3',
      date: '2026-08-02',
      changelog: changelogWithEmptyUnreleased(),
      candidates: impacts.map((semver, index) => candidate(index + 1, 'Fixed', semver, `Note ${index + 1}.`)),
    });

    expect(rendered.version).toBe(expected);
  });

  it('rejects an unknown semver impact rather than rendering a partial release', () => {
    expect(() => renderReleaseCandidate({
      currentVersion: '1.2.3',
      date: '2026-08-02',
      changelog: changelogWithEmptyUnreleased(),
      candidates: [candidate(41, 'Fixed', 'hotfix' as never, 'Correct a race.')],
    })).toThrow('Invalid release semver: hotfix');
  });

  it('renders grouped category entries with attributable PR links and migrations in candidate order', () => {
    const rendered = renderReleaseCandidate({
      currentVersion: '0.99.20',
      date: '2026-08-02',
      changelog: changelogWithEmptyUnreleased(),
      candidates: [
        candidate(42, 'Fixed', 'patch', 'Correct a race.', '```bash migration\nfirst-migration\n```'),
        candidate(41, 'Added', 'minor', 'Add release PR maintenance.'),
        candidate(43, 'Fixed', 'patch', 'Correct another race.', '```bash migration\nsecond-migration\n```'),
        { number: 40, disposition: { disposition: 'no-note' } },
      ],
    });

    expect(rendered.version).toBe('0.100.0');
    expect(rendered.changelog).toBe([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [0.100.0] - 2026-08-02',
      '',
      '### Added',
      '',
      '- Add release PR maintenance. ([implementation PR #41](https://github.com/jstoup111/ai-conductor/pull/41)).',
      '',
      '### Fixed',
      '',
      '- Correct a race. ([implementation PR #42](https://github.com/jstoup111/ai-conductor/pull/42)).',
      '- Correct another race. ([implementation PR #43](https://github.com/jstoup111/ai-conductor/pull/43)).',
      '',
      '## Migration',
      '',
      '```bash migration',
      'first-migration',
      '```',
      '',
      '```bash migration',
      'second-migration',
      '```',
      '',
      '## [0.99.20] - 2026-08-01',
      '',
      '### Fixed',
      '',
      '- Earlier release.',
      '',
    ].join('\n'));
  });

  it('is byte-for-byte stable when rerendered from the same authoritative inputs', () => {
    const input = {
      currentVersion: '1.2.3',
      date: '2026-08-02',
      changelog: changelogWithEmptyUnreleased(),
      candidates: [candidate(7, 'Security', 'major', 'Harden release publication.')],
    } as const;

    const first = renderReleaseCandidate(input);
    const second = renderReleaseCandidate(input);

    expect(second).toEqual(first);
  });

  it('renders one auditable disposition row per candidate while keeping no-note and excluded candidates out of the changelog', () => {
    const audit = renderReleaseCandidateAudit([
      { number: 42, mergeSha: 'merge-note', disposition: candidate(42, 'Fixed', 'patch', 'Correct a race.').disposition },
      { number: 43, mergeSha: 'merge-no-note', disposition: { disposition: 'no-note' } },
      { number: 44, mergeSha: 'merge-excluded', disposition: { disposition: 'excluded', reason: 'Consolidated into implementation PR #42.' } },
    ]);

    expect(audit).toBe([
      '## Release candidate audit',
      '',
      '| Implementation PR | Merge commit | Disposition | Reason |',
      '| --- | --- | --- | --- |',
      '| #42 | `merge-note` | included | Correct a race. |',
      '| #43 | `merge-no-note` | no-note | Explicit no-note disposition. |',
      '| #44 | `merge-excluded` | excluded | Consolidated into implementation PR #42. |',
    ].join('\n'));

    const rendered = renderReleaseCandidate({
      currentVersion: '1.2.3',
      date: '2026-08-02',
      changelog: changelogWithEmptyUnreleased(),
      candidates: [
        candidate(42, 'Fixed', 'patch', 'Correct a race.'),
        { number: 43, disposition: { disposition: 'no-note' } },
      ],
    });
    expect(rendered.changelog).toContain('Correct a race.');
    expect(rendered.changelog).not.toContain('Explicit no-note disposition.');
    expect(rendered.changelog).not.toContain('Consolidated into implementation PR #42.');
  });
});

function candidate(
  number: number,
  category: 'Added' | 'Changed' | 'Deprecated' | 'Removed' | 'Fixed' | 'Security',
  semver: 'major' | 'minor' | 'patch',
  note: string,
  migration?: string,
) {
  return {
    number,
    disposition: { disposition: 'note' as const, category, semver, note, ...(migration === undefined ? {} : { migration }) },
  };
}

function changelogWithEmptyUnreleased(): string {
  return [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.99.20] - 2026-08-01',
    '',
    '### Fixed',
    '',
    '- Earlier release.',
    '',
  ].join('\n');
}
