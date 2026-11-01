// Covers: task:2, task:3
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { pushedTipRef } from '../../../src/engine/push-lease.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { readRestackJournal, writeRestackJournalBlob } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { refreshLedgerRefFor } from '../../../src/engine/stack-refresh-ledger.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { writePublicationRecord } from '../../../src/engine/stack-publication-record.js';
import { readRefreshLedger } from '../../../src/engine/stack-refresh-ledger.js';
import { createSweepRepository, removeAll, sealStack } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const aboveHost = parseChildId(2)!;
const leaf = parseChildId(3)!;
const roundId = parseRoundId('r1')!;
const secondRoundId = parseRoundId('r2')!;

afterEach(async () => {
  await removeAll(cleanup);
});

async function writeBlob(git: ReturnType<typeof makeGitRunner>, value: unknown): Promise<CommitSha> {
  const written = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) });
  const blob = written.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
  if (!blob) throw new Error('cannot write fixture blob');
  return blob;
}

describe('runRestack refresh ledger (real local Git)', () => {
  it('records every moved published member and the routed round after a host repair', async () => {
    const subject = await createSweepRepository('restack-executor-refresh-', cleanup);
    const git = makeGitRunner(subject.repo);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const firstClosed = await subject.commit('first closed', 'one.txt', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', firstClosed]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const secondClosed = await subject.commit('second closed', 'two.txt', 'two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', secondClosed]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('leaf', 'leaf.txt', 'leaf\n');
    await sealStack(subject.repo);

    await expect(writePublicationRecord(subject.repo, 'demo', undefined, {
      version: 1,
      members: [
        { position: host, branch: 'feat/c1/demo', pr: 101 },
        { position: aboveHost, branch: 'feat/c2/demo', pr: 102 },
        { position: leaf, branch: 'feat/daemon-demo', pr: 103 },
      ],
    }, { git })).resolves.toEqual({ kind: 'updated' });
    for (const branch of ['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']) {
      await git(['update-ref', pushedTipRef('demo', branch), (await git(['rev-parse', branch])).stdout.trim()]);
    }

    const route: RouteRecord = {
      roundId,
      kind: 'audit',
      phase: 'open',
      items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
      allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
      hosts: { [host]: 'built' },
      currentHostIndex: 0,
      receipt: emptyUnsettledReceipt(),
      outbox: [],
    };
    const routeOld = await writeBlob(git, route);
    const markerOld = await writeBlob(git, { host, roundId });
    await git(['update-ref', routeRecordRefFor('demo', roundId), routeOld]);
    await git(['update-ref', repairMarkerRefFor('demo'), markerOld]);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('routed repair', 'repair.txt', 'repair\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      originatingChildren: [host],
      routed: { roundId, host, routeOld, markerOld },
      git,
    })).resolves.toMatchObject({ kind: 'applied' });

    const secondRoute = { ...route, roundId: secondRoundId };
    const secondRouteOld = await writeBlob(git, secondRoute);
    const secondMarkerOld = await writeBlob(git, { host, roundId: secondRoundId });
    await git(['update-ref', routeRecordRefFor('demo', secondRoundId), secondRouteOld]);
    await git(['update-ref', repairMarkerRefFor('demo'), secondMarkerOld]);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('second routed repair', 'second-repair.txt', 'repair\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      originatingChildren: [host],
      routed: { roundId: secondRoundId, host, routeOld: secondRouteOld, markerOld: secondMarkerOld },
      git,
    })).resolves.toMatchObject({ kind: 'applied' });

    const stored = await readRefreshLedger(subject.repo, 'demo', { git });
    const localTips = Object.fromEntries(await Promise.all([
      'feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo',
    ].map(async (branch) => [branch, (await git(['rev-parse', branch])).stdout.trim()]))) as Record<string, string>;
    expect(stored.kind === 'ledger' && {
      memberTips: Object.fromEntries(Object.entries(stored.ledger.members).map(([branch, member]) => [branch, member.recordedTip])),
      rounds: stored.ledger.rounds,
      posted: stored.ledger.posted,
    }).toEqual({
      memberTips: localTips,
      rounds: [
        { roundId, kind: 'audit', host, marker: expect.any(String) },
        { roundId: secondRoundId, kind: 'audit', host, marker: expect.any(String) },
      ],
      posted: [],
    });
  });

  it('does not create a refresh ledger for an unpublished routed restack', async () => {
    const subject = await createSweepRepository('restack-executor-refresh-unpublished-', cleanup);
    const git = makeGitRunner(subject.repo);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const firstClosed = await subject.commit('first closed', 'one.txt', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', firstClosed]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const secondClosed = await subject.commit('second closed', 'two.txt', 'two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', secondClosed]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('leaf', 'leaf.txt', 'leaf\n');
    await sealStack(subject.repo);
    const route: RouteRecord = {
      roundId, kind: 'audit', phase: 'open',
      items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
      allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
      hosts: { [host]: 'built' }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [],
    };
    const routeOld = await writeBlob(git, route);
    const markerOld = await writeBlob(git, { host, roundId });
    await git(['update-ref', routeRecordRefFor('demo', roundId), routeOld]);
    await git(['update-ref', repairMarkerRefFor('demo'), markerOld]);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('routed repair', 'repair.txt', 'repair\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [host],
      routed: { roundId, host, routeOld, markerOld }, git,
    })).resolves.toMatchObject({ kind: 'applied' });

    expect((await git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/refresh'])).exitCode).toBe(1);
  });

  it('halts when the refresh ledger changes before the routed applied transaction', async () => {
    const subject = await createSweepRepository('restack-executor-refresh-race-', cleanup);
    const native = makeGitRunner(subject.repo);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const firstClosed = await subject.commit('first closed', 'one.txt', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', firstClosed]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const secondClosed = await subject.commit('second closed', 'two.txt', 'two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', secondClosed]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('leaf', 'leaf.txt', 'leaf\n');
    await sealStack(subject.repo);
    await writePublicationRecord(subject.repo, 'demo', undefined, { version: 1, members: [
      { position: host, branch: 'feat/c1/demo', pr: 101 },
      { position: aboveHost, branch: 'feat/c2/demo', pr: 102 },
      { position: leaf, branch: 'feat/daemon-demo', pr: 103 },
    ] }, { git: native });
    for (const branch of ['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']) {
      await native(['update-ref', pushedTipRef('demo', branch), (await native(['rev-parse', branch])).stdout.trim()]);
    }
    const route: RouteRecord = { roundId, kind: 'audit', phase: 'open',
      items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
      allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
      hosts: { [host]: 'built' }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [] };
    const routeOld = await writeBlob(native, route);
    const markerOld = await writeBlob(native, { host, roundId });
    await native(['update-ref', routeRecordRefFor('demo', roundId), routeOld]);
    await native(['update-ref', repairMarkerRefFor('demo'), markerOld]);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('routed repair', 'repair.txt', 'repair\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const changed = await writeBlob(native, { changed: true });
    let raced = false;
    const git: GitRunner = async (args, options) => {
      if (!raced && args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(refreshLedgerRefFor('demo'))) {
        raced = true;
        await native(['update-ref', refreshLedgerRefFor('demo'), changed]);
      }
      return native(args, options);
    };

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [host],
      routed: { roundId, host, routeOld, markerOld }, git,
    })).resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining(refreshLedgerRefFor('demo')) });
  });

  it('recovers the exact journalled refresh ledger after a crash before apply', async () => {
    const subject = await createSweepRepository('restack-executor-refresh-recovery-', cleanup);
    const native = makeGitRunner(subject.repo);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('c1', 'one.txt', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const c2 = await subject.commit('c2', 'two.txt', 'two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('leaf', 'leaf.txt', 'leaf\n');
    await sealStack(subject.repo);
    await writePublicationRecord(subject.repo, 'demo', undefined, { version: 1, members: [
      { position: host, branch: 'feat/c1/demo', pr: 101 }, { position: aboveHost, branch: 'feat/c2/demo', pr: 102 }, { position: leaf, branch: 'feat/daemon-demo', pr: 103 },
    ] }, { git: native });
    for (const branch of ['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']) await native(['update-ref', pushedTipRef('demo', branch), (await native(['rev-parse', branch])).stdout.trim()]);
    const route: RouteRecord = { roundId, kind: 'audit', phase: 'open', items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }], allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } }, hosts: { [host]: 'built' }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [] };
    const routeOld = await writeBlob(native, route);
    const markerOld = await writeBlob(native, { host, roundId });
    await native(['update-ref', routeRecordRefFor('demo', roundId), routeOld]);
    await native(['update-ref', repairMarkerRefFor('demo'), markerOld]);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('repair', 'repair.txt', 'repair\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    let crashed = false;
    const crashBeforeApplied: GitRunner = async (args, options) => {
      if (!crashed && args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(refreshLedgerRefFor('demo'))) {
        crashed = true;
        throw new Error('crash before applied');
      }
      return native(args, options);
    };
    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [host], routed: { roundId, host, routeOld, markerOld }, git: crashBeforeApplied })).resolves.toMatchObject({ kind: 'unavailable' });
    const synced = await readRestackJournal(subject.repo, 'demo', { git: native });
    if (synced.kind !== 'journal' || synced.journal.refreshNew === undefined) throw new Error('refresh plan was not journalled');
    const expected = synced.journal.refreshNew;
    const dead = await writeRestackJournalBlob(subject.repo, { ...synced.journal, owner: { host: 'dead', pid: 999999, processStartTime: '0' } }, { git: native });
    await native(['update-ref', 'refs/conductor/demo/restack/journal', dead, synced.blob]);
    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: native })).resolves.toEqual({ kind: 'recovered', fromState: 'synced' });
    expect((await native(['rev-parse', refreshLedgerRefFor('demo')])).stdout.trim()).toBe(expected);
  });
});
