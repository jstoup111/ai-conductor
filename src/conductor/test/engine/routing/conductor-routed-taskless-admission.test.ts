// Covers: tasks:33,65
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seams = vi.hoisted(() => ({
  reread: 'record' as 'record' | 'absent' | 'throw',
  admission: 'admitted' as 'admitted' | 'refused' | 'throw',
  capacity: 'available' as 'available' | 'exhausted',
}));

vi.mock('../../../src/engine/routing/route-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/route-record-store.js')>();
  return {
    ...actual,
    nextRoundId: vi.fn(async () => 'r1'),
    createRouteRecord: vi.fn(async (_root, _slug, input) => ({
      kind: 'created' as const,
      record: {
        ...input,
        phase: 'prepared' as const,
        hosts: { 1: 'pending' as const },
        currentHostIndex: 0,
        receipt: {},
        outbox: [],
      },
    })),
    readRouteRecord: vi.fn(async () => {
      if (seams.reread === 'throw') throw new Error('reread seam');
      if (seams.reread === 'absent') return { kind: 'absent' as const };
      return {
        kind: 'record' as const,
        record: {
          roundId: 'r1', kind: 'audit' as const, phase: 'prepared' as const,
          items: [], allocation: {}, hosts: { 1: 'pending' as const }, currentHostIndex: 0,
          receipt: {}, outbox: [],
        },
      };
    }),
  };
});

vi.mock('../../../src/engine/routing/round-admission.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-admission.js')>();
  return {
    ...actual,
    admitRound: vi.fn(async () => {
      if (seams.admission === 'throw') throw new Error('admission seam');
      if (seams.admission === 'refused') return { kind: 'refused' as const, detail: 'admission refused' };
      return { kind: 'admitted' as const, record: {} as never };
    }),
  };
});

vi.mock('../../../src/engine/routing/round-receipt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-receipt.js')>();
  return {
    ...actual,
    // These cases exercise failures after the durable denominator is available.
    routedSealedAuthored: vi.fn(async () => 1),
    tasklessAdmissionCapacity: vi.fn(async () => seams.capacity === 'exhausted'
      ? { kind: 'exhausted' as const, count: 2 }
      : { kind: 'available' as const, count: 0 }),
  };
});

import { Conductor, type StepRunner } from '../../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  seams.reread = 'record';
  seams.admission = 'admitted';
  seams.capacity = 'available';
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function subject(judgedChild = 1) {
  const root = await mkdtemp(join(tmpdir(), 'routed-taskless-admission-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
    version: 1, slug: 'demo', runId: 'fixture', status: 'done', entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: [] },
  }));
  const events = new ConductorEventEmitter();
  const runner: StepRunner = {
    run: vi.fn(async () => ({ success: true })),
    dispatchResidueRoutingJudgement: vi.fn(async (prompt) => {
      const itemId = JSON.parse(prompt.split('\n\n').at(-1)!).items[0].itemId;
      return {
        success: true,
        output: JSON.stringify({ version: 'v1', items: [{ itemId, child: judgedChild, candidates: [judgedChild], rationale: 'fixture' }] }),
      };
    }),
  };
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    events,
    stepRunner: runner,
    config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({
        kind: 'active', child: 1, position: 1, isLeaf: true, branch: 'feat/demo',
      }) as never,
    },
  });
  return { conductor, events };
}

describe('routed taskless admission failures', () => {
  it.each([
    ['receipt CAS', async () => { throw new Error('CAS refused'); }, /round r1.*receipt mutation failed.*CAS refused/],
    ['record reread', async () => ({ kind: 'charged' as const }), /round r1.*record reread failed: reread seam/],
    ['round admission', async () => ({ kind: 'charged' as const }), /round r1.*admission failed: admission seam/],
  ])('returns a round-named halt without emitting a kickback when %s fails', async (failure, mutateReceipt, reason) => {
    const { conductor, events } = await subject();
    if (failure === 'record reread') seams.reread = 'throw';
    if (failure === 'round admission') seams.admission = 'throw';
    const emitted = vi.spyOn(events, 'emit');

    const result = await (conductor as any).admitRoutedTasklessKickback(
      { feature_desc: 'demo' },
      { findingId: () => 'fixture', reason: 'fixture', mutateReceipt },
    );

    expect(result).toMatchObject({ kind: 'halted' });
    expect(result.reason).toMatch(reason);
    expect(emitted.mock.calls.map(([event]) => event)).not.toContainEqual(expect.objectContaining({ type: 'kickback' }));
  });

  it('uses the recovered self-heal count and legacy exhaustion reason without creating a route', async () => {
    const { conductor } = await subject();
    seams.capacity = 'exhausted';

    await expect((conductor as any).admitRoutedManualTestKickback(
      { feature_desc: 'demo' },
      'first failure\nsecond failure',
    )).resolves.toEqual({
      kind: 'exhausted',
      reason: 'manual-test FAIL unresolved after 2 build kickback(s) (cap 2): first failure (+1 more FAIL row(s))',
    });
  });

  it('uses the residue-routing host rather than the active execution child', async () => {
    const { conductor } = await subject(2);
    const routes = await import('../../../src/engine/routing/route-record-store.js');
    vi.mocked(routes.createRouteRecord).mockClear();

    await expect((conductor as any).admitRoutedTasklessKickback(
      { feature_desc: 'demo' },
      { findingId: (host: number) => `fixture-${host}`, reason: 'fixture', mutateReceipt: async () => ({ kind: 'charged' as const }) },
    )).resolves.toEqual({ kind: 'admitted' });

    expect(routes.createRouteRecord).toHaveBeenCalledWith(expect.any(String), 'demo', expect.objectContaining({
      items: [expect.objectContaining({ host: 2, owner: 2, findingId: 'fixture-2' })],
      allocation: expect.objectContaining({ 2: expect.anything() }),
    }));
  });
});
