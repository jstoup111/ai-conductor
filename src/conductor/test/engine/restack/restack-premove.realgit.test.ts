// Covers: task:9
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { createProtectedArtifactSeal } from '../../../src/engine/protected-artifact-seal.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function fixture(advance: { path: string; content: string } = { path: 'base.txt', content: 'base advanced\n' }) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-premove-'));
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
  await git(['config', 'user.name', 'Restack pre-move']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\nbuild/\n');
  await git(['add', '.gitignore']);
  await commit('base', 'src/a.ts', 'base\n');
  await commit('base text', 'base.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('L1', 'leaf.txt', 'leaf\n');
  const oldLeaf = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  await git(['checkout', '-q', 'main']);
  const advancedDefault = await commit('base advance', advance.path, advance.content);
  await git(['checkout', '-q', 'feat/daemon-demo']);
  return { repo, git, oldLeaf, advancedDefault };
}

async function restack(subject: Awaited<ReturnType<typeof fixture>>, events?: ConductorEventEmitter) {
  return runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'base-refresh',
    newDefault: subject.advancedDefault,
    events,
    git: makeGitRunner(subject.repo),
  });
}

describe('runRestack pre-move checks (real local Git)', () => {
  it('refuses a branch whose changing tip is checked out in another worktree before refs move', async () => {
    const subject = await fixture();
    const other = await mkdtemp(join(tmpdir(), 'restack-premove-other-'));
    repositories.push(other);
    await subject.git(['worktree', 'add', '-q', other, 'feat/c1/demo']);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    const result = await restack(subject, events);

    expect(result.kind).toBe('halted');
    expect(refusals).toEqual([expect.objectContaining({ reason: 'checked-out-elsewhere', detail: other })]);
    expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(subject.oldLeaf);
  });

  it('refuses a tracked dirty path that overlaps the checked-out branch move without stashing it', async () => {
    const subject = await fixture({ path: 'src/a.ts', content: 'advanced\n' });
    await writeFile(join(subject.repo, 'src', 'a.ts'), 'operator edit\n');
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    const result = await restack(subject, events);

    expect(result.kind).toBe('halted');
    expect(refusals).toEqual([expect.objectContaining({ reason: 'dirty-overlap', detail: 'src/a.ts' })]);
    await expect(readFile(join(subject.repo, 'src', 'a.ts'), 'utf8')).resolves.toBe('operator edit\n');
    expect((await subject.git(['stash', 'list'])).stdout).toBe('');
    expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(subject.oldLeaf);
  });

  it('quarantines an untracked collision before its dry-run and then applies the restack', async () => {
    const subject = await fixture({ path: 'tmp/out.txt', content: 'tracked output\n' });
    await mkdir(join(subject.repo, 'tmp'), { recursive: true });
    await writeFile(join(subject.repo, 'tmp', 'out.txt'), 'untracked output\n');

    const result = await restack(subject);

    expect(result.kind).toBe('applied');
    await expect(readFile(join(subject.repo, '.pipeline', 'rebase-untracked-quarantine', 'tmp', 'out.txt'), 'utf8'))
      .resolves.toBe('untracked output\n');
    await expect(readFile(join(subject.repo, 'tmp', 'out.txt'), 'utf8')).resolves.toBe('tracked output\n');
  });

  it('maps a read-only quarantine failure to sync-collision before refs move', async () => {
    const subject = await fixture({ path: 'tmp/out.txt', content: 'tracked output\n' });
    await mkdir(join(subject.repo, 'tmp'), { recursive: true });
    await writeFile(join(subject.repo, 'tmp', 'out.txt'), 'untracked output\n');
    const quarantine = join(subject.repo, '.pipeline', 'rebase-untracked-quarantine');
    await mkdir(quarantine, { recursive: true });
    await chmod(quarantine, 0o555);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    try {
      const result = await restack(subject, events);

      expect(result.kind).toBe('halted');
      expect(refusals).toEqual([expect.objectContaining({ reason: 'sync-collision', detail: 'tmp/out.txt' })]);
      expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(subject.oldLeaf);
    } finally {
      await chmod(quarantine, 0o755);
    }
  });

  it('halts on a violated protected-artifact seal before refs move', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.docs', 'plans'), { recursive: true });
    await writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), 'approved\n');
    await subject.git(['add', '.docs/plans/demo.md']);
    await subject.git(['commit', '-qm', 'add approved plan']);
    await createProtectedArtifactSeal({
      projectRoot: subject.repo,
      baselineCommit: (await subject.git(['rev-parse', 'HEAD'])).stdout.trim(),
    });
    await writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), 'mutated\n');
    const oldLeaf = (await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim();

    const result = await restack(subject);

    expect(result.kind).toBe('halted');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('protected-artifact seal error');
    expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(oldLeaf);
  });

  it('does not treat a modified ignored file as tracked dirty work', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, 'build'), { recursive: true });
    await writeFile(join(subject.repo, 'build', 'output.txt'), 'ignored output\n');

    const result = await restack(subject);

    expect(result.kind).toBe('applied');
  });
});
