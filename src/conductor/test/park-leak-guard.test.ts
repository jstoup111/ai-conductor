import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  diffParkedMarkers,
  resolveRealParkedDir,
  snapshotParkedMarkers,
} from './park-leak-guard.js';
import { applyParkTeardownDecision } from './global-setup.js';

describe('park-leak-guard: snapshotParkedMarkers & diffParkedMarkers', () => {
  const temporaryDirectories: string[] = [];

  async function createMarkerDirectory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);
    const markers = join(root, '.daemon', 'parked');
    await mkdir(markers, { recursive: true });
    return markers;
  }

  async function createGitRepository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-repo-'));
    temporaryDirectories.push(root);
    await execa('git', ['init', '--initial-branch=main', root]);
    await execa('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
    await execa('git', ['-C', root, 'config', 'user.name', 'Test User']);
    await execa('git', ['-C', root, 'commit', '--allow-empty', '-m', 'initial']);
    return root;
  }

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('snapshots top-level regular marker files by slug and content', async () => {
    const markers = await createMarkerDirectory();
    await writeFile(join(markers, 'feature-a'), 'parked by operator\n');
    await mkdir(join(markers, 'nested'));

    await expect(snapshotParkedMarkers(markers)).resolves.toEqual({
      exists: true,
      markers: { 'feature-a': 'parked by operator\n' },
    });
  });

  it('returns an empty snapshot when the parked marker directory is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);

    await expect(snapshotParkedMarkers(join(root, '.daemon', 'parked'))).resolves.toEqual({
      exists: false,
      markers: {},
    });
  });

  it('returns an absent snapshot when the parked marker baseline cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);
    const markers = join(root, '.daemon', 'parked');
    await mkdir(join(root, '.daemon'));
    await writeFile(markers, 'not a directory');

    await expect(snapshotParkedMarkers(markers)).resolves.toEqual({
      exists: false,
      markers: {},
    });
  });

  it('classifies added, removed, and changed marker content without false positives', () => {
    expect(diffParkedMarkers(
      { exists: true, markers: { unchanged: 'same', removed: 'before', modified: 'old' } },
      { exists: true, markers: { unchanged: 'same', added: 'after', modified: 'new' } },
    )).toEqual({
      added: ['added'],
      removed: ['removed'],
      modified: ['modified'],
    });
  });

  it('returns empty diff arrays for identical snapshots', () => {
    expect(diffParkedMarkers(
      { exists: true, markers: { feature: 'parked by operator\n' } },
      { exists: true, markers: { feature: 'parked by operator\n' } },
    )).toEqual({ added: [], removed: [], modified: [] });
  });

  it('returns an empty diff when either snapshot is absent', () => {
    expect([
      diffParkedMarkers(
        { exists: false, markers: {} },
        { exists: true, markers: { feature: 'parked by operator\n' } },
      ),
      diffParkedMarkers(
        { exists: true, markers: { feature: 'parked by operator\n' } },
        { exists: false, markers: {} },
      ),
    ]).toEqual([
      { added: [], removed: [], modified: [] },
      { added: [], removed: [], modified: [] },
    ]);
  });

  it.each([
    ['added', { added: ['added-slug'], removed: [], modified: [] }, 'added-slug'],
    ['removed', { added: [], removed: ['removed-slug'], modified: [] }, 'removed-slug'],
    ['modified', { added: [], removed: [], modified: ['modified-slug'] }, 'modified-slug'],
  ])('throws for %s parked marker leaks', (_kind, diff, slug) => {
    expect(() => applyParkTeardownDecision(diff)).toThrow(new RegExp(`${slug}.*#1251`));
  });

  it('returns silently when the parked marker diff is empty', () => {
    expect(() => applyParkTeardownDecision({ added: [], removed: [], modified: [] })).not.toThrow();
  });

  it('resolves the real parked directory from a fixture repository and linked worktree', async () => {
    const root = await createGitRepository();
    const worktree = join(root, 'linked-worktree');
    await execa('git', ['-C', root, 'worktree', 'add', '-b', 'linked', worktree]);

    await expect(Promise.all([
      resolveRealParkedDir(root),
      resolveRealParkedDir(worktree),
    ])).resolves.toEqual([
      join(root, '.daemon', 'parked'),
      join(root, '.daemon', 'parked'),
    ]);
  });

  it('returns null outside a Git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-non-git-'));
    temporaryDirectories.push(root);

    await expect(resolveRealParkedDir(root)).resolves.toBeNull();
  });
});
