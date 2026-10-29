// Covers: task:5, task:8, task:12, task:rem-prd-audit-W9
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rename, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, drainRoutingOutboxes, readRepairMarker, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { reconcileReceiptLedger } from '../../../src/engine/routing/round-receipt.js';
import { consumeLowestQueued } from '../../../src/engine/routing/revalidation-queue.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

vi.mock('../../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-executor.js')>();
  return { ...actual, runRestack: vi.fn(actual.runRestack) };
});

vi.mock('../../../src/engine/routing/round-receipt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-receipt.js')>();
  return { ...actual, reconcileReceiptLedger: vi.fn(actual.reconcileReceiptLedger) };
});

vi.mock('../../../src/engine/routing/route-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/route-record-store.js')>();
  return { ...actual, drainRoutingOutboxes: vi.fn(actual.drainRoutingOutboxes) };
});

vi.mock('../../../src/engine/routing/revalidation-queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/revalidation-queue.js')>();
  return { ...actual, consumeLowestQueued: vi.fn(actual.consumeLowestQueued) };
});

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-routing-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Stack preflight routing']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed child', 'child.txt', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  return { repo, git };
}

async function refNames(repo: string): Promise<string> {
  return (await execFile('git', ['for-each-ref', '--format=%(refname)'], { cwd: repo })).stdout;
}

async function conductorRefSnapshot(repo: string): Promise<string> {
  return (await execFile('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'], { cwd: repo })).stdout;
}

async function writeGitBlob(subject: Awaited<ReturnType<typeof fixture>>, contents: string): Promise<string> {
  const path = join(subject.repo, '.route-test-blob.json');
  await writeFile(path, contents);
  return (await subject.git(['hash-object', '-w', path])).stdout.trim();
}

describe('stack preflight routing', () => {
  it('does not reconcile or admit a successor when routing outbox persistence fails', async () => {
    const subject = await fixture();
    const settled = parseChildId(1)!;
    const successor = parseChildId(2)!;
    const roundId = parseRoundId('r1')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [
        { findingId: 'settled', kind: 'audit', owner: settled, host: settled, reason: 'task-slice', fallback: [] },
        { findingId: 'successor', kind: 'audit', owner: successor, host: successor, reason: 'task-slice', fallback: [] },
      ],
      allocation: {
        [settled]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] },
        [successor]: { remTaskIds: ['rem-prd-audit-T2'], blockBodies: ['### Task rem-prd-audit-T2\n'] },
      },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    const open = { ...created.record, phase: 'open' as const, hosts: { [settled]: 'restacked' as const, [successor]: 'pending' as const } };
    const blob = await writeGitBlob(subject, JSON.stringify(open));
    await subject.git(['update-ref', routeRecordRefFor('demo', roundId), blob]);
    expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'absent' });
    const refsBefore = await conductorRefSnapshot(subject.repo);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    vi.mocked(drainRoutingOutboxes).mockResolvedValueOnce({ kind: 'persist-failed' });

    try {
      await expect(runStackPreflight({
        worktree: subject.repo,
        slug: 'demo',
        events,
        git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining('r1 (2: pending)') });

      expect(await conductorRefSnapshot(subject.repo)).toBe(refsBefore);
      expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'absent' });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({
        kind: 'record',
        record: { hosts: { [settled]: 'restacked', [successor]: 'pending' } },
      });
    } finally {
      persister.stop();
    }
  });

  it('defers a due base refresh for an admitted round before reconciliation navigates to build', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
      allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, child)).resolves.toMatchObject({ kind: 'admitted' });
    expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { roundId, host: child } });
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    const consumed: string[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });

    await expect(runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      baseRefreshDue: true,
      consumeRekick: async () => { consumed.push('consume'); },
      events,
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'navigate-leaf-to-build', roundId: 'r1', host: 1 });

    expect(refusals).toHaveLength(1);
    expect(refusals).toEqual([expect.objectContaining({ type: 'restack_refused', reason: 'deferred-base-refresh' })]);
    expect(consumed).toEqual([]);
  });

  it('escalates repeated routing stalls across their loop halts and resets after routed progress', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    const stalled = {
      kind: 'stalled' as const,
      detail: 'test reconciliation stall',
      rounds: [{ roundId, readable: true as const, unsettledHosts: { [child]: 'pending' as const } }],
    };
    const options = {
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
      reconcileRounds: async () => stalled,
      hasMatchingResumeAuthorization: async () => true,
    };

    persister.start();
    try {
      const refsBefore = await refNames(subject.repo);
      const pipelineBefore = (await readdir(join(subject.repo, '.pipeline'))).sort();
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });
      const firstHalt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
      expect(firstHalt.split('\n', 1)[0]).toBe('routing rounds stalled: r1 (1: pending); test reconciliation stall');
      await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
      expect(await refNames(subject.repo)).toBe(refsBefore);
      expect((await readdir(join(subject.repo, '.pipeline'))).filter((name) => !pipelineBefore.includes(name)).sort())
        .toEqual(['HALT', 'HALT.class', 'events.jsonl']);
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted' });
      await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');

      const escalated = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; attempt?: number });
      expect(escalated.map((event) => event.type)).toEqual([
        'routing_rounds_stalled', 'loop_halt',
        'routing_rounds_stalled', 'loop_halt',
        'routing_rounds_stalled', 'loop_halt',
      ]);
      expect(escalated.filter((event) => event.type === 'routing_rounds_stalled').map((event) => event.attempt)).toEqual([1, 2, 3]);
      const thirdHalt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
      expect(thirdHalt.split('\n', 1)[0]).toBe('routing rounds stalled: r1 (1: pending); test reconciliation stall');
      expect(escalated.filter((event) => event.type === 'loop_halt').map((event) => (event as { reason?: string }).reason))
        .toEqual([firstHalt.trim(), firstHalt.trim(), thirdHalt.trim()]);

      await events.emit({
        type: 'routed_repair_phase', eventId: 'progress', occurredAt: '2026-10-28T00:00:00.000Z',
        roundId, host: child, phase: 'repairing', credit: true, child,
      });
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });

      const attempts = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; attempt?: number })
        .filter((event) => event.type === 'routing_rounds_stalled').map((event) => event.attempt);
      expect(attempts).toEqual([1, 2, 3, 1]);
    } finally {
      persister.stop();
    }
  });

  it('escalates to needs-human when the routing-stall attempt cannot be persisted', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events, undefined, {
      appendFile: () => { throw new Error('injected routing-stall persistence failure'); },
    });
    const stalled = {
      kind: 'stalled' as const,
      detail: 'test reconciliation stall',
      rounds: [{ roundId, readable: true as const, unsettledHosts: { [child]: 'pending' as const } }],
    };

    persister.start();
    try {
      await expect(runStackPreflight({
        worktree: subject.repo,
        slug: 'demo',
        events,
        git: makeGitRunner(subject.repo),
        reconcileRounds: async () => stalled,
        hasMatchingResumeAuthorization: async () => true,
      })).resolves.toMatchObject({ kind: 'halted' });

      await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
      await expect(readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      persister.stop();
    }
  });

  it('counts only consecutive identical routing stalls', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundA = parseRoundId('r1')!;
    const roundB = parseRoundId('r2')!;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    let roundId = roundA;
    const options = {
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
      reconcileRounds: async () => ({
        kind: 'stalled' as const,
        detail: 'test reconciliation stall',
        rounds: [{ roundId, readable: true as const, unsettledHosts: { [child]: 'pending' as const } }],
      }),
      hasMatchingResumeAuthorization: async () => true,
    };

    persister.start();
    try {
      // Different consecutive round sets never inherit one another's retry
      // count: A, B, A are each their first observed occurrence.
      await runStackPreflight(options);
      roundId = roundB;
      await runStackPreflight(options);
      roundId = roundA;
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });

      // The next A is the second consecutive identical stall; the live-HALT
      // run below is therefore the third, escalating occurrence.
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });

      const retained = 'an earlier durable halt must not be replaced\n';
      await writeFile(join(subject.repo, '.pipeline', 'HALT'), retained);
      await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human');
      await expect(runStackPreflight({
        ...options,
        // Let the inner routing path observe the third stall, but keep the
        // wrapper from treating the pre-existing HALT as an authorized resume.
        hasLiveHalt: async () => false,
        hasMatchingResumeAuthorization: async () => false,
      })).resolves.toMatchObject({ kind: 'halted' });
      await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(retained);

      const attempts = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; attempt?: number })
        .filter((event) => event.type === 'routing_rounds_stalled').map((event) => event.attempt);
      expect(attempts).toEqual([1, 1, 1, 2, 3]);
    } finally {
      persister.stop();
    }
  });

  it('returns repaired after a terminal resume-exit leaf return and never restacks its pre-exit cursor', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const continuation = vi.fn(async () => ({ kind: 'continued' as const, next: { kind: 'leaf-returned' as const, roundId } }));
    const terminalRoutingState = vi.fn(async () => false);
    let reconciliations = 0;

    await expect(runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      git: makeGitRunner(subject.repo),
      reconcileRounds: async () => {
        reconciliations += 1;
        return reconciliations === 1
          ? { kind: 'resume-exit' as const, roundId, host: child }
          : { kind: 'leaf-returned' as const, roundId };
      },
      exitRoutedHostAndReconcile: continuation,
      routedRoundOpen: terminalRoutingState,
    })).resolves.toEqual({ kind: 'repaired' });

    expect(continuation).toHaveBeenCalledWith(expect.objectContaining({
      roundId,
      host: child,
      skipBuiltCompareAndSwap: true,
      persist: expect.any(Function),
    }));
    expect(terminalRoutingState).toHaveBeenCalledOnce();
    expect(runRestack).not.toHaveBeenCalled();
  });

  it('distinguishes unreadable stalls from readable rounds with no unsettled hosts', async () => {
    const subject = await fixture();
    const roundId = parseRoundId('r1')!;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    let rounds: readonly ({ readonly roundId: typeof roundId; readonly readable: false } | { readonly roundId: typeof roundId; readonly readable: true; readonly unsettledHosts: Readonly<Record<number, never>> })[] = [
      { roundId, readable: false },
    ];
    const options = {
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
      reconcileRounds: async () => ({ kind: 'stalled' as const, detail: 'test reconciliation stall', rounds }),
      hasMatchingResumeAuthorization: async () => true,
    };

    persister.start();
    try {
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining('r1 (unreadable)') });
      rounds = [{ roundId, readable: true, unsettledHosts: {} }];
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining('r1 ()') });

      const stalls = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; attempt?: number; detail?: string })
        .filter((event) => event.type === 'routing_rounds_stalled');
      expect(stalls.map((event) => event.attempt)).toEqual([1, 1]);
      expect(stalls.map((event) => event.detail)).toEqual([
        expect.stringContaining('r1 (unreadable)'),
        expect.stringContaining('r1 ()'),
      ]);
    } finally {
      persister.stop();
    }
  });

  it('makes resumed-exit admission and unreadable-record refusals durable mechanical stalls without moving routing refs', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const refsBefore = await refNames(subject.repo);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      for (const next of [
        { detail: 'routing round r1 could not admit host 1', rounds: [{ roundId, readable: true as const, unsettledHosts: { [child]: 'pending' as const } }] },
        { detail: 'routing round r1 is unreadable', rounds: [{ roundId, readable: false as const }] },
        { detail: 'routing rounds r1 and r2 include unreadable r2', rounds: [
          { roundId, readable: true as const, unsettledHosts: { [child]: 'pending' as const } },
          { roundId: parseRoundId('r2')!, readable: false as const },
        ] },
      ]) {
        await rm(join(subject.repo, '.pipeline', 'HALT'), { force: true });
        await rm(join(subject.repo, '.pipeline', 'HALT.class'), { force: true });
        await expect(runStackPreflight({
          worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo),
          reconcileRounds: async () => ({ kind: 'resume-exit', roundId, host: child }),
          exitRoutedHostAndReconcile: async () => ({ kind: 'continued', next: { kind: 'stalled', ...next } }),
        })).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });
        await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(next.detail);
        await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
        expect(await refNames(subject.repo)).toBe(refsBefore);
      }
    } finally {
      persister.stop();
    }
  });

  // Covers: task:8, task:rem-prd-audit-rem-prd-S1.8
  it('does not admit an earlier pending round when an applied exit cannot reread its restacked route record', async () => {
    const subject = await fixture();
    const exitedHost = parseChildId(1)!;
    const pendingHost = parseChildId(2)!;
    const earlierRoundId = parseRoundId('r3')!;
    const unreadableRoundId = parseRoundId('r4')!;
    const earlier = await createRouteRecord(subject.repo, 'demo', {
      roundId: earlierRoundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [],
      allocation: {
        [exitedHost]: { remTaskIds: [], blockBodies: [] },
        [pendingHost]: { remTaskIds: [], blockBodies: [] },
      },
    });
    const exiting = await createRouteRecord(subject.repo, 'demo', {
      roundId: unreadableRoundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [],
      allocation: { [exitedHost]: { remTaskIds: [], blockBodies: [] } },
    });
    if (earlier.kind !== 'created' || exiting.kind !== 'created') throw new Error('route creation failed');
    await subject.git(['update-ref', routeRecordRefFor('demo', earlierRoundId), await writeGitBlob(subject, JSON.stringify({
      ...earlier.record, phase: 'open', hosts: { [exitedHost]: 'restacked', [pendingHost]: 'pending' },
    }))]);
    await subject.git(['update-ref', routeRecordRefFor('demo', unreadableRoundId), await writeGitBlob(subject, JSON.stringify({
      ...exiting.record, phase: 'open', hosts: { [exitedHost]: 'built' },
    }))]);
    await subject.git(['update-ref', repairMarkerRefFor('demo'), await writeGitBlob(subject, JSON.stringify({ host: exitedHost, roundId: unreadableRoundId }))]);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runStackPreflight({
        worktree: subject.repo,
        slug: 'demo',
        events,
        git: makeGitRunner(subject.repo),
        // Simulate an applied restack that removed the marker before its r4
        // record became unreadable. Initial reconciliation remains real.
        exitRoutedHostAndReconcile: async () => {
          await subject.git(['update-ref', routeRecordRefFor('demo', unreadableRoundId), await writeGitBlob(subject, '{not-json')]);
          await subject.git(['update-ref', '-d', repairMarkerRefFor('demo')]);
          return { kind: 'exit-halted' as const, detail: `routed exit host ${exitedHost}: cannot reread restacked route record`, unreadableRoundId };
        },
      })).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });

      const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
      expect(halt.split('\n', 1)[0]).toContain('r3 (2: pending); r4 (unreadable)');
      await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
      expect(await readRepairMarker(subject.repo, 'demo')).toEqual({ kind: 'absent' });
      await expect(readRouteRecord(subject.repo, 'demo', earlierRoundId)).resolves.toMatchObject({
        kind: 'record', record: { hosts: { [exitedHost]: 'restacked', [pendingHost]: 'pending' } },
      });
    } finally {
      persister.stop();
    }
  });

  // Covers: task:6, task:rem-prd-audit-rem-prd-S1.9
  it('does not restack through the pre-exit cursor when a later open round makes the deferred queue fence busy', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const leaf = parseChildId(2)!;
    const firstRoundId = parseRoundId('r1')!;
    const secondRoundId = parseRoundId('r2')!;
    const first = await createRouteRecord(subject.repo, 'demo', {
      roundId: firstRoundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [{ findingId: 'pending', kind: 'audit', owner: leaf, host: leaf, reason: 'task-slice', fallback: [] }],
      allocation: {
        [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] },
        [leaf]: { remTaskIds: ['rem-prd-audit-T2'], blockBodies: ['### Task rem-prd-audit-T2\n'] },
      },
    });
    const second = await createRouteRecord(subject.repo, 'demo', {
      roundId: secondRoundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [{ findingId: 'later-pending', kind: 'audit', owner: leaf, host: leaf, reason: 'task-slice', fallback: [] }],
      allocation: {
        [child]: { remTaskIds: ['rem-prd-audit-T3'], blockBodies: ['### Task rem-prd-audit-T3\n'] },
        [leaf]: { remTaskIds: ['rem-prd-audit-T4'], blockBodies: ['### Task rem-prd-audit-T4\n'] },
      },
    });
    if (first.kind !== 'created' || second.kind !== 'created') throw new Error('route creation failed');
    for (const record of [first.record, second.record]) {
      const open = { ...record, phase: 'open' as const, hosts: { [child]: 'restacked' as const, [leaf]: 'pending' as const }, outbox: [] };
      const blob = await writeGitBlob(subject, JSON.stringify(open));
      await subject.git(['update-ref', routeRecordRefFor('demo', record.roundId), blob]);
    }
    const closureSha = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const queueBlob = await writeGitBlob(subject, JSON.stringify({
      generation: 1,
      entries: [{ child, position: child, closureSha, gates: ['test_suite'], replay: { oldParent: closureSha, newParent: closureSha }, state: 'queued' }],
      outbox: [],
    }));
    await subject.git(['update-ref', revalidationQueueRefFor('demo'), queueBlob]);
    vi.mocked(reconcileReceiptLedger).mockResolvedValueOnce();
    vi.mocked(drainRoutingOutboxes).mockResolvedValueOnce({ kind: 'drained' });
    vi.mocked(consumeLowestQueued).mockResolvedValueOnce({ kind: 'busy', detail: `routing round ${secondRoundId} has a pending host` });

    await expect(runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      git: makeGitRunner(subject.repo),
      reconcileRounds: async () => ({ kind: 'deferred' as const }),
    })).resolves.toMatchObject({ kind: 'unavailable', detail: expect.stringContaining('busy') });

    expect(runRestack).not.toHaveBeenCalled();
    await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
    await expect(refNames(subject.repo)).resolves.toContain(routeRecordRefFor('demo', secondRoundId));
    await expect(readFile(join(subject.repo, '.git', 'HEAD'), 'utf8')).resolves.toContain('ref: refs/heads/feat/daemon-demo');
  });

});
