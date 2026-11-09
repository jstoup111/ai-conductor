// Covers: task:4, task:5
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { routeRecordRefFor, repairMarkerRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId, emptyUnsettledReceipt, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import * as restackExecutor from '../../../src/engine/restack/restack-executor.js';
import { readRestackJournal, writeRestackJournalBlob } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => {
  await removeAll(cleanup);
});

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected full SHA, got ${raw}`);
  return parsed;
}

async function writeBlob(git: GitRunner, value: unknown): Promise<CommitSha> {
  const result = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) });
  return sha(result.stdout);
}

async function routedRepairStack(withRepair = true): Promise<SweepRepository & { readonly routeOld: CommitSha; readonly markerOld: CommitSha }> {
  const subject = await createSweepRepository('restack-applied-routed-', cleanup);
  const git = makeGitRunner(subject.repo);
  await subject.commit('base', 'src/base.ts', 'export const base = 1;\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await subject.commit('closed child', 'src/one.ts', 'export const one = 1;\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'src/leaf.ts', 'export const leaf = 2;\n');
  await sealStack(subject.repo, [1, 2]);

  const record: RouteRecord = {
    roundId,
    kind: 'audit',
    phase: 'open',
    items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'task ownership', fallback: [] }],
    allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
    hosts: { [host]: 'built' },
    currentHostIndex: 0,
    receipt: emptyUnsettledReceipt(),
    outbox: [],
  };
  const routeOld = await writeBlob(git, record);
  const markerOld = await writeBlob(git, { host, roundId });
  await git(['update-ref', routeRecordRefFor('demo', roundId), routeOld]);
  await git(['update-ref', repairMarkerRefFor('demo'), markerOld]);

  if (withRepair) {
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('repair', 'src/one.ts', 'export const one = 2;\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  }
  return { ...subject, routeOld, markerOld };
}

async function concurrentRouteBlob(worktree: string, git: GitRunner): Promise<CommitSha> {
  const stored = await readRouteRecord(worktree, 'demo', roundId, { git });
  if (stored.kind !== 'record') throw new Error('expected routed record');
  return writeBlob(git, {
    ...stored.record,
    hosts: { ...stored.record.hosts, [host]: 'restacked' },
  });
}

function appliedAttempts(calls: readonly { readonly args: readonly string[]; readonly input?: string }[]): number {
  return calls.filter((call) => call.args[0] === 'update-ref'
    && call.args[1] === '--stdin'
    && call.input?.includes('refs/conductor/demo/routes/r1')
    && call.input?.includes('refs/conductor/demo/restack/journal')).length;
}

async function expectRoutedApplyHalt(worktree: string): Promise<void> {
  await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8'))
    .resolves.toContain('refs/conductor/demo/routes/r1');
  await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8'))
    .resolves.toContain('needs-human');
}

describe('routed restack applied transaction (real local Git)', () => {
  it('writes the routed route, marker deletion, cascade charge, and applied journal in one transaction', async () => {
    const subject = await routedRepairStack();
    const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
    const native = makeGitRunner(subject.repo);
    const git: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref') calls.push({ args: [...args], input: options?.input });
      return native(args, options);
    };

    await expect(restackExecutor.runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      routed: { roundId, host, routeOld: subject.routeOld, markerOld: subject.markerOld },
      git,
    })).resolves.toMatchObject({ kind: 'applied' });

    const applied = calls.find((call) => call.args[1] === '--stdin' && call.input?.includes('refs/conductor/demo/cascades'));
    expect({
      route: (await native(['rev-parse', routeRecordRefFor('demo', roundId)])).stdout.trim(),
      marker: (await native(['rev-parse', '-q', '--verify', repairMarkerRefFor('demo')])).exitCode,
      applied: applied?.input,
    }).toEqual(expect.objectContaining({
      marker: 1,
      applied: expect.stringMatching(/(?=.*update refs\/conductor\/demo\/routes\/r1 )(?=.*delete refs\/conductor\/demo\/repairing )(?=.*update refs\/conductor\/demo\/cascades )(?=.*update refs\/conductor\/demo\/restack\/journal )/s),
    }));
  });

  it('uses the same applied transaction path for a base refresh without routing refs', async () => {
    const subject = await routedRepairStack(false);
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('advance default', 'src/base.ts', 'export const base = 2;\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
    const native = makeGitRunner(subject.repo);
    const git: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref') calls.push({ args: [...args], input: options?.input });
      return native(args, options);
    };

    const builder = vi.spyOn(restackExecutor.restackTransactionBuilder, 'appliedTransactionLines');
    await expect(restackExecutor.runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git }))
      .resolves.toMatchObject({ kind: 'applied' });

    expect({
      calls: builder.mock.calls.length,
      transactions: calls.filter((call) => call.args[1] === '--stdin' && call.input?.includes('refs/conductor/demo/restack/journal')).map((call) => call.input),
    }).toEqual({
      calls: 1,
      transactions: expect.not.arrayContaining([expect.stringMatching(/refs\/conductor\/demo\/(?:routes|repairing|revalidate)/)]),
    });
    builder.mockRestore();
  });

  it('reuses the journalled routed apply plan during synced recovery', async () => {
    const subject = await routedRepairStack();
    const native = makeGitRunner(subject.repo);
    const interrupted: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('refs/conductor/demo/cascades')) {
        throw new Error('simulated crash before applied transaction');
      }
      return native(args, options);
    };

    await expect(restackExecutor.runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      routed: { roundId, host, routeOld: subject.routeOld, markerOld: subject.markerOld },
      git: interrupted,
    })).resolves.toMatchObject({ kind: 'unavailable' });
    const synced = await readRestackJournal(subject.repo, 'demo', { git: native });
    if (synced.kind !== 'journal') throw new Error('expected synced journal');
    const deadBlob = await writeRestackJournalBlob(subject.repo, {
      ...synced.journal,
      owner: { host: 'recovery-test', pid: 999999, processStartTime: '0' },
    }, { git: native });
    await native(['update-ref', 'refs/conductor/demo/restack/journal', deadBlob, synced.blob]);
    const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
    const recording: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref') calls.push({ args: [...args], input: options?.input });
      return native(args, options);
    };

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: recording }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'synced' });

    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: native });
    expect({
      host: route.kind === 'record' ? route.record.hosts[host] : undefined,
      marker: (await native(['rev-parse', '-q', '--verify', repairMarkerRefFor('demo')])).exitCode,
      applied: calls.find((call) => call.args[1] === '--stdin' && call.input?.includes('refs/conductor/demo/cascades'))?.input,
    }).toEqual(expect.objectContaining({
      host: 'restacked',
      marker: 1,
      applied: expect.stringMatching(/(?=.*update refs\/conductor\/demo\/routes\/r1 )(?=.*delete refs\/conductor\/demo\/repairing )(?=.*update refs\/conductor\/demo\/cascades )(?=.*update refs\/conductor\/demo\/restack\/journal )/s),
    }));
  });

  it('builds the missing routed apply plan when recovery inherits a synced journal', async () => {
    const subject = await routedRepairStack();
    const native = makeGitRunner(subject.repo);
    let interrupted = false;
    const crashAfterSync: GitRunner = async (args, options) => {
      const result = await native(args, options);
      if (!interrupted && args[0] === 'update-ref') {
        const journal = await readRestackJournal(subject.repo, 'demo', { git: native });
        if (journal.kind === 'journal' && journal.journal.state === 'synced' && journal.journal.routed?.routeNew === undefined) {
          interrupted = true;
          throw new Error('simulated crash after sync before routed apply plan');
        }
      }
      return result;
    };

    await expect(restackExecutor.runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      routed: { roundId, host, routeOld: subject.routeOld, markerOld: subject.markerOld },
      git: crashAfterSync,
    })).resolves.toMatchObject({ kind: 'unavailable' });
    const synced = await readRestackJournal(subject.repo, 'demo', { git: native });
    if (synced.kind !== 'journal') throw new Error('expected synced journal');
    expect(synced.journal.routed?.routeNew).toBeUndefined();
    const deadBlob = await writeRestackJournalBlob(subject.repo, {
      ...synced.journal,
      owner: { host: 'recovery-test', pid: 999999, processStartTime: '0' },
    }, { git: native });
    await native(['update-ref', 'refs/conductor/demo/restack/journal', deadBlob, synced.blob]);

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: native }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'synced' });
    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: native });
    expect({
      host: route.kind === 'record' ? route.record.hosts[host] : undefined,
      marker: (await native(['rev-parse', '-q', '--verify', repairMarkerRefFor('demo')])).exitCode,
    }).toEqual({ host: 'restacked', marker: 1 });
  });

  it('halts before the applied transaction when the route changes before its plan is journalled', async () => {
    const subject = await routedRepairStack();
    const native = makeGitRunner(subject.repo);
    const concurrent = await concurrentRouteBlob(subject.repo, native);
    const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
    let changed = false;
    const git: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref') calls.push({ args: [...args], input: options?.input });
      const result = await native(args, options);
      if (!changed && args[0] === 'update-ref') {
        const journal = await readRestackJournal(subject.repo, 'demo', { git: native });
        if (journal.kind === 'journal' && journal.journal.state === 'synced' && journal.journal.routed?.routeNew === undefined) {
          await native(['update-ref', routeRecordRefFor('demo', roundId), concurrent, subject.routeOld]);
          changed = true;
        }
      }
      return result;
    };

    await expect(restackExecutor.runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      routed: { roundId, host, routeOld: subject.routeOld, markerOld: subject.markerOld },
      git,
    })).resolves.toMatchObject({ kind: 'halted' });

    const journal = await readRestackJournal(subject.repo, 'demo', { git: native });
    expect({
      changed,
      attempts: appliedAttempts(calls),
      state: journal.kind === 'journal' ? journal.journal.state : journal.kind,
    }).toEqual({ changed: true, attempts: 0, state: 'synced' });
    await expectRoutedApplyHalt(subject.repo);
  });

  it('halts at synced without retrying when a concurrent writer changes the routed record on the normal path', async () => {
    const subject = await routedRepairStack();
    const native = makeGitRunner(subject.repo);
    const concurrent = await concurrentRouteBlob(subject.repo, native);
    const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
    let changed = false;
    const git: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref') calls.push({ args: [...args], input: options?.input });
      const result = await native(args, options);
      if (!changed && args[0] === 'update-ref'
        && args[1] === 'refs/conductor/demo/restack/journal'
        && args[3] !== '') {
        await native(['update-ref', routeRecordRefFor('demo', roundId), concurrent, subject.routeOld]);
        changed = true;
      }
      return result;
    };

    await expect(restackExecutor.runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      routed: { roundId, host, routeOld: subject.routeOld, markerOld: subject.markerOld },
      git,
    })).resolves.toMatchObject({ kind: 'halted' });

    const journal = await readRestackJournal(subject.repo, 'demo', { git: native });
    expect({
      changed,
      attempts: appliedAttempts(calls),
      state: journal.kind === 'journal' ? journal.journal.state : journal.kind,
    }).toEqual({ changed: true, attempts: 1, state: 'synced' });
    await expectRoutedApplyHalt(subject.repo);
  });

  it('halts at synced without retrying when a concurrent writer changes the routed record during recovery', async () => {
    const subject = await routedRepairStack();
    const native = makeGitRunner(subject.repo);
    const interrupted: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('refs/conductor/demo/cascades')) {
        throw new Error('simulated crash before applied transaction');
      }
      return native(args, options);
    };

    await expect(restackExecutor.runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      routed: { roundId, host, routeOld: subject.routeOld, markerOld: subject.markerOld },
      git: interrupted,
    })).resolves.toMatchObject({ kind: 'unavailable' });
    const synced = await readRestackJournal(subject.repo, 'demo', { git: native });
    if (synced.kind !== 'journal') throw new Error('expected synced journal');
    const concurrent = await concurrentRouteBlob(subject.repo, native);
    await native(['update-ref', routeRecordRefFor('demo', roundId), concurrent, subject.routeOld]);
    const deadBlob = await writeRestackJournalBlob(subject.repo, {
      ...synced.journal,
      owner: { host: 'recovery-test', pid: 999999, processStartTime: '0' },
    }, { git: native });
    await native(['update-ref', 'refs/conductor/demo/restack/journal', deadBlob, synced.blob]);
    const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
    const recording: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref') calls.push({ args: [...args], input: options?.input });
      return native(args, options);
    };

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: recording }))
      .resolves.toMatchObject({ kind: 'halted' });

    const journal = await readRestackJournal(subject.repo, 'demo', { git: native });
    expect({
      attempts: appliedAttempts(calls),
      state: journal.kind === 'journal' ? journal.journal.state : journal.kind,
    }).toEqual({ attempts: 1, state: 'synced' });
    await expectRoutedApplyHalt(subject.repo);
  });
});
