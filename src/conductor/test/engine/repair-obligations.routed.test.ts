// Covers: task:68
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRepairObligationStore } from '../../src/engine/repair-obligations.js';
import { admitAndRestageRepair, admitRoutedObligation } from '../../src/engine/repair-restage.js';

const temporaryDirectories: string[] = [];

async function createProject(): Promise<{ projectRoot: string; planPath: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'repair-obligations-routed-'));
  temporaryDirectories.push(projectRoot);
  const planPath = join(projectRoot, '.docs/plans/active.md');
  await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(planPath, '# Plan\n\n### Task T1: Routed repair\n');
  return { projectRoot, planPath };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('routed repair obligations', () => {
  it('uses the same round-keyed admission when HEAD or plan path changes', async () => {
    const { projectRoot, planPath } = await createProject();

    const first = await admitRoutedObligation({
      projectRoot,
      planPath,
      roundId: 'r1',
      findingId: 'finding-1',
      taskIds: ['T1'],
      branch: 'feat/c1/demo',
      head: 'first-head',
      tree: 'first-tree',
    });
    const changed = await admitRoutedObligation({
      projectRoot,
      planPath: join(projectRoot, '.docs/plans/rewritten.md'),
      roundId: 'r1',
      findingId: 'finding-1',
      taskIds: ['T1'],
      branch: 'feat/c1/demo',
      head: 'later-head',
      tree: 'later-tree',
    });

    expect(first).toMatchObject({ kind: 'admitted', replayed: false });
    expect(changed).toMatchObject({ kind: 'admitted', replayed: true });
    if (first.kind !== 'admitted' || changed.kind !== 'admitted') throw new Error('expected admissions');
    expect(changed.admissionKey).toBe(first.admissionKey);
  });

  it('reuses one obligation after a crash between admission and restage', async () => {
    const { projectRoot, planPath } = await createProject();
    const input = {
      projectRoot,
      planPath,
      roundId: 'r1',
      findingId: 'finding-1',
      taskIds: ['T1'],
      branch: 'feat/c1/demo',
      head: 'host-head',
      tree: 'host-tree',
    };

    const admittedBeforeCrash = await admitRoutedObligation(input);
    const resumed = await admitRoutedObligation(input);

    expect(admittedBeforeCrash).toMatchObject({ kind: 'admitted', replayed: false });
    expect(resumed).toMatchObject({ kind: 'admitted', replayed: true });
    const state = JSON.parse(await readFile(join(projectRoot, '.pipeline/engine-state.json'), 'utf8')) as {
      repairObligations: { records: Record<string, unknown> };
    };
    expect(Object.keys(state.repairObligations.records)).toHaveLength(1);
  });

  it('leaves N=1 obligations branchless', async () => {
    const { projectRoot, planPath } = await createProject();
    await writeFile(join(projectRoot, '.pipeline/task-status.json'), JSON.stringify({
      tasks: [{ id: 'T1', status: 'completed' }],
    }));

    await expect(admitAndRestageRepair({
      projectRoot,
      planPath,
      taskIds: ['T1'],
      findingIds: ['finding-1'],
      sourceAuthority: 'prd_audit',
      instruction: 'Repair the finding.',
      gates: ['prd_audit'],
    })).resolves.toMatchObject({ kind: 'restaged' });

    const state = JSON.parse(await readFile(join(projectRoot, '.pipeline/engine-state.json'), 'utf8')) as {
      repairObligations: { records: Record<string, { baseline: Record<string, unknown> }> };
    };
    expect(Object.values(state.repairObligations.records)[0]?.baseline).not.toHaveProperty('branch');
  });

  it('rejects a persisted routed obligation with an invalid branch', async () => {
    const { projectRoot } = await createProject();
    const statePath = join(projectRoot, '.pipeline/engine-state.json');
    await writeFile(statePath, JSON.stringify({
      repairObligations: {
        version: 1,
        records: {
          routed: {
            id: 'routed',
            planIdentity: '.docs/plans/active.md',
            taskIds: ['T1'],
            source: { findingId: 'finding-1', authority: 'routed_repair', instruction: 'Repair the finding.' },
            baseline: { branch: 'feat/../x', head: 'host-head', tree: 'host-tree', resolvedTaskIds: [] },
            settlement: 'unsettled',
            tasks: { T1: { status: 'open' } },
          },
        },
        currentByPlan: { '.docs/plans/active.md': { T1: 'routed' } },
        admissionsByPlan: {},
      },
    }));

    await expect(createRepairObligationStore(projectRoot, statePath).read()).resolves.toMatchObject({
      ok: false,
      kind: 'incompatible',
    });
  });
});
