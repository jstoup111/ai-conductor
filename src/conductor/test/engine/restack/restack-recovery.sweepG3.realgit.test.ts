// Covers: task:24, task:rem-prd-audit-rem-prd-audit-R28, task:rem-prd-audit-rem-prd-audit-R29, task:rem-prd-audit-rem-prd-audit-R30, task:rem-prd-audit-rem-prd-audit-R31, task:rem-prd-audit-rem-v3-intent-restack
//
// Crash-recovery tests driven by journals that a real `runRestack` left
// behind. A wrapping Git runner simulates process death the moment the
// journal reaches a chosen state: the transaction that reached it is durable,
// and every later Git call (including the executor's own `finally`) fails, as
// it would for a killed process. The journal owner is then rewritten to a dead
// process so recovery treats it as abandoned.
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import {
  journalRefFor,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { verifyRestackMove } from '../../../src/engine/restack/restack-move.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { writePublicationRecord } from '../../../src/engine/stack-publication-record.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
import { syncRestackedWorktree } from '../../../src/engine/restack/restack-sync.js';
import { applyRestackTransition } from '../../../src/engine/restack/restack-transition.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

// Pass-through spies: production behavior is unchanged; the spies only
// record which recovery stages ran and in what order.
vi.mock('../../../src/engine/restack/restack-replay.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-replay.js')>();
  return { ...actual, replayChildRange: vi.fn(actual.replayChildRange) };
});
vi.mock('../../../src/engine/restack/restack-move.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-move.js')>();
  return { ...actual, verifyRestackMove: vi.fn(actual.verifyRestackMove) };
});
vi.mock('../../../src/engine/restack/restack-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-sync.js')>();
  return { ...actual, syncRestackedWorktree: vi.fn(actual.syncRestackedWorktree) };
});
vi.mock('../../../src/engine/restack/restack-transition.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-transition.js')>();
  return { ...actual, applyRestackTransition: vi.fn(actual.applyRestackTransition) };
});

const execFile = promisify(execFileCallback);
const roots: string[] = [];

const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

const DEAD_OWNER = { host: 'dead-sweep-recovery-host', pid: 1, processStartTime: '0' } as const;
const LEAF = 'feat/daemon-demo';
const STACK_REFS = [
  'refs/heads/feat/c1/demo',
  'refs/conductor/demo/closed/c1',
  'refs/heads/feat/c2/demo',
  'refs/conductor/demo/closed/c2',
  `refs/heads/${LEAF}`,
] as const;

beforeEach(() => {
  vi.mocked(replayChildRange).mockClear();
  vi.mocked(verifyRestackMove).mockClear();
  vi.mocked(syncRestackedWorktree).mockClear();
  vi.mocked(applyRestackTransition).mockClear();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Git = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

/**
 * A three-child stack (closed c1, closed c2, active leaf) in a linked feature
 * worktree named `demo`, plus an advanced default `B'` to base-refresh onto.
 */
async function stackFixture() {
  const root = await mkdtemp(join(tmpdir(), 'restack-recovery-sweep-'));
  roots.push(root);
  const main = join(root, 'main');
  const repo = join(root, 'demo');
  await mkdir(main);
  const mainGit: Git = (args) => execFile('git', args, { cwd: main });
  const git: Git = (args) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, file: string, content: string) => {
    await writeFile(join(main, file), content);
    await mainGit(['add', file]);
    await mainGit(['commit', '-qm', message]);
    return (await mainGit(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await mainGit(['init', '-q', '-b', 'main']);
  await mainGit(['config', 'user.email', 'restack@example.test']);
  await mainGit(['config', 'user.name', 'Restack Sweep']);
  await writeFile(join(main, '.gitignore'), '.pipeline/\n');
  await mainGit(['add', '.gitignore']);
  await commit('base', 'base.txt', 'base\n');
  await mainGit(['checkout', '-qb', 'feat/c1/demo']);
  await commit('A1', 'a1.txt', 'a1\n');
  const a2 = await commit('A2', 'a2.txt', 'a2\n');
  await mainGit(['update-ref', 'refs/conductor/demo/closed/c1', a2]);
  await mainGit(['checkout', '-qb', 'feat/c2/demo']);
  await commit('C1', 'c1.txt', 'c1\n');
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await mainGit(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await mainGit(['checkout', '-qb', LEAF]);
  await commit('L1', 'l1.txt', 'l1\n');
  await mainGit(['checkout', '-q', 'main']);
  const advanced = await commit('B-prime', 'base.txt', 'base advanced\n');
  await mainGit(['worktree', 'add', '-q', repo, LEAF]);
  await writeEnvelope(repo);
  return { root, main, repo, git, advanced };
}

async function writeEnvelope(repo: string): Promise<void> {
  await writeSliceTopologyFixture(repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
}

type Stack = Awaited<ReturnType<typeof stackFixture>>;

async function refSnapshot(git: Git): Promise<string> {
  return (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;
}

async function stackValues(git: Git): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const name of STACK_REFS) values[name] = (await git(['rev-parse', name])).stdout.trim();
  return values;
}

async function stagingRefs(git: Git): Promise<string> {
  return (await git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/restack/staging/'])).stdout.trim();
}

async function readJournal(repo: string): Promise<RestackJournal> {
  const read = await readRestackJournal(repo, 'demo');
  if (read.kind !== 'journal') throw new Error(`expected a readable journal, got ${read.kind}`);
  return read.journal;
}

/**
 * Run a real base-refresh `runRestack` and kill it once the journal satisfies
 * `crashWhen`. Returns the journal exactly as the dead process left it.
 */
async function crashRestackAt(subject: Stack, crashWhen: (journal: RestackJournal) => boolean): Promise<RestackJournal> {
  const real = makeGitRunner(subject.repo);
  let dead = false;
  const dying: GitRunner = async (args, options) => {
    if (dead) throw new Error('simulated process death');
    const result = await real(args, options);
    if (args[0] === 'update-ref' && result.exitCode === 0) {
      const read = await readRestackJournal(subject.repo, 'demo', { git: real });
      if (read.kind === 'journal' && crashWhen(read.journal)) {
        dead = true;
        throw new Error('simulated crash');
      }
    }
    return result;
  };
  await runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'base-refresh',
    newDefault: subject.advanced,
    git: dying,
  }).catch(() => undefined);
  expect(dead).toBe(true);
  return readJournal(subject.repo);
}

/** The crashed process is gone: hand its journal to a dead owner. */
async function abandonJournal(subject: Stack): Promise<RestackJournal> {
  const read = await readRestackJournal(subject.repo, 'demo');
  if (read.kind !== 'journal') throw new Error('expected a journal to abandon');
  const abandoned: RestackJournal = { ...read.journal, owner: DEAD_OWNER };
  const blob = await writeRestackJournalBlob(subject.repo, abandoned);
  await subject.git(['update-ref', journalRefFor('demo'), blob, read.blob]);
  return abandoned;
}

function oldValues(journal: RestackJournal): Record<string, string> {
  return Object.fromEntries(journal.refs.map((entry) => [entry.ref, entry.oldSha]));
}

async function persistedEvents(repo: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8').catch(() => '');
  return raw.trim() === '' ? [] : raw.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Recover with a persister attached so events land in `.pipeline/events.jsonl`. */
async function recoverPersisted(repo: string) {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try {
    return await recoverRestackJournal({ worktree: repo, slug: 'demo', events, git: makeGitRunner(repo) });
  } finally {
    persister.stop();
  }
}

/**
 * Rewrite child 2's restacked commit onto its OLD parent. The tree is
 * byte-identical, so tree checks pass, but the moved stack's ordered ancestry
 * is broken — a genuine `verifyRestackMove` failure.
 */
async function breakChild2Ancestry(subject: Stack, journal: RestackJournal): Promise<string> {
  const staged = (await subject.git(['rev-parse', 'refs/conductor/demo/restack/staging/c2'])).stdout.trim();
  const oldC1 = oldValues(journal)['refs/heads/feat/c1/demo']!;
  const tree = (await subject.git(['rev-parse', `${staged}^{tree}`])).stdout.trim();
  const broken = (await execFile('git', ['commit-tree', tree, '-p', oldC1, '-m', 'C2 on the wrong parent'], {
    cwd: subject.repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@example.test', GIT_AUTHOR_DATE: '2030-01-01T00:00:00Z',
      GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@example.test', GIT_COMMITTER_DATE: '2030-01-01T00:00:00Z',
    },
  })).stdout.trim();
  await subject.git(['update-ref', 'refs/conductor/demo/restack/staging/c2', broken, staged]);
  return broken;
}

async function stagedValues(git: Git): Promise<Record<string, string>> {
  const staged = async (child: number) => (await git(['rev-parse', `refs/conductor/demo/restack/staging/c${child}`])).stdout.trim();
  const [c1, c2, leaf] = await Promise.all([staged(1), staged(2), staged(3)]);
  return {
    'refs/heads/feat/c1/demo': c1,
    'refs/conductor/demo/closed/c1': c1,
    'refs/heads/feat/c2/demo': c2,
    'refs/conductor/demo/closed/c2': c2,
    [`refs/heads/${LEAF}`]: leaf,
  };
}

/** Old values for every stack ref; the checked-out leaf may only gain a halt-record commit. */
async function expectStackAtOldValues(subject: Stack, journal: RestackJournal): Promise<void> {
  const old = oldValues(journal);
  const live = await stackValues(subject.git);
  for (const name of STACK_REFS.filter((entry) => entry !== `refs/heads/${LEAF}`)) expect(live[name]).toBe(old[name]);
  const leaf = `refs/heads/${LEAF}`;
  if (live[leaf] !== old[leaf]) {
    expect((await subject.git(['merge-base', '--is-ancestor', old[leaf]!, live[leaf]!])).stdout).toBe('');
    expect((await subject.git(['diff', '--name-only', old[leaf]!, live[leaf]!])).stdout.trim()).toBe('.docs/halted/demo.md');
  }
}

async function worktreeSnapshot(subject: Stack): Promise<string> {
  const index = join(subject.root, `snapshot-index-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  await execFile('git', ['read-tree', 'HEAD'], { cwd: subject.repo, env });
  await execFile('git', ['add', '-A'], { cwd: subject.repo, env });
  const tree = (await execFile('git', ['write-tree'], { cwd: subject.repo, env })).stdout.trim();
  await rm(index, { force: true });
  const status = (await subject.git(['status', '--porcelain=v1', '--untracked-files=all'])).stdout;
  return `${status}\n${tree}`;
}

async function restackedEvents(repo: string): Promise<Array<Record<string, unknown>>> {
  return (await persistedEvents(repo)).filter((event) => event.type === 'restack_recovered');
}

/** Crash at `moved`, abandon, recover: verify, then sync, then one transition. */
async function recoverMovedScenario(): Promise<void> {
  const subject = await stackFixture();
  const crashed = await crashRestackAt(subject, (journal) => journal.state === 'moved');
  const staged = await stagedValues(subject.git);
  expect(await stackValues(subject.git)).toEqual(staged);
  // The dead process never synchronised: the worktree still holds the old tree.
  await expect(readFile(join(subject.repo, 'base.txt'), 'utf8')).resolves.toBe('base\n');
  await abandonJournal(subject);
  vi.mocked(verifyRestackMove).mockClear();
  vi.mocked(syncRestackedWorktree).mockClear();
  vi.mocked(applyRestackTransition).mockClear();

  await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'moved' });

  expect(verifyRestackMove).toHaveBeenCalledTimes(1);
  expect(syncRestackedWorktree).toHaveBeenCalledTimes(1);
  expect(vi.mocked(verifyRestackMove).mock.invocationCallOrder[0]!)
    .toBeLessThan(vi.mocked(syncRestackedWorktree).mock.invocationCallOrder[0]!);
  // Synchronised to the moved tip.
  expect((await subject.git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(staged[`refs/heads/${LEAF}`]);
  expect((await subject.git(['status', '--porcelain'])).stdout).toBe('');
  await expect(readFile(join(subject.repo, 'base.txt'), 'utf8')).resolves.toBe('base advanced\n');
  // Exactly one transition, recorded through the rewrite map.
  expect(applyRestackTransition).toHaveBeenCalledTimes(1);
  const oldLeaf = oldValues(crashed)[`refs/heads/${LEAF}`]!;
  const rewrites = JSON.parse(await readFile(join(subject.repo, '.pipeline', 'rebase-rewrites.json'), 'utf8')) as unknown;
  expect(JSON.stringify(rewrites)).toContain(oldLeaf);
  expect(JSON.stringify(rewrites)).toContain(staged[`refs/heads/${LEAF}`]!);
  expect(await stackValues(subject.git)).toEqual(staged);
  expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  expect(await stagingRefs(subject.git)).toBe('');
  expect(await restackedEvents(subject.repo)).toEqual([
    expect.objectContaining({ type: 'restack_recovered', opId: crashed.opId, fromState: 'moved' }),
  ]);
}

/** Crash at `moved`, then leave a half-done reverse: child 1 restored, child 2 and the leaf still new. */
async function recoverRollingBackScenario(): Promise<void> {
  const subject = await stackFixture();
  const crashed = await crashRestackAt(subject, (journal) => journal.state === 'moved');
  const old = oldValues(crashed);
  const staged = await stagedValues(subject.git);
  const read = await readRestackJournal(subject.repo, 'demo');
  if (read.kind !== 'journal') throw new Error('expected journal');
  const rolling: RestackJournal = { ...read.journal, owner: DEAD_OWNER, state: 'rolling-back' };
  const rollingBlob = await writeRestackJournalBlob(subject.repo, rolling);
  await subject.git(['update-ref', journalRefFor('demo'), rollingBlob, read.blob]);
  for (const name of ['refs/heads/feat/c1/demo', 'refs/conductor/demo/closed/c1']) {
    await subject.git(['update-ref', name, old[name]!, staged[name]!]);
  }
  expect((await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim()).toBe(staged['refs/heads/feat/c2/demo']);

  await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'rolling-back' });

  expect(await stackValues(subject.git)).toEqual(old);
  expect(await readJournal(subject.repo)).toMatchObject({ state: 'aborted', opId: crashed.opId });
  expect(await restackedEvents(subject.repo)).toEqual([
    expect.objectContaining({ type: 'restack_recovered', opId: crashed.opId, fromState: 'rolling-back' }),
  ]);
}

/** Crash at `synced`, abandon, recover: one transition, journal removed. */
async function recoverSyncedScenario(): Promise<void> {
  const subject = await stackFixture();
  const crashed = await crashRestackAt(subject, (journal) => journal.state === 'synced');
  const staged = await stagedValues(subject.git);
  await abandonJournal(subject);
  vi.mocked(applyRestackTransition).mockClear();
  vi.mocked(syncRestackedWorktree).mockClear();

  await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'synced' });

  expect(applyRestackTransition).toHaveBeenCalledTimes(1);
  expect(syncRestackedWorktree).not.toHaveBeenCalled();
  expect(await stackValues(subject.git)).toEqual(staged);
  expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  expect(await stagingRefs(subject.git)).toBe('');
  expect(await restackedEvents(subject.repo)).toEqual([
    expect.objectContaining({ type: 'restack_recovered', opId: crashed.opId, fromState: 'synced' }),
  ]);
}

/** Crash at `moved` with a broken moved stack: recovery verifies BEFORE syncing and rolls back. */
async function recoverMovedVerificationFailureScenario(): Promise<void> {
  const subject = await stackFixture();
  const crashed = await crashRestackAt(subject, (journal) => journal.state === 'moved');
  const staged = (await subject.git(['rev-parse', 'refs/conductor/demo/restack/staging/c2'])).stdout.trim();
  const broken = await breakChild2Ancestry(subject, crashed);
  for (const name of ['refs/heads/feat/c2/demo', 'refs/conductor/demo/closed/c2']) {
    await subject.git(['update-ref', name, broken, staged]);
  }
  await abandonJournal(subject);
  vi.mocked(verifyRestackMove).mockClear();
  vi.mocked(syncRestackedWorktree).mockClear();
  vi.mocked(applyRestackTransition).mockClear();

  await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'moved' });

  expect(verifyRestackMove).toHaveBeenCalledTimes(1);
  await expect(vi.mocked(verifyRestackMove).mock.results[0]!.value).resolves.toMatchObject({ kind: 'failed' });
  expect(syncRestackedWorktree).not.toHaveBeenCalled();
  expect(applyRestackTransition).not.toHaveBeenCalled();
  await expectStackAtOldValues(subject, crashed);
  expect(await readJournal(subject.repo)).toMatchObject({ state: 'aborted' });
  // Never synchronised: the worktree is the clean old tree.
  await expect(readFile(join(subject.repo, 'base.txt'), 'utf8')).resolves.toBe('base\n');
  expect((await subject.git(['status', '--porcelain', '--', '.', ':!.docs'])).stdout).toBe('');
  await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8'))
    .resolves.toMatch(/^restack refused \(verification-failed\)/);
  expect(await restackedEvents(subject.repo)).toEqual([
    expect.objectContaining({ type: 'restack_recovered', opId: crashed.opId, fromState: 'moved' }),
  ]);
}

/** A live process throws mid-restack (during the sync); its own finally restores every ref. */
async function liveThrowScenario(): Promise<void> {
  const subject = await stackFixture();
  const before = await stackValues(subject.git);
  const real = makeGitRunner(subject.repo);
  let thrown = false;
  const throwingOnce: GitRunner = async (args, options) => {
    // Throw at the sync, once the stack has really moved.
    if (!thrown && args[0] === 'read-tree' && args.includes('-u') && !args.includes('-n')) {
      const read = await readRestackJournal(subject.repo, 'demo', { git: real });
      expect(read.kind === 'journal' && read.journal.state).toBe('moved');
      thrown = true;
      throw new Error('injected mid-restack failure');
    }
    return real(args, options);
  };

  const result = await runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.advanced, git: throwingOnce });
  expect(syncRestackedWorktree).toHaveBeenCalled();

  expect(thrown).toBe(true);
  expect(result).toMatchObject({ kind: 'unavailable' });
  const left = await readRestackJournal(subject.repo, 'demo');
  if (left.kind === 'journal') expect(['ready', 'moved']).not.toContain(left.journal.state);
  expect(left.kind === 'journal' ? left.journal.state : left.kind).toBe('aborted');
  expect(await stackValues(subject.git)).toEqual(before);
}

/** Crash at `planned` / `ready`, abandon, recover: the matching restack_recovered is persisted. */
async function recoverEventScenario(state: 'planned' | 'ready'): Promise<void> {
  const subject = await stackFixture();
  const crashed = await crashRestackAt(subject, (journal) => journal.state === state);
  await abandonJournal(subject);
  await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'recovered', fromState: state });
  expect(await restackedEvents(subject.repo)).toEqual([
    expect.objectContaining({ type: 'restack_recovered', opId: crashed.opId, fromState: state }),
  ]);
}

describe('recoverRestackJournal after a real runRestack crash (sweep G3)', () => {
  it('halts instead of launching an applied journal\'s published-stack follow-on', async () => {
    const subject = await stackFixture();
    await crashRestackAt(subject, (journal) => journal.state === 'applied');
    const applied = await readRestackJournal(subject.repo, 'demo');
    if (applied.kind !== 'journal') throw new Error('expected an applied journal');
    const followOn = await writeRestackJournalBlob(subject.repo, {
      ...applied.journal,
      owner: DEAD_OWNER,
      followOnCause: 'base-refresh',
    });
    await subject.git(['update-ref', journalRefFor('demo'), followOn, applied.blob]);
    const child = parseChildId(1)!;
    await expect(writePublicationRecord(subject.repo, 'demo', undefined, {
      version: 1,
      members: [{ position: child, branch: 'feat/c1/demo', pr: 101 }],
    })).resolves.toEqual({ kind: 'updated' });
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });

    await expect(recoverRestackJournal({
      worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    expect(refusals).toEqual([expect.objectContaining({ reason: 'published-stack', child: 1 })]);
    expect(await readJournal(subject.repo)).toMatchObject({ state: 'applied', followOnCause: 'base-refresh' });
  });

  // Covers: task:24, task:rem-prd-audit-rem-prd-audit-R30
  it('resumes a planned crash from child 2 reusing child 1’s staged replay, and aborts without moving refs once feat/c2/demo moved', async () => {
    // Resume: inputs unchanged.
    const resumed = await stackFixture();
    const crashed = await crashRestackAt(resumed, (journal) => journal.state === 'planned'
      && journal.children[0]?.status === 'replayed' && journal.children[1]?.status === 'pending');
    const firstAttemptC1 = (await resumed.git(['rev-parse', 'refs/conductor/demo/restack/staging/c1'])).stdout.trim();
    const firstAttemptC1Commits = (await resumed.git(['rev-list', '--reverse', `${resumed.advanced}..${firstAttemptC1}`])).stdout;
    expect(firstAttemptC1).not.toBe(oldValues(crashed)['refs/heads/feat/c1/demo']);
    await abandonJournal(resumed);
    await rm(join(resumed.repo, '.pipeline'), { recursive: true, force: true });
    vi.mocked(replayChildRange).mockClear();

    await expect(recoverPersisted(resumed.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    // Planning continued at child 2, from child 1's staged tip; child 1 was not replayed again.
    const replayedChildren = vi.mocked(replayChildRange).mock.calls.map(([range, parent]) => [range.child, parent]);
    expect(replayedChildren[0]).toEqual([2, firstAttemptC1]);
    expect(replayedChildren.map(([child]) => child)).not.toContain(1);
    expect((await resumed.git(['rev-parse', 'feat/c1/demo'])).stdout.trim()).toBe(firstAttemptC1);
    expect((await resumed.git(['rev-list', '--reverse', `${resumed.advanced}..feat/c1/demo`])).stdout).toBe(firstAttemptC1Commits);
    expect(await readRestackJournal(resumed.repo, 'demo')).toEqual({ kind: 'missing' });

    // Abort: feat/c2/demo moved after the crash.
    const changed = await stackFixture();
    const changedJournal = await crashRestackAt(changed, (journal) => journal.state === 'planned'
      && journal.children[0]?.status === 'replayed' && journal.children[1]?.status === 'pending');
    await abandonJournal(changed);
    const c2 = (await changed.git(['rev-parse', 'feat/c2/demo'])).stdout.trim();
    const operatorCommit = (await changed.git(['commit-tree', `${c2}^{tree}`, '-p', c2, '-m', 'operator commit on c2'])).stdout.trim();
    await changed.git(['update-ref', 'refs/heads/feat/c2/demo', operatorCommit, c2]);
    const before = await stackValues(changed.git);
    const journalWrites: string[] = [];
    const real = makeGitRunner(changed.repo);
    const recording: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(journalRefFor('demo'))) {
        journalWrites.push(options.input);
      }
      return real(args, options);
    };
    const recovered: unknown[] = [];
    const events = new ConductorEventEmitter();
    events.on('restack_recovered', (event) => { recovered.push(event); });
    vi.mocked(replayChildRange).mockClear();

    await expect(recoverRestackJournal({ worktree: changed.repo, slug: 'demo', events, git: recording }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    // The journal was moved to `aborted` (then removed) — never toward ready.
    const abortedWrite = journalWrites.find((input) => / refs\/conductor\/demo\/restack\/journal [0-9a-f]{40}/.test(input));
    expect(abortedWrite).toBeDefined();
    const abortedBlob = /update refs\/conductor\/demo\/restack\/journal ([0-9a-f]{40})/.exec(abortedWrite!)![1]!;
    expect(JSON.parse((await changed.git(['cat-file', 'blob', abortedBlob])).stdout)).toMatchObject({ state: 'aborted', opId: changedJournal.opId });
    expect(journalWrites.some((input) => /"state":"ready"/.test(input))).toBe(false);
    expect(await readRestackJournal(changed.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(await stagingRefs(changed.git)).toBe('');
    // No stack ref moved; the checked-out leaf may only gain the halt-record commit.
    const after = await stackValues(changed.git);
    for (const name of STACK_REFS.filter((entry) => entry !== `refs/heads/${LEAF}`)) expect(after[name]).toBe(before[name]);
    const leafAdded = (await changed.git(['diff', '--name-only', before[`refs/heads/${LEAF}`]!, after[`refs/heads/${LEAF}`]!])).stdout.trim();
    expect(['', '.docs/halted/demo.md']).toContain(leafAdded);
    expect(replayChildRange).not.toHaveBeenCalled();
    await expect(readFile(join(changed.repo, '.pipeline', 'HALT'), 'utf8'))
      .resolves.toMatch(/^restack refused \(stack-ref-changed\)/);
    expect(recovered).toEqual([{ type: 'restack_recovered', opId: changedJournal.opId, fromState: 'planned' }]);
  });
  // Covers: task:24
  it.each(['none', 'recreated-worktree', 'deleted-pipeline'] as const)('finishes a ready crash with its journaled staging SHAs and no replay after %s', async (loss) => {
    const subject = await stackFixture();
    const crashed = await crashRestackAt(subject, (journal) => journal.state === 'ready');
    const staged = await stagedValues(subject.git);
    expect(await stackValues(subject.git)).toEqual(oldValues(crashed));
    await abandonJournal(subject);
    if (loss === 'recreated-worktree') {
      await execFile('git', ['worktree', 'remove', '--force', subject.repo], { cwd: subject.main });
      await execFile('git', ['worktree', 'add', '-q', subject.repo, LEAF], { cwd: subject.main });
    }
    if (loss === 'deleted-pipeline') await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });
    vi.mocked(replayChildRange).mockClear();
    vi.mocked(verifyRestackMove).mockClear();

    await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'ready' });

    expect(replayChildRange).not.toHaveBeenCalled();
    expect(verifyRestackMove).toHaveBeenCalledTimes(1);
    expect(await stackValues(subject.git)).toEqual(staged);
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(await restackedEvents(subject.repo)).toEqual([
      expect.objectContaining({ type: 'restack_recovered', opId: crashed.opId, fromState: 'ready' }),
    ]);
  });

  it('rolls back a ready crash when post-move verification fails', async () => {
    // The recovered move is verified; a failed check rolls every ref back and halts.
    const failing = await stackFixture();
    const crashed = await crashRestackAt(failing, (journal) => journal.state === 'ready');
    await breakChild2Ancestry(failing, crashed);
    await abandonJournal(failing);
    vi.mocked(verifyRestackMove).mockClear();

    await expect(recoverPersisted(failing.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'ready' });

    expect(verifyRestackMove).toHaveBeenCalledTimes(1);
    await expect(vi.mocked(verifyRestackMove).mock.results[0]!.value).resolves.toMatchObject({ kind: 'failed' });
    await expectStackAtOldValues(failing, crashed);
    expect(await readJournal(failing.repo)).toMatchObject({ state: 'aborted' });
    await expect(readFile(join(failing.repo, '.pipeline', 'HALT'), 'utf8'))
      .resolves.toMatch(/^restack refused \(verification-failed\)/);
    await expect(readFile(join(failing.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  // Covers: task:24, task:rem-prd-audit-rem-prd-audit-R28
  it('recovers a dead owner’s moved journal by verifying, syncing the worktree to the moved tip, applying one transition and removing the journal and staging refs', async () => {
    await recoverMovedScenario();
  });

  // Covers: task:24, task:rem-prd-audit-rem-prd-audit-R29
  it('completes a dead owner’s partially reversed rolling-back journal to every journaled old SHA and ends it aborted', async () => {
    await recoverRollingBackScenario();
  });

  // Covers: task:24, task:rem-prd-audit-rem-prd-audit-R28, task:rem-prd-audit-rem-prd-audit-R29
  it.each([
    ['a synced journal', recoverSyncedScenario],
    ['a planned journal', () => recoverEventScenario('planned')],
    ['a ready journal', () => recoverEventScenario('ready')],
    ['a moved journal that fails verification before sync', recoverMovedVerificationFailureScenario],
    ['a live throw that rolls back in its finally', liveThrowScenario],
  ] as const)('recovers %s with its expected event and state transition', async (_name, scenario) => {
    await scenario();
  });

  // Covers: task:24
  it('removes no journal or a leftover applied journal silently, ignoring .pipeline throughout', async () => {
    // No journal: nothing to report.
    const empty = await stackFixture();
    await expect(recoverPersisted(empty.repo)).resolves.toEqual({ kind: 'none' });
    expect(await restackedEvents(empty.repo)).toEqual([]);

    // Leftover applied journal with no follow-on.
    const applied = await stackFixture();
    await crashRestackAt(applied, (journal) => journal.state === 'applied');
    expect(await stagingRefs(applied.git)).not.toBe('');
    await abandonJournal(applied);
    await mkdir(join(applied.repo, '.pipeline', 'restack', 'resolve', 'c2'), { recursive: true });
    await writeFile(join(applied.repo, '.pipeline', 'restack', 'resolve', 'c2', 'left.txt'), 'leftover\n');
    const appliedRefs = await stackValues(applied.git);

    await expect(recoverPersisted(applied.repo)).resolves.toEqual({ kind: 'cleaned' });

    expect(await readRestackJournal(applied.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(await stagingRefs(applied.git)).toBe('');
    await expect(readFile(join(applied.repo, '.pipeline', 'restack', 'resolve', 'c2', 'left.txt'))).rejects.toThrow();
    expect(await stackValues(applied.git)).toEqual(appliedRefs);
    expect(await restackedEvents(applied.repo)).toEqual([]);
    // Resume continues: nothing outstanding blocks the next restack.
    await expect(runRestack({ worktree: applied.repo, slug: 'demo', cause: 'base-refresh', newDefault: applied.advanced, git: makeGitRunner(applied.repo) }))
      .resolves.not.toMatchObject({ kind: 'refused' });

  });

  // The committed halt record at the active branch tip decides an aborted
  // journal's recovery, never the presence or absence of .pipeline.
  it.each([
    ['halted', 'present'],
    ['halted', 'deleted'],
    ['superseded', 'present'],
    ['superseded', 'deleted'],
  ] as const)('keeps or cleans an aborted journal from a %s halt with a %s pipeline', async (record, pipeline) => {
    const subject = await stackFixture();
    await crashRestackAt(subject, (journal) => journal.state === 'ready');
    const read = await readRestackJournal(subject.repo, 'demo');
    if (read.kind !== 'journal') throw new Error('expected journal');
    const aborted: RestackJournal = { ...read.journal, owner: DEAD_OWNER, state: 'aborted' };
    const abortedBlob = await writeRestackJournalBlob(subject.repo, aborted);
    await subject.git(['update-ref', journalRefFor('demo'), abortedBlob, read.blob]);
    await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(subject.repo, '.docs', 'halted', 'demo.md'), `# Halt: demo\n\nStatus: ${record}\n`);
    await subject.git(['add', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'halt record: demo']);
    await mkdir(join(subject.repo, '.pipeline', 'restack', 'resolve', 'c2'), { recursive: true });
    if (pipeline === 'present') {
      // A contradictory live marker: recovery must not consult it.
      if (record === 'superseded') await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'live halt\n');
    } else {
      await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });
    }
    const staging = await stagingRefs(subject.git);
    expect(staging).not.toBe('');
    const refs = await stackValues(subject.git);

    const result = await recoverPersisted(subject.repo);

    expect(await stackValues(subject.git)).toEqual(refs);
    expect(await restackedEvents(subject.repo)).toEqual([]);
    if (record === 'halted') {
      expect(result).toEqual({ kind: 'none' });
      expect(await readJournal(subject.repo)).toMatchObject({ state: 'aborted' });
      expect(await stagingRefs(subject.git)).toBe(staging);
    } else {
      expect(result).toEqual({ kind: 'cleaned' });
      expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
      expect(await stagingRefs(subject.git)).toBe('');
      await expect(readFile(join(subject.repo, '.pipeline', 'restack', 'resolve', 'c2'))).rejects.toThrow();
    }
  });

  // Covers: task:24, task:rem-prd-audit-rem-prd-audit-R31
  it('leaves refs, worktree and events.jsonl byte-identical on a second recovery run, and never touches a live owner’s journal', async () => {
    const subject = await stackFixture();
    await crashRestackAt(subject, (journal) => journal.state === 'moved');

    // The crashed journal still names this (live) process: recovery must not act.
    const liveBlob = (await subject.git(['rev-parse', journalRefFor('demo')])).stdout.trim();
    const liveRefs = await refSnapshot(subject.git);
    const liveTree = await worktreeSnapshot(subject);
    await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'live-owner' });
    expect((await subject.git(['rev-parse', journalRefFor('demo')])).stdout.trim()).toBe(liveBlob);
    expect(await refSnapshot(subject.git)).toBe(liveRefs);
    expect(await worktreeSnapshot(subject)).toBe(liveTree);
    expect(await restackedEvents(subject.repo)).toEqual([]);

    await abandonJournal(subject);
    await expect(recoverPersisted(subject.repo)).resolves.toEqual({ kind: 'recovered', fromState: 'moved' });
    const refsAfterFirst = await refSnapshot(subject.git);
    const treeAfterFirst = await worktreeSnapshot(subject);
    const eventsAfterFirst = await readFile(join(subject.repo, '.pipeline', 'events.jsonl'));
    expect(eventsAfterFirst.toString('utf8')).toContain('restack_recovered');

    await recoverPersisted(subject.repo);

    expect(await refSnapshot(subject.git)).toBe(refsAfterFirst);
    expect(await worktreeSnapshot(subject)).toBe(treeAfterFirst);
    expect((await readFile(join(subject.repo, '.pipeline', 'events.jsonl'))).equals(eventsAfterFirst)).toBe(true);
  });
});
