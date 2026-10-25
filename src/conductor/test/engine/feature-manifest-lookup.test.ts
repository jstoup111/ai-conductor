// Covers: task:7

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import type { BacklogTreeSource } from '../../src/engine/backlog-tree-source.js';
import {
  backlogTreeManifestSource,
  gitRefManifestSource,
  MalformedFeatureManifestError,
  resolveFeatureArtifact,
  worktreeManifestSource,
} from '../../src/engine/feature-manifest-source.js';

const execFile = promisify(execFileCallback);
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(slug: string, artifacts: readonly { kind: string; path: string }[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    slug,
    artifacts,
  });
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'feature-manifest-lookup-'));
  cleanupRoots.push(root);

  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }));

  return root;
}

function fakeBacklogTree(files: Record<string, string>): BacklogTreeSource {
  return {
    async listPlanFiles() {
      return [];
    },
    async listShippedFiles() {
      return [];
    },
    async listAdrFiles() {
      return [];
    },
    async readFile(path) {
      return files[path] ?? null;
    },
  };
}

async function commitFixture(root: string): Promise<void> {
  await execFile('git', ['init', '--initial-branch=main'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Feature manifest fixture'], { cwd: root });
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
}

describe('engine/feature-manifest-source — resolveFeatureArtifact', () => {
  it('uses a manifest stories entry, whether it is legacy-shaped or relocated, without consulting legacy lookup', async () => {
    const root = await writeTree({
      '.docs/f/manifest.json': manifest('f', [
        { kind: 'plan', path: '.docs/plans/f.md' },
        { kind: 'stories', path: '.docs/f/2-stories.md' },
      ]),
      '.docs/plans/f.md': '# Plan',
      '.docs/stories/f.md': '# Legacy stories',
      '.docs/f/2-stories.md': '# Relocated stories',
    });
    const legacy = vi.fn(async () => ['.docs/stories/f.md']);

    await expect(
      resolveFeatureArtifact(worktreeManifestSource(root), 'f', 'stories', legacy),
    ).resolves.toEqual({
      origin: 'manifest',
      paths: ['.docs/f/2-stories.md'],
      missing: [],
    });
    expect(legacy).not.toHaveBeenCalled();

    await writeFile(
      join(root, '.docs/f/manifest.json'),
      manifest('f', [
        { kind: 'plan', path: '.docs/plans/f.md' },
        { kind: 'stories', path: '.docs/stories/f.md' },
      ]),
    );
    const legacyShaped = vi.fn(async () => ['.docs/f/ignored.md']);

    await expect(
      resolveFeatureArtifact(worktreeManifestSource(root), 'f', 'stories', legacyShaped),
    ).resolves.toEqual({
      origin: 'manifest',
      paths: ['.docs/stories/f.md'],
      missing: [],
    });
    expect(legacyShaped).not.toHaveBeenCalled();
  });

  it('uses legacy lookup only when the feature has no manifest', async () => {
    const root = await writeTree({
      '.docs/stories/f.md': '# Legacy stories',
    });
    const legacy = vi.fn(async () => ['.docs/stories/f.md']);

    await expect(
      resolveFeatureArtifact(worktreeManifestSource(root), 'f', 'stories', legacy),
    ).resolves.toEqual({
      origin: 'legacy',
      paths: ['.docs/stories/f.md'],
    });
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it('treats a present manifest with no requested kind as authoritative', async () => {
    const root = await writeTree({
      '.docs/f/manifest.json': manifest('f', [
        { kind: 'plan', path: '.docs/plans/f.md' },
      ]),
      '.docs/plans/f.md': '# Plan',
      '.docs/specs/f.md': '# Legacy PRD',
    });
    const legacy = vi.fn(async () => ['.docs/specs/f.md']);

    await expect(
      resolveFeatureArtifact(worktreeManifestSource(root), 'f', 'prd', legacy),
    ).resolves.toEqual({
      origin: 'manifest',
      paths: [],
      missing: [],
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed manifest without falling back to legacy files', async () => {
    const root = await writeTree({
      '.docs/f/manifest.json': '{ malformed JSON',
      '.docs/stories/f.md': '# Legacy stories',
    });
    const legacy = vi.fn(async () => ['.docs/stories/f.md']);

    let thrown: unknown;
    try {
      await resolveFeatureArtifact(worktreeManifestSource(root), 'f', 'stories', legacy);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MalformedFeatureManifestError);
    expect((thrown as Error).message).toContain('.docs/f/manifest.json');
    expect((thrown as Error).message).toMatch(/not valid JSON|JSON/i);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('keeps feature manifests isolated when resolving an artifact', async () => {
    const root = await writeTree({
      '.docs/a/manifest.json': manifest('a', [
        { kind: 'plan', path: '.docs/a/plan.md' },
      ]),
      '.docs/a/plan.md': '# A plan',
      '.docs/b/manifest.json': manifest('b', [
        { kind: 'plan', path: '.docs/b/plan.md' },
      ]),
      '.docs/b/plan.md': '# B plan',
    });
    const legacy = vi.fn(async () => ['.docs/plans/a.md']);

    await expect(
      resolveFeatureArtifact(worktreeManifestSource(root), 'a', 'plan', legacy),
    ).resolves.toEqual({
      origin: 'manifest',
      paths: ['.docs/a/plan.md'],
      missing: [],
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('reports listed-but-missing artifacts consistently for worktree, git-ref, and backlog-tree sources', async () => {
    const files = {
      '.docs/f/manifest.json': manifest('f', [
        { kind: 'plan', path: '.docs/plans/f.md' },
        { kind: 'coherence', path: '.docs/f/missing-coherence.md' },
      ]),
      '.docs/plans/f.md': '# Plan',
    };
    const root = await writeTree(files);
    await commitFixture(root);
    const sources = [
      ['worktree', worktreeManifestSource(root)],
      ['git ref', gitRefManifestSource(root, 'HEAD')],
      ['backlog tree', backlogTreeManifestSource(fakeBacklogTree(files))],
    ] as const;

    for (const [name, source] of sources) {
      const legacy = vi.fn(async () => ['.docs/coherence/f.md']);
      await expect(
        resolveFeatureArtifact(source, 'f', 'coherence', legacy),
        name,
      ).resolves.toEqual({
        origin: 'manifest',
        paths: ['.docs/f/missing-coherence.md'],
        missing: ['.docs/f/missing-coherence.md'],
      });
      expect(legacy, name).not.toHaveBeenCalled();
    }
  });
});
