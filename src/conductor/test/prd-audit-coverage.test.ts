// Covers: task:3, task:4
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  checkStepCompletion,
  parsePrdAuditReport,
  prdAuditCoverageGap,
  resolveFeaturePrdPaths,
  sweepStaleReviewArtifacts,
  type ArtifactResolutionContext,
} from '../src/engine/artifacts.js';
import { appendRemediationTasks } from '../src/engine/remediation-append.js';

const prdAuditSkillPath = fileURLToPath(
  new URL('../../../skills/prd-audit/SKILL.md', import.meta.url),
);

describe('prd-audit skill contract', () => {
  it('renders a graded per-criterion report with PRD intent context', async () => {
    const skill = await readFile(prdAuditSkillPath, 'utf8');
    const report = skill.match(/```markdown\n(# PRD Audit:[\s\S]*?)\n```/)?.[1];

    expect(report).toEqual(expect.any(String));
    expect(report).toMatch(/^# PRD Audit: <Feature Name>/m);
    expect(report).toMatch(/^\*\*PRD:\*\* present/m);
    expect(report).toMatch(/^\*\*Intent sources:\*\* /m);
    expect(report).toMatch(/^\| Criterion \| Grade \| Plan task \| PRD: \| Intent relation \| Evidence \|/m);
    expect(report).toMatch(/^\| S6\.1 \| PASS \| — \| FR-7 \| /m);
    expect(report).toMatch(/^\| S6\.2 \| FIXABLE \| 4 \| FR-7 \| /m);

    expect(skill).toContain('PASS | FIXABLE | PLAN_GAP | OVER_SCOPE');
    expect(skill).toContain('Any row may cite a task present\nin the active plan; cite its bare task id with no annotation.');
    expect(skill).toContain('Every FIXABLE row must cite its owning\nplan task.');
    expect(skill).toContain('Use `—` when there is no task.');
    expect(skill).toContain('every OVER_SCOPE row must use exactly one of `within`, `outside-harmless`, or `outside-visible`');
  });
});

describe('parsePrdAuditReport', () => {
  it('reads criterion grades, optional plan ownership, and the PRD-presence marker', () => {
    const report = [
      '# PRD Audit',
      '',
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S2.1 | FIXABLE | 4 | Missing guard |',
      '| S2.2 | PLAN_GAP | | No plan task owns this |',
    ].join('\n');

    expect(parsePrdAuditReport(report)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        rejectedRows: [],
        findings: [
          { criterion: 'S2.1', grade: 'FIXABLE', planTask: '4', prdIds: [], evidence: 'Missing guard' },
          { criterion: 'S2.2', grade: 'PLAN_GAP', prdIds: [], evidence: 'No plan task owns this' },
        ],
      },
    });
  });

  it('accepts the mandated em-dash placeholder for grades without a Plan task', () => {
    const report = [
      '# PRD Audit',
      '',
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S6.1 | PASS | — | FR-7 | Implemented |',
      '| S6.2 | FIXABLE | 4 | FR-7 | Missing guard |',
      '| S6.3 | PLAN_GAP | — | FR-7 | No active task owns the missing behavior |',
      '| S9.2 | OVER_SCOPE | — | FR-9 | Outside intent |',
    ].join('\n');

    expect(parsePrdAuditReport(report, activePlan)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        rejectedRows: [],
        findings: [
          { criterion: 'S6.1', grade: 'PASS', prdIds: ['FR-7'], evidence: 'Implemented' },
          { criterion: 'S6.2', grade: 'FIXABLE', planTask: '4', prdIds: ['FR-7'], evidence: 'Missing guard' },
          {
            criterion: 'S6.3',
            grade: 'PLAN_GAP',
            prdIds: ['FR-7'],
            evidence: 'No active task owns the missing behavior',
          },
          { criterion: 'S9.2', grade: 'OVER_SCOPE', prdIds: ['FR-9'], evidence: 'Outside intent' },
        ],
      },
    });
  });

  it('reads a no-PRD verdict report', () => {
    const report = [
      '**PRD:** none',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S2.1 | PASS | | Implemented |',
    ].join('\n');

    expect(parsePrdAuditReport(report)).toMatchObject({
      ok: true,
      value: { prd: 'none', findings: [{ criterion: 'S2.1', grade: 'PASS' }] },
    });
  });

  it('rejects a grade outside the closed grade enum', () => {
    const report = [
      '**PRD:** none',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S2.1 | MAYBE | | Unclear |',
    ].join('\n');

    expect(parsePrdAuditReport(report)).toEqual({
      ok: true,
      value: {
        prd: 'none',
        findings: [],
        rejectedRows: [{
          key: 'S2.1',
          rowText: '| S2.1 | MAYBE | | Unclear |',
          reason: 'PRD audit finding S2.1 has an invalid Grade.',
        }],
      },
    });
  });

  const activePlan = '### Task 4: Existing task\n\n**Files:** src/example.ts';

  it('resolves annotated and remediation Plan task citations against the active plan', () => {
    const report = [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S1.1 | PASS | rem-prd-audit-rem-s1-6-1 (landed) | Implemented |',
      '| S1.2 | FIXABLE | rem-as-built-rem-ab1-3 | Missing guard |',
    ].join('\n');
    const remediationPlan = [
      '### Task rem-prd-audit-rem-s1-6-1: Existing task',
      '',
      '### Task rem-as-built-rem-ab1-3: Existing task',
    ].join('\n');

    expect(parsePrdAuditReport(report, remediationPlan)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        rejectedRows: [],
        findings: [
          {
            criterion: 'S1.1',
            grade: 'PASS',
            planTask: 'rem-prd-audit-rem-s1-6-1',
            prdIds: [],
            evidence: 'Implemented',
          },
          {
            criterion: 'S1.2',
            grade: 'FIXABLE',
            planTask: 'rem-as-built-rem-ab1-3',
            prdIds: [],
            evidence: 'Missing guard',
          },
        ],
      },
    });
  });

  it('#2064 keeps an unchanged report parseable after appending remediation tasks', () => {
    const basePlan = [
      '### Task 1: Existing work',
      '',
      '### Task 2: Existing work',
    ].join('\n');
    const appended = appendRemediationTasks(basePlan, [{
      id: 'S1.1',
      disposition: 'build',
      category: null,
      rationale: 'Repair the first missing behavior.',
      tasks: [{ id: 'rem-s1-6-1', title: 'Repair the cited behavior' }],
    }], 'prd-audit');
    const report = [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S1.1 | PASS | rem-prd-audit-rem-s1-6-1 (landed) | Implemented |',
      '| S1.2 | FIXABLE | 2 | Missing guard |',
    ].join('\n');
    const extended = appendRemediationTasks(appended.planText, [{
      id: 'AB1',
      disposition: 'build',
      category: null,
      rationale: 'Repair the as-built gap.',
      tasks: [{ id: 'rem-ab1-2', title: 'Repair the as-built behavior' }],
    }], 'as-built');
    const expected = {
      ok: true,
      value: {
        prd: 'present' as const,
        rejectedRows: [],
        findings: [
          {
            criterion: 'S1.1',
            grade: 'PASS',
            planTask: 'rem-prd-audit-rem-s1-6-1',
            prdIds: [],
            evidence: 'Implemented',
          },
          {
            criterion: 'S1.2',
            grade: 'FIXABLE',
            planTask: '2',
            prdIds: [],
            evidence: 'Missing guard',
          },
        ],
      },
    };

    expect([
      parsePrdAuditReport(report, appended.planText),
      parsePrdAuditReport(report, extended.planText),
    ]).toEqual([expected, expected]);
  });

  it('rejects a FIXABLE finding with no owning plan task, naming the finding', () => {
    const report = [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S2.1 | FIXABLE | | Missing guard |',
    ].join('\n');

    expect(parsePrdAuditReport(report, activePlan)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        findings: [],
        rejectedRows: [{
          key: 'S2.1',
          rowText: '| S2.1 | FIXABLE | | Missing guard |',
          reason: 'PRD audit finding S2.1 is FIXABLE but has no Plan task.',
        }],
      },
    });
  });

  it('rejects a FIXABLE finding whose task is absent from the active plan', () => {
    const report = [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S2.1 | FIXABLE | 99 | Missing guard |',
    ].join('\n');

    expect(parsePrdAuditReport(report, activePlan)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        findings: [],
        rejectedRows: [{
          key: 'S2.1',
          rowText: '| S2.1 | FIXABLE | 99 | Missing guard |',
          reason: 'PRD audit finding S2.1 names Plan task 99, which is absent from the active plan.',
        }],
      },
    });
  });

  it('rejects a finding that claims multiple grades', () => {
    const report = [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S2.1 | FIXABLE, PLAN_GAP | 4 | Missing guard |',
    ].join('\n');

    expect(parsePrdAuditReport(report, activePlan)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        findings: [],
        rejectedRows: [{
          key: 'S2.1',
          rowText: '| S2.1 | FIXABLE, PLAN_GAP | 4 | Missing guard |',
          reason: 'PRD audit finding S2.1 has an invalid Grade.',
        }],
      },
    });
  });

  it('accepts separate rows with one grade each', () => {
    const report = [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S2.1 | FIXABLE | 4 | Missing guard |',
      '| S2.2 | PLAN_GAP | | No plan task owns this |',
    ].join('\n');

    expect(parsePrdAuditReport(report, activePlan)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        rejectedRows: [],
        findings: [
          { criterion: 'S2.1', grade: 'FIXABLE', planTask: '4', prdIds: [], evidence: 'Missing guard' },
          { criterion: 'S2.2', grade: 'PLAN_GAP', prdIds: [], evidence: 'No plan task owns this' },
        ],
      },
    });
  });

  it('stops at the end of the criterion table and retains the per-FR table as context', () => {
    const report = [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S1.1 | PASS | — | FR-1 | Implemented |',
      '',
      '| FR | Verdict | Gap-class | Evidence |',
      '| --- | --- | --- | --- |',
      '| FR-1 | ALIGNED | — | Implemented |',
    ].join('\n');

    expect(parsePrdAuditReport(report)).toEqual({
      ok: true,
      value: {
        prd: 'present',
        rejectedRows: [],
        findings: [{ criterion: 'S1.1', grade: 'PASS', prdIds: ['FR-1'], evidence: 'Implemented' }],
      },
    });
  });
});

const context = (overrides: Partial<ArtifactResolutionContext> = {}): ArtifactResolutionContext => ({
  featureIdentities: [],
  changedPaths: new Set(),
  ...overrides,
});

function criterionReport(
  rows: Array<{ criterion: string; grade?: 'PASS' | 'FIXABLE' | 'PLAN_GAP' | 'OVER_SCOPE'; prd?: string }>,
  prd: 'present' | 'none' = 'present',
): string {
  return [
    `**PRD:** ${prd}`,
    '',
    '## Verdict Table',
    '',
    '| Criterion | Grade | Plan task | PRD: | Evidence |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(({ criterion, grade = 'PASS', prd: intent = '' }) =>
      `| ${criterion} | ${grade} | ${grade === 'FIXABLE' ? '1' : '—'} | ${intent} | Covered |`),
  ].join('\n');
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

describe('prdAuditCoverageGap', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-coverage-'));
    await mkdir(join(root, '.docs/specs'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('requires the PRD-presence marker to agree with resolved PRD authority', async () => {
    const featureContext = context({ activePlanPath: '.docs/plans/current-feature.md' });
    const report = criterionReport([{ criterion: 'S1.1', prd: 'FR-1' }]);

    await writeFile(
      join(root, '.docs/specs/current-feature.md'),
      '# PRD\n\n## Functional Requirements\n\nFR-1\nFR-2',
    );
    await expect(prdAuditCoverageGap(root, featureContext, report)).resolves.toBeNull();
    await expect(
      prdAuditCoverageGap(root, featureContext, criterionReport([{ criterion: 'S1.1' }], 'none')),
    ).resolves.toContain('declares **PRD:** none');
  });

  it('accepts a conformant no-PRD report when no approved PRD resolves', async () => {
    const report = [
      '**PRD:** none',
      '',
      '## Verdict Table',
      '',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      '| S1.1 | PASS | | Implemented |',
    ].join('\n');

    await expect(
      prdAuditCoverageGap(root, context({ activePlanPath: '.docs/plans/current-feature.md' }), report),
    ).resolves.toBeNull();
  });

  it.each([
    {
      name: 'the no-PRD report has a malformed PRD declaration',
      featureContext: context({ activePlanPath: '.docs/plans/current-feature.md' }),
      setup: async () => undefined,
      report: '**PRD:** unavailable',
      expectedGap: 'must declare **PRD:** present or none',
    },
    {
      name: 'a resolved PRD cannot be read',
      featureContext: context({ activePlanPath: '.docs/plans/current-feature.md' }),
      setup: async () => mkdir(join(root, '.docs/specs/current-feature.md')),
      report: criterionReport([{ criterion: 'S1.1' }]),
      expectedGap: null,
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
      report: criterionReport([{ criterion: 'S1.1' }], 'none'),
      expectedGap: 'declares **PRD:** none',
    },
  ])('handles $name', async ({ featureContext, setup, report, expectedGap }) => {
    await setup();

    if (expectedGap === null) {
      await expect(prdAuditCoverageGap(root, featureContext, report)).resolves.toBeNull();
    } else {
      await expect(prdAuditCoverageGap(root, featureContext, report)).resolves.toContain(expectedGap);
    }
  });
});

describe('prd_audit completion predicate coverage', () => {
  let root: string;
  const featureContext = context({ activePlanPath: '.docs/plans/current-feature.md' });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-predicate-coverage-'));
    await mkdir(join(root, '.docs/specs'), { recursive: true });
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.docs/specs/current-feature.md'),
      '# PRD\n\n## Functional Requirements\n\nFR-1\nFR-2\nFR-3\nFR-4\nFR-5',
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

  it('keeps a fresh fully-covered criterion report done', async () => {
    const allAligned = criterionReport([1, 2, 3, 4, 5].map((n) => ({ criterion: `S1.${n}` })));

    const reportPath = join(root, '.pipeline/prd-audit.md');
    await writeFile(reportPath, allAligned);
    const covered = await checkStepCompletion(root, 'prd_audit', {
      artifactResolution: featureContext,
    });

    expect(covered.done).toBe(true);
  });

  it('blocks missing S1.3 and S1.5 without writing a code stamp', async () => {
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      criterionReport([1, 2, 4].map((n) => ({ criterion: `S1.${n}` }))),
    );

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      reason: 'PRD audit report is missing criterion-grade rows for S1.3, S1.5.',
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('blocks an empty report as mechanically malformed without writing a code stamp', async () => {
    await writeFile(join(root, '.pipeline/prd-audit.md'), '');

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
      reason: 'PRD audit report must declare **PRD:** present or none.; PRD audit report must declare **PRD:** present or none.',
    });
    await expect(access(join(root, '.pipeline/prd-audit-code-stamp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('continues story-criterion coverage when no approved PRD resolves', async () => {
    await rm(join(root, '.docs/specs/current-feature.md'));
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await writeFile(
      join(root, '.docs/stories/current-feature.md'),
      '## Story 1: Unreadable criteria\n\n**Requirement:** FR-1',
    );
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      [
        '**PRD:** none',
        '',
        '## Verdict Table',
        '',
        '| Criterion | Grade | Plan task | Evidence |',
        '| --- | --- | --- | --- |',
        '| S1.1 | PASS | | Covered |',
      ].join('\n'),
    );

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toMatchObject({
      done: false,
      reason: expect.stringContaining('.docs/stories/current-feature.md'),
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
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      criterionReport([{ criterion: 'S1.1', prd: 'FR-1' }]),
    );

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toMatchObject({
      done: false,
      reason: expect.stringContaining('FR-2'),
    });
  });

  it('keeps a report done when a prior-cycle history table carries a stale DIVERGED verdict', async () => {
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      [
        '# PRD Audit', '', '## What moved since cycle 4', '',
        '| FR | Cycle 4 | Cycle 5 | Why |', '| --- | --- | --- | --- |',
        '| FR-5 | DIVERGED (`intended-drift`), blocking | **ALIGNED** | PRD amended |', '',
        criterionReport([1, 2, 3, 4, 5].map((n) => ({ criterion: `S1.${n}` }))),
      ].join('\n'),
    );

    await expect(
      checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext }),
    ).resolves.toMatchObject({ done: true });
  });

  it('still blocks on a Verdict Table row that a narrative table claims is closed', async () => {
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      criterionReport([
        ...[1, 2, 3, 4].map((n) => ({ criterion: `S1.${n}` })),
        { criterion: 'S1.5', grade: 'FIXABLE' },
      ]),
    );

    await expect(
      checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext }),
    ).resolves.toEqual({
      done: false,
      reason: expect.stringContaining('S1.5 (FIXABLE)'),
    });
  });

  it('reports both blocking verdict rows and omitted verdict rows without writing a code stamp', async () => {
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      criterionReport([{ criterion: 'S1.1' }, { criterion: 'S1.2', grade: 'FIXABLE' }, { criterion: 'S1.4' }]),
    );

    await expect(checkStepCompletion(root, 'prd_audit', { artifactResolution: featureContext })).resolves.toEqual({
      done: false,
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
  const partialReport = criterionReport([{ criterion: 'S1.1' }]);
  const fullReport = criterionReport([{ criterion: 'S1.1' }, { criterion: 'S1.2' }]);

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

  it('preserves a code-valid sidecar when no stories artifact makes the report complete', async () => {
    await writeFile(join(root, '.pipeline/prd-audit.md'), partialReport);
    await writeFile(join(root, '.pipeline/prd-audit-code-stamp.json'), '{"codeStamp":"baseline"}');

    await expect(
      checkStepCompletion(root, 'prd_audit', {
        artifactResolution: featureContext,
        git: codeValidGit,
        sessionStartedAt: Date.now(),
      }),
    ).resolves.toMatchObject({ done: true });
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

  it('preserves a stale report that is complete without a stories artifact', async () => {
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
    ).resolves.toEqual([]);
  });
});
