// Covers: task:11
import { mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const readPaths = vi.hoisted(() => [] as string[]);

vi.mock('node:fs/promises', async (importOriginal) => {
  const filesystem = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...filesystem,
    readFile: async (...args: Parameters<typeof filesystem.readFile>) => {
      readPaths.push(String(args[0]));
      return filesystem.readFile(...args);
    },
  };
});

import {
  REMEDIATION_TYPED_PLAN_PATH,
  persistRemediationPlan,
  readTypedRemediationPlan,
  remediationRequiredReferenceDigest,
  type RemediationPlanStoreFilesystem,
} from '../../src/engine/remediation-plan-store.js';
import { readRemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';

const roots: string[] = [];

const requiredReferences = [{
  kind: 'prd-criterion' as const,
  id: 'S1.2',
  sourceGate: 'prd_audit' as const,
  ownerTaskId: '7',
  summary: 'The criterion remains unmet.',
}];

const dispositions = [{
  reference: requiredReferences[0],
  requiredReference: requiredReferences[0],
  disposition: 'build' as const,
  targetStep: 'build',
  category: null,
  rationale: 'Add the missing behavior.',
  tasks: [{ id: 'repair', title: 'Add the missing behavior.' }],
  boundTaskIds: [],
}];

afterEach(async () => {
  readPaths.splice(0);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-plan-store-'));
  roots.push(root);
  return root;
}

function input(attemptId = 'attempt-current') {
  return {
    attemptId,
    source: 'prd-audit' as const,
    requiredReferences,
    dispositions,
  };
}

function filesystemWithRenameSpy(renames: [string, string][]): RemediationPlanStoreFilesystem {
  return {
    mkdir: (path) => mkdir(path, { recursive: true }),
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
    rename: async (from, to) => {
      renames.push([from, to]);
      await rename(from, to);
    },
    rm: (path) => rm(path, { force: true }),
  };
}

describe('typed remediation plan store', () => {
  // Covers: task:11
  it('atomically persists a validated plan with its attempt, source, and required-reference digest', async () => {
    const root = await projectRoot();
    const renames: [string, string][] = [];

    await expect(persistRemediationPlan(root, input(), { filesystem: filesystemWithRenameSpy(renames) }))
      .resolves.toMatchObject({ kind: 'persisted' });

    const serialized = JSON.parse(await readFile(join(root, REMEDIATION_TYPED_PLAN_PATH), 'utf8'));
    expect(serialized).toMatchObject({
      version: 'v1',
      attemptId: 'attempt-current',
      source: 'prd-audit',
      requiredReferenceDigest: remediationRequiredReferenceDigest(requiredReferences),
      dispositions,
    });
    expect(renames).toEqual([[expect.stringMatching(/remediation-plan\.json\..+\.tmp$/), join(root, REMEDIATION_TYPED_PLAN_PATH)]]);
    await expect(readTypedRemediationPlan(root, { attemptId: 'attempt-current' })).resolves.toMatchObject({
      kind: 'present', value: { dispositions },
    });
  });

  // Covers: task:11, task:31
  it('treats a newer plan from a prior attempt as absent without consulting modification time', async () => {
    const root = await projectRoot();
    await persistRemediationPlan(root, input('attempt-prior'));
    const path = join(root, REMEDIATION_TYPED_PLAN_PATH);
    await utimes(path, new Date('2030-01-01T00:00:00.000Z'), new Date('2030-01-01T00:00:00.000Z'));

    await expect(readTypedRemediationPlan(root, { attemptId: 'attempt-current' })).resolves.toEqual({ kind: 'absent' });
  });

  // Covers: task:11
  it.each([
    ['a legacy prose plan', { dispositions: [{ id: 'legacy-plan' }] }],
    ['a case-v1 adjudication', { mode: 'case-v1', domain: 'build_review', sourceOutcomes: [], cases: [] }],
  ])('does not open the legacy remediation artifact when it holds %s', async (_label, artifact) => {
    const root = await projectRoot();
    const opened: string[] = [];
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify(artifact), 'utf8');
    const filesystem: RemediationPlanStoreFilesystem = {
      mkdir: (path) => mkdir(path, { recursive: true }),
      readFile: async (path) => {
        opened.push(path);
        return readFile(path, 'utf8');
      },
      writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
      rename: (from, to) => rename(from, to),
      rm: (path) => rm(path, { force: true }),
    };

    await expect(readTypedRemediationPlan(root, { attemptId: 'attempt-current' }, { filesystem })).resolves.toEqual({ kind: 'absent' });
    expect(opened).toEqual([join(root, REMEDIATION_TYPED_PLAN_PATH)]);
  });

  // Covers: task:11
  it('keeps the case reader isolated from the typed plan artifact', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
      mode: 'case-v1',
      domain: 'build_review',
      sourceOutcomes: [],
      cases: [],
    }), 'utf8');
    await writeFile(join(root, REMEDIATION_TYPED_PLAN_PATH), '{not a case artifact', 'utf8');

    readPaths.splice(0);
    await expect(readRemediationCaseJudgement(root, Date.now() - 60_000)).resolves.toMatchObject({
      ok: true,
      judgement: { mode: 'case-v1' },
    });
    expect(readPaths).toEqual([join(root, '.pipeline', 'remediation.json')]);
  });

  // Covers: task:11, task:31
  it('returns invalid for corrupt typed evidence rather than admitting its dispositions', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, REMEDIATION_TYPED_PLAN_PATH), '{not json', 'utf8');

    await expect(readTypedRemediationPlan(root, { attemptId: 'attempt-current' })).resolves.toMatchObject({
      kind: 'invalid', reason: expect.stringContaining('invalid typed remediation plan'),
    });
  });

  // Covers: task:11
  it('returns a named persistence fault when the injected atomic write fails and leaves no present plan', async () => {
    const root = await projectRoot();
    const filesystem: RemediationPlanStoreFilesystem = {
      mkdir: (path) => mkdir(path, { recursive: true }),
      readFile: (path) => readFile(path, 'utf8'),
      writeFile: async () => { throw new Error('disk full'); },
      rename: async () => { throw new Error('rename must not run'); },
      rm: (path) => rm(path, { force: true }),
    };

    await expect(persistRemediationPlan(root, input(), { filesystem })).resolves.toMatchObject({
      kind: 'persistence-fault', reason: expect.stringContaining('disk full'),
    });
    await expect(readTypedRemediationPlan(root, { attemptId: 'attempt-current' })).resolves.not.toMatchObject({ kind: 'present' });
  });
});
