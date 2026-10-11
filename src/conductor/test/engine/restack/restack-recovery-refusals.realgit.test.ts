// Covers: task:25
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  journalRefFor,
  pinStagingRef,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
import { syncRestackedWorktree } from '../../../src/engine/restack/restack-sync.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

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

  it('halts on an unexpected moved ref while accepting a halt-record-only checked-out tip at synced', async () => {
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

    const recovered = await recoverRestackJournal({ worktree: synced.repo, slug: 'demo', git: makeGitRunner(synced.repo) });

    expect(recovered).toEqual({ kind: 'recovered', fromState: 'synced' });
    await expect(readFile(join(synced.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
