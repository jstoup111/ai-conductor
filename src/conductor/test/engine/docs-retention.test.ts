// Covers: task:1, task:22
import { describe, expect, it } from 'vitest';

import { DOCS_RETENTION_POLICY, prunableFilesForStem } from '../../src/engine/docs-retention.js';

const PRUNABLE_FAMILIES = [
  'plans',
  'conflicts',
  'coherence',
  'coherence-waivers',
  'track',
  'complexity',
  'halted',
  'plan-review',
  'applicability',
  'retros',
] as const;

const PRUNABLE_KINDS = [
  'plan',
  'conflicts',
  'coherence',
  'coherence-waiver',
  'track',
  'complexity',
  'applicability',
] as const;

const KEPT_FAMILIES = [
  'stories',
  'specs',
  'decisions',
  'architecture',
  'shipped',
  'intake',
  'release-waivers',
] as const;

function pathsFor(stem: string): string[] {
  return [
    ...PRUNABLE_FAMILIES.map((family) => `.docs/${family}/${stem}.md`),
    ...KEPT_FAMILIES.map((family) => `.docs/${family}/${stem}.md`),
  ];
}

const paths = [
  ...pathsFor('alpha'),
  ...pathsFor('alpha-two'),
  ...pathsFor('2026-10-01-alpha'),
  '.docs/retros/2026-10-02-alpha.md',
  '.docs/audit/alpha.md',
  '.docs/audits/alpha.md',
  '.docs/baselines/alpha.md',
  '.docs/observation/alpha.md',
  '.docs/repository-wide.md',
];

describe('prunableFilesForStem', () => {
  it('exports exactly the retained and prunable feature families', () => {
    expect(DOCS_RETENTION_POLICY).toMatchObject({
      keptFamilies: KEPT_FAMILIES,
      prunableFamilies: PRUNABLE_FAMILIES,
      prunableKinds: PRUNABLE_KINDS,
    });
  });

  it('returns exactly alpha files from every prunable family, including halted', () => {
    expect([...prunableFilesForStem(paths, 'alpha')].sort()).toEqual(
      PRUNABLE_FAMILIES.map((family) => `.docs/${family}/alpha.md`).sort(),
    );
  });

  it('matches undated and dated family artifacts through normalized identity', () => {
    expect([...prunableFilesForStem(paths, '2026-10-01-alpha')].sort()).toEqual([
      '.docs/plans/2026-10-01-alpha.md',
      ...PRUNABLE_FAMILIES.filter((family) => family !== 'plans')
        .flatMap((family) => [`.docs/${family}/2026-10-01-alpha.md`, `.docs/${family}/alpha.md`]),
      '.docs/retros/2026-10-02-alpha.md',
    ].sort());
  });

  it('excludes kept families, prefix collisions, and repository-wide docs paths', () => {
    expect(prunableFilesForStem(paths, 'alpha')).not.toContain(
      expect.stringMatching(/(?:alpha-two|audit|audits|baselines|observation|repository-wide)/),
    );
  });
});
