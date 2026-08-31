// Covers: task:9
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendBuildReviewWorkOrderContext,
  classifyBuildReviewDurableRead,
  publishBuildReviewWorkOrder,
  readBuildReviewWorkOrder,
  readBuildReviewWorkOrderAttemptedCaseIds,
  markBuildReviewWorkOrderAttempted,
  type BuildReviewWorkOrder,
  type BuildReviewWorkOrderFilesystem,
} from '../../src/engine/build-review-work-order.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'work-order' } as const;
const EFFECT_ID = 'effect-build-1';
const WORK_ORDER = {
  version: 'v1',
  domain: 'build_review',
  feature: FEATURE,
  effectId: EFFECT_ID,
  cases: [
    {
      caseId: 'case-critical',
      priority: 'critical',
      tasks: [
        { title: 'src/widget.ts:20 — exercise the changed branch' },
        { title: 'test/widget.test.ts:41 — prove the rejection path' },
      ],
    },
    {
      caseId: 'case-high',
      priority: 'high',
      tasks: [{ title: 'src/worker.ts:8 — cover the retry boundary' }],
    },
  ],
} as const satisfies BuildReviewWorkOrder;

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-work-order-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('build-review work order', () => {
  it('persists ordered multi-case work and a later process reads it by the stable effect id', async () => {
    const projectRoot = await createProjectRoot();

    await expect(publishBuildReviewWorkOrder(projectRoot, WORK_ORDER)).resolves.toEqual({
      ok: true,
      workOrder: WORK_ORDER,
    });
    await expect(readBuildReviewWorkOrder(projectRoot, FEATURE, EFFECT_ID)).resolves.toEqual({
      ok: true,
      workOrder: WORK_ORDER,
    });
  });

  it('adds ordered file-scoped work to BUILD retry context without replacing existing context', () => {
    expect(appendBuildReviewWorkOrderContext('Existing retry context.', WORK_ORDER)).toBe([
      'Existing retry context.',
      '',
      `Build-review remediation work order (effect: ${EFFECT_ID}):`,
      '1. [critical] case-critical',
      '   1. src/widget.ts:20 — exercise the changed branch',
      '   2. test/widget.test.ts:41 — prove the rejection path',
      '2. [high] case-high',
      '   1. src/worker.ts:8 — cover the retry boundary',
    ].join('\n'));
  });

  it.each([
    ['unsupported version', { ...WORK_ORDER, version: 'v2' }, 'unknown-version'],
    ['foreign domain', { ...WORK_ORDER, domain: 'prd_audit' }, 'foreign-domain'],
    ['missing stable effect id', { ...WORK_ORDER, effectId: '' }, 'malformed-order'],
    ['taskless case', { ...WORK_ORDER, cases: [{ ...WORK_ORDER.cases[0], tasks: [] }] }, 'malformed-order'],
  ] as const)('refuses to publish %s', async (_description, workOrder, reason) => {
    const projectRoot = await createProjectRoot();

    await expect(publishBuildReviewWorkOrder(projectRoot, workOrder)).resolves.toEqual({ ok: false, reason });
  });

  it.each([
    ['malformed JSON', '{not json', 'malformed-json'],
    ['foreign feature', JSON.stringify({ ...WORK_ORDER, feature: { ...FEATURE, feature: 'other' } }), 'foreign-feature'],
    ['foreign effect', JSON.stringify({ ...WORK_ORDER, effectId: 'effect-other' }), 'foreign-effect'],
    ['partial order', JSON.stringify({ ...WORK_ORDER, cases: [{ ...WORK_ORDER.cases[0], tasks: [] }] }), 'malformed-order'],
  ] as const)('never turns a %s into BUILD prompt text', async (_description, contents, reason) => {
    const projectRoot = await createProjectRoot();
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.pipeline/build-review-work-order.json'), contents, 'utf8');

    await expect(readBuildReviewWorkOrder(projectRoot, FEATURE, EFFECT_ID)).resolves.toEqual({ ok: false, reason });
  });

  it('keeps the last complete work order when atomic replacement fails', async () => {
    const projectRoot = await createProjectRoot();
    const path = join(projectRoot, '.pipeline/build-review-work-order.json');
    const original = `${JSON.stringify({ ...WORK_ORDER, cases: [WORK_ORDER.cases[0]] })}\n`;
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(path, original, 'utf8');
    const filesystem: BuildReviewWorkOrderFilesystem = {
      readFile: (file) => readFile(file, 'utf8'),
      mkdir: async (directory) => { await mkdir(directory, { recursive: true }); },
      writeFile: async (file, contents) => { await writeFile(file, contents, 'utf8'); },
      rename: async () => { throw new Error('rename failed'); },
      rm: async (file) => { await rm(file, { force: true }); },
    };

    await expect(publishBuildReviewWorkOrder(projectRoot, WORK_ORDER, filesystem)).resolves.toEqual({
      ok: false,
      reason: 'atomic-replace-failed',
    });
    await expect(readFile(path, 'utf8')).resolves.toBe(original);
  });

  it('does not write the active plan, task status, or plan-growth ledger', async () => {
    const projectRoot = await createProjectRoot();
    const activePlan = join(projectRoot, '.docs/plans/active.md');
    const taskStatus = join(projectRoot, '.pipeline/task-status.json');
    const growth = join(projectRoot, '.pipeline/kickback-ledger.json');
    await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await Promise.all([
      writeFile(activePlan, 'approved plan\n', 'utf8'),
      writeFile(taskStatus, '{"tasks":[]}\n', 'utf8'),
      writeFile(growth, '{"version":1,"gates":{}}\n', 'utf8'),
    ]);

    await expect(publishBuildReviewWorkOrder(projectRoot, WORK_ORDER)).resolves.toMatchObject({ ok: true });
    await expect(readBuildReviewWorkOrder(projectRoot, FEATURE, EFFECT_ID)).resolves.toMatchObject({ ok: true });
    await expect(Promise.all([readFile(activePlan, 'utf8'), readFile(taskStatus, 'utf8'), readFile(growth, 'utf8')]))
      .resolves.toEqual(['approved plan\n', '{"tasks":[]}\n', '{"version":1,"gates":{}}\n']);
  });
  it('records durable BUILD attempt evidence for every case in the published order', async () => {
    const projectRoot = await createProjectRoot();
    await publishBuildReviewWorkOrder(projectRoot, WORK_ORDER);

    await expect(readBuildReviewWorkOrderAttemptedCaseIds(projectRoot, FEATURE)).resolves.toEqual({ ok: true, attemptedCaseIds: [] });
    await expect(markBuildReviewWorkOrderAttempted(projectRoot, FEATURE)).resolves.toMatchObject({ ok: true });
    // A later process — not the one that stamped it — reads the same evidence.
    await expect(readBuildReviewWorkOrderAttemptedCaseIds(projectRoot, FEATURE)).resolves.toEqual({ ok: true, attemptedCaseIds: ['case-critical', 'case-high'] });
    // Stamping twice is idempotent and preserves the stable effect identity.
    await expect(markBuildReviewWorkOrderAttempted(projectRoot, FEATURE)).resolves.toMatchObject({ ok: true });
    await expect(readBuildReviewWorkOrder(projectRoot, FEATURE, EFFECT_ID)).resolves.toMatchObject({
      ok: true, workOrder: { effectId: EFFECT_ID, attemptedCaseIds: ['case-critical', 'case-high'] },
    });
  });

  it('keeps absent attempt evidence distinct from invalid durable orders', async () => {
    const projectRoot = await createProjectRoot();
    const missing = await readBuildReviewWorkOrderAttemptedCaseIds(projectRoot, FEATURE);
    expect(missing).toEqual({ ok: false, reason: 'missing-work-order' });
    expect(classifyBuildReviewDurableRead(missing)).toBe('absent');
    await expect(markBuildReviewWorkOrderAttempted(projectRoot, FEATURE)).resolves.toEqual({ ok: false, reason: 'missing-work-order' });

    await publishBuildReviewWorkOrder(projectRoot, WORK_ORDER);
    const foreign = { ...FEATURE, feature: 'other-feature' } as const;
    const foreignAttempt = await readBuildReviewWorkOrderAttemptedCaseIds(projectRoot, foreign);
    expect(foreignAttempt).toEqual({ ok: false, reason: 'foreign-feature' });
    expect(classifyBuildReviewDurableRead(foreignAttempt)).toBe('invalid');
    await expect(markBuildReviewWorkOrderAttempted(projectRoot, foreign)).resolves.toEqual({ ok: false, reason: 'foreign-feature' });
  });
});
