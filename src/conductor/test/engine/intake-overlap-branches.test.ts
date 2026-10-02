// Covers: task:4
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../src/engine/rebase.js';
import { collectInFlightOverlaps } from '../../src/engine/engineer/intake/overlap-sources.js';

const fixtureRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function gitAt(cwd: string, timestamp: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: timestamp, GIT_COMMITTER_DATE: timestamp },
  });
}

async function commitFile(
  repo: string,
  branch: string,
  path: string,
  contents: string,
  timestamp: string,
): Promise<void> {
  git(repo, 'switch', '-q', '-C', branch);
  await mkdir(join(repo, path, '..'), { recursive: true });
  await writeFile(join(repo, path), contents);
  git(repo, 'add', path);
  gitAt(repo, timestamp, 'commit', '-q', '-m', `${branch}: ${path}`);
}

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'intake-overlap-branches-'));
  fixtureRoots.push(root);
  const remote = join(root, 'origin.git');
  const repo = join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test User');
  await mkdir(join(repo, 'src/halt'), { recursive: true });
  await writeFile(join(repo, 'src/halt/markers.ts'), 'export const marker = 0;\n');
  await writeFile(join(repo, 'src/spec.ts'), 'export const spec = 0;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', '-u', 'origin', 'main');

  await commitFile(repo, 'feat/daemon-a', 'src/halt/markers.ts', 'export const marker = 1;\n', '2020-01-01T00:00:00Z');
  git(repo, 'switch', '-q', 'main');
  await commitFile(repo, 'spec/b', 'src/spec.ts', 'export const spec = 1;\n', '2019-01-01T00:00:00Z');
  git(repo, 'push', '-q', 'origin', 'spec/b');
  git(repo, 'switch', '-q', 'main');
  await commitFile(repo, 'spec/b2', 'src/halt/markers.ts', 'export const marker = 2;\n', '2018-01-01T00:00:00Z');
  git(repo, 'push', '-q', 'origin', 'spec/b2');
  git(repo, 'switch', '-q', 'main');
  git(repo, 'branch', '-D', 'spec/b2');

  git(repo, 'branch', 'feat/daemon-c');
  await commitFile(repo, 'fix/d', 'src/halt/markers.ts', 'export const marker = 3;\n', '2017-01-01T00:00:00Z');
  git(repo, 'switch', '-q', '--orphan', 'feat/daemon-unrelated-history');
  await writeFile(join(repo, 'unrelated.ts'), 'export const unrelated = true;\n');
  git(repo, 'add', '.');
  gitAt(repo, '2016-01-01T00:00:00Z', 'commit', '-q', '-m', 'unrelated');

  git(repo, 'switch', '-q', 'main');
  await commitFile(repo, 'feat/daemon-e', 'src/halt/markers.ts', 'export const marker = 4;\n', '2021-01-01T00:00:00Z');
  git(repo, 'switch', '-q', 'main');
  await mkdir(join(repo, '.docs/shipped'), { recursive: true });
  await writeFile(join(repo, '.docs/shipped/e.md'), 'shipped\n');
  git(repo, 'add', '.docs/shipped/e.md');
  git(repo, 'commit', '-q', '-m', 'record shipped daemon e');
  return repo;
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('engineer/intake/overlap-sources — in-flight branch overlaps (Task 4)', () => {
  it('finds unshipped spec and daemon branches, while skipping merged, shipped, and unrelated history', async () => {
    const repo = await createFixture();

    const result = await collectInFlightOverlaps({
      git: makeGitRunner(repo),
      baseRef: 'main',
      citedPaths: ['src/halt/markers.ts', 'src/spec.ts'],
      maxBranches: 100,
    });

    expect(result.overlaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ branch: 'feat/daemon-a', sharedPaths: ['src/halt/markers.ts'] }),
      expect.objectContaining({ branch: 'spec/b', sharedPaths: ['src/spec.ts'] }),
      expect.objectContaining({ branch: 'origin/spec/b2', sharedPaths: ['src/halt/markers.ts'] }),
    ]));
    expect(result.overlaps.map((overlap) => overlap.branch)).not.toEqual(expect.arrayContaining([
      'feat/daemon-c', 'fix/d', 'feat/daemon-e', 'feat/daemon-unrelated-history',
    ]));
    expect(result.skipNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('feat/daemon-unrelated-history'),
    ]));

    await expect(collectInFlightOverlaps({
      git: makeGitRunner(repo),
      baseRef: 'main',
      citedPaths: ['src/halt/markers.ts'],
      maxBranches: 1,
    })).resolves.toMatchObject({
      overlaps: [{ branch: 'feat/daemon-a', sharedPaths: ['src/halt/markers.ts'] }],
    });
  });
});
