// Covers: task:4, task:5, task:6, task:7, task:8, task:9, task:10
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admission: vi.fn(),
  consumeQueued: vi.fn(),
  readRepairMarker: vi.fn(),
}));

vi.mock('../../../src/engine/routing/queue-admission.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/queue-admission.js')>();
  return {
    ...actual,
    admitQueuedRevalidation: (...args: Parameters<typeof actual.admitQueuedRevalidation>) => mocks.admission(...args),
  };
});

vi.mock('../../../src/engine/routing/revalidation-queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/revalidation-queue.js')>();
  return {
    ...actual,
    consumeLowestQueued: (...args: Parameters<typeof actual.consumeLowestQueued>) => mocks.consumeQueued(...args),
  };
});

vi.mock('../../../src/engine/routing/route-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/route-record-store.js')>();
  return {
    ...actual,
    readRepairMarker: (...args: Parameters<typeof actual.readRepairMarker>) => {
      const implementation = mocks.readRepairMarker.getMockImplementation();
      return implementation === undefined ? actual.readRepairMarker(...args) : implementation(...args);
    },
  };
});

import { Conductor } from '../../../src/engine/conductor.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const round = parseRoundId('r7')!;

afterEach(async () => {
  mocks.admission.mockReset();
  mocks.consumeQueued.mockReset();
  mocks.readRepairMarker.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'region-entry-admission-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
    ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
    feature_desc: 'demo', complexity_tier: 'M',
  }));
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'pending', build: 'skipped', test_suite: 'skipped', build_review: 'skipped',
  }));
  return root;
}

describe('BUILD-region queue admission', () => {
  it('admits a markerless revalidating child, re-resolves it, and enters its routed host before dispatch', async () => {
    const root = await fixture();
    const order: string[] = [];
    let admitted = false;
    const resolveActiveChild = vi.fn(async () => {
      order.push(admitted ? 'resolve-routed-host' : 'resolve-revalidating');
      return admitted
        ? { kind: 'repair-pending' as const, child, position: parseChildId(2)!, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], routedRepair: { child, roundId: round } }
        : { kind: 'repair-pending' as const, child, position: parseChildId(2)!, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 } };
    });
    mocks.admission.mockImplementation(async () => {
      order.push('admit');
      admitted = true;
      return { kind: 'admitted', roundId: round, host: child };
    });
    const enterHostRegion = vi.fn(async () => { order.push('enter-host'); return { kind: 'entered', pinnedBase: 'a'.repeat(40) } as never; });
    const enterChildRegion = vi.fn(async () => { order.push('enter-child'); return { kind: 'completed' } as never; });
    let park = false;
    const runner = { run: vi.fn(async () => { order.push('dispatch'); park = true; return { success: true }; }) };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(),
      operatorParkBoundary: async () => park,
      childRegionLifecycle: { resolveActiveChild, enterHostRegion, enterChildRegion },
    });

    await conductor.run();

    expect(mocks.admission).toHaveBeenCalledOnce();
    expect(order.indexOf('admit')).toBeLessThan(order.indexOf('enter-host'));
    expect(order.indexOf('resolve-routed-host')).toBeGreaterThan(order.indexOf('admit'));
    expect(enterHostRegion).toHaveBeenCalledWith(expect.objectContaining({ host: child, roundId: round }));
    expect(enterChildRegion).toHaveBeenCalledWith(root, 'demo', expect.objectContaining({ child, branch: 'feat/c1/demo' }), expect.anything(), undefined);
    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.anything(), expect.anything());
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('re-resolves and enters the reconciled host without consuming a queued child for navigate-host', async () => {
    const root = await fixture();
    const queued = parseChildId(2)!;
    const queuedRound = parseRoundId('r8')!;
    let navigated = false;
    const resolveActiveChild = vi.fn(async () => navigated
      ? { kind: 'repair-pending' as const, child, position: queued, isLeaf: true, branch: 'feat/c1/demo', repairChildren: [child], routedRepair: { child, roundId: queuedRound } }
      : { kind: 'repair-pending' as const, child: queued, position: queued, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [queued], revalidating: { child: queued, generation: 4 } });
    mocks.admission.mockImplementation(async () => {
      navigated = true;
      return { kind: 'continue', reconciled: { kind: 'navigate-host', roundId: queuedRound, host: child } };
    });
    const enterHostRegion = vi.fn(async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never);
    const enterChildRegion = vi.fn(async () => ({ kind: 'completed' }) as never);
    let park = false;
    const runner = { run: vi.fn(async () => { park = true; return { success: true }; }) };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(),
      operatorParkBoundary: async () => park,
      childRegionLifecycle: { resolveActiveChild, enterHostRegion, enterChildRegion },
    });

    await conductor.run();

    expect(mocks.admission).toHaveBeenCalledOnce();
    expect(mocks.consumeQueued).not.toHaveBeenCalled();
    expect(resolveActiveChild.mock.invocationCallOrder[0]).toBeLessThan(mocks.admission.mock.invocationCallOrder[0]);
    expect(mocks.admission.mock.invocationCallOrder[0]).toBeLessThan(enterHostRegion.mock.invocationCallOrder[0]);
    expect(enterHostRegion).toHaveBeenCalledWith(expect.objectContaining({ host: child, roundId: queuedRound }));
    expect(enterChildRegion).toHaveBeenCalledWith(root, 'demo', expect.objectContaining({ child, branch: 'feat/c1/demo' }), expect.anything(), undefined);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('halts mechanically with the blocking round when a busy fence leaves the child revalidating', async () => {
    const root = await fixture();
    const resolveActiveChild = vi.fn(async () => ({
      kind: 'repair-pending' as const, child, position: parseChildId(2)!, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 },
    }));
    mocks.admission.mockResolvedValue({ kind: 'busy', detail: 'routing round r6 has an active host; cannot admit r7' });
    const enterHostRegion = vi.fn();
    const enterChildRegion = vi.fn();
    const runner = { run: vi.fn() };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild, enterHostRegion, enterChildRegion },
    });

    await conductor.run();

    expect(resolveActiveChild.mock.invocationCallOrder.filter((order) => order > mocks.admission.mock.invocationCallOrder[0]!).length).toBe(1);
    expect(enterHostRegion).not.toHaveBeenCalled();
    expect(enterChildRegion).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('routing round r6');
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
  });

  it('re-resolves a marker-race busy result once and enters the marker host', async () => {
    const root = await fixture();
    const markerHost = parseChildId(2)!;
    const markerRound = parseRoundId('r9')!;
    let markerAppeared = false;
    const resolveActiveChild = vi.fn(async () => markerAppeared
      ? { kind: 'repair-pending' as const, child, position: markerHost, isLeaf: true, branch: 'feat/c1/demo', repairChildren: [child], routedRepair: { child: markerHost, roundId: markerRound } }
      : { kind: 'repair-pending' as const, child, position: markerHost, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 } });
    mocks.admission.mockImplementation(async () => {
      markerAppeared = true;
      return { kind: 'busy' };
    });
    const enterHostRegion = vi.fn(async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never);
    const enterChildRegion = vi.fn(async () => ({ kind: 'completed' }) as never);
    let park = false;
    const runner = { run: vi.fn(async () => { park = true; return { success: true }; }) };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(),
      operatorParkBoundary: async () => park,
      childRegionLifecycle: { resolveActiveChild, enterHostRegion, enterChildRegion },
    });

    await conductor.run();

    expect(resolveActiveChild.mock.invocationCallOrder.filter((order) =>
      order > mocks.admission.mock.invocationCallOrder[0]! && order < enterHostRegion.mock.invocationCallOrder[0]!,
    // The second read is completion-context bookkeeping; the first is the
    // single busy-result re-resolution before host entry.
    ).length).toBe(2);
    expect(enterHostRegion).toHaveBeenCalledWith(expect.objectContaining({ host: markerHost, roundId: markerRound }));
    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.anything(), expect.anything());
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('halts mechanically naming the marker owner when a marker-race stays revalidating', async () => {
    const root = await fixture();
    const markerHost = parseChildId(2)!;
    const markerRound = parseRoundId('r9')!;
    let markerAppeared = false;
    const resolveActiveChild = vi.fn(async () => ({
      kind: 'repair-pending' as const, child, position: markerHost, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 },
    }));
    mocks.admission.mockImplementation(async () => {
      markerAppeared = true;
      return { kind: 'busy' };
    });
    mocks.readRepairMarker.mockImplementation(async () => markerAppeared
      ? { kind: 'marker', marker: { host: markerHost, roundId: markerRound } }
      : { kind: 'absent' });
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() }, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild, enterHostRegion: vi.fn(), enterChildRegion: vi.fn() },
    });

    await conductor.run();

    expect(resolveActiveChild.mock.invocationCallOrder.filter((order) => order > mocks.admission.mock.invocationCallOrder[0]!).length).toBe(1);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('owned by child 2 in round r9');
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
  });

  it.each(['resume-exit', 'navigate-leaf-to-build'] as const)('halts mechanically for preflight-only %s without dispatching', async (kind) => {
    const root = await fixture();
    const resolveActiveChild = vi.fn(async () => ({
      kind: 'repair-pending' as const, child, position: parseChildId(2)!, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 },
    }));
    mocks.admission.mockResolvedValue({ kind: 'continue', reconciled: { kind } });
    const runner = { run: vi.fn() };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild, enterHostRegion: vi.fn(), enterChildRegion: vi.fn() },
    });

    await conductor.run();

    expect(resolveActiveChild.mock.invocationCallOrder.filter((order) => order > mocks.admission.mock.invocationCallOrder[0]!).length).toBe(0);
    expect(runner.run).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(`queued child 1, queue generation 3;`);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(kind);
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
  });

  it('names queue state and halts needs-human only when admission is unavailable', async () => {
    const root = await fixture();
    const resolveActiveChild = vi.fn(async () => ({
      kind: 'repair-pending' as const, child, position: parseChildId(2)!, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 },
    }));
    mocks.admission.mockResolvedValue({ kind: 'unavailable', detail: 'revalidation queue is unreadable' });
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }, events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() }, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild, enterHostRegion: vi.fn(), enterChildRegion: vi.fn() },
    });
    await conductor.run();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/child BUILD region refused: queued child 1, queue generation 3;.*marker owner: .*revalidation queue is unreadable/);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain('has no matching repair marker');
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('refuses an ineligible revalidating cursor before queue admission', async () => {
    const root = await fixture();
    const resolveActiveChild = vi.fn(async () => ({
      kind: 'repair-pending' as const, child, position: parseChildId(2)!, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 },
    }));
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: false } }, events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() }, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild, enterHostRegion: vi.fn(), enterChildRegion: vi.fn() },
    });
    await conductor.run();
    expect(mocks.admission).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('queued child 1, queue generation 3; routing is ineligible');
  });

  it('does not dispatch when an admitted queue head re-resolves to another execution source', async () => {
    const root = await fixture();
    let admitted = false;
    const resolveActiveChild = vi.fn(async () => admitted
      ? { kind: 'active' as const, child, position: child, isLeaf: true, branch: 'feat/daemon-demo' }
      : { kind: 'repair-pending' as const, child, position: parseChildId(2)!, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 3 } });
    mocks.admission.mockImplementation(async () => { admitted = true; return { kind: 'admitted', roundId: round, host: child }; });
    const runner = { run: vi.fn() };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }, events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild, enterHostRegion: vi.fn(), enterChildRegion: vi.fn() },
    });
    await conductor.run();
    expect(runner.run).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('queued child 1, queue generation 3;');
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('admitted round r7 for child 1 re-resolved as cursor');
  });

  it('leaves an ordinary cursor region untouched by queue admission', async () => {
    const root = await fixture();
    const resolveActiveChild = vi.fn(async () => ({ kind: 'active' as const, child, position: child, isLeaf: true, branch: 'feat/daemon-demo' }));
    let park = false;
    const runner = { run: vi.fn(async () => { park = true; return { success: true }; }) };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }, events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(), operatorParkBoundary: async () => park,
      childRegionLifecycle: { resolveActiveChild, enterHostRegion: vi.fn(), enterChildRegion: vi.fn(async () => ({ kind: 'completed' }) as never) },
    });
    await conductor.run();
    expect(mocks.admission).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.anything(), expect.anything());
  });
});
