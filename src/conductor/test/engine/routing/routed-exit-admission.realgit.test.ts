// Covers: task:8
//
// This is deliberately a real-local-Git fixture: admission's queue, route,
// and marker transaction is the boundary that a mocked continuation cannot
// prove.
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitQueuedRevalidation } from '../../../src/engine/routing/queue-admission.js';
import { readRepairMarker, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const roots: string[] = [];
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const r4 = parseRoundId('r4')!;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(hostState: 'restacked' | 'admitted' | 'repairing' | 'built' = 'restacked') {
  const root = await mkdtemp(join(tmpdir(), 'routed-exit-admission-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(root, { slug: 'demo', sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['one', 'two'] }, storyOwnership: { S1: 1, S2: 2 } });
  await git(['add', '.']);
  await git(['commit', '-qm', 'topology']);
  const sha = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim())!;
  const queue = { generation: 4, entries: [{ child: c2, position: c2, closureSha: sha, gates: ['acceptance_specs'], replay: { oldParent: sha, newParent: sha }, state: 'queued' }], outbox: [] };
  const queueBlob = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(queue) })).stdout.trim();
  await git(['update-ref', revalidationQueueRefFor('demo'), queueBlob]);
  const record: RouteRecord = {
    roundId: r4, kind: 'revalidate', phase: 'open', items: [], allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
    hosts: { [c1]: hostState }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [],
  };
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(record) })).stdout.trim();
  await git(['update-ref', routeRecordRefFor('demo', r4), blob]);
  return { root, git };
}

describe('routed-exit queue admission (real local Git)', () => {
  it('admits child 2 after r4 has restacked, writes its marker, and leaves no HALT', async () => {
    const subject = await fixture();
    const result = await admitQueuedRevalidation({ worktree: subject.root, slug: 'demo', reconciled: { kind: 'none' } });
    expect(result).toMatchObject({ kind: 'admitted', host: c2 });
    if (result.kind !== 'admitted') throw new Error('expected child 2 admission');
    await expect(readRepairMarker(subject.root, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { host: c2, roundId: result.roundId } });
    await expect(readRouteRecord(subject.root, 'demo', result.roundId)).resolves.toMatchObject({ kind: 'record', record: { kind: 'revalidate', phase: 'open', hosts: { 2: 'admitted' } } });
    await expect(access(join(subject.root, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['admitted', 'repairing', 'built'] as const)('does not admit child 2 while r4 host 1 is %s', async (hostState) => {
    const subject = await fixture(hostState);
    const before = (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout;
    await expect(admitQueuedRevalidation({ worktree: subject.root, slug: 'demo', reconciled: { kind: 'none' } })).resolves.toMatchObject({ kind: 'busy', detail: expect.stringContaining('r4') });
    expect((await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout).toBe(before);
  });
});
