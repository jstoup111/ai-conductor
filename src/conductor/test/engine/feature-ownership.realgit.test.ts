// Covers: task:1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  computeFeatureOwnership,
  renderOwnershipRefusal,
  worktreeFeatureOwnershipSource,
} from '../../src/engine/feature-ownership.js';
import type { DocsPath } from '../../src/engine/feature-manifest.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout.trim();
}

async function write(root: string, path: string, contents = `${path}\n`): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), contents, 'utf8');
}

async function commit(root: string, message: string): Promise<void> {
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', message]);
}

function manifest(slug = 'f', artifacts: readonly { kind: string; path: string }[] = [
  { kind: 'plan', path: '.docs/plans/f.md' },
]): string {
  return `${JSON.stringify({ schemaVersion: 1, slug, artifacts }, null, 2)}\n`;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'feature-ownership-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'feature-ownership@example.test']);
  await git(root, ['config', 'user.name', 'Feature ownership']);
  await write(root, 'README.md', 'base\n');
  await commit(root, 'base');
  return root;
}

async function addManifestFeature(
  root: string,
  artifacts: readonly { kind: string; path: string }[] = [{ kind: 'plan', path: '.docs/plans/f.md' }],
): Promise<void> {
  await write(root, '.docs/f/manifest.json', manifest('f', artifacts));
  for (const artifact of artifacts) await write(root, artifact.path);
  await commit(root, 'manifest-backed feature');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('computeFeatureOwnership (real local Git)', () => {
  it('reports missing, committed unlisted, and untracked unlisted artifacts together', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root, [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'coherence', path: '.docs/coherence/f.md' },
    ]);
    await rm(join(root, '.docs/coherence/f.md'));
    await write(root, '.docs/stories/extra.md');
    await commit(root, 'unlisted story');
    await write(root, '.docs/f/notes.md');

    await expect(computeFeatureOwnership(worktreeFeatureOwnershipSource(root), 'f', 'main')).resolves.toEqual({
      kind: 'drift',
      manifestPath: '.docs/f/manifest.json',
      drift: [
        { path: '.docs/coherence/f.md', reason: 'missing' },
        { path: '.docs/stories/extra.md', reason: 'unlisted' },
        { path: '.docs/f/notes.md', reason: 'unlisted' },
      ],
    });
  });

  it('ignores non-doc additions and excluded release waivers', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root);
    await write(root, 'src/x.ts');
    await write(root, '.docs/release-waivers/f.md');
    await commit(root, 'implementation and waiver');

    await expect(computeFeatureOwnership(worktreeFeatureOwnershipSource(root), 'f', 'main')).resolves.toMatchObject({
      kind: 'manifest',
      manifestPath: '.docs/f/manifest.json',
      ownedPaths: ['.docs/plans/f.md'],
    });
  });

  it('does not attribute its parent branch additions to a stacked child', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'parent']);
    await write(root, '.docs/stories/p.md');
    await commit(root, 'parent story');
    await git(root, ['checkout', '-qb', 'child']);
    await addManifestFeature(root);

    await expect(computeFeatureOwnership(worktreeFeatureOwnershipSource(root), 'f', 'parent')).resolves.toMatchObject({ kind: 'manifest' });
  });

  it('does not attribute a rebased base branch addition to the feature', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root);
    await git(root, ['checkout', '-q', 'main']);
    await write(root, '.docs/stories/other.md');
    await commit(root, 'base story');
    await git(root, ['checkout', '-q', 'feature']);
    await git(root, ['rebase', 'main']);

    await expect(computeFeatureOwnership(worktreeFeatureOwnershipSource(root), 'f', 'main')).resolves.toMatchObject({ kind: 'manifest' });
  });

  it('returns legacy without evaluating feature-added paths when its manifest is absent', async () => {
    const root = await fixture();
    const real = makeGitRunner(root);
    const calls: string[][] = [];
    const recordingGit: GitRunner = async (args, options) => {
      calls.push(args);
      return real(args, options);
    };

    await expect(computeFeatureOwnership(worktreeFeatureOwnershipSource(root, recordingGit), 'f', 'main')).resolves.toEqual({ kind: 'legacy' });
    expect(calls).toEqual([]);
  });

  it('returns the parser reason for a manifest whose slug differs from its folder', async () => {
    const root = await fixture();
    await write(root, '.docs/f/manifest.json', manifest('g'));
    await commit(root, 'malformed manifest');

    const ownership = await computeFeatureOwnership(worktreeFeatureOwnershipSource(root), 'f', 'main');
    expect(ownership).toMatchObject({ kind: 'malformed', manifestPath: '.docs/f/manifest.json' });
    if (ownership.kind === 'malformed') {
      expect(ownership.reason).toContain('f');
      expect(ownership.reason).toContain('g');
    }
  });
});

describe('renderOwnershipRefusal', () => {
  it('names every drift path with its specific recovery', () => {
    expect(renderOwnershipRefusal({
      kind: 'drift',
      manifestPath: '.docs/f/manifest.json' as DocsPath,
      drift: [
        { path: '.docs/coherence/f.md', reason: 'missing' },
        { path: '.docs/stories/extra.md', reason: 'unlisted' },
        { path: '.docs/f/notes.md', reason: 'unlisted' },
      ],
    })).toMatchInlineSnapshot(`
      "Feature artifact manifest drift:\n.docs/coherence/f.md: missing — restore the file.\n.docs/stories/extra.md: unlisted — register it with ai-conductor register-artifact.\n.docs/f/notes.md: unlisted — register it with ai-conductor register-artifact."
    `);
  });
});
