import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findFrIdsWithoutRows,
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
