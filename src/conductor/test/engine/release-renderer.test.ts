import { describe, expect, it } from 'vitest';

import {
  aggregateReleaseSemver,
  renderReleaseCandidate,
} from '../../src/engine/release-renderer.js';

describe('engine/release-renderer — deterministic release candidates (Task 6)', () => {
  it.each([
    [['patch'], 'patch'],
    [['patch', 'minor', 'patch'], 'minor'],
    [['patch', 'minor', 'major', 'patch'], 'major'],
  ] as const)('selects the highest semver impact from %j', (impacts, expected) => {
    expect(aggregateReleaseSemver(impacts)).toBe(expected);
  });

  it('rejects an unknown semver impact rather than rendering a partial release', () => {
    expect(() => aggregateReleaseSemver(['patch', 'hotfix'] as never)).toThrow('Invalid release semver: hotfix');
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
