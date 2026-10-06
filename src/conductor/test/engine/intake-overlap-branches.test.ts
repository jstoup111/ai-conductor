// Covers: task:4
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import {
  collectInFlightOverlaps,
  selectInFlightBranches,
  traceBranchIssue,
} from '../../src/engine/engineer/intake/overlap-sources.js';

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

async function createChildBranchesFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'intake-overlap-child-'));
  fixtureRoots.push(root);
  const remote = join(root, 'origin.git');
  const repo = join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test User');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src/markers.ts'), 'export const marker = 0;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', '-u', 'origin', 'main');

  await commitFile(repo, 'feat/c1/x', 'src/markers.ts', 'export const marker = 1;\n', '2020-01-01T00:00:00Z');
  git(repo, 'push', '-q', 'origin', 'feat/c1/x');
  git(repo, 'switch', '-q', 'main');

  await commitFile(repo, 'feat/cool/x', 'src/markers.ts', 'export const marker = 2;\n', '2019-01-01T00:00:00Z');
  git(repo, 'switch', '-q', 'main');

  await commitFile(repo, 'feat/c1-x/baz', 'src/markers.ts', 'export const marker = 3;\n', '2018-01-01T00:00:00Z');
  git(repo, 'switch', '-q', 'main');

  return repo;
}

async function createLeafAndChildFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'intake-overlap-leaf-child-'));
  fixtureRoots.push(root);
  const remote = join(root, 'origin.git');
  const repo = join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test User');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src/markers.ts'), 'export const marker = 0;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', '-u', 'origin', 'main');

  await commitFile(repo, 'feat/daemon-x', 'src/markers.ts', 'export const marker = 1;\n', '2020-01-01T00:00:00Z');
  git(repo, 'push', '-q', 'origin', 'feat/daemon-x');
  git(repo, 'switch', '-q', 'main');

  await commitFile(repo, 'feat/c1/x', 'src/markers.ts', 'export const marker = 2;\n', '2019-01-01T00:00:00Z');
  git(repo, 'push', '-q', 'origin', 'feat/c1/x');
  git(repo, 'switch', '-q', 'main');

  return repo;
}

async function recordShipped(repo: string, slug: string): Promise<void> {
  await mkdir(join(repo, '.docs/shipped'), { recursive: true });
  await writeFile(join(repo, `.docs/shipped/${slug}.md`), 'shipped\n');
  git(repo, 'add', `.docs/shipped/${slug}.md`);
  git(repo, 'commit', '-q', '-m', `record shipped ${slug}`);
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

  it('selectInFlightBranches drops unrecognized child-like refs before any further git call', async () => {
    const calls: string[][] = [];
    const gitRunner: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'for-each-ref') {
        return { exitCode: 0, stdout: 'feat/c1/a/b\nfeat/c1/\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '0', stderr: '' };
    };

    const result = await selectInFlightBranches({ git: gitRunner, baseRef: 'main' });

    expect(result.branches).toEqual([]);
    expect(result.skipNotes).toEqual([]);
    expect(calls.filter((args) => args[0] !== 'for-each-ref')).toEqual([]);
  });

  it('selects both local and remote child refs and excludes malformed child-like names on real git', async () => {
    const repo = await createChildBranchesFixture();

    const result = await selectInFlightBranches({
      git: makeGitRunner(repo),
      baseRef: 'main',
    });

    expect(result.branches).toEqual(['feat/c1/x', 'origin/feat/c1/x']);
  });
});

describe('engineer/intake/overlap-sources — child attribution to the parent feature (Task 12)', () => {
  it('traceBranchIssue reads the parent intake marker for leaf and child branches', async () => {
    const calls: string[][] = [];
    const gitRunner: GitRunner = async (args) => {
      calls.push(args);
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    const readIssueState = async (): Promise<'OPEN' | 'CLOSED' | string | null> => 'CLOSED';

    expect(await traceBranchIssue({
      git: gitRunner,
      branch: 'feat/daemon-x',
      repository: 'owner/repo',
      readIssueState,
    })).toBeNull();
    expect(await traceBranchIssue({
      git: gitRunner,
      branch: 'feat/c2/x',
      repository: 'owner/repo',
      readIssueState,
    })).toBeNull();

    expect(calls).toEqual([
      ['show', 'feat/daemon-x:.docs/intake/x.md'],
      ['show', 'feat/c2/x:.docs/intake/x.md'],
    ]);
  });

  it('isShippedBranch probes the parent shipped record for leaf and child branches', async () => {
    const calls: string[][] = [];
    const gitRunner: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'for-each-ref') {
        return { exitCode: 0, stdout: 'feat/daemon-x\nfeat/c2/x\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await selectInFlightBranches({ git: gitRunner, baseRef: 'main' });

    const shippedProbes = calls.filter((args) => args[0] === 'cat-file');
    expect(shippedProbes).toEqual([
      ['cat-file', '-e', 'main:.docs/shipped/x.md'],
      ['cat-file', '-e', 'main:.docs/shipped/x.md'],
    ]);
    expect(shippedProbes.flat().join(' ')).not.toMatch(/c2\.md|x-c2\.md/);
  });

  it('excludes a shipped child exactly like a shipped leaf and includes both when unshipped', async () => {
    const repo = await createLeafAndChildFixture();

    const unshipped = await selectInFlightBranches({ git: makeGitRunner(repo), baseRef: 'main' });
    expect(unshipped.branches).toEqual(expect.arrayContaining(['feat/daemon-x', 'feat/c1/x']));

    await recordShipped(repo, 'x');
    const shipped = await selectInFlightBranches({ git: makeGitRunner(repo), baseRef: 'main' });
    expect(shipped.branches).toEqual([]);
  });
});
