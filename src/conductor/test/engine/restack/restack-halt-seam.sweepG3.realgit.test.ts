// Covers: task:28
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { writeHaltMarker } from '../../../src/engine/halt-marker.js';
import { renderHaltRecord } from '../../../src/engine/halt-record.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import {
  journalRefFor,
  pinStagingRef,
  readRestackJournal,
  stagingRefFor,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { applyRestackMove } from '../../../src/engine/restack/restack-move.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
import { syncRestackedWorktree } from '../../../src/engine/restack/restack-sync.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

// Pass-through spy: the halt seam keeps calling the real recovery, and the
// test can observe how (and how often) it was entered.
vi.mock('../../../src/engine/restack/restack-recovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-recovery.js')>();
  return { ...actual, recoverRestackJournal: vi.fn(actual.recoverRestackJournal) };
});

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const committer = { name: 'Restack halt seam sweep', email: 'restack@example.test', date: '2030-02-03T04:05:06Z' };
const deadOwner = { host: 'dead-halt-seam-owner', pid: 1, processStartTime: '0' };
const recoverSpy = vi.mocked(recoverRestackJournal);
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  recoverSpy.mockClear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

function childOne(): ChildId {
  const child = parseChildId(1);
  if (!child) throw new Error('child must parse');
  return child;
}

/** A one-child feature worktree named `demo` whose default branch advanced. */
async function singleChildFixture() {
  const root = await mkdtemp(join(tmpdir(), 'restack-halt-seam-sweep-'));
  roots.push(root);
  const main = join(root, 'main');
  const repo = join(root, 'demo');
  await mkdir(main);
  const mainGit = (args: string[]) => execFile('git', args, { cwd: main });
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await mainGit(['init', '-q', '-b', 'main']);
  await mainGit(['config', 'user.email', committer.email]);
  await mainGit(['config', 'user.name', committer.name]);
  await writeFile(join(main, '.gitignore'), '.pipeline/\n');
  await writeFile(join(main, 'base.txt'), 'base\n');
  await mainGit(['add', '.']);
  await mainGit(['commit', '-qm', 'base']);
  const base = sha((await mainGit(['rev-parse', 'HEAD'])).stdout);
  await mainGit(['branch', 'feat/c1/demo']);
  await mainGit(['worktree', 'add', '-q', repo, 'feat/c1/demo']);
  await writeFile(join(repo, 'child.txt'), 'child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'child']);
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await writeFile(join(main, 'base.txt'), 'advanced\n');
  await mainGit(['add', 'base.txt']);
  await mainGit(['commit', '-qm', 'advance']);
  const advanced = sha((await mainGit(['rev-parse', 'HEAD'])).stdout);
  return { root, repo, git, base, oldTip, advanced, child: childOne() };
}

type SingleChild = Awaited<ReturnType<typeof singleChildFixture>>;

function journalFor(subject: SingleChild, state: RestackJournal['state'], oldTip: CommitSha, owner = deadOwner): RestackJournal {
  return {
    opId: 'halt-seam-sweep' as RestackOpId,
    cause: 'base-refresh',
    committer,
    dirtyPaths: [],
    refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: oldTip }],
    ranges: [{ child: subject.child, oldParent: subject.base, oldTip, kind: 'active' }],
    children: [{ child: subject.child, status: 'replayed' }],
    state,
    owner,
  };
}

async function replayOnto(subject: SingleChild, oldTip: CommitSha): Promise<CommitSha> {
  const replay = await replayChildRange(
    { child: subject.child, oldParent: subject.base, oldTip, kind: 'active' },
    subject.advanced,
    committer,
    makeGitRunner(subject.repo),
  );
  await pinStagingRef(subject.repo, 'demo', subject.child, replay.tip);
  return replay.tip;
}

/** A dead (or given) owner crashed after moving the branch but before syncing the worktree. */
async function crashAtMoved(subject: SingleChild, owner = deadOwner) {
  const newTip = await replayOnto(subject, subject.oldTip);
  const blob = await writeRestackJournalBlob(subject.repo, journalFor(subject, 'moved', subject.oldTip, owner));
  await subject.git(['update-ref', 'refs/heads/feat/c1/demo', newTip, subject.oldTip]);
  await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
  return { newTip, blob };
}

async function liveOwner() {
  const stat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
  const start = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/)[19];
  if (!start) throw new Error('current process start time unavailable');
  return { host: hostname(), pid: process.pid, processStartTime: start };
}

async function haltRecordCommits(git: SingleChild['git'], since: string): Promise<string[]> {
  const listed = (await git(['rev-list', `${since}..HEAD`])).stdout.split('\n').filter(Boolean);
  const records: string[] = [];
  for (const commit of listed) {
    const changed = (await git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])).stdout.trim();
    if (changed === '.docs/halted/demo.md') records.push(commit);
  }
  return records;
}

/**
 * Leaf over two closed children, as the executor's own sync tests build it,
 * checked out in a linked worktree named `demo` so its halt is recordable.
 */
async function stackFixture() {
  const root = await mkdtemp(join(tmpdir(), 'restack-halt-seam-stack-'));
  roots.push(root);
  const main = join(root, 'main');
  const repo = join(root, 'demo');
  await mkdir(main);
  const mainGit = (args: string[]) => execFile('git', args, { cwd: main });
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await mkdir(join(main, path, '..'), { recursive: true });
    await writeFile(join(main, path), content);
    await mainGit(['add', path]);
    await mainGit(['commit', '-qm', message]);
    return sha((await mainGit(['rev-parse', 'HEAD'])).stdout);
  };
  await mainGit(['init', '-q', '-b', 'main']);
  await mainGit(['config', 'user.email', committer.email]);
  await mainGit(['config', 'user.name', committer.name]);
  await writeFile(join(main, '.gitignore'), '.pipeline/\n');
  await mainGit(['add', '.gitignore']);
  await commit('base', 'notes.txt', 'base notes\n');
  await commit('approved plan', '.docs/plans/demo.md', 'approved\n');
  await mainGit(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  await mainGit(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await mainGit(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await mainGit(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await mainGit(['checkout', '-qb', 'feat/daemon-demo']);
  const leaf = await commit('L1', 'leaf.txt', 'leaf\n');
  await mainGit(['checkout', '-q', 'main']);
  const advancedDefault = await commit('base advance', 'base.txt', 'advanced\n');
  await mainGit(['worktree', 'add', '-q', repo, 'feat/daemon-demo']);
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  return { repo, git, c1, c2, leaf, advancedDefault };
}

function waitForPath(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const watcher = watch(join(path, '..'), (_event, name) => {
      if (name === path.slice(path.lastIndexOf('/') + 1)) {
        clearTimeout(timeout);
        watcher.close();
        resolve();
      }
    });
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error(`timed out waiting for ${path}`));
    }, 10_000);
  });
}

async function commitHaltRecord(subject: SingleChild): Promise<CommitSha> {
  await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
  await writeFile(join(subject.repo, '.docs', 'halted', 'demo.md'), renderHaltRecord({
    slug: 'demo', haltClass: 'needs-human', step: 'build', phase: 'BUILD', branch: 'feat/c1/demo',
    headSha: subject.oldTip, haltedAt: '2030-02-03T04:05:06Z', haltBody: 'original halt\n', child: subject.child,
  }));
  await subject.git(['add', '.docs/halted/demo.md']);
  await subject.git(['commit', '-qm', 'halt record: demo']);
  return sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
}

/**
 * Start `supersedeHaltRecord` in a separate `node` process. It reads HEAD,
 * then blocks inside `prepare-commit-msg` until `release` exists.
 */
async function startSupersede(subject: SingleChild, run: number) {
  const started = join(subject.root, `supersede-started-${run}`);
  const release = join(subject.root, `supersede-release-${run}`);
  const hooks = join(subject.root, 'race-hooks');
  await mkdir(hooks, { recursive: true });
  const prepare = join(hooks, 'prepare-commit-msg');
  await writeFile(prepare, `#!/bin/sh\nprintf '' > '${started}'\nwhile [ ! -f '${release}' ]; do sleep 0.01; done\nexit 0\n`);
  await chmod(prepare, 0o755);
  await subject.git(['config', 'core.hooksPath', hooks]);
  const module = new URL('../../../src/engine/halt-record.ts', import.meta.url).pathname;
  const program = [
    'const { supersedeHaltRecord } = await import(process.argv[1]);',
    'const result = await supersedeHaltRecord(process.argv[2], "demo", "race");',
    'process.stdout.write(JSON.stringify(result));',
  ].join(' ');
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program, module, subject.repo], {
    cwd: subject.repo, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
  const complete = new Promise<unknown>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(JSON.parse(stdout) as unknown) : reject(new Error(`child exited ${code}: ${stderr}`)));
  });
  await waitForPath(started);
  return { release: () => writeFile(release, 'go\n'), complete };
}

/** The restack's ready → moved → synced steps, planned from `expected` as the live branch tip. */
async function restackBranch(subject: SingleChild, expected: CommitSha): Promise<CommitSha> {
  const newTip = await replayOnto(subject, expected);
  const ready = journalFor(subject, 'ready', expected);
  const readyBlob = await writeRestackJournalBlob(subject.repo, ready);
  await subject.git(['update-ref', journalRefFor('demo'), readyBlob, '']);
  const moved = await applyRestackMove(
    subject.repo,
    { slug: 'demo', blob: readyBlob, journal: ready },
    [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: expected, newSha: newTip, child: subject.child }],
  );
  if (moved.kind !== 'moved') throw new Error(`restack move did not apply: ${JSON.stringify(moved)}`);
  await syncRestackedWorktree(subject.repo, expected, newTip, { git: makeGitRunner(subject.repo) });
  const syncedBlob = await writeRestackJournalBlob(subject.repo, { ...ready, state: 'synced' });
  await subject.git(['update-ref', journalRefFor('demo'), syncedBlob, moved.journal.blob]);
  return newTip;
}

describe('restack halt seam, sweep (real local Git)', () => {
  // Covers: task:28
  it('runRestack halting on a failed post-move verification first rolls its moved journal to aborted, then commits the halt record on the rolled-back HEAD', async () => {
    const subject = await stackFixture();
    const raw = makeGitRunner(subject.repo);
    let perturbed = false;
    // Another writer retargets the leaf's staging ref right after the move, so
    // the moved leaf no longer matches it and verification fails at `moved`.
    const git: GitRunner = async (args, options) => {
      const result = await raw(args, options);
      if (!perturbed && args[0] === 'update-ref' && args[1] === '--stdin' && result.exitCode === 0
        && options?.input?.includes('update refs/heads/feat/daemon-demo ')) {
        perturbed = true;
        await subject.git(['update-ref', stagingRefFor('demo', parseChildId(3)!), subject.c1]);
      }
      return result;
    };
    const events = new ConductorEventEmitter();
    const refusals: string[] = [];
    const atRecord: { state?: string; head?: string }[] = [];
    events.on('restack_refused', (event) => { if (event.type === 'restack_refused') refusals.push(event.reason); });
    // The leaf branch has no remote here, so the committed record reports a
    // failed publish; either event follows the record commit.
    const observeRecord = async () => {
      const journal = await readRestackJournal(subject.repo, 'demo');
      atRecord.push({
        state: journal.kind === 'journal' ? journal.journal.state : journal.kind,
        head: (await subject.git(['rev-parse', 'HEAD^'])).stdout.trim(),
      });
    };
    events.on('halt_record_written', observeRecord);
    events.on('halt_record_push_failed', observeRecord);

    const result = await runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.advancedDefault, git, events });

    expect(perturbed).toBe(true);
    expect(result).toEqual({ kind: 'halted' });
    expect(refusals).toEqual(['verification-failed']);
    // The journal had already left `moved` when the halt record was committed,
    // and the record's parent is the rolled-back leaf tip.
    expect(atRecord).toEqual([{ state: 'aborted', head: subject.leaf }]);
    expect((await subject.git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()).toBe('feat/daemon-demo');
    expect(await haltRecordCommits(subject.git, subject.leaf)).toHaveLength(1);
    await expect(readFile(join(subject.repo, '.docs', 'halted', 'demo.md'), 'utf8')).resolves.toContain(`Head SHA: ${subject.leaf}`);
    expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(subject.c1);
    expect((await subject.git(['rev-parse', 'refs/heads/feat/c2/demo'])).stdout.trim()).toBe(subject.c2);
  });

  // Covers: task:28
  it("writeHaltMarker at a dead owner's moved journal recovers with target synced before committing the record at the post-recovery HEAD, and leaves a live owner's journal untouched", async () => {
    const subject = await singleChildFixture();
    const { newTip } = await crashAtMoved(subject);
    const events = new ConductorEventEmitter();
    const order: string[] = [];
    events.on('restack_recovered', (event) => { if (event.type === 'restack_recovered') order.push(`recovered:${event.opId}:${event.fromState}`); });
    events.on('restack_applied', () => { order.push('applied'); });
    events.on('halt_record_written', () => { order.push('record'); });

    await expect(writeHaltMarker(subject.repo, 'operator decision required\n', 'needs-human', events)).resolves.toEqual({ status: 'written' });

    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith(expect.objectContaining({ worktree: subject.repo, slug: 'demo', target: 'synced' }));
    expect(order).toEqual(['recovered:halt-seam-sweep:moved', 'record']);
    expect(await readRestackJournal(subject.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'synced' } });
    const records = await haltRecordCommits(subject.git, newTip);
    expect(records).toHaveLength(1);
    expect((await subject.git(['rev-parse', `${records[0]}^`])).stdout.trim()).toBe(newTip);
    await expect(readFile(join(subject.repo, '.docs', 'halted', 'demo.md'), 'utf8')).resolves.toContain(`Head SHA: ${newTip}`);
    await expect(readFile(join(subject.repo, 'base.txt'), 'utf8')).resolves.toBe('advanced\n');

    // While the journal's owner is alive, the seam does not recover it.
    recoverSpy.mockClear();
    const alive = await singleChildFixture();
    await crashAtMoved(alive, await liveOwner());
    const before = (await alive.git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;

    await expect(writeHaltMarker(alive.repo, 'operator decision required\n', 'needs-human')).resolves.toEqual({ status: 'written' });

    expect(recoverSpy).not.toHaveBeenCalled();
    expect((await alive.git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout).toBe(before);
    expect(await readRestackJournal(alive.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'moved' } });
  });

  // Covers: task:28
  it('a failed halt-time recovery aborts the journal, is entered exactly once, and leaves exactly one halt marker and one halt record', async () => {
    const subject = await singleChildFixture();
    // A ready journal whose staging ref is gone cannot move forward.
    const blob = await writeRestackJournalBlob(subject.repo, journalFor(subject, 'ready', subject.oldTip));
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    const events = new ConductorEventEmitter();
    const written: string[] = [];
    const refused: string[] = [];
    events.on('halt_record_written', (event) => { if (event.type === 'halt_record_written') written.push(event.path); });
    events.on('restack_refused', (event) => { if (event.type === 'restack_refused') refused.push(event.reason); });

    await expect(writeHaltMarker(subject.repo, 'operator decision required\n', 'needs-human', events)).resolves.toEqual({ status: 'written' });

    expect(recoverSpy).toHaveBeenCalledTimes(1);
    await expect(recoverSpy.mock.results[0]!.value).resolves.toMatchObject({ kind: 'unavailable' });
    expect(await readRestackJournal(subject.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('operator decision required\n');
    expect(written).toEqual(['.docs/halted/demo.md']);
    expect(refused).toEqual([]);
    expect(await haltRecordCommits(subject.git, subject.oldTip)).toHaveLength(1);
    expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo^'])).stdout.trim()).toBe(subject.oldTip);
  });

  // Covers: task:28
  it('across repeated two-process runs in both orders, a node supersede and a restack move never revert each other', { timeout: 120_000 }, async () => {
    for (let run = 0; run < 3; run += 1) {
      // Supersede reads HEAD, then the restack moves the branch, then the supersede commits.
      const late = await singleChildFixture();
      const lateRecord = await commitHaltRecord(late);
      const lateSupersede = await startSupersede(late, run);
      const restacked = await restackBranch(late, lateRecord);
      await lateSupersede.release();

      await expect(lateSupersede.complete).resolves.toMatchObject({ kind: 'failed' });
      expect((await late.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(restacked);
      expect((await late.git(['rev-parse', 'HEAD^{tree}'])).stdout.trim())
        .toBe((await late.git(['rev-parse', `${restacked}^{tree}`])).stdout.trim());
      await expect(late.git(['show', 'HEAD:base.txt'])).resolves.toMatchObject({ stdout: 'advanced\n' });
      await expect(late.git(['show', 'HEAD:.docs/halted/demo.md'])).resolves.toMatchObject({ stdout: expect.stringContaining('Status: halted') });

      // Supersede commits first; the restack then plans from, and keeps, that commit.
      const early = await singleChildFixture();
      const earlyRecord = await commitHaltRecord(early);
      const earlySupersede = await startSupersede(early, run);
      await earlySupersede.release();
      await expect(earlySupersede.complete).resolves.toEqual({ kind: 'written' });
      const superseded = sha((await early.git(['rev-parse', 'HEAD'])).stdout);
      expect(superseded).not.toBe(earlyRecord);
      const supersededRecord = (await early.git(['show', `${superseded}:.docs/halted/demo.md`])).stdout;
      expect(supersededRecord).not.toContain('Status: halted\n');

      const moved = await restackBranch(early, superseded);

      expect((await early.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(moved);
      await expect(early.git(['show', 'HEAD:.docs/halted/demo.md'])).resolves.toMatchObject({ stdout: supersededRecord });
      await expect(early.git(['show', 'HEAD:base.txt'])).resolves.toMatchObject({ stdout: 'advanced\n' });
    }
  });
});
