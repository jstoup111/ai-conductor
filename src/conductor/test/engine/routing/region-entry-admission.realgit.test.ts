// Covers: task:6, task:7, task:8, task:9, task:10
//
// These tests deliberately use a real local repository for the routing refs,
// while keeping the child-region and provider boundaries injected.  The
// observable seam is BUILD-region entry: it must turn a queued child into an
// open revalidate round before the first region gate is dispatched.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../../src/engine/conductor.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { readRepairMarker } from '../../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const roots: string[] = [];
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(entries: readonly number[] = [1]) {
  const root = await mkdtemp(join(tmpdir(), 'region-entry-admission-realgit-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(root, {
    slug: 'demo',
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child one', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  });
  await git(['add', '.']);
  await git(['commit', '-qm', 'stack topology']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
    ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])), feature_desc: 'demo', complexity_tier: 'M',
  }));
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'pending', build: 'skipped', test_suite: 'skipped', build_review: 'skipped',
  }));
  const sha = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim())!;
  const queue = {
    generation: 1,
    entries: entries.map((id) => ({
      child: parseChildId(id)!, position: parseChildId(id)!, closureSha: sha,
      gates: ['acceptance_specs'], replay: { oldParent: sha, newParent: sha }, state: 'queued',
    })),
    outbox: [],
  };
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(queue) })).stdout.trim();
  await git(['update-ref', revalidationQueueRefFor('demo'), blob]);
  return { root, git };
}

function revalidating(child = c1) {
  return { kind: 'repair-pending' as const, child, position: c2, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [child], revalidating: { child, generation: 1 } };
}

describe('BUILD-region admission (real local Git)', () => {
  it('admits the #3477-shaped markerless queue before dispatching child 1 acceptance_specs', async () => {
    const { root, git } = await fixture();
    let admitted = false;
    const resolveActiveChild = vi.fn(async () => {
      if (!admitted) return revalidating();
      const marker = await readRepairMarker(root, 'demo');
      if (marker.kind !== 'marker') throw new Error('expected admitted marker');
      return { kind: 'repair-pending' as const, child: c1, position: c2, isLeaf: true, branch: 'feat/c1/demo', repairChildren: [c1], routedRepair: { child: c1, roundId: marker.marker.roundId } };
    });
    const runner = { run: vi.fn(async () => { admitted = true; return { success: true }; }) };
    // The marker is written by real Git admission.  Polling only at the
    // injected cursor boundary keeps the fixture deterministic.
    const lifecycle = {
      resolveActiveChild: async (...args: Parameters<typeof resolveActiveChild>) => {
        const marker = await readRepairMarker(root, 'demo');
        admitted ||= marker.kind === 'marker';
        return resolveActiveChild(...args);
      },
      enterHostRegion: vi.fn(async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never),
      enterChildRegion: vi.fn(async () => ({ kind: 'completed' }) as never),
    };
    let park = false;
    const conductor = new Conductor({
      // Start after the invalidated gate.  Admission must rewind the loop to
      // acceptance_specs instead of silently continuing at build.
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'build', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }, events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(), operatorParkBoundary: async () => park,
      childRegionLifecycle: lifecycle,
    });
    runner.run.mockImplementation(async () => { park = true; return { success: true }; });

    await conductor.run();

    const marker = await readRepairMarker(root, 'demo');
    expect(marker).toMatchObject({ kind: 'marker', marker: { host: c1 } });
    const refs = (await git(['for-each-ref', '--format=%(objectname)', 'refs/conductor/demo/routes/'])).stdout.trim().split('\n').filter(Boolean);
    const records = await Promise.all(refs.map(async (ref) => JSON.parse((await git(['cat-file', '-p', ref])).stdout)));
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'revalidate', phase: 'open' })]));
    expect(lifecycle.enterHostRegion).toHaveBeenCalledWith(expect.objectContaining({ host: c1, roundId: (marker as { marker: { roundId: unknown } }).marker.roundId }));
    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.anything(), expect.anything());
  });

  it('does not mutate routing refs for a flat cursor', async () => {
    const { root, git } = await fixture([]);
    await git(['update-ref', '-d', revalidationQueueRefFor('demo')]);
    const before = (await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout;
    let park = false;
    const runner = { run: vi.fn(async () => { park = true; return { success: true }; }) };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }, events: new ConductorEventEmitter(), stepRunner: runner, acceptanceRedExec: vi.fn(), operatorParkBoundary: async () => park,
      childRegionLifecycle: { resolveActiveChild: async () => ({ kind: 'active' as const, child: c1, position: c1, isLeaf: true, branch: 'feat/daemon-demo' }), enterHostRegion: vi.fn(), enterChildRegion: vi.fn(async () => ({ kind: 'completed' }) as never) },
    });
    await conductor.run();
    expect((await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout).toBe(before);
    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.anything(), expect.anything());
  });

  // Covers: task:6
  it.each([
    ['queue', revalidationQueueRefFor('demo')],
    ['marker', repairMarkerRefFor('demo')],
  ] as const)('halts needs-human and names an unreadable $kind ref without routing writes', async (_kind, brokenRef) => {
    const { root, git } = await fixture();
    const badBlob = (await git(['hash-object', '-w', '--stdin'], { input: '{not json' })).stdout.trim();
    await git(['update-ref', brokenRef, badBlob]);
    const before = (await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout;
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }, events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() }, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild: async () => revalidating(), enterHostRegion: vi.fn(), enterChildRegion: vi.fn() },
    });
    await conductor.run();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(brokenRef);
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect((await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout).toBe(before);
  });

  // Covers: task:6
  it('names an unreadable routed record without consuming its queued child', async () => {
    const { root, git } = await fixture();
    const round = parseRoundId('r7')!;
    const marker = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host: 1, roundId: round }) })).stdout.trim();
    const badBlob = (await git(['hash-object', '-w', '--stdin'], { input: '{not json' })).stdout.trim();
    await git(['update-ref', repairMarkerRefFor('demo'), marker]);
    await git(['update-ref', routeRecordRefFor('demo', round), badBlob]);
    const before = (await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout;
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }, events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() }, acceptanceRedExec: vi.fn(),
      childRegionLifecycle: { resolveActiveChild: async () => revalidating(), enterHostRegion: vi.fn(), enterChildRegion: vi.fn() },
    });
    await conductor.run();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(routeRecordRefFor('demo', round));
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect((await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout).toBe(before);
  });
});
