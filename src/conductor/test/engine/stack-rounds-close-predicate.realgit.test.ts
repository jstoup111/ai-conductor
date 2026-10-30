import { afterEach, describe, expect, it } from 'vitest';

import { CHILD_REGION_STEPS, parseChildId } from '../../src/engine/child-context.js';
import { parseCommitSha } from '../../src/engine/restack/restack-types.js';
import { checkRoundSupersession } from '../../src/engine/stack-rounds-cli.js';
import { createRouteRecord, readRouteRecord, writeRoutingTransaction } from '../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor, routeRecordRefFor } from '../../src/engine/routing/routing-refs.js';
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

async function replaceRound(
  subject: Awaited<ReturnType<typeof createSweepRepository>>,
  roundId: typeof r2 | typeof r3 | typeof r4 | typeof r5,
  next: (record: RouteRecord) => RouteRecord,
): Promise<void> {
  const stored = await readRouteRecord(subject.repo, slug, roundId);
  if (stored.kind !== 'record') throw new Error(`could not read ${roundId}`);
  const result = await writeRoutingTransaction(subject.repo, slug, [{ kind: 'update-record', previous: stored, record: next(stored.record) }]);
  if (result.kind !== 'updated') throw new Error(`could not update ${roundId}: ${result.kind}`);
}

async function pointRefAtInvalidBlob(
  subject: Awaited<ReturnType<typeof createSweepRepository>>,
  ref: string,
): Promise<void> {
  const blob = (await subject.git(['rev-parse', 'HEAD:.gitignore'])).stdout.trim();
  await subject.git(['update-ref', ref, blob]);
}

async function pointRefAtBlobText(
  subject: Awaited<ReturnType<typeof createSweepRepository>>,
  ref: string,
  text: string,
): Promise<void> {
  await subject.write('routing-blob.json', text);
  const blob = (await subject.git(['hash-object', '-w', 'routing-blob.json'])).stdout.trim();
  await subject.git(['update-ref', ref, blob]);
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

  // Covers: task:5
  it('refuses an open audit round with no pending hosts to drop without writes', async () => {
    const subject = await fixture();
    await replaceRound(subject, r4, (record) => ({
      ...record,
      hosts: { [c1]: 'restacked', [c2]: 'done' },
    }));
    const before = await routeRefs(subject);

    await expect(checkRoundSupersession(subject.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining(`routing round ${r4} has no pending hosts to drop`),
    });

    expect(await routeRefs(subject)).toBe(before);
  });

  // Covers: task:5
  it('refuses the sole non-closed round and non-audit rounds without writes', async () => {
    const sole = await createSweepRepository('stack-rounds-close-sole-', cleanup);
    await sole.git(['commit', '-qm', 'initial']);
    await openAudit(sole, r4, { [c1]: 'restacked', [c2]: 'pending' }, []);
    const soleBefore = await routeRefs(sole);
    await expect(checkRoundSupersession(sole.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining(`sole non-closed round ${r4} would skip the leaf return`),
    });
    expect(await routeRefs(sole)).toBe(soleBefore);

    const subject = await fixture();
    await replaceRound(subject, r4, (record) => ({ ...record, kind: 'revalidate', sealedAuthored: undefined }));
    const revalidateBefore = await routeRefs(subject);
    await expect(checkRoundSupersession(subject.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringMatching(/revalidate.*only audit rounds can be superseded/),
    });
    expect(await routeRefs(subject)).toBe(revalidateBefore);

    await replaceRound(subject, r4, (record) => ({
      ...record,
      kind: 'operator',
      hosts: { [c1]: 'repairing' },
      allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
      items: [],
      operator: {
        origin: 'land', reason: 'operator work', operator: 'tester', entryStep: 'build', carried: [],
        otherTips: { main: parseCommitSha('1'.repeat(40))! },
        priorRegion: {
          statuses: Object.fromEntries(CHILD_REGION_STEPS.map((step) => [step, 'done'])) as Record<(typeof CHILD_REGION_STEPS)[number], 'done'>,
          verdicts: {},
        },
      },
    }));
    const operatorBefore = await routeRefs(subject);
    await expect(checkRoundSupersession(subject.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringMatching(/operator.*only audit rounds can be superseded.*ai-conductor stack land --slug demo --abandon/),
    });
    expect(await routeRefs(subject)).toBe(operatorBefore);
  });

  // Covers: task:5
  it.each(['admitted', 'repairing', 'built', 'reroute-moved', 'abandoning', 'abandoned'] as const)(
    'refuses an in-flight host in state %s without writes',
    async (state) => {
      const subject = await fixture();
      if (state !== 'reroute-moved') {
        await replaceRound(subject, r4, (record) => ({ ...record, hosts: { [c1]: state, [c2]: 'pending' } }));
      }
      const before = await routeRefs(subject);
      const stored = await readRouteRecord(subject.repo, slug, r4);
      if (stored.kind !== 'record') throw new Error('missing r4');
      const checked = state === 'reroute-moved'
        ? checkRoundSupersession(subject.repo, slug, r4, {
          readRouteRecord: async (worktree, feature, id, dependencies) => id === r4
            ? { ...stored, record: { ...stored.record, hosts: { [c1]: state, [c2]: 'pending' } } }
            : readRouteRecord(worktree, feature, id, dependencies),
        })
        : checkRoundSupersession(subject.repo, slug, r4);
      await expect(checked).resolves.toMatchObject({
        kind: 'refused', detail: expect.stringContaining(`host 1 is ${state}`),
      });
      expect(await routeRefs(subject)).toBe(before);
    },
  );

  // Covers: task:5
  it('refuses in-progress reroutes and held or unreadable repair markers without writes', async () => {
    const rerouting = await fixture();
    await replaceRound(rerouting, r4, (record) => ({
      ...record,
      hosts: { [c1]: 'reroute-moved', [c2]: 'pending' },
      currentHostIndex: 1,
      fallback: [{ from: c1, to: c2, evidence: ['because'], branch: 'feat/c1/demo', head: parseCommitSha('1'.repeat(40))! }],
      reroute: {
        sourceBranch: 'feat/c1/demo',
        rejectedTip: parseCommitSha('1'.repeat(40))!,
        resetTip: parseCommitSha('1'.repeat(40))!,
        destination: c2,
      },
    }));
    const rerouteBefore = await routeRefs(rerouting);
    await expect(checkRoundSupersession(rerouting.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining('in-progress reroute'),
    });
    expect(await routeRefs(rerouting)).toBe(rerouteBefore);

    const held = await fixture();
    await pointRefAtBlobText(held, repairMarkerRefFor(slug), JSON.stringify({ host: c1, roundId: r4 }));
    const heldBefore = await routeRefs(held);
    await expect(checkRoundSupersession(held.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining(`marker holds ${r4}`),
    });
    expect(await routeRefs(held)).toBe(heldBefore);

    const unreadable = await fixture();
    await pointRefAtInvalidBlob(unreadable, repairMarkerRefFor(slug));
    const unreadableBefore = await routeRefs(unreadable);
    await expect(checkRoundSupersession(unreadable.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining('repair marker is unreadable'),
    });
    expect(await routeRefs(unreadable)).toBe(unreadableBefore);
  });

  // Covers: task:5
  it('refuses malformed round inputs and unreadable route records without writes', async () => {
    const subject = await fixture();
    const before = await routeRefs(subject);
    await expect(checkRoundSupersession(subject.repo, slug, 'x4' as typeof r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining('round id x4 is invalid'),
    });
    await expect(checkRoundSupersession(subject.repo, slug, r2)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining(`routing round ${r2} is missing`),
    });
    expect(await routeRefs(subject)).toBe(before);
    await pointRefAtInvalidBlob(subject, routeRecordRefFor(slug, r3));
    const unreadableBefore = await routeRefs(subject);
    await expect(checkRoundSupersession(subject.repo, slug, r3)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining(`routing round ${r3} is unreadable`),
    });
    await expect(checkRoundSupersession(subject.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining(`other routing round ${r3} is unreadable`),
    });
    expect(await routeRefs(subject)).toBe(unreadableBefore);
  });

  // Covers: task:5
  it.each([
    ['prepared', { [c1]: 'pending', [c2]: 'pending' }],
    ['closed', { [c1]: 'done', [c2]: 'done' }],
  ] as const)('refuses a %s round without writes', async (phase, hosts) => {
    const subject = await fixture();
    await replaceRound(subject, r4, (record) => ({ ...record, phase, hosts, currentHostIndex: 0 }));
    const before = await routeRefs(subject);
    await expect(checkRoundSupersession(subject.repo, slug, r4)).resolves.toMatchObject({
      kind: 'refused', detail: expect.stringContaining(`routing round ${r4} is ${phase}`),
    });
    expect(await routeRefs(subject)).toBe(before);
  });
});
