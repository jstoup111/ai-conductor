// Covers: task:13
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { journalRefFor, readRestackJournal, stagingRefFor } from '../../../src/engine/restack/restack-journal.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};
const stamp: CommitterStamp = {
  name: 'Restack Journal',
  email: 'journal@example.test',
  date: '2030-02-03T04:05:06Z',
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected full SHA: ${raw}`);
  return parsed;
}

async function fixture(initialFiles: Readonly<Record<string, string>> = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-ownership-'));
  repositories.push(repo);
  const git = async (args: string[]) => execFile('git', args, { cwd: repo });
  const write = async (path: string, content: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), content);
  };
  const commit = async (message: string, path: string, content: string) => {
    await write(path, content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack ownership']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  for (const [path, content] of Object.entries(initialFiles)) await write(path, content);
  await git(['add', '.gitignore']);
  await git(['add', ...Object.keys(initialFiles)]);
  await commit('base', 'base.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('L1', 'leaf.txt', 'leaf\n');
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);

  return { repo, git, write, commit };
}

async function restack(subject: Awaited<ReturnType<typeof fixture>>, newDefault: string, events?: ConductorEventEmitter) {
  return runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'base-refresh',
    newDefault,
    events,
    git: makeGitRunner(subject.repo),
  });
}

async function advanceDefault(subject: Awaited<ReturnType<typeof fixture>>, path: string, content: string): Promise<string> {
  await subject.git(['checkout', '-q', 'main']);
  const advanced = await subject.commit('default advance', path, content);
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  return advanced;
}

async function closeChildTwo(subject: Awaited<ReturnType<typeof fixture>>, newTip: string): Promise<void> {
  const oldTip = (await subject.git(['rev-parse', 'refs/conductor/demo/closed/c2'])).stdout.trim();
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', newTip]);
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  await subject.git(['rebase', '--onto', newTip, oldTip]);
}

describe('runRestack path ownership (real local Git)', () => {
  it('accepts child-owned rename-then-edit and set-then-set replay paths', async () => {
    const renamed = await fixture({ 'src/x.ts': 'first\nsecond\n' });
    await renamed.git(['checkout', '-q', 'feat/c2/demo']);
    await renamed.git(['mv', 'src/x.ts', 'src/y.ts']);
    await renamed.write('src/y.ts', 'edited first\nedited second\n');
    await renamed.git(['add', '-A']);
    await renamed.git(['commit', '-qm', 'rename and edit y']);
    const renamedC2 = (await renamed.git(['rev-parse', 'HEAD'])).stdout.trim();
    await closeChildTwo(renamed, renamedC2);
    const renamedAdvance = await advanceDefault(renamed, 'base.txt', 'advanced\n');

    await expect(restack(renamed, renamedAdvance)).resolves.toMatchObject({ kind: 'applied' });
    await expect(renamed.git(['show', 'feat/c2/demo:src/y.ts'])).resolves.toMatchObject({ stdout: 'edited first\nedited second\n' });

    const setThenSet = await fixture({ 'src/h.ts': 'L=zero\n' });
    await setThenSet.git(['checkout', '-q', 'feat/c2/demo']);
    await setThenSet.commit('set a', 'src/h.ts', 'L=a\n');
    const c2 = await setThenSet.commit('set b', 'src/h.ts', 'L=b\n');
    await closeChildTwo(setThenSet, c2);
    const setAdvance = await advanceDefault(setThenSet, 'src/h.ts', 'L=a\n');

    await expect(restack(setThenSet, setAdvance)).resolves.toMatchObject({ kind: 'applied' });
    await expect(setThenSet.git(['show', 'feat/c2/demo:src/h.ts'])).resolves.toMatchObject({ stdout: 'L=b\n' });
  });

  it('halts before ref movement for both silent-revert shapes on paths a child does not own', async () => {
    const subject = await fixture({ 'src/g.ts': 'original\n' });
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.commit('add X', 'src/g.ts', 'X\n');
    const oldC2 = await subject.commit('revert X', 'src/g.ts', 'original\n');
    await closeChildTwo(subject, oldC2);
    const oldLeaf = (await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim();
    const advanced = await advanceDefault(subject, 'src/g.ts', 'X\n');
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    await expect(restack(subject, advanced, events)).resolves.toEqual({ kind: 'halted' });

    expect(refusals).toEqual([expect.objectContaining({ reason: 'replay-mismatch', child: 2, detail: 'src/g.ts' })]);
    expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(oldLeaf);
    const journal = await readRestackJournal(subject.repo, 'demo');
    expect(journal).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    const child = parseChildId(2);
    if (!child) throw new Error('child 2 must be valid');
    await expect(subject.git(['rev-parse', '--verify', stagingRefFor('demo', child)])).resolves.toMatchObject({ stdout: expect.any(String) });
    await expect(subject.git(['rev-parse', '--verify', journalRefFor('demo')])).resolves.toMatchObject({ stdout: expect.any(String) });

    const restored = await fixture({ 'src/deleted.ts': 'X\n' });
    await restored.git(['checkout', '-q', 'feat/c2/demo']);
    await restored.git(['rm', 'src/deleted.ts']);
    await restored.git(['commit', '-qm', 'remove X']);
    const restoredC2 = await restored.commit('restore X', 'src/deleted.ts', 'X\n');
    await closeChildTwo(restored, restoredC2);
    const oldRestoredLeaf = (await restored.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim();
    await restored.git(['checkout', '-q', 'main']);
    await restored.git(['rm', 'src/deleted.ts']);
    await restored.git(['commit', '-qm', 'default removes X']);
    const deletedDefault = (await restored.git(['rev-parse', 'HEAD'])).stdout.trim();
    await restored.git(['checkout', '-q', 'feat/daemon-demo']);
    const restoredEvents = new ConductorEventEmitter();
    const restoredRefusals: unknown[] = [];
    restoredEvents.on('restack_refused', (event) => restoredRefusals.push(event));

    await expect(restack(restored, deletedDefault, restoredEvents)).resolves.toEqual({ kind: 'halted' });

    expect(restoredRefusals).toEqual([expect.objectContaining({ reason: 'replay-mismatch', child: 2, detail: 'src/deleted.ts' })]);
    expect((await restored.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(oldRestoredLeaf);
  });

  it('does not accept a rename collision as a clean replay', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-ownership-rename-conflict-'));
    repositories.push(repo);
    const git = async (args: string[]) => execFile('git', args, { cwd: repo });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack ownership']);
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'x.ts'), 'old\n');
    await git(['add', '.']);
    await git(['commit', '-qm', 'base']);
    const base = sha((await git(['rev-parse', 'HEAD'])).stdout);
    await git(['checkout', '-qb', 'child']);
    await git(['mv', 'src/x.ts', 'src/z.ts']);
    await git(['commit', '-qm', 'rename x to z']);
    const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'src', 'z.ts'), 'parent\n');
    await git(['add', 'src/z.ts']);
    await git(['commit', '-qm', 'parent creates z']);
    const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout);
    const child = parseChildId(2);
    if (!child) throw new Error('child 2 must be valid');

    await expect(replayChildRange({ child, oldParent: base, oldTip, kind: 'closed' }, newParent, stamp, makeGitRunner(repo)))
      .rejects.toThrow(/merge-tree failed/);
  });

  it('emits parent overlap paths only for a child-owned path changed by its new parent', async () => {
    const overlap = await fixture({ 'src/f.ts': 'one=base\ntwo=base\nthree=base\nfour=base\nfive=base\nsix=base\nseven=base\neight=base\nnine=base\nten=base\n' });
    await overlap.git(['checkout', '-q', 'feat/c2/demo']);
    const c2 = await overlap.commit('child edits f', 'src/f.ts', 'one=base\ntwo=base\nthree=base\nfour=base\nfive=base\nsix=base\nseven=base\neight=base\nnine=base\nten=child\n');
    await closeChildTwo(overlap, c2);
    const overlapAdvance = await advanceDefault(overlap, 'src/f.ts', 'one=parent\ntwo=base\nthree=base\nfour=base\nfive=base\nsix=base\nseven=base\neight=base\nnine=base\nten=base\n');
    const overlapEvents = new ConductorEventEmitter();
    const applied: unknown[] = [];
    overlapEvents.on('restack_applied', (event) => applied.push(event));

    await expect(restack(overlap, overlapAdvance, overlapEvents)).resolves.toMatchObject({ kind: 'applied' });
    expect(applied).toContainEqual(expect.objectContaining({ child: 2, parentOverlapPaths: ['src/f.ts'] }));

    const noOverlap = await fixture({ 'src/f.ts': 'base\n' });
    await noOverlap.git(['checkout', '-q', 'feat/c2/demo']);
    const noOverlapC2 = await noOverlap.commit('child edits f', 'src/f.ts', 'child\n');
    await closeChildTwo(noOverlap, noOverlapC2);
    const noOverlapAdvance = await advanceDefault(noOverlap, 'base.txt', 'parent\n');
    const noOverlapEvents = new ConductorEventEmitter();
    const noOverlapApplied: unknown[] = [];
    noOverlapEvents.on('restack_applied', (event) => noOverlapApplied.push(event));

    await expect(restack(noOverlap, noOverlapAdvance, noOverlapEvents)).resolves.toMatchObject({ kind: 'applied' });
    expect(noOverlapApplied).toContainEqual(expect.objectContaining({ child: 2, parentOverlapPaths: [] }));
  });
});
