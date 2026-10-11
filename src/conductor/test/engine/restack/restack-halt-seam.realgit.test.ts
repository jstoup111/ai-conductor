// Covers: task:28
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { writeHaltMarker } from '../../../src/engine/halt-marker.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  journalRefFor,
  pinStagingRef,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

async function movedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'restack-halt-seam-'));
  roots.push(root);
  const main = join(root, 'main');
  const repo = join(root, 'demo');
  await mkdir(main);
  const mainGit = (args: string[]) => execFile('git', args, { cwd: main });
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await mainGit(['init', '-q', '-b', 'main']);
  await mainGit(['config', 'user.email', 'restack@example.test']);
  await mainGit(['config', 'user.name', 'Restack halt seam']);
  const hooks = join(root, 'hooks');
  await mkdir(hooks);
  for (const hook of ['prepare-commit-msg', 'commit-msg', 'post-commit']) {
    const path = join(hooks, hook);
    await writeFile(path, '#!/bin/sh\nexit 0\n');
    await chmod(path, 0o755);
  }
  await mainGit(['config', 'core.hooksPath', hooks]);
  await writeFile(join(main, '.gitignore'), '.pipeline/\n');
  await writeFile(join(main, 'base.txt'), 'base\n');
  await mainGit(['add', '.']);
  await mainGit(['commit', '-qm', 'base']);
  const base = sha((await mainGit(['rev-parse', 'HEAD'])).stdout);
  await mainGit(['branch', 'feat/c1/demo']);
  await mainGit(['worktree', 'add', '-q', repo, 'feat/c1/demo']);
  const oldTip = await commit('child', 'child.txt', 'child\n');
  await writeFile(join(main, 'base.txt'), 'advanced\n');
  await mainGit(['add', 'base.txt']);
  await mainGit(['commit', '-qm', 'advance']);
  const advanced = sha((await mainGit(['rev-parse', 'HEAD'])).stdout);
  const child = parseChildId(1);
  if (!child) throw new Error('child must parse');
  const replay = await replayChildRange(
    { child, oldParent: base, oldTip, kind: 'active' },
    advanced,
    { name: 'Restack halt seam', email: 'restack@example.test', date: '2030-02-03T04:05:06Z' },
    makeGitRunner(repo),
  );
  await pinStagingRef(repo, 'demo', child, replay.tip);
  const journal: RestackJournal = {
    opId: 'halt-seam' as RestackOpId,
    cause: 'base-refresh',
    committer: { name: 'Restack halt seam', email: 'restack@example.test', date: '2030-02-03T04:05:06Z' },
    dirtyPaths: [],
    refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: oldTip }],
    ranges: [{ child, oldParent: base, oldTip, kind: 'active' }],
    children: [{ child, status: 'replayed' }],
    state: 'moved',
    owner: { host: 'dead-halt-seam-owner', pid: 1, processStartTime: '0' },
  };
  const blob = await writeRestackJournalBlob(repo, journal);
  await git(['update-ref', 'refs/heads/feat/c1/demo', replay.tip, oldTip]);
  await git(['update-ref', journalRefFor('demo'), blob, '']);
  return { repo, git, child, oldTip, replay, journal, blob };
}

describe('restack halt seam (real local Git)', () => {
  it('recovers a moved journal to synced before committing the halt record at the post-recovery head', async () => {
    const subject = await movedFixture();
    const events = new ConductorEventEmitter();
    const failures: string[] = [];
    events.on('halt_record_write_failed', (event) => failures.push(event.reason));
    await expect(writeHaltMarker(subject.repo, 'operator decision required\n', 'needs-human', events)).resolves.toEqual({ status: 'written' });

    const journal = await readRestackJournal(subject.repo, 'demo');
    expect(journal).toMatchObject({ kind: 'journal', journal: { state: 'synced' } });
    const record = await readFile(join(subject.repo, '.docs', 'halted', 'demo.md'), 'utf8');
    expect(record).toContain(`Head SHA: ${subject.replay.tip}`);
    expect(failures).toEqual([]);
  });

  it('does not touch a moved journal while its owner is alive', async () => {
    const subject = await movedFixture();
    const stat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/)[19];
    if (!start) throw new Error('current process start time unavailable');
    const live = { ...subject.journal, owner: { host: (await import('node:os')).hostname(), pid: process.pid, processStartTime: start } };
    const blob = await writeRestackJournalBlob(subject.repo, live);
    await subject.git(['update-ref', journalRefFor('demo'), blob, subject.blob]);

    await expect(writeHaltMarker(subject.repo, 'operator decision required\n', 'needs-human')).resolves.toEqual({ status: 'written' });
    expect(await readRestackJournal(subject.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'moved' } });
  });

  it('aborts a failed halt-time recovery once and writes one halt marker', async () => {
    const subject = await movedFixture();
    // A ready journal with no staging ref cannot continue forward.  It can,
    // however, always transition to its durable aborted terminal state.
    await subject.git(['update-ref', '-d', `refs/conductor/demo/restack/staging/c${subject.child}`]);
    const ready = { ...subject.journal, state: 'ready' as const };
    const blob = await writeRestackJournalBlob(subject.repo, ready);
    await subject.git(['update-ref', journalRefFor('demo'), blob, subject.blob]);
    await subject.git(['update-ref', 'refs/heads/feat/c1/demo', subject.oldTip, subject.replay.tip]);

    await expect(writeHaltMarker(subject.repo, 'operator decision required\n', 'needs-human')).resolves.toEqual({ status: 'written' });
    expect(await readRestackJournal(subject.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('operator decision required\n');
  });
});
