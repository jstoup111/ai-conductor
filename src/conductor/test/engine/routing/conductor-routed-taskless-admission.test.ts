// Covers: tasks:2,33,65
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { childBranchFor, leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { closureRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const seams = vi.hoisted(() => ({
  reread: 'record' as 'record' | 'absent' | 'throw',
  admission: 'admitted' as 'admitted' | 'refused' | 'throw',
  capacity: 'available' as 'available' | 'exhausted',
  createdRecord: undefined as any,
}));

vi.mock('../../../src/engine/routing/route-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/route-record-store.js')>();
  return {
    ...actual,
    nextRoundId: vi.fn(async () => 'r1'),
    createRouteRecord: vi.fn(async (_root, _slug, input) => {
      seams.createdRecord = {
        ...input,
        phase: 'prepared' as const,
        hosts: { 1: 'pending' as const },
        currentHostIndex: 0,
        receipt: { laps: {}, growth: 0, taskless: {}, echo: {}, acks: {} },
        outbox: [],
      };
      return { kind: 'created' as const, record: seams.createdRecord };
    }),
    readRouteRecord: vi.fn(async () => {
      if (seams.reread === 'throw') throw new Error('reread seam');
      if (seams.reread === 'absent') return { kind: 'absent' as const };
      return {
        kind: 'record' as const,
        record: seams.createdRecord ?? {
          roundId: 'r1', kind: 'audit' as const, phase: 'prepared' as const,
          items: [], allocation: {}, hosts: { 1: 'pending' as const }, currentHostIndex: 0,
          receipt: { laps: {}, growth: 0, taskless: {}, echo: {}, acks: {} }, outbox: [],
        },
      };
    }),
    writeRouteRecord: vi.fn(async (_root, _stored, record) => {
      seams.createdRecord = record;
      return { kind: 'updated' as const };
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

vi.mock('../../../src/engine/kickback-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/kickback-ledger.js')>();
  return {
    ...actual,
    bumpKickbackGateInLedger: vi.fn(async () => ({ entry: { count: 1 }, exhausted: false, before: undefined })),
  };
});

vi.mock('../../../src/engine/routing/round-receipt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-receipt.js')>();
  return {
    ...actual,
    tasklessAdmissionCapacity: vi.fn(async () => seams.capacity === 'exhausted'
      ? { kind: 'exhausted' as const, count: 2 }
      : { kind: 'available' as const, count: 0 }),
  };
});

import { Conductor, type StepRunner } from '../../../src/engine/conductor.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  seams.reread = 'record';
  seams.admission = 'admitted';
  seams.capacity = 'available';
  seams.createdRecord = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function subject(judgedChild = 1) {
  const root = await mkdtemp(join(tmpdir(), 'routed-taskless-admission-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'taskless@example.test']);
  await git(['config', 'user.name', 'Taskless']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'demo.md'), [
    '### Task T1: First authored task',
    '',
    '### Task T2: Second authored task',
    '',
  ].join('\n'));
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await writeSliceTopologyFixture(root, {
    slug: 'demo',
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['First', 'Second'] },
  });
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child-1.txt'), 'child 1\n');
  await git(['add', 'child-1.txt']);
  await git(['commit', '-qm', 'child 1']);
  await git(['update-ref', closureRefFor('demo', child(1)), 'HEAD']);
  await git(['checkout', '-qb', leafBranchFor('demo')]);
  await writeFile(join(root, 'child-2.txt'), 'child 2\n');
  await git(['add', 'child-2.txt']);
  await git(['commit', '-qm', 'child 2']);
  const events = new ConductorEventEmitter();
  const runner: StepRunner = {
    run: vi.fn(async () => ({ success: true })),
    dispatchResidueRoutingJudgement: vi.fn(async (prompt) => {
      const itemId = JSON.parse(prompt.split('\n\n').at(-1)!).items[0].itemId;
      return {
        success: true,
        output: JSON.stringify({ version: 'v2', items: [{
          itemId, child: judgedChild, candidates: [judgedChild], rationale: 'fixture',
          implicatedPaths: judgedChild === 2 ? ['child-2.txt'] : [],
        }] }),
      };
    }),
  };
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    events,
    git,
    stepRunner: runner,
    config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({
        kind: 'active', child: 1, position: 1, isLeaf: true, branch: 'feat/demo',
      }) as never,
    },
  });
  return { conductor, events, root };
}

function child(position: number): ChildId {
  const parsed = parseChildId(position);
  if (parsed === undefined) throw new Error(`invalid fixture child ${position}`);
  return parsed;
}

async function fiveChildSubject(judgeOutput?: (prompt: string) => string) {
  const root = await mkdtemp(join(tmpdir(), 'routed-taskless-manifest-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'taskless@example.test']);
  await git(['config', 'user.name', 'Taskless']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeSliceTopologyFixture(root, {
    slug: 'demo',
    sliceMembership: {
      taskSlices: { T1: 1, T2: 2, T3: 3, T4: 4, T5: 5 },
      titles: ['One', 'Two', 'Three', 'Four', 'Five'],
    },
  });

  const changes: ReadonlyArray<readonly [ChildId, readonly string[]]> = [
    [child(1), ['src/core/model.ts']],
    [child(2), ['src/client/network/request.ts']],
    [child(3), ['src/client/state/store.ts']],
    [child(4), ['src/client/input/touch.ts', 'src/client/ui/hud.ts']],
    [child(5), ['src/client/art/manifest.ts']],
  ];
  for (const [position, paths] of changes) {
    let branch: string;
    if (position === child(5)) {
      branch = leafBranchFor('demo');
    } else {
      const childBranch = childBranchFor('demo', position);
      if (!childBranch.ok) throw new Error(childBranch.reason);
      branch = childBranch.branch;
    }
    await git(['checkout', '-qb', branch]);
    for (const path of paths) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), `export const child${position} = true;\n`);
    }
    await git(['add', '--', ...paths]);
    await git(['commit', '-qm', `child ${position}`]);
    if (position !== child(5)) await git(['update-ref', closureRefFor('demo', position), 'HEAD']);
  }

  const dispatchResidueRoutingJudgement = vi.fn(async (prompt: string) => ({
    success: true,
    output: judgeOutput?.(prompt) ?? JSON.stringify({ version: 'v2', items: [{
      itemId: 'manual-test-fail', child: 4, candidates: [4], rationale: 'touch controls',
    }] }),
  }));
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    events: new ConductorEventEmitter(),
    git,
    stepRunner: { run: vi.fn(async () => ({ success: true })), dispatchResidueRoutingJudgement },
    config: { stacked_prs: { enabled: true, max_slices: 5, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({
        kind: 'active', child: 5, position: 5, isLeaf: true, branch: leafBranchFor('demo'),
      }) as never,
    },
  });
  return { conductor, dispatchResidueRoutingJudgement, git, root };
}

describe('routed taskless admission failures', () => {
  // Covers: task:8
  it.each([
    [
      'keeps the judged owner when it contains the implicated path',
      { child: 4, candidates: [4], implicatedPaths: ['src/client/input/touch.ts'] },
      { owner: 4, host: 4, reason: 'residue-judged' },
    ],
    [
      'moves an early owner to the first child containing its implicated path',
      { child: 1, candidates: [1], implicatedPaths: ['src/client/ui/hud.ts'] },
      { owner: 1, host: 4, reason: 'prerequisite-paths' },
    ],
    [
      'moves an owner to the leaf when its kept paths span the leaf',
      { child: 4, candidates: [4], implicatedPaths: ['src/client/input/touch.ts', 'src/client/art/manifest.ts'] },
      { owner: 4, host: 5, reason: 'prerequisite-paths' },
    ],
    [
      'uses the leaf when all implicated paths are absent from it',
      { child: 2, candidates: [2], implicatedPaths: ['src/removed.ts'] },
      { owner: 2, host: 5, reason: 'prerequisite-paths' },
    ],
    [
      'uses the leaf for a residue-default answer with no implicated paths',
      { child: 1, candidates: [1, 2], implicatedPaths: [] },
      { owner: 1, host: 5, reason: 'prerequisite-paths' },
    ],
  ])('places a taskless manual-test obligation: %s', async (_label, answer, expected) => {
    const { conductor } = await fiveChildSubject((prompt) => {
      const itemId = JSON.parse(prompt.split('\n\n').at(-1)!).items[0].itemId;
      return JSON.stringify({ version: 'v2', items: [{ itemId, rationale: 'fixture', ...answer }] });
    });
    const routes = await import('../../../src/engine/routing/route-record-store.js');
    vi.mocked(routes.createRouteRecord).mockClear();

    await expect((conductor as any).admitRoutedManualTestKickback({ feature_desc: 'demo' }, 'FAIL: touch control'))
      .resolves.toEqual({ kind: 'admitted' });

    expect(routes.createRouteRecord).toHaveBeenCalledWith(expect.any(String), 'demo', expect.objectContaining({
      items: [expect.objectContaining({ findingId: 'manual-test-fail', ...expected })],
      allocation: expect.objectContaining({ [expected.host]: expect.anything() }),
    }));
  });

  // Covers: task:8
  it('places a no-evidence custom-step obligation on the leaf without sending evidence to the judge', async () => {
    const { conductor, dispatchResidueRoutingJudgement } = await fiveChildSubject((prompt) => {
      const itemId = JSON.parse(prompt.split('\n\n').at(-1)!).items[0].itemId;
      return JSON.stringify({ version: 'v2', items: [{ itemId, child: 2, candidates: [2], rationale: 'fixture' }] });
    });
    const routes = await import('../../../src/engine/routing/route-record-store.js');
    vi.mocked(routes.createRouteRecord).mockClear();

    await expect((conductor as any).admitRoutedCustomStepKickback({ feature_desc: 'demo' }, 'lint-docs', 1))
      .resolves.toEqual({ kind: 'admitted' });

    const promptItem = JSON.parse(dispatchResidueRoutingJudgement.mock.calls[0]![0].split('\n\n').at(-1)!).items[0];
    expect(promptItem).not.toHaveProperty('evidence');
    expect(routes.createRouteRecord).toHaveBeenCalledWith(expect.any(String), 'demo', expect.objectContaining({
      items: [expect.objectContaining({ findingId: 'custom-lint-docs', owner: 2, host: 5, reason: 'prerequisite-paths' })],
    }));
  });

  // Covers: task:7
  it('sends every manual-test FAIL row and each position manifest to the residue judge', async () => {
    const { conductor, dispatchResidueRoutingJudgement } = await fiveChildSubject();
    const evidence = [
      'FAIL: touch target is obscured by the HUD',
      'FAIL: touch controls do not respond after rotation',
    ].join('\n');

    await expect((conductor as any).admitRoutedManualTestKickback({ feature_desc: 'demo' }, evidence))
      .resolves.toEqual({ kind: 'admitted' });

    expect(dispatchResidueRoutingJudgement).toHaveBeenCalledOnce();
    const prompt = dispatchResidueRoutingJudgement.mock.calls[0]![0];
    const item = JSON.parse(prompt.split('\n\n').at(-1)!).items[0];
    expect(item).toMatchObject({
      itemId: 'manual-test-fail',
      evidence,
      changedPaths: {
        4: ['src/client/input/touch.ts', 'src/client/ui/hud.ts'],
        5: ['src/client/art/manifest.ts'],
      },
    });
    expect(Object.keys(item.changedPaths).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  // Covers: task:7
  it('halts before judgement or record creation when a closure ref is unreadable', async () => {
    const { conductor, dispatchResidueRoutingJudgement, git } = await fiveChildSubject();
    const routes = await import('../../../src/engine/routing/route-record-store.js');
    vi.mocked(routes.createRouteRecord).mockClear();
    await git(['update-ref', '-d', closureRefFor('demo', child(3))]);

    await expect((conductor as any).admitRoutedManualTestKickback({ feature_desc: 'demo' }, 'FAIL: touch control'))
      .resolves.toMatchObject({ kind: 'halted', reason: expect.stringContaining('child 3') });

    expect(dispatchResidueRoutingJudgement).not.toHaveBeenCalled();
    expect(routes.createRouteRecord).not.toHaveBeenCalled();
    await expect(git(['rev-parse', '-q', '--verify', routeRecordRefFor('demo', parseRoundId('r1')!)] )).resolves.toMatchObject({ exitCode: 1 });
  });

  // Covers: task:7
  it('halts without a route record after two undeclared residue answers', async () => {
    const { conductor, dispatchResidueRoutingJudgement, git } = await fiveChildSubject((prompt) => {
      const itemId = JSON.parse(prompt.split('\n\n').at(-1)!).items[0].itemId;
      return JSON.stringify({ version: 'v2', items: [{ itemId, child: 9, candidates: [9], rationale: 'bad position' }] });
    });
    const routes = await import('../../../src/engine/routing/route-record-store.js');
    vi.mocked(routes.createRouteRecord).mockClear();

    await expect((conductor as any).admitRoutedManualTestKickback({ feature_desc: 'demo' }, 'FAIL: touch control'))
      .resolves.toMatchObject({ kind: 'halted', reason: expect.stringContaining('manual-test-fail') });

    expect(dispatchResidueRoutingJudgement).toHaveBeenCalledTimes(2);
    expect(routes.createRouteRecord).not.toHaveBeenCalled();
    await expect(git(['rev-parse', '-q', '--verify', routeRecordRefFor('demo', parseRoundId('r1')!)] )).resolves.toMatchObject({ exitCode: 1 });
  });

  // Covers: task:2
  it('dispatches BUILD on child 4 for a taskless manual-test host with every stored FAIL row', async () => {
    const { root } = await subject();
    const failRows = [
      'FAIL: touch target is obscured by the HUD',
      'FAIL: touch controls do not respond after rotation',
    ];
    const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
    await mkdir(join(root, '.pipeline', 'children', '4'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
      ...parentState, build: 'pending', feature_desc: 'demo',
    }));
    await writeFile(join(root, '.pipeline', 'children', '4', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'pending', test_suite: 'skipped', build_review: 'skipped',
    }));
    seams.createdRecord = {
      roundId: 'r1', kind: 'audit', phase: 'open', sealedAuthored: 2,
      items: [{ findingId: 'manual-test-fail', kind: 'audit', owner: 4, host: 4, reason: 'manual-test', fallback: [] }],
      allocation: { 4: { remTaskIds: [], blockBodies: [], retryHint: failRows.join('\n') } },
      hosts: { 4: 'admitted' }, currentHostIndex: 0,
      receipt: { laps: {}, growth: 0, taskless: { manual_test: 1 }, echo: {}, acks: {} }, outbox: [],
    };
    const runner = { run: vi.fn(async (step: string) => {
      if (step === 'build') parked = true;
      return { success: true };
    }) };
    let parked = false;
    const events = new ConductorEventEmitter();
    const loopHalts: unknown[] = [];
    events.on('loop_halt', (event) => { loopHalts.push(event); });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', fromStep: 'build', mode: 'auto', daemon: true, verifyArtifacts: false,
      events, stepRunner: runner,
      config: { stacked_prs: { enabled: true, max_slices: 4, route_whole_feature_fixes: true } } as never,
      operatorParkBoundary: async () => parked,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'repair-pending', child: 4, position: 4, isLeaf: true, branch: 'feat/daemon-demo',
          repairChildren: [4], routedRepair: { child: 4, roundId: 'r1' },
        }) as never,
        enterHostRegion: async () => {
          seams.createdRecord = { ...seams.createdRecord, hosts: { 4: 'repairing' } };
          return { kind: 'entered' } as never;
        },
        enterChildRegion: async () => ({ kind: 'completed' }) as never,
      },
    });

    await conductor.run();

    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.objectContaining({
      retryReason: expect.stringContaining(failRows[0]),
    }));
    expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.objectContaining({
      retryReason: expect.stringContaining(failRows[1]),
    }));
    expect(seams.createdRecord.hosts[4]).toBe('repairing');
    expect(loopHalts).not.toContainEqual(expect.objectContaining({ reason: expect.stringContaining('derived-already-complete') }));
  });

  // Covers: task:2
  it('admits a post-region custom-step kickback on child 2 and dispatches its taskless BUILD', async () => {
    const { conductor: admittingConductor, root } = await subject(2);
    await expect((admittingConductor as any).admitRoutedCustomStepKickback(
      { feature_desc: 'demo' }, 'lint-docs', 1,
    )).resolves.toEqual({ kind: 'admitted' });
    expect(seams.createdRecord).toMatchObject({
      items: [expect.objectContaining({ host: 2, owner: 2, findingId: 'custom-lint-docs' })],
      allocation: { 2: { remTaskIds: [] } },
    });
    seams.createdRecord = { ...seams.createdRecord, phase: 'open', hosts: { 2: 'admitted' } };
    const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
      ...parentState, build: 'pending', feature_desc: 'demo',
    }));
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'pending', test_suite: 'skipped', build_review: 'skipped',
    }));
    let parked = false;
    const runner = { run: vi.fn(async (step: string) => {
      if (step === 'build') parked = true;
      return { success: true };
    }) };
    const events = new ConductorEventEmitter();
    const loopHalts: unknown[] = [];
    events.on('loop_halt', (event) => { loopHalts.push(event); });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', fromStep: 'build', mode: 'auto', daemon: true, verifyArtifacts: false,
      events, stepRunner: runner,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } } as never,
      operatorParkBoundary: async () => parked,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'repair-pending', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo',
          repairChildren: [2], routedRepair: { child: 2, roundId: 'r1' },
        }) as never,
        enterHostRegion: async () => {
          seams.createdRecord = { ...seams.createdRecord, hosts: { 2: 'repairing' } };
          return { kind: 'entered' } as never;
        },
        enterChildRegion: async () => ({ kind: 'completed' }) as never,
      },
    });

    await conductor.run();

    expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.objectContaining({ retryReason: undefined }));
    expect(seams.createdRecord.hosts[2]).toBe('repairing');
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(loopHalts).not.toContainEqual(expect.objectContaining({ reason: expect.stringContaining('derived-already-complete') }));
  });

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

  // Covers: task:rem-prd-audit-rem-prd-audit-S5-1
  it('creates a charged child-2 manual_test receipt from the first authored plan', async () => {
    const { conductor } = await subject(2);
    const routes = await import('../../../src/engine/routing/route-record-store.js');
    vi.mocked(routes.createRouteRecord).mockClear();

    await expect((conductor as any).admitRoutedManualTestKickback(
      { feature_desc: 'demo' },
      'manual-test evidence',
    )).resolves.toEqual({ kind: 'admitted' });

    expect(routes.createRouteRecord).toHaveBeenCalledWith(expect.any(String), 'demo', expect.objectContaining({
      sealedAuthored: 2,
      items: [expect.objectContaining({ host: 2, owner: 2, findingId: 'manual-test-fail' })],
    }));
    expect(seams.createdRecord).toMatchObject({ sealedAuthored: 2 });
    expect(seams.createdRecord.receipt).toEqual({
      laps: {}, growth: 0, taskless: { manual_test: 1 }, echo: {}, acks: {},
    });
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-S5-3-2
  it('routes a first-round lint-docs kickback to the leaf and echoes its ledger charge', async () => {
    const { conductor, root } = await subject(1);
    const routes = await import('../../../src/engine/routing/route-record-store.js');
    const ledger = await import('../../../src/engine/kickback-ledger.js');
    vi.mocked(routes.createRouteRecord).mockClear();
    vi.mocked(ledger.bumpKickbackGateInLedger).mockClear();

    await expect((conductor as any).scanKickbackVerdicts(
      'lint-docs',
      { feature_desc: 'demo' },
      { build: { satisfied: false, checkedAt: Date.now(), kickback: { from: 'lint-docs', evidence: 'lint failed' } } },
      [],
      { navigate: false },
    )).resolves.toBe('kicked');

    expect(ledger.bumpKickbackGateInLedger).toHaveBeenCalledOnce();
    expect(ledger.bumpKickbackGateInLedger).toHaveBeenCalledWith(root, 'build', expect.anything(), undefined);
    expect(routes.createRouteRecord).toHaveBeenCalledWith(expect.any(String), 'demo', expect.objectContaining({
      sealedAuthored: 2,
      items: [expect.objectContaining({ host: 2, owner: 1, findingId: 'custom-lint-docs', reason: 'prerequisite-paths' })],
    }));
    expect(seams.createdRecord.receipt).toEqual({
      laps: {}, growth: 0, taskless: {}, echo: { 'lint-docs': 1 }, acks: {},
    });
    await expect(readFile(join(root, '.docs', 'plans', 'demo.md'), 'utf8')).resolves.not.toContain('### Task rem-');
  });
});
