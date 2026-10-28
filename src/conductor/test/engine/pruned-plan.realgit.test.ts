// Covers: task:11
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readPlanOrPruned } from '../../src/engine/pruned-plan.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
const planPath = '.docs/plans/demo.md';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mustSucceed(git: GitRunner, args: string[]): Promise<string> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'pruned-plan-'));
  roots.push(repo);
  await initTestRepo(repo);
  const realGit = makeGitRunner(repo);
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });

  const commit = async (message: string): Promise<string> => {
    await mustSucceed(realGit, ['add', '-A']);
    await mustSucceed(realGit, ['commit', '-qm', message]);
    return mustSucceed(realGit, ['rev-parse', 'HEAD']);
  };
  const readAt = async (commitish: string, path: string): Promise<Buffer | null> => {
    const result = await realGit(['show', `${commitish}:${path}`]);
    return result.exitCode === 0 ? Buffer.from(result.stdout, 'utf8') : null;
  };
  return { repo, realGit, commit, readAt };
}

describe('readPlanOrPruned (real local Git)', () => {
  it('returns the plan at the requested commit without searching deletion history', async () => {
    const f = await fixture();
    const content = '# Current plan';
    await writeFile(join(f.repo, planPath), content);
    const head = await f.commit('add plan');
    const calls: string[][] = [];
    const git: GitRunner = async (args, options) => {
      calls.push([...args]);
      return f.realGit(args, options);
    };

    await expect(readPlanOrPruned(f.readAt, git, head, planPath)).resolves.toEqual(Buffer.from(content));
    expect(calls.some(([command]) => command === 'log')).toBe(false);
  });

  it('reads a plan from the parent of its deleting commit', async () => {
    const f = await fixture();
    const content = '# Original plan';
    await writeFile(join(f.repo, planPath), content);
    await f.commit('add plan');
    await rm(join(f.repo, planPath));
    const deletedAt = await f.commit('delete plan');

    await expect(readPlanOrPruned(f.readAt, f.realGit, deletedAt, planPath)).resolves.toEqual(Buffer.from(content));
  });

  it('uses the content before the most recent deletion after a plan is re-added', async () => {
    const f = await fixture();
    await writeFile(join(f.repo, planPath), '# First plan');
    await f.commit('add first plan');
    await rm(join(f.repo, planPath));
    await f.commit('delete first plan');
    const current = '# Replacement plan';
    await writeFile(join(f.repo, planPath), current);
    await f.commit('add replacement plan');
    await rm(join(f.repo, planPath));
    const deletedAt = await f.commit('delete replacement plan');

    await expect(readPlanOrPruned(f.readAt, f.realGit, deletedAt, planPath)).resolves.toEqual(Buffer.from(current));
  });

  it('refuses when no reachable deletion supplied the missing plan', async () => {
    const f = await fixture();
    const head = await mustSucceed(f.realGit, ['commit', '--allow-empty', '-qm', 'empty history']);

    await expect(readPlanOrPruned(f.readAt, f.realGit, head, planPath)).resolves.toMatchObject({
      kind: 'refused', code: 'shipment-plan-pruned', path: planPath,
    });
  });

  it('refuses with the failed deletion-history read', async () => {
    const f = await fixture();
    const head = await mustSucceed(f.realGit, ['commit', '--allow-empty', '-qm', 'empty history']);
    const git: GitRunner = async (args, options) => args[0] === 'log'
      ? { exitCode: 1, stdout: '', stderr: 'deletion history unavailable' }
      : f.realGit(args, options);

    await expect(readPlanOrPruned(f.readAt, git, head, planPath)).resolves.toMatchObject({
      kind: 'refused',
      code: 'shipment-plan-pruned',
      path: planPath,
      detail: expect.stringContaining('deletion history unavailable'),
    });
  });
});
