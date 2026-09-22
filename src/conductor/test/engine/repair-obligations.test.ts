// Covers: task:3
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRepairObligationStore,
  type RepairAdmission,
} from '../../src/engine/repair-obligations.js';
import type { EngineState, EngineStateStore } from '../../src/engine/engine-state-store.js';

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
  it('settles only the current obligation and keeps a replay settled', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);
    const first = await repairs.admitOrReplay('key-round-1', admission());
    if (!first.ok) throw new Error(first.message);
    const later = await repairs.admitOrReplay('key-round-2', admission({ id: 'round-2' }));
    if (!later.ok) throw new Error(later.message);

    await expect(repairs.markSettled({
      planPath: '.docs/plans/current.md',
      obligationId: first.obligation.id,
    })).resolves.toMatchObject({ ok: false, kind: 'stale' });
    await expect(repairs.markSettled({
      planPath: '.docs/plans/current.md',
      obligationId: later.obligation.id,
    })).resolves.toMatchObject({ ok: true, obligation: { settlement: 'settled' } });
    await expect(repairs.admitOrReplay('key-round-2', admission({ id: 'round-2' }))).resolves.toMatchObject({
      ok: true,
      replayed: true,
      obligation: { settlement: 'settled' },
    });
  });

  it('atomically replays a caller-authoritative admission key without suppressing a later key', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);

    const first = await repairs.admitOrReplay('architecture_review_as_built:ARCH-1:round-1', admission());
    const replay = await repairs.admitOrReplay('architecture_review_as_built:ARCH-1:round-1', admission({
      id: 'ignored-on-replay',
      baseline: { head: 'new', tree: 'new', resolvedTaskIds: [] },
    }));
    const later = await repairs.admitOrReplay('architecture_review_as_built:ARCH-1:round-2', admission({ id: 'round-2' }));

    expect({ first, replay, later }).toMatchObject({
      first: { ok: true, replayed: false, obligation: { id: 'round-1' } },
      replay: { ok: true, replayed: true, obligation: { id: 'round-1', baseline: { head: 'abc123' } } },
      later: { ok: true, replayed: false, obligation: { id: 'round-2' } },
    });
  });

  it('replays an admitted identity without replacing its immutable boundary or resolved task', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);

    const admitted = await repairs.admitOrReplay('key-round-1', admission());
    expect(admitted).toMatchObject({ ok: true, replayed: false, obligation: { taskIds: ['2', '3'] } });
    if (!admitted.ok) return;

    await expect(repairs.close({
      planPath: '.docs/plans/current.md',
      taskId: 'T2',
      obligationId: admitted.obligation.id,
      evidence: { kind: 'task-done', value: 'evidence-1' },
    })).resolves.toMatchObject({ ok: true });

    await expect(repairs.admitOrReplay('key-round-1', admission({
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
    const first = await repairs.admitOrReplay('key-round-1', admission());
    if (!first.ok) throw new Error(first.message);
    const later = await repairs.admitOrReplay('key-round-2', admission({
      id: 'round-2',
      source: { findingId: 'finding-2', authority: 'build_review', instruction: 'Repair again.' },
    }));
    if (!later.ok) throw new Error(later.message);
    const otherPlan = await repairs.admitOrReplay('key-other-plan', admission({
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

  it('rewrites only named baseline heads and preserves every other engine-state byte', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);
    const first = await repairs.admitOrReplay('key-round-1', admission({
      baseline: { head: 'old-head', tree: 'tree-1', resolvedTaskIds: ['1'], resolvedCount: 1 },
    }));
    const second = await repairs.admitOrReplay('key-round-2', admission({
      id: 'round-2',
      taskIds: ['4'],
      baseline: { head: 'other-head', tree: 'tree-2', resolvedTaskIds: ['2'], resolvedCount: 1 },
    }));
    if (!first.ok || !second.ok) throw new Error('expected seeded obligations');
    await repairs.close({
      planPath: '.docs/plans/current.md',
      taskId: '4',
      obligationId: second.obligation.id,
      evidence: { kind: 'task-done', value: 'evidence-2' },
    });

    const beforeText = await readFile(statePath, 'utf8');
    const before = JSON.parse(beforeText);
    await expect(repairs.rewriteBaselines(new Map([['round-1', 'new-head']]))).resolves.toEqual({
      ok: true,
      value: { rewritten: ['round-1'] },
    });
    const afterText = await readFile(statePath, 'utf8');
    const after = JSON.parse(afterText);

    expect(after).toEqual({
      ...before,
      repairObligations: {
        ...before.repairObligations,
        records: {
          ...before.repairObligations.records,
          'round-1': {
            ...before.repairObligations.records['round-1'],
            baseline: { ...before.repairObligations.records['round-1'].baseline, head: 'new-head' },
          },
        },
      },
    });
    expect(after.repairObligations.records['round-1'].baseline).toEqual({
      ...before.repairObligations.records['round-1'].baseline,
      head: 'new-head',
    });
    expect(after.repairObligations.records['round-1'].settlement).toEqual(before.repairObligations.records['round-1'].settlement);
    expect(after.repairObligations.records['round-1'].tasks).toEqual(before.repairObligations.records['round-1'].tasks);
    expect(after.repairObligations.records['round-2']).toEqual(before.repairObligations.records['round-2']);
    expect(afterText).toBe(beforeText.replace('"old-head"', '"new-head"'));
  });

  it('uses the injected engine-state store update seam exactly once', async () => {
    const current: EngineState = {
      activePlanPath: '.docs/plans/current.md',
      repairObligations: {
        version: 1,
        records: {
          'round-1': {
            id: 'round-1', planIdentity: '.docs/plans/current.md', taskIds: ['2'],
            source: { findingId: 'finding-1', authority: 'build_review', instruction: 'Repair.' },
            baseline: { head: 'old-head', tree: 'tree-1', resolvedTaskIds: [] },
            settlement: 'unsettled', tasks: { '2': { status: 'open' } },
          },
        },
        currentByPlan: { '.docs/plans/current.md': { '2': 'round-1' } },
        admissionsByPlan: {},
      },
    };
    let updates = 0;
    const store: EngineStateStore = {
      read: async () => ({ ok: true, value: structuredClone(current) }),
      update: async (mutator) => {
        updates += 1;
        Object.assign(current, await mutator(current));
        return { ok: true };
      },
    };
    const repairs = createRepairObligationStore('/project', '/project/.pipeline/engine-state.json', store);

    await expect(repairs.rewriteBaselines(new Map())).resolves.toEqual({
      ok: true,
      value: { rewritten: [] },
    });
    expect(updates).toBe(0);
    await expect(repairs.rewriteBaselines(new Map([['round-1', 'new-head']]))).resolves.toEqual({
      ok: true,
      value: { rewritten: ['round-1'] },
    });
    expect(updates).toBe(1);
    expect((current.repairObligations as { records: Record<string, { baseline: { head: string } }> })
      .records['round-1'].baseline.head).toBe('new-head');
  });

  it('does not create missing engine state for baseline translations', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);

    await expect(repairs.rewriteBaselines(new Map([['round-1', 'new-head']]))).resolves.toEqual({
      ok: true,
      value: { rewritten: [] },
    });
    await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
