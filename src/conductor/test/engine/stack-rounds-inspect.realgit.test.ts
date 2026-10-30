// Covers: task:3
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { describeRoutingRounds, renderRoutingRounds } from '../../src/engine/stack-rounds-cli.js';
import { createRouteRecord, readRouteRecord, writeRoutingTransaction } from '../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor, routeRecordRefFor } from '../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../src/engine/routing/route-types.js';
import { createSweepRepository, removeAll } from './restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const slug = 'demo';
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const r3 = parseRoundId('r3')!;
const r4 = parseRoundId('r4')!;
const r5 = parseRoundId('r5')!;

afterEach(async () => { await removeAll(cleanup); });

async function fixture() {
  const subject = await createSweepRepository('stack-rounds-inspect-', cleanup);
  await subject.git(['commit', '-qm', 'initial']);
  const create = async (roundId: typeof r4 | typeof r5) => {
    const created = await createRouteRecord(subject.repo, slug, {
      roundId, kind: 'audit', sealedAuthored: 0, items: [],
      allocation: roundId === r4
        ? { [c1]: { remTaskIds: [], blockBodies: [] }, [c2]: { remTaskIds: [], blockBodies: [] } }
        : { [c1]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(`could not create ${roundId}: ${created.kind}`);
    const stored = await readRouteRecord(subject.repo, slug, roundId);
    if (stored.kind !== 'record') throw new Error(`could not read ${roundId}`);
    return stored;
  };
  const stored4 = await create(r4);
  const stored5 = await create(r5);
  const settled = { ...emptyUnsettledReceipt(), settlementId: 'r4-settled', acks: { [c1]: true } } as const;
  const open4: RouteRecord = { ...stored4.record, phase: 'open', hosts: { [c1]: 'restacked', [c2]: 'pending' }, receipt: settled };
  const open5: RouteRecord = { ...stored5.record, phase: 'open', hosts: { [c1]: 'repairing' } };
  expect(await writeRoutingTransaction(subject.repo, slug, [{ kind: 'update-record', previous: stored4, record: open4 }])).toEqual({ kind: 'updated' });
  expect(await writeRoutingTransaction(subject.repo, slug, [{ kind: 'update-record', previous: stored5, record: open5 }, { kind: 'create-marker', marker: { host: c1, roundId: r5 } }])).toEqual({ kind: 'updated' });
  return subject;
}

async function routeRefs(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  return (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', `refs/conductor/${slug}/`])).stdout;
}

async function pipelinePaths(subject: Awaited<ReturnType<typeof fixture>>): Promise<readonly string[]> {
  try { return (await readdir(join(subject.repo, '.pipeline'), { recursive: true })).sort(); } catch { return []; }
}

async function writeBlob(subject: Awaited<ReturnType<typeof fixture>>, value: string): Promise<string> {
  return (await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], { input: value })).stdout.trim();
}

describe('stack rounds inspection (real local Git)', () => {
  it('describes and renders every routed round, marker, and wedged predecessor without writes', async () => {
    const subject = await fixture();
    const beforeRefs = await routeRefs(subject);
    const beforePipeline = await pipelinePaths(subject);

    const described = await describeRoutingRounds(subject.repo, slug);
    expect(described.readable).toBe(true);
    expect(described.rounds.map((round) => round.roundId)).toEqual([r4, r5]);
    expect(described.marker).toMatchObject({ kind: 'marker', marker: { host: c1, roundId: r5 } });
    expect(renderRoutingRounds(slug, described)).toContain('r4 audit open hosts 1:restacked, 2:pending current host 1 settled outbox 0');
    expect(renderRoutingRounds(slug, described)).toContain('r5 audit open hosts 1:repairing current host 1 unsettled outbox 0');
    expect(renderRoutingRounds(slug, described)).toContain('repair marker: host 1 round r5');
    expect(renderRoutingRounds(slug, described)).toContain(`wedge: r4 host 2 pending unadmitted behind marker r5; ai-conductor stack rounds --slug ${slug} --close r4 --reason <text>`);
    expect(await routeRefs(subject)).toBe(beforeRefs);
    expect(await pipelinePaths(subject)).toEqual(beforePipeline);
  });

  it('reports an empty routing namespace and absent marker', async () => {
    const subject = await createSweepRepository('stack-rounds-empty-', cleanup);
    await subject.git(['commit', '-qm', 'initial']);

    const described = await describeRoutingRounds(subject.repo, slug);
    expect(described).toMatchObject({ readable: true, rounds: [], marker: { kind: 'absent' } });
    expect(renderRoutingRounds(slug, described)).toContain('Feature demo has no routed rounds and no repair marker.');
  });

  it('retains readable rounds when a route or marker blob is unreadable', async () => {
    const subject = await fixture();
    await subject.git(['update-ref', routeRecordRefFor(slug, r3), await writeBlob(subject, 'not a route record')]);
    const malformedMarker = await writeBlob(subject, 'not a marker');
    await subject.git(['update-ref', repairMarkerRefFor(slug), malformedMarker]);

    const described = await describeRoutingRounds(subject.repo, slug);
    expect(described.readable).toBe(false);
    expect(described.rounds.map((round) => round.roundId)).toEqual([r3, r4, r5]);
    expect(described.rounds[0]).toMatchObject({ roundId: r3, stored: { kind: 'unreadable' } });
    expect(described.rounds[0]?.stored).toMatchObject({ blob: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(described.marker).toMatchObject({ kind: 'unreadable', blob: malformedMarker });
    expect(renderRoutingRounds(slug, described)).toMatch(/r3 unreadable [0-9a-f]{40}/);
    expect(renderRoutingRounds(slug, described)).toContain(`repair marker: unreadable ${malformedMarker}`);
  });
});
