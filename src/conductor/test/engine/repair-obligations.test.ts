// Covers: task:1, task:3
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRepairObligationStore,
  type RepairAdmission,
  type RepairObligationSection,
  taskObligationStanding,
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

function sectionForStanding(): RepairObligationSection {
  return {
    version: 1,
    records: {
      older: {
        id: 'older', planIdentity: 'current-plan', taskIds: ['2'],
        source: { findingId: 'old', authority: 'build_review', instruction: 'Old repair.' },
        baseline: { head: 'old-head', tree: 'old-tree', resolvedTaskIds: [] },
        settlement: 'unsettled', tasks: { '2': { status: 'open' } },
      },
      current: {
        id: 'current', planIdentity: 'current-plan', taskIds: ['2'],
        source: { findingId: 'current', authority: 'build_review', instruction: 'Current repair.' },
        baseline: { head: 'current-head', tree: 'current-tree', resolvedTaskIds: [] },
        settlement: 'unsettled', tasks: { '2': { status: 'open' } },
      },
    },
    currentByPlan: { 'current-plan': { '2': 'current' } },
    admissionsByPlan: {},
  };
}

function standingIds(standing: ReturnType<typeof taskObligationStanding>) {
  return standing.kind === 'live'
    ? { kind: standing.kind, current: standing.current?.id, live: standing.live.map(({ id }) => id), superseded: standing.superseded.map(({ id }) => id) }
    : standing;
}

describe('repair obligations', () => {
  it('classifies binding obligations by current authority without using baselines', () => {
    const section = sectionForStanding();

    expect(taskObligationStanding(section, 'current-plan', 'T2')).toEqual({
      kind: 'live',
      current: section.records.current,
      live: [section.records.current],
      superseded: [section.records.older],
    });

    section.records.older.source.authority = 'prd_audit';
    expect(taskObligationStanding(section, 'current-plan', '2')).toEqual({
      kind: 'live',
      current: section.records.current,
      live: [section.records.older, section.records.current],
      superseded: [],
    });
  });

  it('keeps standing unchanged after rewriting obligation baselines', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);
    const older = await repairs.admitOrReplay('older', admission({ id: 'older', taskIds: ['2'] }));
    const current = await repairs.admitOrReplay('current', admission({ id: 'current', taskIds: ['2'] }));
    if (!older.ok || !current.ok) throw new Error('expected admissions');

    const before = await repairs.read();
    if (!before.ok) throw new Error(before.message);
    await expect(repairs.rewriteBaselines(new Map([
      [older.obligation.id, 'rewritten-older-head'],
      [current.obligation.id, 'rewritten-current-head'],
    ]))).resolves.toMatchObject({ ok: true });
    const after = await repairs.read();
    if (!after.ok) throw new Error(after.message);

    expect(standingIds(taskObligationStanding(after.value, older.obligation.planIdentity, 'T2'))).toEqual(
      standingIds(taskObligationStanding(before.value, older.obligation.planIdentity, '2')),
    );
  });

  it('fails closed only when an open bound obligation has no usable current entry', () => {
    const section = sectionForStanding();
    delete section.currentByPlan['current-plan']['2'];

    expect(taskObligationStanding(section, 'current-plan', '2')).toEqual({
      kind: 'current-less',
      reason: 'repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it',
    });

    expect(taskObligationStanding(section, 'current-plan', 'T2')).toEqual({
      kind: 'current-less',
      reason: 'repair state is unavailable: task T2 has an open repair obligation but no current obligation is recorded for it',
    });

    section.currentByPlan['current-plan']['2'] = 'missing';
    expect(taskObligationStanding(section, 'current-plan', '2')).toEqual({
      kind: 'current-less',
      reason: 'repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it',
    });

    section.records.older.tasks['2'].status = 'resolved';
    section.records.current.tasks['2'].status = 'resolved';
    delete section.currentByPlan['current-plan']['2'];
    expect(taskObligationStanding(section, 'current-plan', '2')).toEqual({
      kind: 'live', current: undefined, live: [section.records.older, section.records.current], superseded: [],
    });
    expect(taskObligationStanding(section, 'current-plan', '3')).toEqual({ kind: 'none' });
  });

  it('closes live obligations but refuses superseded and current-less ones', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);
    const older = await repairs.admitOrReplay('older', admission({ id: 'older', taskIds: ['2'] }));
    const current = await repairs.admitOrReplay('current', admission({ id: 'current', taskIds: ['2'] }));
    if (!older.ok || !current.ok) throw new Error('expected admissions');

    await expect(repairs.close({
      planPath: '.docs/plans/current.md', taskId: '2', obligationId: older.obligation.id,
      evidence: { kind: 'task-done', value: 'stale evidence' },
    })).resolves.toEqual({ ok: false, kind: 'stale', message: 'Repair obligation has been superseded for this task' });
    const otherAuthority = await repairs.admitOrReplay('other-authority', admission({
      id: 'other-authority', taskIds: ['2'],
      source: { findingId: 'other', authority: 'prd_audit', instruction: 'Other repair.' },
    }));
    if (!otherAuthority.ok) throw new Error('expected cross-authority admission');
    await expect(repairs.close({
      planPath: '.docs/plans/current.md', taskId: '2', obligationId: otherAuthority.obligation.id,
      evidence: { kind: 'task-done', value: 'live evidence' },
    })).resolves.toMatchObject({ ok: true });

    const persisted = JSON.parse(await readFile(statePath, 'utf8')) as { repairObligations: RepairObligationSection };
    delete persisted.repairObligations.currentByPlan[older.obligation.planIdentity]['2'];
    await writeFile(statePath, JSON.stringify(persisted));
    await expect(repairs.close({
      planPath: '.docs/plans/current.md', taskId: '2', obligationId: current.obligation.id,
      evidence: { kind: 'task-done', value: 'unavailable evidence' },
    })).resolves.toEqual({
      ok: false,
      kind: 'incompatible',
      message: 'repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it',
    });
    await expect(repairs.read()).resolves.toMatchObject({
      ok: true, value: { records: {
        older: { tasks: { '2': { status: 'open' } } },
        current: { tasks: { '2': { status: 'open' } } },
      } },
    });
  });

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

  it('keeps a plan-amendment replay immutable across reconstructed stores', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const firstStore = createRepairObligationStore(projectRoot, statePath);
    const first = await firstStore.admitOrReplay('plan-amendment:1:digest-b', admission({
      id: 'plan-amendment:1:digest-b',
      taskIds: ['1'],
      source: { findingId: 'digest-b', authority: 'plan_amendment', instruction: 'Reopen task 1.' },
      baseline: { head: 'baseline-head', tree: 'baseline-tree', resolvedTaskIds: ['1'] },
    }));
    if (!first.ok) throw new Error(first.message);

    // A daemon restart rebuilds the store from its durable state. Replays must
    // not manufacture a new repair boundary from the later invocation.
    const recreatedStore = createRepairObligationStore(projectRoot, statePath);
    const replays = await Promise.all(Array.from({ length: 2 }, () => recreatedStore.admitOrReplay(
      'plan-amendment:1:digest-b',
      admission({
        id: 'ignored-replay-id', taskIds: ['1'],
        source: { findingId: 'other', authority: 'plan_amendment', instruction: 'Ignored.' },
        baseline: { head: 'later-head', tree: 'later-tree', resolvedTaskIds: [] },
      }),
    )));

    expect(replays).toEqual(replays.map(() => expect.objectContaining({
      ok: true, replayed: true,
      obligation: expect.objectContaining({ id: first.obligation.id, baseline: first.obligation.baseline }),
    })));
    const state = await recreatedStore.read();
    expect(state).toMatchObject({
      ok: true,
      value: {
        records: {
          'plan-amendment:1:digest-b': expect.objectContaining({ baseline: first.obligation.baseline }),
        },
      },
    });
    if (state.ok) {
      expect(Object.values(state.value.records).filter((record) =>
        record.source.authority === 'plan_amendment' && record.tasks['1']?.status === 'open',
      )).toHaveLength(1);
    }
  });

  it('supersedes only prior plan amendments and lets coexisting prd-audit work settle independently', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);
    const prdAudit = await repairs.admitOrReplay('prd-audit:1', admission({
      id: 'prd-audit:1', taskIds: ['1'],
      source: { findingId: 'PRD-1', authority: 'prd_audit', instruction: 'Repair the audit finding.' },
    }));
    const amendmentA = await repairs.admitOrReplay('plan-amendment:1:digest-a', admission({
      id: 'plan-amendment:1:digest-a', taskIds: ['1'],
      source: { findingId: 'digest-a', authority: 'plan_amendment', instruction: 'Reopen A.' },
    }));
    const amendmentB = await repairs.admitOrReplay('plan-amendment:1:digest-b', admission({
      id: 'plan-amendment:1:digest-b', taskIds: ['1'],
      source: { findingId: 'digest-b', authority: 'plan_amendment', instruction: 'Reopen B.' },
    }));
    if (!prdAudit.ok || !amendmentA.ok || !amendmentB.ok) throw new Error('expected admissions');

    const afterRewrite = await repairs.read();
    expect(afterRewrite).toMatchObject({ ok: true, value: { records: {
      'prd-audit:1': { tasks: { '1': { status: 'open' } } },
      'plan-amendment:1:digest-a': { tasks: { '1': {
        status: 'resolved', evidence: { kind: 'superseded-by-plan-amendment', value: 'plan-amendment:1:digest-b' },
      } } },
      'plan-amendment:1:digest-b': { tasks: { '1': { status: 'open' } } },
    } } });

    await expect(repairs.close({
      planPath: '.docs/plans/current.md', taskId: '1', obligationId: prdAudit.obligation.id,
      evidence: { kind: 'current-done-when', value: 'prd proof' },
    })).resolves.toMatchObject({ ok: true, obligation: { tasks: { '1': { status: 'resolved' } } } });
    await expect(repairs.close({
      planPath: '.docs/plans/current.md', taskId: '1', obligationId: amendmentB.obligation.id,
      evidence: { kind: 'current-done-when', value: 'amendment proof' },
    })).resolves.toMatchObject({ ok: true, obligation: { tasks: { '1': { status: 'resolved' } } } });
  });

  it('refuses to close an obligation through a different plan that reuses its task id', async () => {
    const { projectRoot, statePath } = await createStatePath();
    const repairs = createRepairObligationStore(projectRoot, statePath);
    const planA = await repairs.admitOrReplay('plan-a:1', admission({
      id: 'plan-a:1', taskIds: ['1'],
      planPath: '.docs/plans/a.md',
      source: { findingId: 'A-1', authority: 'prd_audit', instruction: 'Repair plan A.' },
    }));
    const planB = await repairs.admitOrReplay('plan-b:1', admission({
      id: 'plan-b:1', taskIds: ['1'],
      planPath: '.docs/plans/b.md',
      source: { findingId: 'B-1', authority: 'plan_amendment', instruction: 'Repair plan B.' },
    }));
    if (!planA.ok || !planB.ok) throw new Error('expected plan-scoped admissions');

    await expect(repairs.close({
      planPath: '.docs/plans/b.md', taskId: '1', obligationId: planA.obligation.id,
      evidence: { kind: 'current-done-when', value: 'wrong plan' },
    })).resolves.toMatchObject({ ok: false, kind: 'stale' });

    await expect(repairs.read()).resolves.toMatchObject({ ok: true, value: { records: {
      'plan-a:1': { tasks: { '1': { status: 'open' } } },
      'plan-b:1': { tasks: { '1': { status: 'open' } } },
    } } });
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
