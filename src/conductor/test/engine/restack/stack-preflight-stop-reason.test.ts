// Covers: task:2, task:4
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { drainRoutingOutboxes } from '../../../src/engine/routing/route-record-store.js';
import { reconcileReceiptLedger } from '../../../src/engine/routing/round-receipt.js';
import { consumeLowestQueued } from '../../../src/engine/routing/revalidation-queue.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

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
vi.mock('../../../src/engine/restack/restack-journal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-journal.js')>();
  return { ...actual, readRestackJournal: vi.fn(actual.readRestackJournal) };
});
vi.mock('../../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-executor.js')>();
  return { ...actual, runRestack: vi.fn(actual.runRestack) };
});

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-stop-reason-'));
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
  await git(['config', 'user.email', 'preflight@example.test']);
  await git(['config', 'user.name', 'Stack preflight']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n  route_whole_feature_fixes: true\n');
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
  await writeFile(join(repo, '.docs', 'stories', 'demo.md'), '# Stories: demo\n\n## Story 1: One\n\n## Story 2: Two\n');
  await writeFile(join(repo, '.docs', 'plans', 'demo.md'), [
    '# Implementation Plan: demo', '', '**Stories:** .docs/stories/demo.md', '', '## Slices', '',
    '| Slice | Title | Tasks |', '| --- | --- | --- |', '| 1 | One | 1 |', '| 2 | Leaf | 2 |', '',
    '### Task 1: One', '**Story:** Story 1', '**Dependencies:** none', '',
    '### Task 2: Two', '**Story:** Story 2', '**Dependencies:** none', '',
  ].join('\n'));
  await writeFile(join(repo, 'positions.json'), '[1,2]');
  const positionsBlob = (await git(['hash-object', '-w', 'positions.json'])).stdout.trim();
  await git(['update-ref', 'refs/conductor/demo/positions', positionsBlob]);
  return { repo };
}

async function withPersistedEvents<T>(repo: string, run: (events: ConductorEventEmitter) => Promise<T>) {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try {
    const result = await run(events);
    const records = (await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as { type: string; reason?: string });
    return { result, records };
  } finally {
    persister.stop();
  }
}

async function expectUnavailableHalt(
  repo: string,
  expectedDetail: string,
  run: (events: ConductorEventEmitter) => ReturnType<typeof runStackPreflight>,
) {
  const { result, records } = await withPersistedEvents(repo, run);
  expect(result).toMatchObject({ kind: 'unavailable', detail: expect.stringContaining(expectedDetail) });
  await expect(readFile(join(repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(new RegExp(`^.*${expectedDetail}`));
  expect(records.filter((record) => record.type === 'loop_halt')).toEqual([
    expect.objectContaining({ reason: expect.stringContaining(expectedDetail) }),
  ]);
}

async function appendBaseRefreshRepair(subject: Awaited<ReturnType<typeof fixture>>) {
  const git = (args: string[]) => execFile('git', args, { cwd: subject.repo });
  await git(['branch', 'feat/c2/demo', 'feat/daemon-demo']);
  await git(['checkout', '-q', 'main']);
  await writeFile(join(subject.repo, 'base.txt'), 'advanced\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base advance']);
  await git(['checkout', '-q', 'feat/c1/demo']);
  await writeFile(join(subject.repo, 'operator.txt'), 'X\n');
  await git(['add', 'operator.txt']);
  await git(['commit', '-qm', 'operator repair']);
  await git(['checkout', '-q', 'feat/daemon-demo']);
}

describe('stack preflight stop reasons', () => {
  it('preserves bytes written by a nested restack halt and names them in the terminal event', async () => {
    const subject = await fixture();
    const main = (await execFile('git', ['rev-parse', 'main'], { cwd: subject.repo })).stdout.trim();
    await execFile('git', ['update-ref', 'refs/heads/feat/c1/demo', main], { cwd: subject.repo });

    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo),
    }));
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'));

    expect(result).toMatchObject({ kind: 'halted' });
    expect(halt.equals(Buffer.from('restack refused (closed-child-rewritten) child 1\n'))).toBe(true);
    expect(records.filter((record) => record.type === 'loop_halt')).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('restack refused (closed-child-rewritten) child 1') }),
    ]);
  });

  it('preserves an unauthorized live HALT and reports both reasons', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    const seeded = Buffer.from('operator decision\nneeds-human\n');
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), seeded);

    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo),
    }));

    expect(result).toMatchObject({ kind: 'halted', detail: 'live HALT without resume authorization' });
    expect((await readFile(join(subject.repo, '.pipeline', 'HALT'))).equals(seeded)).toBe(true);
    expect(records.filter((record) => record.type === 'loop_halt')).toEqual([
      expect.objectContaining({ reason: 'live HALT without resume authorization: operator decision' }),
    ]);
  });

  it('crosses an authorized HALT without emitting when preflight is clear', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    const seeded = Buffer.from('operator decision\nneeds-human\n');
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), seeded);
    const events = new ConductorEventEmitter();
    const emitted: string[] = [];
    events.on('loop_halt', (event) => emitted.push(event.type));
    events.on('restack_refused', (event) => emitted.push(event.type));

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo),
      hasMatchingResumeAuthorization: async () => true,
      reconcileRounds: async () => ({ kind: 'none' }),
    })).resolves.toEqual({ kind: 'clear' });

    expect((await readFile(join(subject.repo, '.pipeline', 'HALT'))).equals(seeded)).toBe(true);
    expect(emitted).toEqual([]);
  });

  it('replaces an authorized resume halt with the unavailable reconciliation reason', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'previous halt\nneeds-human\n');

    await runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      events: new ConductorEventEmitter(),
      git: makeGitRunner(subject.repo),
      hasMatchingResumeAuthorization: async () => true,
      reconcileRounds: async () => ({ kind: 'unavailable', detail: 'round advance cas-failed' }),
    });

    const [firstLine] = (await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).split('\n');
    expect(firstLine).toContain('round advance cas-failed');
  });

  it.each([
    ['clear', async () => {
      const subject = await fixture();
      return { subject, options: { reconcileRounds: async () => ({ kind: 'none' as const }) } };
    }],
  ])('does not create a HALT or emit loop_halt for %s', async (_kind, arrange) => {
    const { subject, options } = await arrange();
    const events = new ConductorEventEmitter();
    const loopHalts: string[] = [];
    events.on('loop_halt', (event) => loopHalts.push(event.type));

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo), ...options,
    })).resolves.toEqual({ kind: 'clear' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(loopHalts).toEqual([]);
  });

  it('writes the unavailable round-reconciliation detail and one durable loop halt', async () => {
    const subject = await fixture();
    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
      reconcileRounds: async () => ({ kind: 'unavailable', detail: 'round advance cas-failed' }),
    }));

    expect(result).toEqual({ kind: 'unavailable', detail: 'round advance cas-failed' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/^round advance cas-failed/);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(records.filter((record) => record.type === 'loop_halt')).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('round advance cas-failed') }),
    ]);
  });

  it('names receipt-ledger, routing-outbox, and revalidation-queue refusals', async () => {
    const receipt = await fixture();
    vi.mocked(reconcileReceiptLedger).mockRejectedValueOnce(new Error('injected receipt failure'));
    await expectUnavailableHalt(receipt.repo, 'routed receipt ledger', (events) => runStackPreflight({
      worktree: receipt.repo, slug: 'demo', events, git: makeGitRunner(receipt.repo),
      reconcileRounds: async () => ({ kind: 'none' }),
    }));

    const outbox = await fixture();
    vi.mocked(drainRoutingOutboxes).mockResolvedValueOnce({ kind: 'unavailable' });
    await expectUnavailableHalt(outbox.repo, 'routing outbox', (events) => runStackPreflight({
      worktree: outbox.repo, slug: 'demo', events, git: makeGitRunner(outbox.repo),
      reconcileRounds: async () => ({ kind: 'none' }),
    }));

    const queue = await fixture();
    vi.mocked(consumeLowestQueued).mockResolvedValueOnce({ kind: 'unavailable' });
    await expectUnavailableHalt(queue.repo, 'revalidation queue', (events) => runStackPreflight({
      worktree: queue.repo, slug: 'demo', events, git: makeGitRunner(queue.repo),
      reconcileRounds: async () => ({ kind: 'none' }),
    }));
  });

  it('names a lost base-refresh follow-on', async () => {
    const subject = await fixture();
    await appendBaseRefreshRepair(subject);
    vi.mocked(runRestack).mockResolvedValueOnce({ kind: 'applied', opId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as never });

    await expectUnavailableHalt(subject.repo, 'base-refresh follow-on', (events) => runStackPreflight({
      worktree: subject.repo, slug: 'demo', events, baseRefreshDue: true, git: makeGitRunner(subject.repo),
    }));
    expect(readRestackJournal).toHaveBeenCalled();
  });
});
