// Covers: task:6, task:rem-prd-audit-8
import { afterEach, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import type { GitResult, GitRunner } from '../../src/engine/rebase.js';
import { checkRoundSupersession, dispatchStackRoundsCommand, supersedeRound } from '../../src/engine/stack-rounds-cli.js';
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

it('reports a failed write, rather than contention, when update-ref fails without moving a fenced ref', async () => {
  const subject = await createSweepRepository('stack-rounds-close-write-failure-', cleanup);
  await subject.git(['commit', '-qm', 'initial']);
  await openAudit(subject, r4, { [c1]: 'restacked', [c2]: 'pending' }, []);
  await openAudit(subject, r5, { [c1]: 'repairing' }, []);
  const checked = await checkRoundSupersession(subject.repo, slug, r4);
  if (checked.kind !== 'supersedable') throw new Error(checked.detail);
  const git: GitRunner = async (args, options) => {
    if (args[0] === 'update-ref' && args[1] === '--stdin') return { exitCode: 1, stdout: '', stderr: 'disk write failed' };
    const result = await subject.git(args, options?.env);
    return { exitCode: 0, ...result } satisfies GitResult;
  };

  await expect(supersedeRound({ worktree: subject.repo, slug, checked, reason: 'newer round', operator: 'operator', git }))
    .resolves.toEqual({ kind: 'refused', detail: 'failed write for routing round r4 (unavailable)' });
  await expect(readRouteRecord(subject.repo, slug, r4)).resolves.toMatchObject({
    kind: 'record', blob: checked.stored.blob, record: { phase: 'open', outbox: [] },
  });
});

it('keeps the target open without an event when its checked survivor closes before the transaction', async () => {
  const subject = await createSweepRepository('stack-rounds-close-survivor-race-', cleanup);
  await subject.git(['commit', '-qm', 'initial']);
  await openAudit(subject, r4, { [c1]: 'restacked', [c2]: 'pending' }, []);
  await openAudit(subject, r5, { [c1]: 'repairing' }, []);
  const checked = await checkRoundSupersession(subject.repo, slug, r4);
  if (checked.kind !== 'supersedable') throw new Error(checked.detail);
  expect(await writeRoutingTransaction(subject.repo, slug, [{
    kind: 'update-record', previous: checked.survivor, record: { ...checked.survivor.record, phase: 'closed', hosts: { [c1]: 'done' } },
  }])).toEqual({ kind: 'updated' });

  await expect(supersedeRound({ worktree: subject.repo, slug, checked, reason: 'newer round', operator: 'operator' }))
    .resolves.toEqual({ kind: 'refused', detail: 'contested write for routing round r4' });
  await expect(readRouteRecord(subject.repo, slug, r4)).resolves.toMatchObject({
    kind: 'record', blob: checked.stored.blob, record: { phase: 'open', outbox: [] },
  });
});

it('refuses r5 after r4 closes when both pre-lease checks cite the other round', async () => {
  const subject = await createSweepRepository('stack-rounds-close-dispatch-race-', cleanup);
  await subject.git(['commit', '-qm', 'initial']);
  await openAudit(subject, r4, { [c1]: 'restacked', [c2]: 'pending' }, []);
  await openAudit(subject, r5, { [c1]: 'restacked' }, []);
  const checkedR4 = await checkRoundSupersession(subject.repo, slug, r4);
  const checkedR5 = await checkRoundSupersession(subject.repo, slug, r5);
  if (checkedR4.kind !== 'supersedable' || checkedR5.kind !== 'supersedable') throw new Error('expected mutually surviving rounds');
  const output: string[] = [];
  const acquireLease = vi.fn(async () => ({ kind: 'acquired' as const, lease: { release: async () => ({ ok: true }) } }));
  const checkSupersession = vi.fn()
    .mockResolvedValueOnce(checkedR4)
    .mockResolvedValueOnce(checkedR5);
  const deps = {
    cwd: subject.repo, resolveMainRoot: async () => subject.repo, resolveWorktree: async () => subject.repo,
    loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } }, warnings: [] }),
    hasDurableChildState: async () => true, resolveOperator: async () => 'operator',
    acquireLease, checkSupersession, supersede: supersedeRound, print: (line: string) => output.push(line),
  };

  await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-close', slug, roundId: r4, reason: 'newer round' }, deps as never)).resolves.toBe(0);
  await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-close', slug, roundId: r5, reason: 'newer round' }, deps as never)).resolves.toBe(1);

  const r4After = await readRouteRecord(subject.repo, slug, r4);
  const r5After = await readRouteRecord(subject.repo, slug, r5);
  expect([r4After, r5After].filter((round) => round.kind === 'record' && round.record.phase !== 'closed')).toHaveLength(1);
  expect(checkSupersession).toHaveBeenCalledTimes(2);
  expect(acquireLease).toHaveBeenCalledTimes(2);
  expect(output.join('\n')).toContain('contested write for routing round r5');
});

it('keeps a preliminary refusal before lease acquisition', async () => {
  const acquireLease = vi.fn();
  await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-close', slug, roundId: r4, reason: 'newer round' }, {
    cwd: '/tmp', resolveMainRoot: async () => '/tmp', resolveWorktree: async () => '/tmp',
    loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } }, warnings: [] }),
    hasDurableChildState: async () => true, resolveOperator: async () => 'operator',
    checkSupersession: async () => ({ kind: 'refused', detail: 'sole non-closed round' }), acquireLease, print: () => {},
  } as never)).resolves.toBe(1);
  expect(acquireLease).not.toHaveBeenCalled();
});
