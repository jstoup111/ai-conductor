// Covers: task:rem-as-built-R13-2, task:rem-as-built-R14
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

/**
 * Unchanged closed child 1, originating closed child 2 (operator commit X
 * appended past closed/c2), active child 3 checked out, and an unentered leaf
 * 4 whose branch is the pre-region halt record H inside child 1's range.
 */
async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-adopted-leaf-owner-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, file: string, content: string) => {
    await mkdir(dirname(join(repo, file)), { recursive: true });
    await writeFile(join(repo, file), content);
    await git(['add', file]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack adopted owner']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  const base = await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const haltRecord = await commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closureOne = await commit('child one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closureOne]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const closureTwo = await commit('child two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', closureTwo]);
  const operatorX = await commit('operator X', 'operator.txt', 'X\n');
  await git(['checkout', '-qb', 'feat/c3/demo', closureTwo]);
  const activeTip = await commit('child three', 'three.txt', 'three\n');
  await writeSliceTopologyFixture(repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3, '4': 4 }, titles: ['Child 1', 'Child 2', 'Child 3', 'Leaf 4'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3, S4: 4 },
  }, envelopeFilesystem);
  await writeFile(join(repo, '.pipeline', 'task-evidence.json'), JSON.stringify({
    evidenceStamps: { halted: { sha: haltRecord } },
  }));
  const rev = async (name: string) => sha((await git(['rev-parse', name])).stdout);
  return { repo, git, rev, base, haltRecord, closureOne, closureTwo, operatorX, activeTip };
}

describe('unentered leaf owned by an adopted, non-originating repair child (real local Git)', () => {
  // Covers: adr-2026-10-10-stacked-restack-journaled-replay D2, task:rem-as-built-R13-2, task:rem-as-built-R14
  it('feature-repair execution resolves a leaf inside unchanged closed child 1 to itself while originating child 2 is adopted', async () => {
    const subject = await fixture();

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    expect(await subject.rev('feat/daemon-demo')).toBe(subject.haltRecord);
    expect(await subject.rev('feat/c1/demo')).toBe(subject.closureOne);
    expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(subject.closureOne);
    expect(await subject.rev('feat/c2/demo')).toBe(subject.operatorX);
    expect(await subject.rev('refs/conductor/demo/closed/c2')).toBe(subject.operatorX);
    const newActive = await subject.rev('feat/c3/demo');
    expect(newActive).not.toBe(subject.activeTip);
    await expect(subject.git(['merge-base', '--is-ancestor', subject.operatorX, newActive])).resolves.toMatchObject({ stdout: '' });
    await expect(subject.git(['show', 'feat/c3/demo:operator.txt'])).resolves.toMatchObject({ stdout: 'X\n' });
    expect(await subject.rev('HEAD')).toBe(newActive);
    await expect(subject.git(['rev-parse', '--verify', journalRefFor('demo')])).rejects.toBeDefined();
  });

  // Covers: adr-2026-10-10-stacked-restack-journaled-replay D2, task:rem-as-built-R13-2, task:rem-as-built-R14
  it('pending feature-repair recovery resolves a leaf inside unchanged closed child 1 to itself and verifies the move', async () => {
    const subject = await fixture();
    const [one, two, three, leaf] = [1, 2, 3, 4].map((value) => parseChildId(value));
    if (!one || !two || !three || !leaf) throw new Error('child ids should parse');
    const journal: RestackJournal = {
      opId: 'crashed-before-adopted-owner-leaf' as RestackOpId,
      cause: 'feature-repair',
      newDefault: subject.base,
      committer: { name: 'Restack adopted owner', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      comparisonCommits: [],
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.closureOne },
        { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: subject.closureOne },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: subject.operatorX },
        { ref: 'refs/conductor/demo/closed/c2' as never, oldSha: subject.closureTwo },
        { ref: 'refs/heads/feat/c3/demo' as never, oldSha: subject.activeTip },
        { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: subject.haltRecord },
      ],
      ranges: [
        { child: one, oldParent: subject.base, oldTip: subject.closureOne, kind: 'closed' },
        { child: two, oldParent: subject.closureOne, oldTip: subject.operatorX, kind: 'closed' },
        { child: three, oldParent: subject.closureTwo, oldTip: subject.activeTip, kind: 'active' },
        { child: leaf, oldParent: subject.haltRecord, oldTip: subject.haltRecord, kind: 'leaf-unentered' },
      ],
      originatingChildren: [two],
      children: [one, two, three, leaf].map((child) => ({ child, status: 'pending' as const })),
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    expect(await subject.rev('feat/daemon-demo')).toBe(subject.haltRecord);
    expect(await subject.rev('feat/c1/demo')).toBe(subject.closureOne);
    expect(await subject.rev('feat/c2/demo')).toBe(subject.operatorX);
    expect(await subject.rev('refs/conductor/demo/closed/c2')).toBe(subject.operatorX);
    const newActive = await subject.rev('feat/c3/demo');
    expect(newActive).not.toBe(subject.activeTip);
    await expect(subject.git(['merge-base', '--is-ancestor', subject.operatorX, newActive])).resolves.toMatchObject({ stdout: '' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });
});
