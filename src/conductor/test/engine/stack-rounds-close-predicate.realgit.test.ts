import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { checkRoundSupersession } from '../../src/engine/stack-rounds-cli.js';
import { createRouteRecord, readRouteRecord, writeRoutingTransaction } from '../../src/engine/routing/route-record-store.js';
import { parseRoundId, type RouteRecord } from '../../src/engine/routing/route-types.js';
import { createSweepRepository, removeAll } from './restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const slug = 'demo';
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;
const r2 = parseRoundId('r2')!;
const r3 = parseRoundId('r3')!;
const r4 = parseRoundId('r4')!;
const r5 = parseRoundId('r5')!;

afterEach(async () => { await removeAll(cleanup); });

async function openAudit(
  subject: Awaited<ReturnType<typeof createSweepRepository>>,
  roundId: typeof r2 | typeof r3 | typeof r4 | typeof r5,
  hosts: RouteRecord['hosts'],
  items: RouteRecord['items'],
): Promise<void> {
  const created = await createRouteRecord(subject.repo, slug, {
    roundId,
    kind: 'audit',
    sealedAuthored: 0,
    items,
    allocation: Object.fromEntries(Object.keys(hosts).map((host) => [host, { remTaskIds: [], blockBodies: [] }])),
  });
  if (created.kind !== 'created') throw new Error(`could not create ${roundId}: ${created.kind}`);
  const stored = await readRouteRecord(subject.repo, slug, roundId);
  if (stored.kind !== 'record') throw new Error(`could not read ${roundId}`);
  const updated: RouteRecord = { ...stored.record, phase: 'open', hosts };
  const result = await writeRoutingTransaction(subject.repo, slug, [{ kind: 'update-record', previous: stored, record: updated }]);
  if (result.kind !== 'updated') throw new Error(`could not open ${roundId}: ${result.kind}`);
}

async function fixture() {
  const subject = await createSweepRepository('stack-rounds-close-predicate-', cleanup);
  await subject.git(['commit', '-qm', 'initial']);
  await openAudit(subject, r4, { [c1]: 'restacked', [c2]: 'pending' }, [
    { findingId: 'host-1', kind: 'audit', owner: c1, host: c1, reason: 'task-slice', fallback: [] },
    { findingId: 'host-2', kind: 'audit', owner: c2, host: c2, reason: 'task-slice', fallback: [] },
  ]);
  await openAudit(subject, r5, { [c1]: 'repairing' }, []);
  return subject;
}

async function routeRefs(subject: Awaited<ReturnType<typeof createSweepRepository>>): Promise<string> {
  return (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', `refs/conductor/${slug}/`])).stdout;
}

describe('stack rounds close predicate (real local Git)', () => {
  // Covers: task:4
  it('admits r4 behind r5 and identifies its dropped host findings without writes', async () => {
    const subject = await fixture();
    const before = await routeRefs(subject);

    await expect(checkRoundSupersession(subject.repo, slug, r4)).resolves.toMatchObject({
      kind: 'supersedable',
      supersededBy: r5,
      droppedHosts: [c2],
      findingIds: ['host-2'],
    });

    expect(await routeRefs(subject)).toBe(before);
  });

  // Covers: task:4
  it('admits every ascending pending host in an older open audit round without writes', async () => {
    const subject = await createSweepRepository('stack-rounds-close-predicate-many-', cleanup);
    await subject.git(['commit', '-qm', 'initial']);
    await openAudit(subject, r2, { [c1]: 'restacked', [c2]: 'pending', [c3]: 'pending' }, [
      { findingId: 'host-3', kind: 'audit', owner: c3, host: c3, reason: 'task-slice', fallback: [] },
      { findingId: 'host-2', kind: 'audit', owner: c2, host: c2, reason: 'task-slice', fallback: [] },
    ]);
    await openAudit(subject, r3, { [c1]: 'repairing' }, []);
    const before = await routeRefs(subject);

    await expect(checkRoundSupersession(subject.repo, slug, r2)).resolves.toMatchObject({
      kind: 'supersedable',
      supersededBy: r3,
      droppedHosts: [c2, c3],
      findingIds: ['host-3', 'host-2'],
    });

    expect(await routeRefs(subject)).toBe(before);
  });
});
