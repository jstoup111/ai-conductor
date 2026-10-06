// Test: owner-gate merge-time derivation (merge-time.ts)
//
// Covers first-appearance time from git history (ADR-3):
//   - two ISO lines (newest-first log) → the EARLIEST (last line)
//   - empty stdout → null; non-zero git exit → null (indeterminate)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { firstAppearanceTime, resolveMarkerDecider } from '../../../src/engine/owner-gate/merge-time.js';
import type { GitRunner, GitResult } from '../../../src/engine/rebase.js';

const execFile = promisify(execFileCb);
const MARKER = '.docs/applicability/feature.md';

interface GitStub {
  git: GitRunner;
  calls: string[][];
}

function gitReturning(result: Partial<GitResult>): GitStub {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    return { exitCode: 0, stdout: '', stderr: '', ...result };
  };
  return { git, calls };
}

describe('firstAppearanceTime', () => {
  it('returns the earliest (first-appearance) commit time from a newest-first log', async () => {
    const { git, calls } = gitReturning({
      stdout: '2026-06-20T10:00:00Z\n2026-05-01T09:00:00Z\n',
    });
    await expect(firstAppearanceTime(git, 'main', '.docs/plans/my-slug.md')).resolves.toBe(
      '2026-05-01T09:00:00Z',
    );
    expect(calls[0]).toEqual([
      'log',
      'main',
      '--diff-filter=A',
      '--format=%cI',
      '--',
      '.docs/plans/my-slug.md',
    ]);
  });

  it('returns null on empty output (no history)', async () => {
    const { git } = gitReturning({ stdout: '\n' });
    await expect(firstAppearanceTime(git, 'main', '.docs/plans/x.md')).resolves.toBeNull();
  });

  it('returns null on a non-zero git exit (indeterminate)', async () => {
    const { git } = gitReturning({ exitCode: 128, stdout: '2026-05-01T09:00:00Z\n' });
    await expect(firstAppearanceTime(git, 'main', '.docs/plans/x.md')).resolves.toBeNull();
  });
});

describe('resolveMarkerDecider (real git)', () => {
  let repo: string;
  const git = (args: string[]) => execFile('git', args, { cwd: repo });

  async function commitMarker(
    content: string,
    message: string,
    author = 'Op Erator <operator@example.com>',
  ): Promise<string> {
    await writeFile(join(repo, MARKER), content);
    await git(['add', MARKER]);
    await git(['commit', '-q', `--author=${author}`, '-m', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  }

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'marker-decider-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await git(['config', 'user.name', 'Merge Bot']);
    await git(['config', 'user.email', 'merge-bot@example.com']);
    await mkdir(join(repo, '.docs', 'applicability'), { recursive: true });
    await writeFile(join(repo, 'README.md'), '# fixture\n');
    await git(['add', 'README.md']);
    await git(['commit', '-q', '-m', 'initial']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('returns the squash-style base commit author, committer, and sha', async () => {
    const commit = await commitMarker('steps: []\n', 'add applicability marker');

    await expect(resolveMarkerDecider(repo, 'main', MARKER)).resolves.toEqual({
      author: 'Op Erator <operator@example.com>',
      committer: 'Merge Bot <merge-bot@example.com>',
      commit,
    });
  });

  it('uses the latest first-parent base commit that amended the marker', async () => {
    await commitMarker('steps: []\n', 'add applicability marker');
    await git(['config', 'user.name', 'Second Committer']);
    await git(['config', 'user.email', 'second@example.com']);
    const commit = await commitMarker('steps:\n  - prd_audit\n', 'amend applicability marker', 'Second Author <second-author@example.com>');

    await expect(resolveMarkerDecider(repo, 'main', MARKER)).resolves.toEqual({
      author: 'Second Author <second-author@example.com>',
      committer: 'Second Committer <second@example.com>',
      commit,
    });
  });

  it('uses the first-parent merge commit rather than the inner branch commit', async () => {
    await git(['checkout', '-q', '-b', 'marker-branch']);
    await git(['config', 'user.name', 'Inner Committer']);
    await git(['config', 'user.email', 'inner@example.com']);
    await commitMarker('steps: []\n', 'branch marker', 'Inner Author <inner-author@example.com>');
    await git(['checkout', '-q', 'main']);
    await git(['config', 'user.name', 'Merge Committer']);
    await git(['config', 'user.email', 'merge@example.com']);
    await git(['merge', '--no-ff', '-q', 'marker-branch', '-m', 'merge marker branch']);
    const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();

    await expect(resolveMarkerDecider(repo, 'main', MARKER)).resolves.toEqual({
      author: 'Merge Committer <merge@example.com>',
      committer: 'Merge Committer <merge@example.com>',
      commit,
    });
  });

  it('returns unknown without a sha for an unknown base ref or a path with no history', async () => {
    await expect(resolveMarkerDecider(repo, 'does-not-exist', MARKER)).resolves.toEqual({ decider: 'unknown' });
    await expect(resolveMarkerDecider(repo, 'main', '.docs/applicability/missing.md')).resolves.toEqual({ decider: 'unknown' });
  });

  it('keeps marker attribution outside owner resolution and authorization consumers', async () => {
    const engineRoot = fileURLToPath(new URL('../../../src/engine/', import.meta.url));
    const sources = await Promise.all([
      readFile(join(engineRoot, 'owner-gate', 'merge-time.ts'), 'utf8'),
      readFile(join(engineRoot, 'owner-gate', 'identity.ts'), 'utf8'),
      readFile(join(engineRoot, 'owner-gate', 'gate.ts'), 'utf8'),
      readFile(join(engineRoot, 'daemon-backlog.ts'), 'utf8'),
    ]);

    expect(sources.join('\n')).not.toMatch(/resolveDaemonOwner\([^)]*resolveMarkerDecider/);
  });
});
