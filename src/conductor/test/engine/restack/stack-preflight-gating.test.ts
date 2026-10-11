// Covers: task:31.1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-gating-'));
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
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await commit('closed two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', closedTwo]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  return { repo, git, commit, closed };
}

async function appendRepair(subject: Awaited<ReturnType<typeof fixture>>) {
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  await subject.commit('operator change', 'operator.txt', 'X\n');
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
}

describe('stack preflight live-HALT gate', () => {
  it('recovers only and leaves an appended child unreplayed while HALT is live', async () => {
    const subject = await fixture();
    await appendRepair(subject);
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'operator action required\n');

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(subject.closed);
    await expect(subject.git(['show', 'feat/daemon-demo:operator.txt'])).rejects.toThrow();
  });

  it('repairs the stack after a matching staged authorization clears its live HALT', async () => {
    const subject = await fixture();
    await appendRepair(subject);
    let liveHalt = true;
    let prepared = false;

    await expect(runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      git: makeGitRunner(subject.repo),
      hasLiveHalt: async () => liveHalt,
      hasMatchingResumeAuthorization: async () => true,
      prepareResume: async () => { prepared = true; liveHalt = false; },
    })).resolves.toEqual({ kind: 'repaired' });
    expect(prepared).toBe(true);
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim())
      .toBe((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim());
    expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
  });
});
