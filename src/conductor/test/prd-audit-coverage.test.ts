// Covers: task:3, task:4, task:5, task:6
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  checkStepCompletion,
  resolveFeaturePrdPaths,
  sweepStaleReviewArtifacts,
  type ArtifactResolutionContext,
} from '../src/engine/artifacts.js';
import { persistPrdAuditVerdict } from '../src/engine/prd-audit-verdict-store.js';
import type { PrdAuditJudgment } from '../src/engine/prd-audit-contract.js';

const prdAuditSkillPath = fileURLToPath(
  new URL('../../../skills/prd-audit/SKILL.md', import.meta.url),
);

describe('prd-audit skill contract', () => {
  it('delegates managed verdict persistence to the typed engine contract', async () => {
    const skill = await readFile(prdAuditSkillPath, 'utf8');

    expect(skill).toContain('bounded, versioned evidence projection');
    expect(skill).toContain('terminal native structured-result shape');
    expect(skill).toContain('Do not recreate engine input collection');
    expect(skill).toMatch(/substitute a Markdown report\s+for the terminal judgment/);
    expect(skill).toMatch(/The engine validates,\s+persists, renders, and routes the returned judgment/);
    expect(skill).toContain('PASS | FIXABLE | PLAN_GAP | OVER_SCOPE');
    expect(skill).toMatch(/An OVER_SCOPE judgment supplies its closed\s+intent relation/);
  });
});

const context = (overrides: Partial<ArtifactResolutionContext> = {}): ArtifactResolutionContext => ({
  featureIdentities: [],
  changedPaths: new Set(),
  ...overrides,
});

async function persistCoverageVerdict(
  root: string,
  rows: Array<{ criterion: string; grade?: 'PASS' | 'FIXABLE' | 'PLAN_GAP' | 'OVER_SCOPE' }>,
  options: { complete?: boolean; diagnostics?: readonly string[]; codeStamp?: string | null } = {},
): Promise<void> {
  const criterionJudgments: Array<PrdAuditJudgment['criterionJudgments'][number]> = rows.map(({
    criterion: criterionId, grade = 'PASS',
  }) => {
    const match = /^S(.+)\.(\d+)$/.exec(criterionId);
    if (!match) throw new Error(`Fixture cannot derive criterion reference from ${criterionId}`);
    const base = {
      criterion: { storyId: match[1]!, ordinal: Number(match[2]) }, criterionId,
      evidence: 'Fixture supplies typed audit evidence.', rationale: 'Fixture supplies typed audit evidence.',
      requirementAssociations: [], evidenceTaskIds: [],
    };
    if (grade === 'FIXABLE') return { ...base, grade, ownerTaskId: '1' };
    if (grade === 'OVER_SCOPE') return { ...base, grade, intentRelation: 'within' as const };
    return { ...base, grade };
  });
  await persistPrdAuditVerdict(root, {
    complete: options.complete ?? true,
    judgment: { version: 'v1', criterionJudgments, noOwnerObservations: [] },
    diagnostics: options.diagnostics ?? [], recordedDispositions: [],
  // Managed PRD-audit settlement stamps every persisted judgment.  A fixture
  // that omits an explicit stamp models a newly written verdict whose stamp
  // cannot be preserved in this non-git scratch directory, not legacy
  // unstamped evidence (which the typed migration correctly rejects).
  }, { attemptId: 'fixture-run', codeStamp: options.codeStamp ?? 'fixture-head' });
}

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

describe('prd_audit completion predicate coverage', () => {
  let root: string;
  const featureContext = context({ activePlanPath: '.docs/plans/current-feature.md' });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-predicate-coverage-'));
    await mkdir(join(root, '.docs/specs'), { recursive: true });
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await mkdir(join(root, '.docs/plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.docs/specs/current-feature.md'),
      '# PRD\n\n## Functional Requirements\n\nFR-1\nFR-2\nFR-3\nFR-4\nFR-5',
    );
    // The predicate resolves this plan as the authority for every `Plan task`
    // cell `criterionReport` emits; without it a cited task is unverifiable.
    await writeFile(
      join(root, '.docs/plans/current-feature.md'),
      '### Task 1: Existing work\n\n**Files:** src/example.ts\n',
    );
    await writeFile(
      join(root, '.docs/stories/current-feature.md'),
      [
        '## Story 1: criteria', '', '### Happy Path',
        '- Given one, when run, then one.', '- Given two, when run, then two.',
        '- Given three, when run, then three.', '- Given four, when run, then four.',
        '- Given five, when run, then five.',
        '', '**Requirements:** FR-1, FR-2, FR-3, FR-4, FR-5',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a fresh fully-covered typed verdict done', async () => {
    await persistCoverageVerdict(root, [1, 2, 3, 4, 5].map((n) => ({ criterion: `S1.${n}` })));
    const covered = await checkStepCompletion(root, 'prd_audit', {
      artifactResolution: featureContext,
    });

    expect(covered.done).toBe(true);
  });

  it('blocks an incomplete typed verdict without writing a code stamp', async () => {
    await persistCoverageVerdict(root, [1, 2, 4].map((n) => ({ criterion: `S1.${n}` })), {
      complete: false,
      diagnostics: ['criterion judgments missing S1.3, S1.5'],
    });

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      routeClass: 'absent',
      retrySignal: 'structured-result-rejected',
      reason: '.pipeline/prd-audit.json is incomplete: criterion judgments missing S1.3, S1.5',
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not interpret an empty rendered report without typed evidence', async () => {
    await writeFile(join(root, '.pipeline/prd-audit.md'), '');

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      routeClass: 'absent',
      reason: '.pipeline/prd-audit.json is missing',
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves a complete typed verdict when its rendered report loses a source artifact', async () => {
    await rm(join(root, '.docs/specs/current-feature.md'));
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await writeFile(
      join(root, '.docs/stories/current-feature.md'),
      '## Story 1: Unreadable criteria\n\n**Requirement:** FR-1',
    );
    await persistCoverageVerdict(root, [{ criterion: 'S1.1' }]);

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toMatchObject({
      done: true,
    });
  });

  it('requires a PLAN_GAP row for a PRD requirement without a covering story', async () => {
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await writeFile(
      join(root, '.docs/stories/current-feature.md'),
      [
        '## Story 1: Covered requirement',
        '',
        '**Requirement:** FR-1',
        '',
        '### Happy Path',
        '- Given a valid request, when it is handled, then the result is visible.',
      ].join('\n'),
    );
    await persistCoverageVerdict(root, [{ criterion: 'S1.1' }], {
      complete: false,
      diagnostics: ['FR-2 has no covering story criterion or PLAN_GAP judgment'],
    });

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toMatchObject({
      done: false,
      reason: expect.stringContaining('FR-2'),
    });
  });

  it('keeps a typed verdict done when the rendered view carries stale DIVERGED history', async () => {
    await persistCoverageVerdict(root, [1, 2, 3, 4, 5].map((n) => ({ criterion: `S1.${n}` })));
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      [
        '# PRD Audit', '', '## What moved since cycle 4', '',
        '| FR | Cycle 4 | Cycle 5 | Why |', '| --- | --- | --- | --- |',
        '| FR-5 | DIVERGED (`intended-drift`), blocking | **ALIGNED** | PRD amended |', '',
      ].join('\n'),
    );

    await expect(
      checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext }),
    ).resolves.toMatchObject({ done: true });
  });

  it('still blocks on a Verdict Table row that a narrative table claims is closed', async () => {
    await persistCoverageVerdict(root, [
      ...[1, 2, 3, 4].map((n) => ({ criterion: `S1.${n}` })),
      { criterion: 'S1.5', grade: 'FIXABLE' },
    ]);

    await expect(
      checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext }),
    ).resolves.toEqual({
      done: false,
      routeClass: 'named-route',
      reason: expect.stringContaining('S1.5 (FIXABLE)'),
    });
  });

  it('reports blocking typed verdict rows without writing a code stamp', async () => {
    await persistCoverageVerdict(root, [
      { criterion: 'S1.1' }, { criterion: 'S1.2', grade: 'FIXABLE' }, { criterion: 'S1.4' },
    ]);

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      routeClass: 'named-route',
      reason: expect.stringContaining('S1.2 (FIXABLE)'),
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('prd_audit code-validity coverage rechecks', () => {
  let root: string;
  const featureContext = context({ activePlanPath: '.docs/plans/current-feature.md' });

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

  it('preserves a code-valid typed verdict when no stories artifact exists', async () => {
    await persistCoverageVerdict(root, [{ criterion: 'S1.1' }], { codeStamp: 'baseline' });

    await expect(
      checkStepCompletion(root, 'prd_audit', {
        artifactResolution: featureContext,
        git: codeValidGit,
        sessionStartedAt: Date.now(),
      }),
    ).resolves.toMatchObject({ done: true });
  });

  it('still preserves a fully-covered code-valid typed verdict', async () => {
    await persistCoverageVerdict(root, [{ criterion: 'S1.1' }, { criterion: 'S1.2' }], { codeStamp: 'baseline' });

    await expect(
      checkStepCompletion(root, 'prd_audit', {
        artifactResolution: featureContext,
        git: codeValidGit,
        sessionStartedAt: Date.now(),
      }),
    ).resolves.toMatchObject({ done: true });
  });

  it('preserves a stale rendered report backed by a code-valid typed verdict', async () => {
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
    await execa('git', ['add', '.'], { cwd: root });
    await execa('git', ['commit', '-qm', 'test fixture'], { cwd: root });
    const baseline = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout;
    const reportPath = join(root, '.pipeline/prd-audit.md');
    await persistCoverageVerdict(root, [{ criterion: 'S1.1' }], { codeStamp: baseline });
    await utimes(reportPath, 1, 1);

    await expect(
      sweepStaleReviewArtifacts(root, 'prd_audit', Date.now(), undefined, featureContext),
    ).resolves.toEqual([]);
  });
});
