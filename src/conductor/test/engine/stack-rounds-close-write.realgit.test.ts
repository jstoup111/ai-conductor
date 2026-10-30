// Covers: task:6
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { checkRoundSupersession, supersedeRound } from '../../src/engine/stack-rounds-cli.js';
import { createRouteRecord, readRouteRecord, writeRoutingTransaction } from '../../src/engine/routing/route-record-store.js';
import { parseRoundId, type RouteRecord } from '../../src/engine/routing/route-types.js';
import { createSweepRepository, removeAll } from './restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const slug = 'demo';
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const r4 = parseRoundId('r4')!;
const r5 = parseRoundId('r5')!;

afterEach(async () => { await removeAll(cleanup); });

async function openAudit(
  subject: Awaited<ReturnType<typeof createSweepRepository>>,
  roundId: typeof r4 | typeof r5,
  hosts: RouteRecord['hosts'],
  items: RouteRecord['items'],
): Promise<void> {
  expect(await createRouteRecord(subject.repo, slug, {
    roundId, kind: 'audit', sealedAuthored: 0, items,
    allocation: Object.fromEntries(Object.keys(hosts).map((host) => [host, { remTaskIds: [], blockBodies: [] }])),
  })).toMatchObject({ kind: 'created' });
  const stored = await readRouteRecord(subject.repo, slug, roundId);
  if (stored.kind !== 'record') throw new Error('missing route record');
  expect(await writeRoutingTransaction(subject.repo, slug, [{
    kind: 'update-record', previous: stored, record: { ...stored.record, phase: 'open', hosts },
  }])).toEqual({ kind: 'updated' });
}

it('closes pending hosts and appends the supersession event in the one record update', async () => {
  const subject = await createSweepRepository('stack-rounds-close-write-', cleanup);
  await subject.git(['commit', '-qm', 'initial']);
  await openAudit(subject, r4, { [c1]: 'restacked', [c2]: 'pending' }, [
    { findingId: 'host-2', kind: 'audit', owner: c2, host: c2, reason: 'task-slice', fallback: [] },
  ]);
  await openAudit(subject, r5, { [c1]: 'repairing' }, []);
  const checked = await checkRoundSupersession(subject.repo, slug, r4);
  if (checked.kind !== 'supersedable') throw new Error(checked.detail);

  await expect(supersedeRound({ worktree: subject.repo, slug, checked, reason: '  newer round  ', operator: 'operator' }))
    .resolves.toMatchObject({ kind: 'superseded', event: { roundId: r4, supersededBy: r5, droppedHosts: [c2], findingIds: ['host-2'], reason: 'newer round', operator: 'operator' } });
  await expect(readRouteRecord(subject.repo, slug, r4)).resolves.toMatchObject({
    kind: 'record', record: { phase: 'closed', hosts: { [c1]: 'restacked', [c2]: 'done' }, outbox: [
      { event: { type: 'routing_round_superseded', roundId: r4 } },
    ] },
  });
});
