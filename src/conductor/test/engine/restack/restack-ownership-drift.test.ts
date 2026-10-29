// Covers: task:3
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { computeFeatureOwnership, worktreeFeatureOwnershipSource } from '../../../src/engine/feature-ownership.js';
import { createProtectedArtifactSeal } from '../../../src/engine/protected-artifact-seal.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { checkRestackPreMove, type RestackMoveRef } from '../../../src/engine/restack/restack-move.js';
import { parseRefName, parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

async function fixture({ unlisted = true }: { unlisted?: boolean } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-ownership-drift-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack ownership drift']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await commit('base', 'base.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('child one', 'c1.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('child two', 'c2.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.docs', 'demo'), { recursive: true });
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await writeFile(join(repo, '.docs', 'demo', 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    slug: 'demo',
    artifacts: [
      { kind: 'plan', path: '.docs/plans/demo.md' },
      { kind: 'stories', path: '.docs/demo/review/stories.md' },
      { kind: 'stories', path: '.docs/stories/demo.md' },
      { kind: 'complexity', path: '.docs/complexity/demo.md' },
    ],
  }, null, 2)}\n`);
  await writeFile(join(repo, '.docs', 'plans', 'demo.md'), '# Plan\n');
  await mkdir(join(repo, '.docs', 'demo', 'review'), { recursive: true });
  await writeFile(join(repo, '.docs', 'demo', 'review', 'stories.md'), '# Stories\n');
  await git(['add', '.docs']);
  await git(['commit', '-qm', 'add manifest']);
  if (unlisted) await commit('add unlisted story', '.docs/stories/unlisted.md', '# Unlisted\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);

  const oldLeaf = (await git(['rev-parse', 'feat/daemon-demo'])).stdout.trim();
  const oldChildren = await Promise.all(['feat/c1/demo', 'feat/c2/demo'].map(async (branch) =>
    (await git(['rev-parse', branch])).stdout.trim()));
  await git(['checkout', '-q', 'main']);
  const advanced = await commit('advance base', 'base-advance.txt', 'advance\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  return { repo, git, advanced, oldLeaf, oldChildren };
}

describe('restack manifest ownership drift (Task 3, real local Git)', () => {
  it('halts the executor before moving any stacked ref', async () => {
    const subject = await fixture();

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.advanced,
      git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /\.docs\/stories\/unlisted\.md: unlisted.*ai-conductor register-artifact/s,
    );
    expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(subject.oldLeaf);
    await expect(Promise.all(['feat/c1/demo', 'feat/c2/demo'].map(async (branch) =>
      (await subject.git(['rev-parse', branch])).stdout.trim()))).resolves.toEqual(subject.oldChildren);
  });

  it('refuses the pre-move seal check before it moves a ref', async () => {
    const subject = await fixture();
    const leafRef = parseRefName('refs/heads/feat/daemon-demo');
    const oldSha = parseCommitSha(subject.oldLeaf);
    const newSha = parseCommitSha(subject.advanced);
    if (!leafRef || !oldSha || !newSha) throw new Error('fixture must produce valid refs and shas');
    const moves: RestackMoveRef[] = [{ ref: leafRef, oldSha, newSha }];

    await expect(checkRestackPreMove(subject.repo, moves, leafRef, {
      git: makeGitRunner(subject.repo),
      ownershipBase: 'main',
    })).resolves.toMatchObject({
      kind: 'seal-refused',
      detail: expect.stringMatching(/\.docs\/stories\/unlisted\.md: unlisted.*ai-conductor register-artifact/s),
    });
    expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(subject.oldLeaf);
  });

  it('allows a clean manifest-backed child to pass the pre-move seal check', async () => {
    const subject = await fixture({ unlisted: false });
    const leafRef = parseRefName('refs/heads/feat/daemon-demo');
    const oldSha = parseCommitSha(subject.oldLeaf);
    const newSha = parseCommitSha(subject.advanced);
    if (!leafRef || !oldSha || !newSha) throw new Error('fixture must produce valid refs and shas');
    const ownership = await computeFeatureOwnership(worktreeFeatureOwnershipSource(subject.repo), 'demo', 'main');
    if (ownership.kind !== 'manifest') throw new Error(`expected manifest ownership, received ${ownership.kind}`);
    await createProtectedArtifactSeal({ projectRoot: subject.repo, baselineCommit: subject.oldLeaf, ownership });
    const moves: RestackMoveRef[] = [{ ref: leafRef, oldSha, newSha }];

    await expect(checkRestackPreMove(subject.repo, moves, leafRef, {
      git: makeGitRunner(subject.repo),
      ownershipBase: 'main',
    })).resolves.toEqual({ kind: 'clear' });
  });
});
