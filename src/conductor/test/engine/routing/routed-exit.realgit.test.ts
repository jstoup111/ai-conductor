// Covers: task:7, task:8, task:9, task:10, task:11, task:12, task:13, task:14
import { afterEach, describe, expect, it } from 'vitest';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseChildId } from '../../../src/engine/child-context.js';
import { resolveActiveChild } from '../../../src/engine/child-cursor.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { cascadesRefFor, MAX_RESTACK_CASCADES_PER_CHILD } from '../../../src/engine/restack/cascade-cap.js';
import { journalRefFor } from '../../../src/engine/restack/restack-journal.js';
import { readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { requestRoutedExit } from '../../../src/engine/routing/routed-exit.js';
import { closureRefFor, repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { writePublicationRecord } from '../../../src/engine/stack-publication-record.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from '../restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const childTwo = parseChildId(2)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => { await removeAll(cleanup); });

async function blob(git: ReturnType<typeof makeGitRunner>, value: unknown): Promise<string> {
  const result = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) });
  if (result.exitCode !== 0) throw new Error('cannot write fixture blob');
  return result.stdout.trim();
}

async function fixture(withRepair: boolean): Promise<SweepRepository & { readonly gitRunner: ReturnType<typeof makeGitRunner>; readonly repair?: string }> {
  const subject = await createSweepRepository('routed-exit-', cleanup);
  await subject.git(['commit', '-qm', 'ignore pipeline']);
  await subject.commit('base', 'base.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await subject.commit('closed one', 'one.txt', 'one\n');
  await subject.git(['update-ref', closureRefFor('demo', host), closedOne]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await subject.commit('closed two', 'two.txt', 'two\n');
  await subject.git(['update-ref', closureRefFor('demo', childTwo), closedTwo]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await sealStack(subject.repo);
  await subject.write('.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  const repair = withRepair ? await subject.commit('routed fix', 'fix.txt', 'fixed\n') : undefined;
  const gitRunner = makeGitRunner(subject.repo);
  const entryTree = (await gitRunner(['rev-parse', `${closedOne}^{tree}`])).stdout.trim() as never;
  const record: RouteRecord = {
    roundId, kind: 'audit', phase: 'open',
    items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
    allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
    hosts: { [host]: 'repairing' }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [],
    entry: { host, pinnedBase: closedOne, tree: entryTree },
  };
  await gitRunner(['update-ref', routeRecordRefFor('demo', roundId), await blob(gitRunner, record)]);
  await gitRunner(['update-ref', repairMarkerRefFor('demo'), await blob(gitRunner, { host, roundId })]);
  return { ...subject, gitRunner, ...(repair === undefined ? {} : { repair }) };
}

async function refExists(git: ReturnType<typeof makeGitRunner>, ref: string): Promise<boolean> {
  return (await git(['rev-parse', '-q', '--verify', ref])).exitCode === 0;
}

describe('routed exit (real local Git)', () => {
  it('marks a repaired host built, drains its outbox, and carries the fix through one routed restack', async () => {
    const subject = await fixture(true);
    const persisted: string[] = [];
    await expect(requestRoutedExit({
      worktree: subject.repo, slug: 'demo', roundId, host,
      persist: async (event) => { persisted.push(event.type); return 'persisted'; },
    })).resolves.toEqual({ kind: 'restacked' });

    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    expect({
      host: route.kind === 'record' ? route.record.hosts[host] : undefined,
      marker: await refExists(subject.gitRunner, repairMarkerRefFor('demo')),
      journal: await refExists(subject.gitRunner, journalRefFor('demo')),
      closure: (await subject.gitRunner(['rev-parse', closureRefFor('demo', host)])).stdout.trim(),
      repair: subject.repair,
      outboxEvents: persisted,
    }).toEqual({ host: 'restacked', marker: false, journal: false, closure: subject.repair, repair: subject.repair, outboxEvents: ['routed_repair_phase'] });
    await expect(subject.gitRunner(['merge-base', '--is-ancestor', subject.repair!, 'feat/c2/demo'])).resolves.toMatchObject({ exitCode: 0 });
    await expect(subject.gitRunner(['merge-base', '--is-ancestor', subject.repair!, 'feat/daemon-demo'])).resolves.toMatchObject({ exitCode: 0 });
  });

  it('takes the one-transaction no-commit exit only at the exact closure tip', async () => {
    const subject = await fixture(false);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host })).resolves.toEqual({ kind: 'no-commit-done' });
    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    expect({
      host: route.kind === 'record' ? route.record.hosts[host] : undefined,
      marker: await refExists(subject.gitRunner, repairMarkerRefFor('demo')),
      journal: await refExists(subject.gitRunner, journalRefFor('demo')),
    }).toEqual({ host: 'done', marker: false, journal: false });
  });

  it('refuses a missing host entry baseline before either exit transaction', async () => {
    const subject = await fixture(true);
    const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    if (stored.kind !== 'record') throw new Error('fixture route is missing');
    await subject.gitRunner(['update-ref', routeRecordRefFor('demo', roundId), await blob(subject.gitRunner, {
      ...stored.record, entry: undefined,
    }), stored.blob]);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host })).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('host 1'),
    });
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
  });

  it('halts before a journal when the exit is published or has a foreign co-origin', async () => {
    const published = await fixture(true);
    await expect(writePublicationRecord(published.repo, 'demo', undefined, {
      version: 1, members: [{ position: host, branch: 'feat/c1/demo', pr: 1 }],
    }, { git: published.gitRunner })).resolves.toEqual({ kind: 'updated' });
    await expect(requestRoutedExit({ worktree: published.repo, slug: 'demo', roundId, host })).resolves.toMatchObject({ kind: 'halted' });
    expect(await refExists(published.gitRunner, journalRefFor('demo'))).toBe(false);

    const foreign = await fixture(true);
    await foreign.git(['checkout', '-q', 'feat/c2/demo']);
    await foreign.commit('foreign round\n\nRound: r9', 'foreign.txt', 'foreign\n');
    await foreign.git(['checkout', '-q', 'feat/c1/demo']);
    await expect(resolveActiveChild(foreign.repo, 'demo', { git: foreign.gitRunner })).resolves.toMatchObject({
      kind: 'repair-pending', foreignRoundChildren: [childTwo],
    });
    await expect(requestRoutedExit({ worktree: foreign.repo, slug: 'demo', roundId, host })).resolves.toMatchObject({ kind: 'halted' });
    expect(await refExists(foreign.gitRunner, journalRefFor('demo'))).toBe(false);
    await expect(readFile(join(foreign.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('child 2');
  });

  it('keeps the marker and names the runbook when the routed exit reaches the cascade cap', async () => {
    const subject = await fixture(true);
    await subject.gitRunner(['update-ref', cascadesRefFor('demo'), await blob(subject.gitRunner, {
      version: 1, counts: { '1': MAX_RESTACK_CASCADES_PER_CHILD },
    })]);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host })).resolves.toMatchObject({ kind: 'halted' });
    expect(await refExists(subject.gitRunner, repairMarkerRefFor('demo'))).toBe(true);
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('Routed repair halted on the cascade cap');
  });

});
