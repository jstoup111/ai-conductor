// Covers: task:24
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  journalRefFor,
  pinStagingRef,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
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
  const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, file: string, content: string) => {
    await writeFile(join(repo, file), content);
    await git(['add', file]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack recovery']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  const base = await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const oldTip = await commit('child', 'child.txt', 'child\n');
  await git(['checkout', '-q', 'main']);
  const advanced = await commit('advance', 'base.txt', 'advanced\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  return { repo, git, base, oldTip, advanced };
}

describe('recoverRestackJournal (real local Git)', () => {
  it('removes an aborted journal after a lost worktree has no committed outstanding halt', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    await pinStagingRef(subject.repo, 'demo', child, subject.oldTip);
    const journal: RestackJournal = {
      opId: 'aborted-cleanup' as RestackOpId,
      cause: 'base-refresh',
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip }],
      ranges: [{ child, oldParent: subject.advanced, oldTip: subject.oldTip, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'aborted',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    expect(await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .toEqual({ kind: 'cleaned' });
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/staging/c1']))
      .rejects.toBeDefined();
  });

  it('replays a pending planned child from its journaled parent without reading .pipeline', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    const journal: RestackJournal = {
      opId: 'crashed-planned' as RestackOpId,
      cause: 'base-refresh',
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip }],
      // The first range's parent is the new default captured by the original
      // planner, so the recovery neither re-resolves nor re-plans the stack.
      ranges: [{ child, oldParent: subject.advanced, oldTip: subject.oldTip, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    const result = await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });

    expect(result).toEqual({ kind: 'recovered', fromState: 'planned' });
    const tip = (await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim();
    expect(tip).not.toBe(subject.oldTip);
    expect((await subject.git(['merge-base', '--is-ancestor', subject.advanced, tip])).stdout).toBe('');
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  it('finishes a dead owner’s ready journal after .pipeline is lost, using only its staging and journal refs', async () => {
    const subject = await fixture();
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
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip }],
      ranges: [{ child, oldParent: subject.base, oldTip: subject.oldTip, kind: 'active' }],
      children: [{ child, status: 'replayed' }],
      state: 'ready',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    const events = new ConductorEventEmitter();
    const recovered: unknown[] = [];
    events.on('restack_recovered', (event) => recovered.push(event));
    const result = await recoverRestackJournal({
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
    });

    expect(result).toEqual({ kind: 'recovered', fromState: 'ready' });
    expect((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim()).toBe(replay.tip);
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(recovered).toEqual([{ type: 'restack_recovered', opId: 'crashed-ready', fromState: 'ready' }]);
  });
});
