import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkStepCompletion,
  findFrIdsWithoutRows,
  prdAuditCoverageGap,
  resolveFeaturePrdPaths,
  type ArtifactResolutionContext,
} from '../src/engine/artifacts.js';

const context = (overrides: Partial<ArtifactResolutionContext> = {}): ArtifactResolutionContext => ({
  featureIdentities: [],
  changedPaths: new Set(),
  ...overrides,
});

describe('resolveFeaturePrdPaths', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-coverage-'));
    await mkdir(join(root, '.docs/specs'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns only the active-plan stem match from a multi-PRD corpus', async () => {
    await writeFile(join(root, '.docs/specs/current-feature.md'), '# PRD');
    await writeFile(join(root, '.docs/specs/other-feature.md'), '# PRD');

    await expect(
      resolveFeaturePrdPaths(root, context({ activePlanPath: '.docs/plans/current-feature.md' })),
    ).resolves.toEqual([join(root, '.docs/specs/current-feature.md')]);
  });

  it('excludes a SUPERSEDED stem match', async () => {
    await writeFile(join(root, '.docs/specs/SUPERSEDED-current-feature.md'), '# PRD');
    await writeFile(join(root, '.docs/specs/other-feature.md'), '# PRD');

    await expect(
      resolveFeaturePrdPaths(root, context({ featureDesc: 'current feature' })),
    ).resolves.toEqual([]);
  });

  it('returns no PRDs for an unmatched multi-PRD corpus', async () => {
    await writeFile(join(root, '.docs/specs/first-feature.md'), '# PRD');
    await writeFile(join(root, '.docs/specs/second-feature.md'), '# PRD');

    await expect(
      resolveFeaturePrdPaths(root, context({ featureIdentities: ['missing-feature'] })),
    ).resolves.toEqual([]);
  });
});

describe('findFrIdsWithoutRows', () => {
  it('returns no ids when every expected FR has a verdict row', () => {
    const content = [
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Covered |',
      '| FR-2A | ALIGNED | — | Covered |',
    ].join('\n');

    expect(findFrIdsWithoutRows(content, new Set(['FR-1', 'FR-2A']))).toEqual([]);
  });

  it('matches an expected FR suffix case-insensitively', () => {
    const content = '| fr-2a | ALIGNED | — | Covered |';

    expect(findFrIdsWithoutRows(content, new Set(['FR-2A']))).toEqual([]);
  });

  it('returns the two expected ids that have no verdict rows', () => {
    const content = [
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Covered |',
      '| FR-3 | ALIGNED | — | Covered |',
    ].join('\n');

    expect(findFrIdsWithoutRows(content, new Set(['FR-1', 'FR-2', 'FR-3', 'FR-4']))).toEqual([
      'FR-2',
      'FR-4',
    ]);
  });

  it('returns every expected id when the report is empty', () => {
    expect(findFrIdsWithoutRows('', new Set(['FR-1', 'FR-2A']))).toEqual(['FR-1', 'FR-2A']);
  });
});

describe('prdAuditCoverageGap', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-coverage-'));
    await mkdir(join(root, '.docs/specs'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns a gap only when a resolved PRD requirement has no report verdict row', async () => {
    const featureContext = context({ activePlanPath: '.docs/plans/current-feature.md' });
    const reportWithAllRows = [
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Covered |',
      '| FR-2 | ALIGNED | — | Covered |',
    ].join('\n');
    const reportWithPartialRows = [
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Covered |',
    ].join('\n');

    await writeFile(
      join(root, '.docs/specs/current-feature.md'),
      '# PRD\n\n## Functional Requirements\n\nFR-1\nFR-2',
    );
    const coverageResults = await Promise.all([
      prdAuditCoverageGap(root, featureContext, reportWithAllRows),
      prdAuditCoverageGap(root, featureContext, reportWithPartialRows),
    ]);

    await writeFile(join(root, '.docs/specs/current-feature.md'), '# PRD\n\nNo enumerated requirements.');
    coverageResults.push(await prdAuditCoverageGap(root, featureContext, reportWithPartialRows));

    expect(coverageResults).toEqual([null, expect.stringContaining('FR-2'), null]);
  });

  it.each([
    {
      name: 'no PRD resolves for the feature',
      featureContext: context({ activePlanPath: '.docs/plans/current-feature.md' }),
      setup: async () => undefined,
      report: '',
      expectedGap: 'unresolvable',
    },
    {
      name: 'a resolved PRD cannot be read',
      featureContext: context({ activePlanPath: '.docs/plans/current-feature.md' }),
      setup: async () => mkdir(join(root, '.docs/specs/current-feature.md')),
      report: '',
      expectedGap: 'unreadable',
    },
    {
      name: 'two resolved PRDs contribute their union of FR ids',
      featureContext: context({ featureIdentities: ['first-feature', 'second-feature'] }),
      setup: async () => {
        await writeFile(
          join(root, '.docs/specs/first-feature.md'),
          '## Functional Requirements\n\nFR-1',
        );
        await writeFile(
          join(root, '.docs/specs/second-feature.md'),
          '## Functional Requirements\n\nFR-2',
        );
      },
      report: '| FR-1 | ALIGNED | — | Covered |',
      expectedGap: 'FR-2',
    },
  ])('fails closed when $name', async ({ featureContext, setup, report, expectedGap }) => {
    await setup();

    await expect(prdAuditCoverageGap(root, featureContext, report)).resolves.toContain(expectedGap);
  });
});

describe('prd_audit completion predicate coverage', () => {
  let root: string;
  const featureContext = context({ activePlanPath: '.docs/plans/current-feature.md' });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-predicate-coverage-'));
    await mkdir(join(root, '.docs/specs'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.docs/specs/current-feature.md'),
      '# PRD\n\n## Functional Requirements\n\nFR-1\nFR-2',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a fresh fully-covered ALIGNED report done and blocks a report with an uncovered FR', async () => {
    const allAligned = [
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Covered |',
      '| FR-2 | ALIGNED | — | Covered |',
    ].join('\n');
    const onlyFirstFr = [
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Covered |',
    ].join('\n');

    const reportPath = join(root, '.pipeline/prd-audit.md');
    await writeFile(reportPath, allAligned);
    const covered = await checkStepCompletion(root, 'prd_audit', {
      artifactResolution: featureContext,
    });

    await writeFile(reportPath, onlyFirstFr);
    const incomplete = await checkStepCompletion(root, 'prd_audit', {
      artifactResolution: featureContext,
    });

    expect(covered.done).toBe(true);
    expect(incomplete).toEqual({
      done: false,
      reason: 'PRD audit report is missing verdict rows for FR-2.',
    });
  });
});
