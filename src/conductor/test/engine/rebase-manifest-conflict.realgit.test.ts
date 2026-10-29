// Covers: S4.2, task:15
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { initTestRepo } from '../fixtures/git-repo.js';
import { createProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { computeFeatureOwnership, worktreeFeatureOwnershipSource } from '../../src/engine/feature-ownership.js';
import {
  docsKeepBothResolver,
  makeGitRunner,
  performRebase,
  resolveRebaseConflicts,
  type RebaseOutcome,
} from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];

async function makeRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  repos.push(repo);
  await initTestRepo(repo);
  await writeFile(join(repo, 'README.md'), 'base\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-qm', 'base']);
  return repo;
}

async function git(repo: string, args: string[]) {
  return execFile('git', args, { cwd: repo });
}

async function makeManifestAndStoryConflict(repo: string): Promise<RebaseOutcome> {
  await git(repo, ['checkout', '-qb', 'feature']);
  await mkdir(join(repo, '.docs', 'f'), { recursive: true });
  await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
  await writeFile(join(repo, '.docs', 'f', 'manifest.json'), '{"feature":"side"}\n');
  await writeFile(join(repo, '.docs', 'stories', 'x.md'), 'feature story\n');
  await git(repo, ['add', '.docs']);
  await git(repo, ['commit', '-qm', 'feature docs']);

  await git(repo, ['checkout', '-q', 'main']);
  await mkdir(join(repo, '.docs', 'f'), { recursive: true });
  await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
  await writeFile(join(repo, '.docs', 'f', 'manifest.json'), '{"feature":"base"}\n');
  await writeFile(join(repo, '.docs', 'stories', 'x.md'), 'base story\n');
  await git(repo, ['add', '.docs']);
  await git(repo, ['commit', '-qm', 'base docs']);
  await git(repo, ['checkout', '-q', 'feature']);

  return performRebase(makeGitRunner(repo), repo, 'main');
}

afterEach(async () => {
  while (repos.length > 0) {
    await rm(repos.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe('rebase manifest conflicts (Task 15, real git)', () => {
  it('declines a manifest conflict without creating keep-both manifest copies', async () => {
    const repo = await makeRepo('rebase-manifest-keep-both-');
    const paused = await makeManifestAndStoryConflict(repo);

    expect(paused).toMatchObject({
      kind: 'conflict_halt',
      conflicts: expect.arrayContaining(['.docs/f/manifest.json', '.docs/stories/x.md']),
    });
    const attempt = await docsKeepBothResolver({
      conflicts: ['.docs/f/manifest.json', '.docs/stories/x.md'],
      projectRoot: repo,
      baseRef: 'main',
    });

    expect(attempt).toMatchObject({ resolved: false });
    await expect(access(join(repo, '.docs', 'f', 'manifest~ours.json'))).rejects.toThrow();
    await expect(access(join(repo, '.docs', 'f', 'manifest~theirs.json'))).rejects.toThrow();
  });

  it('halts manifest conflicts before the model-driven resolver dispatches', async () => {
    const repo = await makeRepo('rebase-manifest-provider-');
    const paused = await makeManifestAndStoryConflict(repo);
    let providerDispatches = 0;

    const outcome = await resolveRebaseConflicts(
      makeGitRunner(repo),
      repo,
      paused,
      async () => {
        providerDispatches += 1;
        return { resolved: false, reason: 'fake provider should not run' };
      },
      3,
    );

    expect(providerDispatches).toBe(0);
    expect(outcome).toMatchObject({
      kind: 'conflict_halt',
      reason: expect.stringContaining('.docs/f/manifest.json'),
    });
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain("base branch's manifest");
      expect(outcome.reason).toContain('register-artifact');
    }
  });

  it('still keeps both sides of a story-only add/add conflict', async () => {
    const repo = await makeRepo('rebase-story-keep-both-');
    await git(repo, ['checkout', '-qb', 'feature']);
    await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
    await writeFile(join(repo, '.docs', 'stories', 'x.md'), 'feature story\n');
    await git(repo, ['add', '.docs']);
    await git(repo, ['commit', '-qm', 'feature story']);
    await git(repo, ['checkout', '-q', 'main']);
    await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
    await writeFile(join(repo, '.docs', 'stories', 'x.md'), 'base story\n');
    await git(repo, ['add', '.docs']);
    await git(repo, ['commit', '-qm', 'base story']);
    await git(repo, ['checkout', '-q', 'feature']);

    const paused = await performRebase(makeGitRunner(repo), repo, 'main');
    const outcome = await resolveRebaseConflicts(makeGitRunner(repo), repo, paused, docsKeepBothResolver, 1);

    expect(outcome.kind).not.toBe('conflict_halt');
    await expect(access(join(repo, '.docs', 'stories', 'x~ours.md'))).resolves.toBeUndefined();
    await expect(access(join(repo, '.docs', 'stories', 'x~theirs.md'))).resolves.toBeUndefined();
  });

  it('rebases over a base-inherited story change for a manifest-backed feature', async () => {
    const repo = await makeRepo('rebase-manifest-inherited-');
    await git(repo, ['checkout', '-qb', 'feature']);
    await mkdir(join(repo, '.docs', 'f'), { recursive: true });
    await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
    await writeFile(join(repo, '.docs', 'f', 'manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      slug: 'f',
      artifacts: [{ kind: 'plan', path: '.docs/plans/f.md' }],
    })}\n`);
    await writeFile(join(repo, '.docs', 'plans', 'f.md'), '# Feature plan\n');
    await git(repo, ['add', '.docs']);
    await git(repo, ['commit', '-qm', 'feature manifest']);
    await mkdir(join(repo, '.pipeline'), { recursive: true });
    await writeFile(join(repo, '.pipeline', 'conduct-state.json'), '{"feature_desc":"f"}\n');
    const ownership = await computeFeatureOwnership(worktreeFeatureOwnershipSource(repo), 'f', 'main');
    if (ownership.kind !== 'manifest') throw new Error('expected manifest ownership');
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(),
      ownership,
    });

    await git(repo, ['checkout', '-q', 'main']);
    await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
    await writeFile(join(repo, '.docs', 'stories', 'g.md'), '# Other feature story\n');
    await git(repo, ['add', '.docs']);
    await git(repo, ['commit', '-qm', 'base adds other story']);
    await git(repo, ['checkout', '-q', 'feature']);

    const outcome = await performRebase(makeGitRunner(repo), repo, 'main');

    expect(outcome.kind).not.toBe('conflict_halt');
    const base = (await git(repo, ['rev-parse', 'main'])).stdout.trim();
    expect((await git(repo, ['merge-base', '--is-ancestor', base, 'HEAD'])).stdout).toBe('');
  });
});
