// Covers: task:7, task:8, task:9, task:10, task:11, task:12, task:13, task:14, task:18
import { afterEach, describe, expect, it, vi } from 'vitest';

import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { parseChildId } from '../../../src/engine/child-context.js';
import { resolveActiveChild } from '../../../src/engine/child-cursor.js';
import { checkStepCompletion } from '../../../src/engine/artifacts.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { cascadesRefFor } from '../../../src/engine/restack/cascade-cap.js';
import { RESTACK_CASCADE_TIER_DEFAULTS } from '../../../src/engine/restack/cascade-allowance.js';
import { journalRefFor } from '../../../src/engine/restack/restack-journal.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { readRevalidationQueue, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { exitRoutedHostAndReconcile } from '../../../src/engine/routing/round-admission.js';
import { routedRepairPhaseEvent } from '../../../src/engine/routing/routing-events.js';
vi.mock('../../../src/engine/routing/routed-exit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/routed-exit.js')>();
  return { ...actual, requestRoutedExit: vi.fn(actual.requestRoutedExit) };
});

import { requestRoutedExit } from '../../../src/engine/routing/routed-exit.js';
import { advanceRound } from '../../../src/engine/routing/routed-exit.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { closureRefFor, repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { writePublicationRecord } from '../../../src/engine/stack-publication-record.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from '../restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const childTwo = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const execFile = promisify(execFileCallback);

afterEach(async () => {
  vi.mocked(requestRoutedExit).mockClear();
  await removeAll(cleanup);
});

async function blob(git: ReturnType<typeof makeGitRunner>, value: unknown): Promise<string> {
  const result = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) });
  if (result.exitCode !== 0) throw new Error('cannot write fixture blob');
  return result.stdout.trim();
}

async function fixture(withRepair: boolean): Promise<SweepRepository & { readonly gitRunner: ReturnType<typeof makeGitRunner>; readonly repair?: string }> {
  const subject = await createSweepRepository('routed-exit-', cleanup);
  await subject.write('.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await subject.git(['add', '.ai-conductor/config.yml']);
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

function recordingRunner(git: GitRunner): { readonly git: GitRunner; readonly calls: Array<{ readonly args: string[]; readonly input?: string }> } {
  const calls: Array<{ args: string[]; input?: string }> = [];
  return {
    calls,
    git: async (args, options) => {
      calls.push({ args: [...args], ...(options?.input === undefined ? {} : { input: options.input }) });
      return git(args, options);
    },
  };
}

function updateTransactions(calls: readonly { readonly args: string[]; readonly input?: string }[]): string[] {
  return calls.filter((call) => call.args[0] === 'update-ref' && call.args[1] === '--stdin').map((call) => call.input ?? '');
}

async function createdJournal(subject: SweepRepository & { readonly gitRunner: ReturnType<typeof makeGitRunner> }, calls: readonly { readonly args: string[]; readonly input?: string }[]): Promise<Record<string, unknown>> {
  const create = updateTransactions(calls).flatMap((input) => [...input.matchAll(new RegExp(`(?:create|update) ${journalRefFor('demo')} ([0-9a-f]{40})`, 'g'))])[0];
  if (create === undefined) throw new Error('expected a journal creation transaction');
  const payload = await subject.gitRunner(['cat-file', '-p', create[1]!]);
  return JSON.parse(payload.stdout) as Record<string, unknown>;
}

async function replaceRoute(subject: SweepRepository & { readonly gitRunner: ReturnType<typeof makeGitRunner> }, change: (record: RouteRecord) => RouteRecord): Promise<void> {
  const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
  if (stored.kind !== 'record') throw new Error('fixture route is missing');
  await subject.gitRunner(['update-ref', routeRecordRefFor('demo', roundId), await blob(subject.gitRunner, change(stored.record)), stored.blob]);
}

async function declareCarryingOperatorRound(
  subject: SweepRepository & { readonly gitRunner: ReturnType<typeof makeGitRunner> },
  carriedTip: string,
): Promise<void> {
  const hostTip = (await subject.gitRunner(['rev-parse', 'feat/c1/demo'])).stdout.trim() as never;
  const leafTip = (await subject.gitRunner(['rev-parse', 'feat/daemon-demo'])).stdout.trim() as never;
  await replaceRoute(subject, (record) => ({
    ...record,
    kind: 'operator',
    operator: {
      origin: 'land', reason: 'carry reviewer edit', operator: 'operator@example.test', entryStep: 'acceptance_specs',
      carried: [{ child: childTwo, tip: carriedTip as never }],
      otherTips: { 'feat/c2/demo': carriedTip as never, 'feat/daemon-demo': leafTip },
      priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
      declaration: { tip: hostTip, at: '2026-10-26T00:00:00.000Z' },
    },
  }));
}

function addOutbox(record: RouteRecord): RouteRecord {
  const event = routedRepairPhaseEvent(roundId, host, 'built', false);
  return { ...record, outbox: [...record.outbox, { eventId: event.eventId, occurredAt: event.occurredAt, event }] };
}

describe('routed exit (real local Git)', () => {
  // Covers: task:4
  it('drains routing outboxes before reconciling a restacked exit', async () => {
    const subject = await fixture(false);
    await replaceRoute(subject, (record) => ({
      ...addOutbox(record),
      hosts: { [host]: 'restacked', [childTwo]: 'pending' },
    }));
    const order: string[] = [];
    const exit = vi.fn(async () => {
      order.push('exit');
      await subject.gitRunner(['update-ref', '-d', repairMarkerRefFor('demo')]);
      return { kind: 'restacked' as const };
    });
    const persist = vi.fn(async () => {
      order.push('persist');
      return 'persisted' as const;
    });
    const recorded = recordingRunner(subject.gitRunner);
    const git: GitRunner = async (args, options) => {
      const result = await recorded.git(args, options);
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(repairMarkerRefFor('demo'))) order.push('reconcile');
      return result;
    };

    await expect(exitRoutedHostAndReconcile({
      worktree: subject.repo, slug: 'demo', roundId, host, exit, persist, git,
    })).resolves.toEqual({ kind: 'continued', next: { kind: 'navigate-host', roundId, host: childTwo } });

    expect(order).toEqual(['exit', 'persist', 'reconcile']);
    expect(exit).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  // Covers: task:4
  it.each(['refused', 'rolled-back'] as const)('preserves routed state when the exit is %s', async (outcome) => {
    const subject = await fixture(true);
    await replaceRoute(subject, (record) => ({ ...record, hosts: { ...record.hosts, [host]: 'built', [childTwo]: 'pending' } }));
    const before = (await subject.gitRunner(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout;
    const marker = (await subject.gitRunner(['rev-parse', repairMarkerRefFor('demo')])).stdout.trim();
    const exit = vi.fn(async () => ({ kind: 'halted' as const, detail: `${outcome} exit` }));

    await expect(exitRoutedHostAndReconcile({
      worktree: subject.repo, slug: 'demo', roundId, host, exit, git: subject.gitRunner,
    })).resolves.toEqual({ kind: 'exit-halted', detail: `${outcome} exit` });

    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'built', 2: 'pending' } },
    });
    await expect(subject.gitRunner(['rev-parse', repairMarkerRefFor('demo')])).resolves.toMatchObject({ stdout: marker });
    await expect(subject.gitRunner(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).resolves.toMatchObject({ stdout: before });
  });

  // Covers: task:4
  it.each(['no-commit-done', 'noop'] as const)('reconciles after a %s exit', async (kind) => {
    const subject = await fixture(false);
    await replaceRoute(subject, (record) => ({
      ...record,
      hosts: { [host]: 'done', [childTwo]: 'pending' },
    }));
    await subject.gitRunner(['update-ref', '-d', repairMarkerRefFor('demo')]);
    const exit = vi.fn(async () => ({ kind }));

    await expect(exitRoutedHostAndReconcile({
      worktree: subject.repo, slug: 'demo', roundId, host, exit, persist: async () => 'persisted', git: subject.gitRunner,
    })).resolves.toEqual({ kind: 'continued', next: { kind: 'navigate-host', roundId, host: childTwo } });

    expect(exit).toHaveBeenCalledOnce();
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-rem-vg6-s6-1
  it('distinguishes a final leaf return from a close that yields to an open round or queue', async () => {
    const leafReturn = await fixture(false);
    await writeFile(join(leafReturn.repo, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'demo' }));
    await expect(requestRoutedExit({ worktree: leafReturn.repo, slug: 'demo', roundId, host, git: leafReturn.gitRunner }))
      .resolves.toEqual({ kind: 'no-commit-done' });
    const settled = await readRouteRecord(leafReturn.repo, 'demo', roundId, { git: leafReturn.gitRunner });
    if (settled.kind !== 'record') throw new Error('missing settled route');
    await expect(advanceRound(leafReturn.repo, 'demo', settled, { git: leafReturn.gitRunner }))
      .resolves.toEqual({ kind: 'leaf-returned' });

    const otherOpen = await fixture(false);
    await expect(requestRoutedExit({ worktree: otherOpen.repo, slug: 'demo', roundId, host, git: otherOpen.gitRunner }))
      .resolves.toEqual({ kind: 'no-commit-done' });
    const first = await readRouteRecord(otherOpen.repo, 'demo', roundId, { git: otherOpen.gitRunner });
    if (first.kind !== 'record') throw new Error('missing first route');
    const secondRound = parseRoundId('r2')!;
    const second: RouteRecord = { ...first.record, roundId: secondRound, phase: 'open' };
    await otherOpen.gitRunner(['update-ref', routeRecordRefFor('demo', secondRound), await blob(otherOpen.gitRunner, second)]);
    await expect(advanceRound(otherOpen.repo, 'demo', first, { git: otherOpen.gitRunner }))
      .resolves.toEqual({ kind: 'closed' });

    const queued = await fixture(false);
    const queuedRoute = await readRouteRecord(queued.repo, 'demo', roundId, { git: queued.gitRunner });
    if (queuedRoute.kind !== 'record') throw new Error('missing queued route');
    const waitingForLeaf: typeof queuedRoute = {
      ...queuedRoute,
      record: {
        ...queuedRoute.record,
        hosts: { [host]: 'done', [parseChildId(3)!]: 'pending' },
      },
    };
    await expect(advanceRound(queued.repo, 'demo', waitingForLeaf, {
      git: queued.gitRunner,
      queue: { entries: [{}] as never },
    })).resolves.toEqual({ kind: 'queue' });
  });

  it('admits the next child host without carrying the settled host entry baseline', async () => {
    const subject = await fixture(false);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.gitRunner }))
      .resolves.toEqual({ kind: 'no-commit-done' });
    const settled = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    if (settled.kind !== 'record') throw new Error('missing settled route');
    expect(settled.record.entry?.host).toBe(host);
    const twoHosts: typeof settled = {
      ...settled,
      record: { ...settled.record, hosts: { ...settled.record.hosts, [childTwo]: 'pending' } },
    };

    await expect(advanceRound(subject.repo, 'demo', twoHosts, { git: subject.gitRunner }))
      .resolves.toEqual({ kind: 'admitted', host: childTwo });
    const advanced = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    if (advanced.kind !== 'record') throw new Error('missing advanced route');
    expect(advanced.record.hosts[childTwo]).toBe('admitted');
    expect(advanced.record.currentHostIndex).toBe(1);
    expect(advanced.record.entry).toBeUndefined();
    expect(await refExists(subject.gitRunner, repairMarkerRefFor('demo'))).toBe(true);
  });

  it('marks a repaired host built, drains its outbox, and carries the fix through one routed restack', async () => {
    const subject = await fixture(true);
    const persisted: string[] = [];
    const recorded = recordingRunner(subject.gitRunner);
    await expect(requestRoutedExit({
      worktree: subject.repo, slug: 'demo', roundId, host,
      persist: async (event) => { persisted.push(event.type); return 'persisted'; },
      git: recorded.git,
    })).resolves.toEqual({ kind: 'restacked' });

    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    expect({
      host: route.kind === 'record' ? route.record.hosts[host] : undefined,
      marker: await refExists(subject.gitRunner, repairMarkerRefFor('demo')),
      journal: await refExists(subject.gitRunner, journalRefFor('demo')),
      closure: (await subject.gitRunner(['rev-parse', closureRefFor('demo', host)])).stdout.trim(),
      repair: subject.repair,
      outboxEvents: persisted,
    }).toEqual({ host: 'restacked', marker: false, journal: false, closure: subject.repair, repair: subject.repair, outboxEvents: ['routed_repair_phase', 'routed_repair_phase'] });
    await expect(subject.gitRunner(['merge-base', '--is-ancestor', subject.repair!, 'feat/c2/demo'])).resolves.toMatchObject({ exitCode: 0 });
    await expect(subject.gitRunner(['merge-base', '--is-ancestor', subject.repair!, 'feat/daemon-demo'])).resolves.toMatchObject({ exitCode: 0 });
    const journal = await createdJournal(subject, recorded.calls);
    expect({ cause: journal.cause, routed: journal.routed, origins: journal.originatingChildren }).toEqual({
      cause: 'feature-repair', routed: expect.objectContaining({ roundId: 'r1', host: 1 }), origins: [1],
    });
  });

  it('drains an existing route outbox before it creates the routed restack journal', async () => {
    const subject = await fixture(true);
    await replaceRoute(subject, addOutbox);
    const recorded = recordingRunner(subject.gitRunner);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: recorded.git })).resolves.toEqual({ kind: 'restacked' });
    const transactions = updateTransactions(recorded.calls);
    const outbox = await (async () => {
      for (let index = 0; index < transactions.length; index += 1) {
        const match = new RegExp(`update ${routeRecordRefFor('demo', roundId)} ([0-9a-f]{40})`).exec(transactions[index]!);
        if (match === null) continue;
        const record = JSON.parse((await subject.gitRunner(['cat-file', '-p', match[1]!])).stdout) as RouteRecord;
        if (record.outbox.length === 0) return index;
      }
      return -1;
    })();
    const journal = transactions.findIndex((input) => new RegExp(`(?:create|update) ${journalRefFor('demo')}`).test(input));
    expect(outbox).toBeGreaterThanOrEqual(0);
    expect(journal).toBeGreaterThan(outbox);
  });

  it('leaves the built host and avoids a journal when durable outbox persistence fails', async () => {
    const subject = await fixture(true);
    await replaceRoute(subject, addOutbox);
    await expect(requestRoutedExit({
      worktree: subject.repo, slug: 'demo', roundId, host,
      persist: async () => { throw new Error('persister unavailable'); },
    })).resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining('outbox') });
    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    expect(route).toMatchObject({ kind: 'record', record: { hosts: { 1: 'built' } } });
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
  });

  it('persists only feature-repair restack applications and one restacked routed phase', async () => {
    const subject = await fixture(true);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, events })).resolves.toEqual({ kind: 'restacked' });
    persister.stop();
    const records = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.filter((event) => event.type === 'restack_applied').every((event) => event.cause === 'feature-repair')).toBe(true);
    expect(records.filter((event) => event.type === 'routed_repair_phase' && event.host === 1 && event.phase === 'restacked')).toHaveLength(1);
  });

  it('resumes a built routed host once through stack preflight without creating a second journal', async () => {
    const subject = await fixture(true);
    await expect(requestRoutedExit({
      worktree: subject.repo, slug: 'demo', roundId, host,
      persist: async () => { throw new Error('crash after built'); },
    })).resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining('outbox') });
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: subject.gitRunner }))
      .resolves.toEqual({ kind: 'navigate-host', roundId: parseRoundId('r2')!, host: childTwo });
    const afterFirst = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    expect(afterFirst).toMatchObject({ kind: 'record', record: { hosts: { 1: 'restacked' } } });
    const recorded = recordingRunner(subject.gitRunner);
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: recorded.git })).resolves.toMatchObject({ kind: expect.any(String) });
    expect(updateTransactions(recorded.calls).some((input) => new RegExp(`(?:create|update) ${journalRefFor('demo')}`).test(input))).toBe(false);
  });

  it('rolls a failed exit verification back without settling routing refs, then blocks preflight before another exit', async () => {
    const subject = await fixture(true);
    await replaceRoute(subject, (record) => ({ ...record, hosts: { ...record.hosts, [host]: 'built' } }));
    const before = await Promise.all([
      subject.gitRunner(['rev-parse', repairMarkerRefFor('demo')]),
      subject.gitRunner(['rev-parse', routeRecordRefFor('demo', roundId)]),
      subject.gitRunner(['rev-parse', closureRefFor('demo', host)]),
    ]);
    const real = subject.gitRunner;
    let corrupted = false;
    const corruptingGit: GitRunner = async (args, options) => {
      const result = await real(args, options);
      if (!corrupted && result.exitCode === 0 && args[0] === 'update-ref' && args[1] === '--stdin'
        && options?.input?.includes('update refs/heads/feat/c1/demo ')) {
        corrupted = true;
        await real(['update-ref', 'refs/conductor/demo/restack/staging/c2', before[2]!.stdout.trim()]);
      }
      return result;
    };

    await expect(requestRoutedExit({
      worktree: subject.repo, slug: 'demo', roundId, host, git: corruptingGit,
    })).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('tree mismatch for child 2'),
    });

    expect(corrupted).toBe(true);
    await expect(Promise.all([
      subject.gitRunner(['rev-parse', repairMarkerRefFor('demo')]),
      subject.gitRunner(['rev-parse', routeRecordRefFor('demo', roundId)]),
      subject.gitRunner(['rev-parse', closureRefFor('demo', host)]),
    ]).then((refs) => refs.map((ref) => ref.stdout.trim()))).resolves.toEqual(before.map((ref) => ref.stdout.trim()));
    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'built' } },
    });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('tree mismatch for child 2');

    vi.mocked(requestRoutedExit).mockClear();
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: subject.gitRunner })).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('live HALT without resume authorization'),
    });
    expect(requestRoutedExit).not.toHaveBeenCalled();
  });

  it.each(['exit', 'preflight resume'] as const)('hands a routed replay conflict to the supplied resolver (%s)', async (entry) => {
    const subject = await fixture(true);
    // The routed fix creates the file child 2 adds, so replaying child 2 conflicts.
    await subject.commit('routed fix touching child 2', 'two.txt', 'routed\n');
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'test resolver declined' }));
    let result;
    if (entry === 'exit') {
      result = await requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.gitRunner, resolver, resolverCap: 1 });
    } else {
      await replaceRoute(subject, (record) => ({ ...record, hosts: { ...record.hosts, [host]: 'built' } }));
      result = await runStackPreflight({ worktree: subject.repo, slug: 'demo', git: subject.gitRunner, resolver, resolverCap: 1 });
    }

    expect(resolver).toHaveBeenCalled();
    expect(result).toMatchObject({ kind: 'halted', detail: expect.stringContaining('test resolver declined') });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/restack conflict child 2[\s\S]*test resolver declined/);
  });

  it('applies a routed restack when the supplied resolver reconciles child 2', async () => {
    const subject = await fixture(true);
    await subject.commit('routed fix touching child 2', 'two.txt', 'routed\n');

    await expect(requestRoutedExit({
      worktree: subject.repo,
      slug: 'demo',
      roundId,
      host,
      git: subject.gitRunner,
      resolver: async ({ projectRoot, environment }) => {
        await writeFile(join(projectRoot, 'two.txt'), 'two\nrouted\n');
        await execFile('git', ['add', 'two.txt'], { cwd: projectRoot, env: { ...process.env, ...environment } });
        await execFile('git', ['rebase', '--continue'], { cwd: projectRoot, env: { ...process.env, ...environment } });
        return { resolved: true };
      },
      resolverCap: 1,
    })).resolves.toEqual({ kind: 'restacked' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a provider setup exhaustion from the routed resolver', async () => {
    const subject = await fixture(true);
    await subject.commit('routed fix touching child 2', 'two.txt', 'routed\n');
    const refs = ['refs/heads/feat/c2/demo', closureRefFor('demo', childTwo)];
    const before = await Promise.all(refs.map(async (ref) => (await subject.gitRunner(['rev-parse', ref])).stdout.trim()));

    await expect(requestRoutedExit({
      worktree: subject.repo,
      slug: 'demo',
      roundId,
      host,
      git: subject.gitRunner,
      resolver: async () => ({
        resolved: false,
        reason: 'provider setup failed',
        providerSetupExhaustion: {
          candidates: [{
            provider: 'codex',
            reason: 'provider setup failed',
            recoveryAction: 'Restore Codex setup, then retry the routed exit.',
          }],
        },
      }),
      resolverCap: 1,
    })).resolves.toMatchObject({
      kind: 'halted',
      detail: expect.stringContaining('every configured provider is unavailable during setup'),
    });

    const after = await Promise.all(refs.map(async (ref) => (await subject.gitRunner(['rev-parse', ref])).stdout.trim()));
    expect(after).toEqual(before);
  });

  it('takes the one-transaction no-commit exit only at the exact closure tip', async () => {
    const subject = await fixture(false);
    const recorded = recordingRunner(subject.gitRunner);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: recorded.git })).resolves.toEqual({ kind: 'no-commit-done' });
    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    expect({
      host: route.kind === 'record' ? route.record.hosts[host] : undefined,
      marker: await refExists(subject.gitRunner, repairMarkerRefFor('demo')),
      journal: await refExists(subject.gitRunner, journalRefFor('demo')),
    }).toEqual({ host: 'done', marker: false, journal: false });
    const writes = updateTransactions(recorded.calls);
    const exitWrites = writes.filter((input) => input.includes(routeRecordRefFor('demo', roundId)) && input.includes(repairMarkerRefFor('demo')));
    expect(exitWrites).toHaveLength(1);
    expect(exitWrites[0]).toContain(`delete ${repairMarkerRefFor('demo')}`);
    expect(exitWrites[0]).not.toContain('"built"');
    expect(writes.join('\n')).not.toMatch(new RegExp(`(?:create|update) ${journalRefFor('demo')}`));
  });

  it('takes the no-commit exit for a taskless routed manual-test failure, then refuses the unchanged leaf PASS and halts the no-op cycle', async () => {
    const subject = await fixture(false);
    await replaceRoute(subject, (record) => ({
      ...record,
      items: [{ ...record.items[0]!, findingId: 'manual-test-fail', reason: 'manual-test' }],
      allocation: { [host]: { remTaskIds: [], blockBodies: [], retryHint: '| s1 | FAIL |' } },
      receipt: { ...record.receipt, taskless: { manual_test: 1 } },
    }));

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.gitRunner }))
      .resolves.toEqual({ kind: 'no-commit-done' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'done' }, receipt: { taskless: { manual_test: 1 } } },
    });
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);

    const head = (await subject.gitRunner(['rev-parse', 'HEAD'])).stdout.trim();
    const context = { getHeadSha: async () => head, sessionStartedAt: Date.now() - 1_000 };
    await writeFile(join(subject.repo, '.pipeline', 'manual-test-results.md'), '| Story | Result |\n|---|---|\n| s1 | FAIL |\n');
    await expect(checkStepCompletion(subject.repo, 'manual_test', context)).resolves.toMatchObject({
      done: false, reason: expect.stringContaining('contains FAIL rows'),
    });
    await writeFile(join(subject.repo, '.pipeline', 'manual-test-results.md'), '| Story | Result |\n|---|---|\n| s1 | PASS |\n');
    await expect(checkStepCompletion(subject.repo, 'manual_test', context)).resolves.toMatchObject({
      done: false, reason: expect.stringContaining('whitewash guard'),
    });
    // The auto-mode loop that converts this refused verdict into the durable
    // no-op halt is covered by manual-test-auto-mode-marker-record.acceptance.
  });

  it('restacks an empty metadata commit instead of treating its matching tree as a no-commit exit', async () => {
    const subject = await fixture(false);
    await subject.gitRunner(['commit', '--allow-empty', '-qm', 'metadata only']);
    const recorded = recordingRunner(subject.gitRunner);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: recorded.git })).resolves.toEqual({ kind: 'restacked' });
    const routeBlobs = updateTransactions(recorded.calls).flatMap((input) => [...input.matchAll(new RegExp(`update ${routeRecordRefFor('demo', roundId)} ([0-9a-f]{40})`, 'g'))]).map((match) => match[1]!);
    const routeStates = await Promise.all(routeBlobs.map(async (sha) => JSON.parse((await subject.gitRunner(['cat-file', '-p', sha])).stdout) as RouteRecord));
    expect(routeStates.some((record) => record.hosts[host] === 'built')).toBe(true);
    const journal = await createdJournal(subject, recorded.calls);
    expect(journal.cause).toBe('feature-repair');
  });

  it('refuses the no-commit transaction when its marker compare-and-swap is stale', async () => {
    const subject = await fixture(false);
    const recorded = recordingRunner(subject.gitRunner);
    const raw = subject.gitRunner;
    let raced = false;
    const racing: GitRunner = async (args, options) => {
      if (!raced && args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(`delete ${repairMarkerRefFor('demo')}`)) {
        raced = true;
        await raw(['update-ref', repairMarkerRefFor('demo'), await blob(raw, { host: childTwo, roundId })]);
      }
      return recorded.git(args, options);
    };
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: racing })).resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining('cas-failed') });
    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    expect(route).toMatchObject({ kind: 'record', record: { hosts: { 1: 'repairing' } } });
    expect(await refExists(subject.gitRunner, repairMarkerRefFor('demo'))).toBe(true);
    expect(updateTransactions(recorded.calls).join('\n')).not.toContain('"built"');
  });

  it('is a write-free noop when the host has already been restacked', async () => {
    const subject = await fixture(true);
    await replaceRoute(subject, (record) => ({ ...record, hosts: { ...record.hosts, [host]: 'restacked' } }));
    const recorded = recordingRunner(subject.gitRunner);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: recorded.git })).resolves.toEqual({ kind: 'noop' });
    expect(updateTransactions(recorded.calls)).toEqual([]);
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
  });

  it('refuses a missing host entry baseline before either exit transaction', async () => {
    const subject = await fixture(true);
    const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    if (stored.kind !== 'record') throw new Error('fixture route is missing');
    await subject.gitRunner(['update-ref', routeRecordRefFor('demo', roundId), await blob(subject.gitRunner, {
      ...stored.record, entry: undefined,
    }), stored.blob]);
    const recorded = recordingRunner(subject.gitRunner);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: recorded.git })).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('host 1'),
    });
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
    expect(updateTransactions(recorded.calls).join('\n')).not.toMatch(/"(?:done|built)"/);
  });

  it('halts before a journal when the exit is published or has a foreign co-origin', async () => {
    const published = await fixture(true);
    await expect(writePublicationRecord(published.repo, 'demo', undefined, {
      version: 1, members: [{ position: host, branch: 'feat/c1/demo', pr: 1 }],
    }, { git: published.gitRunner })).resolves.toEqual({ kind: 'updated' });
    const publishedRefs = await Promise.all(['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo', closureRefFor('demo', host), closureRefFor('demo', childTwo)]
      .map(async (ref) => (await published.gitRunner(['rev-parse', ref])).stdout.trim()));
    await expect(requestRoutedExit({ worktree: published.repo, slug: 'demo', roundId, host })).resolves.toMatchObject({ kind: 'halted' });
    expect(await refExists(published.gitRunner, journalRefFor('demo'))).toBe(false);
    await expect(readFile(join(published.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/^restack refused \(published-stack\) child 1/);
    await expect(readFile(join(published.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(Promise.all(['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo', closureRefFor('demo', host), closureRefFor('demo', childTwo)]
      .map(async (ref) => (await published.gitRunner(['rev-parse', ref])).stdout.trim()))).resolves.toEqual(publishedRefs);
    const publishedRoute = await readRouteRecord(published.repo, 'demo', roundId, { git: published.gitRunner });
    expect(publishedRoute).toMatchObject({ kind: 'record', record: { hosts: { 1: 'repairing' } } });

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
    await expect(readFile(join(foreign.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('halts an audit exit with an uncarried unstamped child without restacking', async () => {
    const subject = await fixture(true);
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.commit('unlanded reviewer edit', 'review.txt', 'review\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const recorded = recordingRunner(subject.gitRunner);

    const cursor = await resolveActiveChild(subject.repo, 'demo', { git: subject.gitRunner });
    expect(cursor).toMatchObject({
      kind: 'repair-pending', repairChildren: [host, childTwo],
    });
    expect(cursor).not.toHaveProperty('coOrigins');
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: recorded.git }))
      .resolves.toMatchObject({ kind: 'halted', detail: expect.stringContaining('unlanded closed-child commits') });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'unlanded-closed-child-commits: child 2',
    );
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
    expect(updateTransactions(recorded.calls).some((input) => new RegExp(`(?:create|update) ${journalRefFor('demo')}`).test(input))).toBe(false);
  });

  it('charges each declared carried co-origin and queues it in the applied transaction', async () => {
    const subject = await fixture(true);
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    const carriedTip = await subject.commit('uncommitted operator repair', 'operator.txt', 'operator\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await declareCarryingOperatorRound(subject, carriedTip);
    const recorded = recordingRunner(subject.gitRunner);
    await expect(resolveActiveChild(subject.repo, 'demo', { git: subject.gitRunner })).resolves.toMatchObject({
      kind: 'repair-pending', coOrigins: [childTwo],
    });
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: recorded.git })).resolves.toEqual({ kind: 'restacked' });
    const journal = await createdJournal(subject, recorded.calls);
    expect(journal.originatingChildren).toEqual([1, 2]);
    const cascades = await subject.gitRunner(['cat-file', '-p', (await subject.gitRunner(['rev-parse', cascadesRefFor('demo')])).stdout.trim()]);
    expect(JSON.parse(cascades.stdout)).toMatchObject({ counts: { '1': 1, '2': 1 } });
    await expect(readRevalidationQueue(subject.repo, 'demo', { git: subject.gitRunner })).resolves.toMatchObject({
      kind: 'queue', queue: { entries: [expect.objectContaining({ child: childTwo })] },
    });
  });

  it('halts before planning when a routed origin set excludes its host', async () => {
    const subject = await fixture(true);
    const route = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.gitRunner });
    const marker = (await subject.gitRunner(['rev-parse', repairMarkerRefFor('demo')])).stdout.trim() as never;
    if (route.kind !== 'record') throw new Error('fixture route is missing');
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [childTwo],
      routed: { roundId, host, routeOld: route.blob, markerOld: marker }, git: subject.gitRunner,
    })).resolves.toMatchObject({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('child 1');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
  });

  it('keeps the marker and names the runbook when the routed exit reaches the cascade cap', async () => {
    const subject = await fixture(true);
    await subject.gitRunner(['update-ref', cascadesRefFor('demo'), await blob(subject.gitRunner, {
      version: 1, counts: { '1': RESTACK_CASCADE_TIER_DEFAULTS.M },
    })]);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host })).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('cascade-cap'),
    });
    expect(await refExists(subject.gitRunner, repairMarkerRefFor('demo'))).toBe(true);
    expect(await refExists(subject.gitRunner, journalRefFor('demo'))).toBe(false);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/^restack refused \(cascade-cap\) child 1[\s\S]*Routed repair halted on the cascade cap/);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

});
