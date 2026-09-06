// Covers: task:3
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRepairObligationStore,
  type RepairAdmission,
} from '../../src/engine/repair-obligations.js';

const temporaryDirectories: string[] = [];

async function createStatePath(): Promise<{ projectRoot: string; statePath: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'repair-obligations-'));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, '.pipeline'));
  return { projectRoot, statePath: join(projectRoot, '.pipeline', 'engine-state.json') };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function admission(overrides: Partial<RepairAdmission> = {}): RepairAdmission {
  return {
    id: 'round-1',
    planPath: '.docs/plans/current.md',
    taskIds: ['T2', '3'],
    source: {
      findingId: 'finding-1',
      authority: 'build_review',
      instruction: 'Repair the current evidence boundary.',
    },
    baseline: {
      head: 'abc123',
      tree: 'tree123',
      resolvedTaskIds: ['1'],
    },
    ...overrides,
  };
}

describe('repair obligations', () => {
  it('replays an admitted identity without replacing its immutable boundary or resolved task', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);

    const admitted = await repairs.admit(admission());
    expect(admitted).toMatchObject({ ok: true, replayed: false, obligation: { taskIds: ['2', '3'] } });
    if (!admitted.ok) return;

    await expect(repairs.close({
      planPath: '.docs/plans/current.md',
      taskId: 'T2',
      obligationId: admitted.obligation.id,
      evidence: { kind: 'task-done', value: 'evidence-1' },
    })).resolves.toMatchObject({ ok: true });

    await expect(repairs.admit(admission({
      taskIds: ['999'],
      source: { findingId: 'other', authority: 'other', instruction: 'must not replace' },
      baseline: { head: 'different', tree: 'different', resolvedTaskIds: [] },
    }))).resolves.toMatchObject({
      ok: true,
      replayed: true,
      obligation: {
        taskIds: ['2', '3'],
        baseline: { head: 'abc123', tree: 'tree123', resolvedTaskIds: ['1'] },
        tasks: { '2': { status: 'resolved' }, '3': { status: 'open' } },
      },
    });
  });

  it('isolates plan identities, retains prior rounds, and rejects a stale closure after a later repair', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);
    const first = await repairs.admit(admission());
    if (!first.ok) throw new Error(first.message);
    const later = await repairs.admit(admission({
      id: 'round-2',
      source: { findingId: 'finding-2', authority: 'build_review', instruction: 'Repair again.' },
    }));
    if (!later.ok) throw new Error(later.message);
    const otherPlan = await repairs.admit(admission({
      id: 'round-other-plan',
      planPath: join(projectRoot, '.docs/plans/other.md'),
      taskIds: ['T2'],
    }));
    if (!otherPlan.ok) throw new Error(otherPlan.message);

    await expect(repairs.close({
      planPath: '.docs/plans/current.md',
      taskId: '2',
      obligationId: first.obligation.id,
      evidence: { kind: 'task-done', value: 'stale' },
    })).resolves.toMatchObject({ ok: false, kind: 'stale' });
    await expect(repairs.close({
      planPath: '.docs/plans/current.md',
      taskId: 'T2',
      obligationId: later.obligation.id,
      evidence: { kind: 'task-done', value: 'fresh' },
    })).resolves.toMatchObject({ ok: true });

    await expect(readFile(statePath, 'utf8')).resolves.toSatisfy((raw) => {
      const state = JSON.parse(raw) as { repairObligations: { records: Record<string, unknown> } };
      expect(Object.keys(state.repairObligations.records)).toEqual(['round-1', 'round-2', 'round-other-plan']);
      return true;
    });
  });
});
