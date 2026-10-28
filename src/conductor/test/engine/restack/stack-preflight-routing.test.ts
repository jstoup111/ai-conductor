// Covers: task:5, task:8, task:12, task:rem-prd-audit-W9
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile, readFile } from 'node:fs/promises';
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
import { createRouteRecord, readRepairMarker } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

vi.mock('../../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-executor.js')>();
  return { ...actual, runRestack: vi.fn(actual.runRestack) };
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

describe('stack preflight routing', () => {
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
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });
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
      await runStackPreflight(options);
      roundId = roundB;
      await runStackPreflight(options);
      roundId = roundA;
      await expect(runStackPreflight(options)).resolves.toMatchObject({ kind: 'halted', haltClass: 'mechanical' });

      const attempts = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; attempt?: number })
        .filter((event) => event.type === 'routing_rounds_stalled').map((event) => event.attempt);
      expect(attempts).toEqual([1, 1, 1]);
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
});
