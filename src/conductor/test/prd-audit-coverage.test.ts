import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import {
  checkStepCompletion,
  findFrIdsWithoutRows,
  prdAuditCoverageGap,
  resolveFeaturePrdPaths,
  sweepStaleReviewArtifacts,
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

  it('matches a dated PRD from the bare feature identity in a multi-PRD corpus', async () => {
    await writeFile(join(root, '.docs/specs/2026-08-09-csv-export-single-account.md'), '# PRD');
    await writeFile(join(root, '.docs/specs/other-feature.md'), '# PRD');

    await expect(
      resolveFeaturePrdPaths(root, context({ featureIdentities: ['csv-export-single-account'] })),
    ).resolves.toEqual([join(root, '.docs/specs/2026-08-09-csv-export-single-account.md')]);
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
      '# PRD\n\n## Functional Requirements\n\nFR-1\nFR-2\nFR-3\nFR-4\nFR-5',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a fresh fully-covered ALIGNED report done', async () => {
    const allAligned = [
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Covered |',
      '| FR-2 | ALIGNED | — | Covered |',
      '| FR-3 | ALIGNED | — | Covered |',
      '| FR-4 | ALIGNED | — | Covered |',
      '| FR-5 | ALIGNED | — | Covered |',
    ].join('\n');

    const reportPath = join(root, '.pipeline/prd-audit.md');
    await writeFile(reportPath, allAligned);
    const covered = await checkStepCompletion(root, 'prd_audit', {
      artifactResolution: featureContext,
    });

    expect(covered.done).toBe(true);
  });

  it('blocks missing FR-3 and FR-5 without writing a code stamp', async () => {
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      [
        '| FR | Verdict | Gap-class | Evidence |',
        '| --- | --- | --- | --- |',
        '| FR-1 | ALIGNED | — | Covered |',
        '| FR-2 | ALIGNED | — | Covered |',
        '| FR-4 | ALIGNED | — | Covered |',
      ].join('\n'),
    );

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      reason: 'PRD audit report is missing verdict rows for FR-3, FR-5.',
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('blocks an empty report naming every missing FR without writing a code stamp', async () => {
    await writeFile(join(root, '.pipeline/prd-audit.md'), '');

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      reason: 'PRD audit report is missing verdict rows for FR-1, FR-2, FR-3, FR-4, FR-5.',
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reports both blocking verdict rows and omitted verdict rows without writing a code stamp', async () => {
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      [
        '| FR | Verdict | Gap-class | Evidence |',
        '| --- | --- | --- | --- |',
        '| FR-1 | ALIGNED | — | Covered |',
        '| FR-2 | MISSING | impl-gap | Not implemented |',
        '| FR-4 | ALIGNED | — | Covered |',
      ].join('\n'),
    );

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      reason:
        'prd-audit found un-ALIGNED FRs: FR-2 — close the gap (BUILD) or amend the PRD (DECIDE), then re-audit; PRD audit report is missing verdict rows for FR-3, FR-5.',
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('prd_audit code-validity coverage rechecks', () => {
  let root: string;
  const featureContext = context({ activePlanPath: '.docs/plans/current-feature.md' });
  const partialReport = [
    '| FR | Verdict | Gap-class | Evidence |',
    '| --- | --- | --- | --- |',
    '| FR-1 | ALIGNED | — | Covered |',
  ].join('\n');
  const fullReport = [
    '| FR | Verdict | Gap-class | Evidence |',
    '| --- | --- | --- | --- |',
    '| FR-1 | ALIGNED | — | Covered |',
    '| FR-2 | ALIGNED | — | Covered |',
  ].join('\n');

  const codeValidGit = async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 1, stdout: '', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-preserve-coverage-'));
    await mkdir(join(root, '.docs/specs'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.docs/specs/current-feature.md'),
      '## Functional Requirements\n\nFR-1\nFR-2',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not preserve a code-valid sidecar when the current report omits an FR verdict', async () => {
    await writeFile(join(root, '.pipeline/prd-audit.md'), partialReport);
    await writeFile(join(root, '.pipeline/prd-audit-code-stamp.json'), '{"codeStamp":"baseline"}');

    await expect(
      checkStepCompletion(root, 'prd_audit', {
        artifactResolution: featureContext,
        git: codeValidGit,
        sessionStartedAt: Date.now(),
      }),
    ).resolves.toMatchObject({ done: false });
  });

  it('still preserves a fully-covered code-valid report', async () => {
    await writeFile(join(root, '.pipeline/prd-audit.md'), fullReport);
    await writeFile(join(root, '.pipeline/prd-audit-code-stamp.json'), '{"codeStamp":"baseline"}');

    await expect(
      checkStepCompletion(root, 'prd_audit', {
        artifactResolution: featureContext,
        git: codeValidGit,
        sessionStartedAt: Date.now(),
      }),
    ).resolves.toMatchObject({ done: true });
  });

  it('does not spare a stale partial report with a code-valid sidecar when only the caller has feature identity', async () => {
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
    await execa('git', ['add', '.'], { cwd: root });
    await execa('git', ['commit', '-qm', 'test fixture'], { cwd: root });
    const baseline = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout;
    const reportPath = join(root, '.pipeline/prd-audit.md');
    await writeFile(reportPath, partialReport);
    await writeFile(join(root, '.pipeline/prd-audit-code-stamp.json'), JSON.stringify({ codeStamp: baseline }));
    await utimes(reportPath, 1, 1);

    await expect(
      sweepStaleReviewArtifacts(root, 'prd_audit', Date.now(), undefined, featureContext),
    ).resolves.toEqual([reportPath]);
  });
});
