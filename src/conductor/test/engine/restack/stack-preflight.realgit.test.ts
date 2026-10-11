// Covers: task:30
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

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
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-'));
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
  const closedOne = await commit('closed one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closedOne]);
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
  return { repo, git, commit, closedOne };
}

describe('runStackPreflight (real local Git)', () => {
  it('repairs an appended closed child, moves its closure, and replays every descendant', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('operator change', 'operator.txt', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'repaired' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim())
      .toBe((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim());
    expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });

  it('does not replay a closed branch extended only by a halt record', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
    const before = (await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim();
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'clear' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(before);
  });

  it('halts closed-child rewrites without moving their closure', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.git(['reset', '--hard', 'HEAD^']);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(subject.closedOne);
    expect(refusals).toEqual([expect.objectContaining({ reason: 'closed-child-rewritten', child: 1 })]);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('chains a base refresh behind the repair and consumes its re-kick before the durable hand-off', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'main']);
    await subject.commit('base advance', 'base.txt', 'advanced\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('operator change', 'operator.txt', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const events = new ConductorEventEmitter();
    const planned: { cause?: string; opId?: string }[] = [];
    events.on('restack_planned', (event) => planned.push(event));
    const phases: string[] = [];

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', baseRefreshDue: true,
      consumeRekick: async () => { phases.push('consume'); }, events, git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'repaired' });
    expect(phases).toEqual(['consume']);
    expect(planned.map(({ cause }) => cause)).toEqual(['feature-repair', 'base-refresh']);
    expect(planned[0]!.opId).not.toBe(planned[1]!.opId);
  });
});
