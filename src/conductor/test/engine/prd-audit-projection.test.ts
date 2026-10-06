// Covers: task:1, task:2, task:3, task:4, task:5
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import * as prdAuditProjection from '../../src/engine/prd-audit-projection.js';
import {
  buildPrdAuditProjection,
  PRD_AUDIT_PROJECTION_VERSION,
  type PrdAuditProjectionLimits,
} from '../../src/engine/prd-audit-projection.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function largestCorpusBytes(directory: string): Promise<number> {
  const names = await readdir(directory, { recursive: true });
  const sizes = await Promise.all(names
    .filter((name) => name.endsWith('.md'))
    .map(async (name) => Buffer.byteLength(await readFile(join(directory, name), 'utf-8'))));
  return Math.max(...sizes);
}

async function largestPlanIntentBytes(directory: string): Promise<number> {
  const names = await readdir(directory, { recursive: true });
  const intents = await Promise.all(names
    .filter((name) => name.endsWith('.md'))
    .map(async (name) => {
      const plan = await readFile(join(directory, name), 'utf-8');
      const heading = /^##\s+Technical Approach\s*$/im.exec(plan);
      if (heading?.index === undefined) return 0;
      const section = plan.slice(heading.index + heading[0].length).split(/^##\s+/m, 1)[0] ?? '';
      const intent = section.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
      return Buffer.byteLength(intent, 'utf-8');
    }));
  return Math.max(...intents);
}

function roundUpPowerOfTwo(bytes: number): number {
  let rounded = 1;
  while (rounded < bytes) rounded *= 2;
  return rounded;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-projection-'));
  directories.push(root);
  const git = async (...args: string[]) => execFileAsync('git', ['-C', root, ...args]);

  await execFileAsync('git', ['init', '-b', 'main', root]);
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test User');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.docs', 'specs'), { recursive: true });
  await mkdir(join(root, '.docs', 'coherence'), { recursive: true });
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, 'src.ts'), 'export const version = 1;\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  await git('checkout', '-b', 'feature/audit-fixture');

  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
    feature_desc: 'audit-fixture',
    activePlanPath: '.docs/plans/audit-fixture.md',
  }));
  await writeFile(join(root, '.docs', 'plans', 'audit-fixture.md'), `# Implementation Plan: Audit fixture

**Stories:** .docs/stories/audit-fixture.md

## Technical Approach

Audit the feature requirements against the delivered source.

### Task task-a: Preserve the documented outcome

**Story:** Story alpha.1
**Files:** src.ts
**Done when:**
- The published behavior preserves the documented outcome.

### Task task-b: Preserve the negative obligation

**Story:** Story beta.2
**Files:** src.ts
**Done when:**
- The published behavior reports the documented gap.
- The report remains attributable to Story beta.2.
`);
  await writeFile(join(root, '.docs', 'stories', 'audit-fixture.md'), `# Stories

## Story alpha.1: Preserve obligations

### Happy Path
- Given the feature is audited, when its source meets the documented behavior, then the audit can pass.

### Negative Paths
- Given the feature omits the documented behavior, when its source is audited, then the audit reports the gap.

## Story beta.2: Preserve negative obligations

### Happy Path
- Given the audit receives documented evidence, when the negative obligation is satisfied, then the audit retains its attribution.

### Negative Paths
- Given the negative obligation is omitted, when the audit evaluates the feature, then the audit reports the attributable gap.
`);
  await writeFile(join(root, '.docs', 'specs', 'audit-fixture.md'), `# PRD

## Goals
- Preserve the documented outcome.

## Non-Goals
- Do not broaden unrelated behavior.

## In Scope
- Bounded evidence for the active audit.

## Out of Scope
- Replacing the reviewer contract.

## Functional Requirements
- FR-7: The audit preserves the documented outcome.
- **FR-9:** The audit retains bolded requirement syntax.
`);
  await writeFile(join(root, '.docs', 'specs', '2026-09-30-audit-fixture.md'), `# Supplemental PRD

## Functional Requirements
- FR-8: The audit retains every applicable PRD source.
`);
  await writeFile(join(root, '.docs', 'coherence', 'audit-fixture.md'), `# Coherence

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| fr | FR-7 | story-alpha.1 | covered | Preserve the documented outcome. |
| story | story-alpha.1 | task-a | covered | Preserve obligations. |
`);
  await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
    version: 2,
    feature: { version: 1, repository: 'fixture-repository', feature: 'audit-fixture' },
    decisions: [{
      id: 'decision-1',
      criterion: 'NC.1',
      authority: 'accept',
      rationale: 'The original scope was explicitly accepted.',
      operator: 'operator@example.test',
      revision: 1,
      originalSource: {
        id: 'prd-audit:NC.1',
        snapshot: 'The original reviewer found a scope observation.',
      },
      originalCaseId: 'case-1',
    }],
  }));
  await writeFile(join(root, 'src.ts'), 'export const version = 2;\n');
  await git('add', '.');
  await git('commit', '-m', 'feature change');
  return root;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('PRD-audit feature projection', () => {
  it('rejects each malformed story criterion and task completion block before dispatch', async () => {
    const root = await fixture();
    const stories = join(root, '.docs', 'stories', 'audit-fixture.md');
    await writeFile(stories, `# Stories\n\n## Story alpha.1: Broken obligation\n\n### Happy Path\n- Given a request, when it is handled, it is visible.\n`);
    await expect(buildPrdAuditProjection(root)).resolves.toMatchObject({
      ok: false,
      fault: {
        source: '.docs/stories/audit-fixture.md',
        dimension: 'malformed-criteria',
        detail: expect.stringContaining('lacks Then'),
      },
    });

    await writeFile(stories, `# Stories\n\n## Story alpha.1: Valid obligation\n\n### Happy Path\n- Given a request, when it is handled, then it is visible.\n\n### Negative Paths\n- Given a request, when it fails, then it is visible.\n`);
    await writeFile(join(root, '.docs', 'plans', 'audit-fixture.md'), `# Implementation Plan: Audit fixture\n\n**Stories:** .docs/stories/audit-fixture.md\n\n## Technical Approach\n\nAudit the feature requirements against the delivered source.\n\n### Task task-a: Broken completion\n\n**Story:** Story alpha.1\n**Done when:**\n`);
    await expect(buildPrdAuditProjection(root)).resolves.toMatchObject({
      ok: false,
      fault: { dimension: 'plan task completion conditions', detail: expect.stringContaining('task-a') },
    });
  });
  it.each([
    ['a source without a story id', '# Stories\n\n### Happy Path\n- Given a request, when it is handled, then it is visible.\n\n### Negative Paths\n- Given a request, when it fails, then it is visible.', 'missing Story id'],
    ['a source without a Happy Path section', '# Stories\n\n## Story alpha.1: Broken obligation\n\n### Negative Paths\n- Given a request, when it fails, then it is visible.', 'missing Happy Path section'],
    ['a source without a Negative Paths section', '# Stories\n\n## Story alpha.1: Broken obligation\n\n### Happy Path\n- Given a request, when it is handled, then it is visible.', 'missing Negative Paths section'],
    ['a criterion without When', '# Stories\n\n## Story alpha.1: Broken obligation\n\n### Happy Path\n- Given a request, then it is visible.\n\n### Negative Paths\n- Given a request, when it fails, then it is visible.', 'lacks When'],
  ])('rejects %s through the sealed story readability contract', async (_name, storiesText, diagnostic) => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'stories', 'audit-fixture.md'), storiesText);
    await expect(buildPrdAuditProjection(root)).resolves.toMatchObject({
      ok: false,
      fault: {
        source: '.docs/stories/audit-fixture.md',
        dimension: 'malformed-criteria',
        detail: expect.stringContaining(diagnostic),
      },
    });
  });

  it('projects an exact story requirement association when applicable PRD sources share its id', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'stories', 'audit-fixture.md'), `# Stories

## Story alpha.1: Preserve obligations

**Requirements:** .docs/specs/audit-fixture.md:FR-1

### Happy Path
- Given the feature is audited, when its source meets the documented behavior, then the audit can pass.

### Negative Paths
- Given the feature omits the documented behavior, when its source is audited, then the audit reports the gap.

## Story beta.2: Preserve negative obligations

### Happy Path
- Given the audit receives documented evidence, when the negative obligation is satisfied, then the audit retains its attribution.

### Negative Paths
- Given the negative obligation is omitted, when the audit evaluates the feature, then the audit reports the attributable gap.
`);
    await writeFile(join(root, '.docs', 'specs', 'audit-fixture.md'), '# PRD\n\n## Functional Requirements\n- FR-1: The primary source obligation.\n');
    await writeFile(join(root, '.docs', 'specs', '2026-09-30-audit-fixture.md'), '# Supplemental PRD\n\n## Functional Requirements\n- FR-1: The supplemental source obligation.\n');

    const result = await buildPrdAuditProjection(root);

    if (!result.ok) throw new Error(`projection failed: ${result.fault.dimension}`);
    expect(result.projection.criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'Salpha.1.1', requirementAssociations: [{ path: '.docs/specs/audit-fixture.md', requirementId: 'FR-1' }] }),
      expect.objectContaining({ id: 'Salpha.1.2', requirementAssociations: [{ path: '.docs/specs/audit-fixture.md', requirementId: 'FR-1' }] }),
    ]));
  });

  it('independently resolves populated feature obligations, scoped changes, and attributable history', async () => {
    const result = await buildPrdAuditProjection(await fixture());

    if (!result.ok) throw new Error(`projection failed: ${result.fault.dimension}`);
    expect(result.projection.criteria).toEqual([
      {
        id: 'Salpha.1.1',
        storyId: 'alpha.1',
        kind: 'happy',
        text: 'Given the feature is audited, when its source meets the documented behavior, then the audit can pass.',
        requirementAssociations: [],
      },
      {
        id: 'Salpha.1.2',
        storyId: 'alpha.1',
        kind: 'negative',
        text: 'Given the feature omits the documented behavior, when its source is audited, then the audit reports the gap.',
        requirementAssociations: [],
      },
      {
        id: 'Sbeta.2.1',
        storyId: 'beta.2',
        kind: 'happy',
        text: 'Given the audit receives documented evidence, when the negative obligation is satisfied, then the audit retains its attribution.',
        requirementAssociations: [],
      },
      {
        id: 'Sbeta.2.2',
        storyId: 'beta.2',
        kind: 'negative',
        text: 'Given the negative obligation is omitted, when the audit evaluates the feature, then the audit reports the attributable gap.',
        requirementAssociations: [],
      },
    ]);
    expect(result.projection.tasks).toEqual([
      {
        id: 'task-a',
        storyIds: ['alpha.1'],
        doneWhen: ['The published behavior preserves the documented outcome.'],
      },
      {
        id: 'task-b',
        storyIds: ['beta.2'],
        doneWhen: [
          'The published behavior reports the documented gap.',
          'The report remains attributable to Story beta.2.',
        ],
      },
    ]);

    expect(result).toMatchObject({
      ok: true,
      projection: {
        version: PRD_AUDIT_PROJECTION_VERSION,
        plan: { intent: 'Audit the feature requirements against the delivered source.' },
        criteria: [
          { id: 'Salpha.1.1', storyId: 'alpha.1', kind: 'happy' },
          { id: 'Salpha.1.2', storyId: 'alpha.1', kind: 'negative' },
          { id: 'Sbeta.2.1', storyId: 'beta.2', kind: 'happy' },
          { id: 'Sbeta.2.2', storyId: 'beta.2', kind: 'negative' },
        ],
        tasks: [{
          id: 'task-a',
          storyIds: ['alpha.1'],
          doneWhen: ['The published behavior preserves the documented outcome.'],
        }, {
          id: 'task-b',
          storyIds: ['beta.2'],
          doneWhen: [
            'The published behavior reports the documented gap.',
            'The report remains attributable to Story beta.2.',
          ],
        }],
        prd: { sources: [
          {
            path: '.docs/specs/2026-09-30-audit-fixture.md',
            requirements: [{ id: 'FR-8', text: 'The audit retains every applicable PRD source.' }],
          },
          {
            path: '.docs/specs/audit-fixture.md',
            requirements: [
              { id: 'FR-7', text: 'The audit preserves the documented outcome.' },
              { id: 'FR-9', text: 'The audit retains bolded requirement syntax.' },
            ],
          },
        ] },
        coherence: [
          { rowClass: 'fr', id: 'FR-7', citedIds: ['story-alpha.1'] },
          { rowClass: 'story', id: 'story-alpha.1', citedIds: ['task-a'] },
        ],
        changes: expect.objectContaining({
          changedFiles: expect.arrayContaining([expect.objectContaining({ path: 'src.ts' })]),
        }),
        history: expect.objectContaining({
          decisions: [expect.objectContaining({
            criterion: 'NC.1', authority: 'accept', operator: 'operator@example.test',
            originalSource: expect.objectContaining({ id: 'prd-audit:NC.1' }),
          })],
        }),
      },
    });
  });

  it('keeps technical-work obligations while representing absent optional sources explicitly', async () => {
    const root = await fixture();
    await Promise.all([
      rm(join(root, '.docs', 'specs', 'audit-fixture.md')),
      rm(join(root, '.docs', 'specs', '2026-09-30-audit-fixture.md')),
      rm(join(root, '.pipeline', 'accepted-widenings.json')),
      rm(join(root, '.docs', 'coherence', 'audit-fixture.md')),
    ]);

    const result = await buildPrdAuditProjection(root);

    expect(result).toMatchObject({
      ok: true,
      projection: {
        version: PRD_AUDIT_PROJECTION_VERSION,
        criteria: [
          { id: 'Salpha.1.1', kind: 'happy' },
          { id: 'Salpha.1.2', kind: 'negative' },
          { id: 'Sbeta.2.1', kind: 'happy' },
          { id: 'Sbeta.2.2', kind: 'negative' },
        ],
        tasks: [{
          id: 'task-a',
          storyIds: ['alpha.1'],
          doneWhen: ['The published behavior preserves the documented outcome.'],
        }, {
          id: 'task-b',
          storyIds: ['beta.2'],
          doneWhen: [
            'The published behavior reports the documented gap.',
            'The report remains attributable to Story beta.2.',
          ],
        }],
        prd: { kind: 'absent' },
        coherence: { kind: 'absent' },
        history: { kind: 'absent' },
      },
    });
  });

  it('bounds changed-file excerpts while retaining complete structured obligations', async () => {
    const root = await fixture();
    const git = async (...args: string[]) => execFileAsync('git', ['-C', root, ...args]);
    const atLimitPath = join(root, 'b-at-limit.ts');
    await writeFile(atLimitPath, 'x');
    await git('add', 'b-at-limit.ts');
    const provisional = (await git('diff', '--cached', '--', 'b-at-limit.ts')).stdout;
    const diffOverhead = Buffer.byteLength(provisional, 'utf-8') - 1;
    let atLimitContent = 'x'.repeat((256 * 1024) - diffOverhead);
    await writeFile(atLimitPath, atLimitContent);
    await git('add', 'b-at-limit.ts');
    const actualBytes = Buffer.byteLength((await git('diff', '--cached', '--', 'b-at-limit.ts')).stdout, 'utf-8');
    if (actualBytes !== 256 * 1024) {
      atLimitContent = atLimitContent.slice(0, atLimitContent.length - (actualBytes - (256 * 1024)));
      await writeFile(atLimitPath, atLimitContent);
      await git('add', 'b-at-limit.ts');
    }
    await git('add', 'b-at-limit.ts');
    await git('commit', '-m', 'at limit diff fixture');
    const atLimit = await buildPrdAuditProjection(root);

    await Promise.all([
      writeFile(join(root, 'a-per-file.ts'), 'x'.repeat(256 * 1024)),
      writeFile(join(root, 'c-total-one.ts'), 'x'.repeat(128 * 1024)),
      writeFile(join(root, 'c-total-two.ts'), 'x'.repeat(128 * 1024)),
      writeFile(join(root, 'c-total-three.ts'), 'x'.repeat(128 * 1024)),
      writeFile(join(root, 'é-per-file.ts'), 'x'.repeat(256 * 1024)),
    ]);
    await git('add', '.');
    await git('commit', '-m', 'bounded diff fixture');

    const overflow = await buildPrdAuditProjection(root);

    expect({ atLimit, overflow }).toMatchObject({
      atLimit: {
        ok: true,
        projection: { changes: { excerpts: expect.arrayContaining([expect.stringContaining('b-at-limit.ts')]) } },
      },
      overflow: {
        ok: true,
        projection: {
        criteria: [
          { id: 'Salpha.1.1', text: 'Given the feature is audited, when its source meets the documented behavior, then the audit can pass.' },
          { id: 'Salpha.1.2', text: 'Given the feature omits the documented behavior, when its source is audited, then the audit reports the gap.' },
          { id: 'Sbeta.2.1', text: 'Given the audit receives documented evidence, when the negative obligation is satisfied, then the audit retains its attribution.' },
          { id: 'Sbeta.2.2', text: 'Given the negative obligation is omitted, when the audit evaluates the feature, then the audit reports the attributable gap.' },
        ],
        tasks: [{
          id: 'task-a',
          doneWhen: ['The published behavior preserves the documented outcome.'],
        }, {
          id: 'task-b',
          doneWhen: [
            'The published behavior reports the documented gap.',
            'The report remains attributable to Story beta.2.',
          ],
        }],
        prd: { sources: expect.arrayContaining([
          expect.objectContaining({
            path: '.docs/specs/audit-fixture.md',
            requirements: expect.arrayContaining([
              { id: 'FR-7', text: 'The audit preserves the documented outcome.' },
              { id: 'FR-9', text: 'The audit retains bolded requirement syntax.' },
            ]),
            intent: {
              goals: { kind: 'present', text: '- Preserve the documented outcome.' },
              nonGoals: { kind: 'present', text: '- Do not broaden unrelated behavior.' },
              inScope: { kind: 'present', text: '- Bounded evidence for the active audit.' },
              outOfScope: { kind: 'present', text: '- Replacing the reviewer contract.' },
            },
          }),
          expect.objectContaining({
            path: '.docs/specs/2026-09-30-audit-fixture.md',
            intent: {
              goals: { kind: 'absent' }, nonGoals: { kind: 'absent' },
              inScope: { kind: 'absent' }, outOfScope: { kind: 'absent' },
            },
          }),
        ]) },
        changes: {
          omittedFiles: expect.arrayContaining([
            expect.objectContaining({
              path: 'a-per-file.ts',
              digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
              locator: expect.objectContaining({ kind: 'git-diff', path: 'a-per-file.ts' }),
            }),
            expect.objectContaining({
              path: 'c-total-three.ts',
              digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
              locator: expect.objectContaining({ kind: 'git-diff', path: 'c-total-three.ts' }),
            }),
            expect.objectContaining({
              path: 'é-per-file.ts',
              digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
              locator: expect.objectContaining({ kind: 'git-diff', path: 'é-per-file.ts' }),
            }),
          ]),
        },
      },
      },
    });
  });

  it('refuses every over-limit structured corpus dimension and the total envelope without a shortened projection', async () => {
    const root = await fixture();
    const cases: readonly { readonly limits: Partial<PrdAuditProjectionLimits>; readonly dimension: string }[] = [
      { limits: { planIntentBytes: 1 }, dimension: 'plan-intent' },
      { limits: { planTasksBytes: 1 }, dimension: 'plan-tasks' },
      { limits: { criteriaBytes: 1 }, dimension: 'criteria' },
      { limits: { prdIntentBytes: 1 }, dimension: 'prd-intent' },
      { limits: { coherenceBytes: 1 }, dimension: 'coherence' },
      { limits: { historyBytes: 1 }, dimension: 'history' },
      { limits: { totalBytes: 1 }, dimension: 'total' },
    ];

    for (const { limits, dimension } of cases) {
      const result = await buildPrdAuditProjection(root, undefined, limits);

      expect(result).toMatchObject({
        ok: false,
        fault: { dimension, actual: expect.any(Number), limit: 1 },
      });
      if (result.ok) throw new Error('expected an over-limit projection fault');
      const fault = result.fault as { readonly actual: number; readonly limit: number };
      expect(fault.actual).toBeGreaterThan(fault.limit);
      expect(result).not.toHaveProperty('projection');
    }
  });

  it('ships finite corpus-based limits that admit every normal input and its total envelope', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const limits = prdAuditProjection.PRD_AUDIT_PROJECTION_LIMITS;
    const maxima = prdAuditProjection.PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES;
    const historyFloor = prdAuditProjection.PRD_AUDIT_PROJECTION_MIN_HISTORY_BYTES;
    const overhead = prdAuditProjection.PRD_AUDIT_PROJECTION_ENVELOPE_OVERHEAD_BYTES;
    const [largestPlanIntent, largestPlan, largestStories, largestPrd, largestCoherence] = await Promise.all([
      largestPlanIntentBytes(join(repositoryRoot, '.docs', 'plans')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'plans')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'stories')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'specs')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'coherence')),
    ]);

    expect(limits).toEqual({
      planIntentBytes: expect.any(Number),
      planTasksBytes: expect.any(Number),
      criteriaBytes: expect.any(Number),
      prdIntentBytes: expect.any(Number),
      coherenceBytes: expect.any(Number),
      historyBytes: expect.any(Number),
      totalBytes: expect.any(Number),
    });
    expect(maxima).toEqual({
      planIntentBytes: largestPlanIntent,
      planTasksBytes: largestPlan,
      criteriaBytes: largestStories,
      prdIntentBytes: largestPrd,
      coherenceBytes: largestCoherence,
      historyBytes: 0,
    });
    expect(Object.values({ ...limits, overhead, historyFloor }).every((limit) => Number.isFinite(limit) && limit > 0)).toBe(true);
    expect(limits.planIntentBytes).toBe(roundUpPowerOfTwo(Math.max(256 * 1024, maxima.planIntentBytes)));
    expect(limits.planTasksBytes).toBe(roundUpPowerOfTwo(Math.max(256 * 1024, maxima.planTasksBytes)));
    expect(limits.criteriaBytes).toBe(roundUpPowerOfTwo(Math.max(256 * 1024, maxima.criteriaBytes)));
    expect(limits.prdIntentBytes).toBe(roundUpPowerOfTwo(maxima.prdIntentBytes));
    expect(limits.coherenceBytes).toBe(roundUpPowerOfTwo(maxima.coherenceBytes));
    expect(limits.historyBytes).toBe(roundUpPowerOfTwo(Math.max(historyFloor, maxima.historyBytes)));
    expect(limits.totalBytes).toBe(roundUpPowerOfTwo(
      limits.planIntentBytes + limits.planTasksBytes + limits.criteriaBytes + limits.prdIntentBytes +
      limits.coherenceBytes + limits.historyBytes + (512 * 1024) + overhead,
    ));
  });

  it('rejects a valid foreign widening history without rewriting its recovery source', async () => {
    const root = await fixture();
    const historyPath = join(root, '.pipeline', 'accepted-widenings.json');
    const foreignHistory = JSON.stringify({
      version: 2,
      feature: { version: 1, repository: 'fixture-repository', feature: 'foreign-fixture' },
      decisions: [],
    });
    await writeFile(historyPath, foreignHistory);

    const result = await buildPrdAuditProjection(root);

    expect({ result, bytes: await readFile(historyPath, 'utf-8') }).toEqual({
      result: {
        ok: false,
        fault: { dimension: 'history', detail: 'widening history at .pipeline/accepted-widenings.json is foreign to the active feature' },
      },
      bytes: foreignHistory,
    });
  });

  it('keeps case-only widening history and rejects a foreign case-store feature without rewriting it', async () => {
    const root = await fixture();
    await rm(join(root, '.pipeline', 'accepted-widenings.json'));
    const casePath = join(root, '.pipeline', 'remediation-cases.json');
    const caseHistory = {
      version: 'v2',
      feature: { version: 'v1', repository: 'fixture-repository', feature: 'audit-fixture' },
      cases: [], suppressions: [],
      prdWideningCases: [{
        id: 'prd-case-1', domain: 'prd_widening',
        originalSources: [{ sourceId: 'NC-1', snapshot: 'Original widening.' }],
        currentSources: [{ sourceId: 'NC-1', snapshot: 'Current widening.', recordedAt: '2026-09-09T12:00:00.000Z' }],
        relationships: [{ currentSourceId: 'NC-1', kind: 'same-case', caseId: 'prd-case-1', reason: 'Same behavior.' }],
      }],
    };
    await writeFile(casePath, JSON.stringify(caseHistory));
    await expect(buildPrdAuditProjection(root)).resolves.toMatchObject({
      ok: true,
      projection: { history: { decisions: [], cases: [expect.objectContaining({ id: 'prd-case-1' })] } },
    });

    const foreignCaseHistory = JSON.stringify({
      ...caseHistory,
      feature: { ...caseHistory.feature, feature: 'foreign-fixture' },
    });
    await writeFile(casePath, foreignCaseHistory);

    expect({
      result: await buildPrdAuditProjection(root),
      bytes: await readFile(casePath, 'utf-8'),
    }).toEqual({
      result: {
        ok: false,
        fault: { dimension: 'history', detail: 'widening case history at .pipeline/remediation-cases.json is foreign to the active feature' },
      },
      bytes: foreignCaseHistory,
    });
  });

  it('rejects corrupt and unsupported case-only history without rewriting its recovery source', async () => {
    const root = await fixture();
    await rm(join(root, '.pipeline', 'accepted-widenings.json'));
    const casePath = join(root, '.pipeline', 'remediation-cases.json');
    const histories = [
      {
        bytes: '{not json',
        detail: 'widening case history at .pipeline/remediation-cases.json is corrupt',
      },
      {
        bytes: JSON.stringify({ version: 'v3' }),
        detail: 'widening case history at .pipeline/remediation-cases.json has an unsupported version',
      },
    ] as const;

    for (const history of histories) {
      await writeFile(casePath, history.bytes);
      expect({
        result: await buildPrdAuditProjection(root),
        bytes: await readFile(casePath, 'utf-8'),
      }).toEqual({
        result: {
          ok: false,
          fault: { dimension: 'history', detail: history.detail },
        },
        bytes: history.bytes,
      });
    }
  });

  it('rejects corrupt, foreign, and unsupported present widening history without rewriting its recovery source', async () => {
    const root = await fixture();
    const historyPath = join(root, '.pipeline', 'accepted-widenings.json');
    const histories = [
      {
        bytes: '{not json',
        detail: 'widening history at .pipeline/accepted-widenings.json is corrupt',
      },
      {
        bytes: JSON.stringify({
          version: 2,
          feature: { version: 1, repository: 'fixture-repository', feature: 'foreign-fixture' },
          decisions: [],
        }),
        detail: 'widening history at .pipeline/accepted-widenings.json is foreign to the active feature',
      },
      {
        bytes: JSON.stringify({
          version: 3,
          feature: { version: 1, repository: 'fixture-repository', feature: 'audit-fixture' },
          decisions: [],
        }),
        detail: 'widening history at .pipeline/accepted-widenings.json has an unsupported version',
      },
    ] as const;

    for (const history of histories) {
      await writeFile(historyPath, history.bytes);
      const result = await buildPrdAuditProjection(root);

      expect({ result, bytes: await readFile(historyPath, 'utf-8') }).toEqual({
        result: {
          ok: false,
          fault: { dimension: 'history', detail: history.detail },
        },
        bytes: history.bytes,
      });
    }
  });

  it('rejects a missing coherence-required PRD without substituting a foreign source', async () => {
    const root = await fixture();
    const foreignPrdPath = join(root, '.docs', 'specs', 'foreign-fixture.md');
    const foreignPrd = '# PRD\n\n## Functional Requirements\n- FR-1: Foreign requirement.\n';
    await Promise.all([
      rm(join(root, '.docs', 'specs', 'audit-fixture.md')),
      rm(join(root, '.docs', 'specs', '2026-09-30-audit-fixture.md')),
      writeFile(foreignPrdPath, foreignPrd),
    ]);

    const result = await buildPrdAuditProjection(root);

    expect({ result, bytes: await readFile(foreignPrdPath, 'utf-8') }).toEqual({
      result: {
        ok: false,
        fault: { dimension: 'prd', detail: 'active PRD required by coherence is unavailable' },
      },
      bytes: foreignPrd,
    });
  });

  it('rejects a missing active plan without substituting a valid foreign plan', async () => {
    const root = await fixture();
    const activePlanPath = join(root, '.docs', 'plans', 'audit-fixture.md');
    const foreignPlanPath = join(root, '.docs', 'plans', 'foreign-fixture.md');
    const foreignPlan = '# Implementation Plan: Foreign fixture\n\n## Technical Approach\n\nForeign intent.\n';
    await Promise.all([rm(activePlanPath), writeFile(foreignPlanPath, foreignPlan)]);

    const result = await buildPrdAuditProjection(root);

    expect({ result, bytes: await readFile(foreignPlanPath, 'utf-8') }).toEqual({
      result: {
        ok: false,
        fault: { dimension: 'plan', detail: 'active plan is unreadable' },
      },
      bytes: foreignPlan,
    });
  });

  it('rejects missing sealed stories without substituting a valid foreign story source', async () => {
    const root = await fixture();
    const activeStoriesPath = join(root, '.docs', 'stories', 'audit-fixture.md');
    const foreignStoriesPath = join(root, '.docs', 'stories', 'foreign-fixture.md');
    const foreignStories = '# Stories\n\n## Story foreign.1: Foreign obligation\n\n### Happy Path\n- Given foreign input, when reviewed, then it passes.\n';
    await Promise.all([rm(activeStoriesPath), writeFile(foreignStoriesPath, foreignStories)]);

    const result = await buildPrdAuditProjection(root);

    expect({ result, bytes: await readFile(foreignStoriesPath, 'utf-8') }).toEqual({
      result: {
        ok: false,
        fault: {
          source: '.docs/stories/audit-fixture.md',
          dimension: 'stories',
          detail: 'sealed stories are unreadable',
        },
      },
      bytes: foreignStories,
    });
  });
});
