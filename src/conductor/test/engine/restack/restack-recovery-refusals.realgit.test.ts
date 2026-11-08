// Covers: task:25
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { readConflictRecord, refusedTipRefFor } from '../../../src/engine/restack/restack-conflict-record.js';
import {
  journalRefFor,
  pinStagingRef,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
import { syncRestackedWorktree } from '../../../src/engine/restack/restack-sync.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-refusals-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack recovery']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  const base = await commit('base', 'src-a.ts', 'old\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const oldTip = await commit('child', 'child.txt', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', oldTip]);
  await git(['checkout', '-q', 'main']);
  const advanced = await commit('advance', 'src-a.ts', 'new\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  return { repo, git, base, oldTip, advanced };
}

/** A planned two-child base refresh which conflicts while replaying child 2. */
async function resolverRecoveryFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-resolver-refusal-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, {
    cwd: repo,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  const write = async (path: string, contents: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), contents);
  };
  const commit = async (message: string) => {
    await git(['add', '-A']);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack recovery resolver']);
  await write('.gitignore', '.pipeline/\n');
  await write('src/c.ts', 'one\ntwo\n');
  await write('tests/b.test.ts', 'old parent test\n');
  const base = await commit('base');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await write('c1.txt', 'child one\n');
  const c1 = await commit('child one');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  await write('src/c.ts', 'one\nchild\n');
  const c2 = await commit('child two conflict');
  await git(['checkout', '-q', 'main']);
  await write('src/c.ts', 'one\nparent\n');
  await write('tests/a.test.ts', 'parent test\n');
  await write('tests/b.test.ts', 'parent changed test\n');
  const advanced = await commit('default advance');
  await git(['checkout', '-q', 'feat/c2/demo']);

  const one = parseChildId(1);
  const two = parseChildId(2);
  if (!one || !two) throw new Error('child ids should parse');
  const journal: RestackJournal = {
    opId: 'crashed-resolver-handoff' as RestackOpId,
    cause: 'base-refresh', newDefault: advanced,
    committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
    dirtyPaths: [],
    refs: [
      { ref: 'refs/heads/feat/c1/demo' as never, oldSha: c1 },
      { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: c1 },
      { ref: 'refs/heads/feat/c2/demo' as never, oldSha: c2 },
    ],
    ranges: [
      { child: one, oldParent: base, oldTip: c1, kind: 'closed' },
      { child: two, oldParent: c1, oldTip: c2, kind: 'active' },
    ],
    children: [{ child: one, status: 'pending' }, { child: two, status: 'pending' }],
    state: 'planned', owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
  };
  const blob = await writeRestackJournalBlob(repo, journal);
  await git(['update-ref', journalRefFor('demo'), blob, '']);
  return { repo, git, c1, c2 };
}

async function resolverGit(projectRoot: string, environment: NodeJS.ProcessEnv, args: string[]) {
  return execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
}

async function movedJournal(subject: Awaited<ReturnType<typeof fixture>>) {
  const child = parseChildId(1);
  if (!child) throw new Error('child id should parse');
  const replay = await replayChildRange(
    { child, oldParent: subject.base, oldTip: subject.oldTip, kind: 'active' },
    subject.advanced,
    { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
    makeGitRunner(subject.repo),
  );
  await pinStagingRef(subject.repo, 'demo', child, replay.tip);
  const journal: RestackJournal = {
    opId: 'crashed-moved' as RestackOpId,
    cause: 'base-refresh',
    committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
    dirtyPaths: [],
    refs: [
      { ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip },
      { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: subject.oldTip },
    ],
    ranges: [{ child, oldParent: subject.base, oldTip: subject.oldTip, kind: 'closed' }],
    children: [{ child, status: 'replayed' }],
    state: 'moved',
    owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
  };
  const blob = await writeRestackJournalBlob(subject.repo, journal);
  await subject.git(['update-ref', 'refs/heads/feat/c1/demo', replay.tip, subject.oldTip]);
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', replay.tip, subject.oldTip]);
  await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
  return { child, replay, journal, blob };
}

async function readyJournal(subject: Awaited<ReturnType<typeof fixture>>) {
  const child = parseChildId(1);
  if (!child) throw new Error('child id should parse');
  const replay = await replayChildRange(
    { child, oldParent: subject.base, oldTip: subject.oldTip, kind: 'active' },
    subject.advanced,
    { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
    makeGitRunner(subject.repo),
  );
  await pinStagingRef(subject.repo, 'demo', child, replay.tip);
  const journal: RestackJournal = {
    opId: 'crashed-ready' as RestackOpId,
    cause: 'base-refresh',
    committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
    dirtyPaths: [],
    refs: [
      { ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip },
      { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: subject.oldTip },
    ],
    ranges: [{ child, oldParent: subject.base, oldTip: subject.oldTip, kind: 'closed' }],
    children: [{ child, status: 'replayed' }],
    state: 'ready',
    owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
  };
  const blob = await writeRestackJournalBlob(subject.repo, journal);
  await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
  return { child, replay, journal, blob };
}

describe('recoverRestackJournal refusal paths (real local Git)', () => {
  it('accepts a resolver tip adapting a new-parent test and persists it as child 2 adapted paths', async () => {
    const subject = await resolverRecoveryFixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(recoverRestackJournal({
        worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo), events, resolverCap: 1,
        resolver: async ({ projectRoot, environment }) => {
          await writeFile(join(projectRoot, 'src/c.ts'), 'one\nresolved child\n');
          await writeFile(join(projectRoot, 'tests/a.test.ts'), 'adapted parent test\n');
          await resolverGit(projectRoot, environment, ['add', 'src/c.ts', 'tests/a.test.ts']);
          await resolverGit(projectRoot, environment, ['rebase', '--continue']);
          return { resolved: true };
        },
      })).resolves.toMatchObject({ kind: 'recovered', fromState: 'planned' });
    } finally {
      persister.stop();
    }

    const records = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(records).toContainEqual(expect.objectContaining({ type: 'restack_applied', child: 2, adaptedPaths: ['tests/a.test.ts'] }));
    expect((await subject.git(['show', 'feat/c2/demo:tests/a.test.ts'])).stdout).toBe('adapted parent test\n');
  });

  it('retains an old-parent restoring resolver tip and writes its refusal as a recoverable conflict', async () => {
    const subject = await resolverRecoveryFixture();
    let resolverTip: string | undefined;
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    await expect(recoverRestackJournal({
      worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo), events, resolverCap: 1,
      resolver: async ({ projectRoot, environment }) => {
        await writeFile(join(projectRoot, 'src/c.ts'), 'one\nresolved child\n');
        await writeFile(join(projectRoot, 'tests/b.test.ts'), 'old parent test\n');
        await resolverGit(projectRoot, environment, ['add', 'src/c.ts', 'tests/b.test.ts']);
        await resolverGit(projectRoot, environment, ['rebase', '--continue']);
        resolverTip = (await resolverGit(projectRoot, environment, ['rev-parse', 'HEAD'])).stdout.trim();
        return { resolved: true };
      },
    })).resolves.toEqual({ kind: 'halted' });

    expect(resolverTip).toMatch(/^[0-9a-f]{40}$/);
    expect((await subject.git(['rev-parse', refusedTipRefFor('demo')])).stdout.trim()).toBe(resolverTip);
    expect(await readConflictRecord(subject.repo, 'demo', { git: makeGitRunner(subject.repo) })).toMatchObject({ kind: 'record' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('Restack-Conflict: 2');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('tests/b.test.ts (parent-revert)');
    expect(refusals).toContainEqual(expect.objectContaining({ type: 'restack_refused', reason: 'replay-mismatch', child: 2 }));
    expect((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim()).toBe(subject.c1);
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(subject.c1);
    expect((await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim()).toBe(subject.c2);
  });

  it('keeps an operator edit from a half-applied sync and rolls the refs back', async () => {
    const subject = await fixture();
    await movedJournal(subject);
    await writeFile(join(subject.repo, 'src-a.ts'), 'operator edit\n');

    const result = await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });

    expect(result).toEqual({ kind: 'recovered', fromState: 'moved' });
    await expect(readFile(join(subject.repo, 'src-a.ts'), 'utf8')).resolves.toBe('operator edit\n');
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(subject.oldTip);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('src-a.ts');
  });

  it('halts with every durable feature ref when the journal blob is unreadable', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    await pinStagingRef(subject.repo, 'demo', child, subject.oldTip);
    await writeFile(join(subject.repo, 'corrupt-journal.json'), '{not json');
    const bad = sha((await subject.git(['hash-object', '-w', 'corrupt-journal.json'])).stdout.trim());
    await subject.git(['update-ref', journalRefFor('demo'), bad, '']);

    const result = await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });

    expect(result).toEqual({ kind: 'unavailable', detail: `cannot read restack journal ${journalRefFor('demo')}` });
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(journalRefFor('demo'));
    expect(halt).toContain('refs/heads/feat/c1/demo');
    expect(halt).toContain('refs/conductor/demo/closed/c1');
    expect(halt).toContain('refs/conductor/demo/restack/staging/c1');
    expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(subject.oldTip);
  });

  it('aborts a ready journal when a new tracked edit overlaps its pending move', async () => {
    const subject = await fixture();
    await readyJournal(subject);
    await writeFile(join(subject.repo, 'src-a.ts'), 'operator edit\n');

    const result = await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });

    expect(result).toEqual({ kind: 'recovered', fromState: 'ready' });
    expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(subject.oldTip);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('dirty-overlap');
  });

  it('halts on an unexpected moved ref while naming every journaled live value', async () => {
    const divergent = await fixture();
    const moved = await movedJournal(divergent);
    await divergent.git(['reset', '--hard', '-q', moved.replay.tip]);
    const rogue = await (async () => {
      await writeFile(join(divergent.repo, 'rogue.txt'), 'operator commit\n');
      await divergent.git(['add', 'rogue.txt']);
      await divergent.git(['commit', '-qm', 'operator commit']);
      return (await divergent.git(['rev-parse', 'HEAD'])).stdout.trim();
    })();

    const refused = await recoverRestackJournal({ worktree: divergent.repo, slug: 'demo', git: makeGitRunner(divergent.repo) });

    expect(refused).toEqual({ kind: 'unavailable', detail: 'journaled refs no longer match the moved side' });
    const halt = await readFile(join(divergent.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(`refs/heads/feat/c1/demo ${rogue}`);
    expect(halt).toContain(`refs/conductor/demo/closed/c1 ${moved.replay.tip}`);
  });

  it('completes a synced journal after a checked-out halt-record commit without moving that branch', async () => {
    const synced = await fixture();
    const syncedMove = await movedJournal(synced);
    await syncRestackedWorktree(synced.repo, synced.oldTip, syncedMove.replay.tip, { git: makeGitRunner(synced.repo) });
    const syncedJournal = { ...syncedMove.journal, state: 'synced' as const };
    const syncedBlob = await writeRestackJournalBlob(synced.repo, syncedJournal);
    await synced.git(['update-ref', journalRefFor('demo'), syncedBlob, syncedMove.blob]);
    await mkdir(join(synced.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(synced.repo, '.docs', 'halted', 'demo.md'), 'Status: halted\n');
    await synced.git(['add', '.docs/halted/demo.md']);
    await synced.git(['commit', '-qm', 'halt record only']);
    const branchBeforeRecovery = (await synced.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim();
    const calls: string[][] = [];
    const rawGit = makeGitRunner(synced.repo);
    const observingGit: typeof rawGit = async (args, options) => {
      (calls as string[][]).push([...args, ...(options?.input === undefined ? [] : [options.input])]);
      return rawGit(args, options);
    };

    const recovered = await recoverRestackJournal({ worktree: synced.repo, slug: 'demo', git: observingGit });

    expect(recovered).toEqual({ kind: 'recovered', fromState: 'synced' });
    expect((await synced.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(branchBeforeRecovery);
    expect(await readRestackJournal(synced.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(calls.filter((call) => call[0] === 'update-ref').flat().join('\n')).not.toContain('refs/heads/feat/c1/demo');
    await expect(readFile(join(synced.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
