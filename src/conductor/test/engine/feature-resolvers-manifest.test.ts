// Covers: task:10, task:rem-prd-audit-10

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveFeaturePlanPath,
  resolveFeaturePrdPaths,
  resolveFeatureStoriesPath,
  type ArtifactResolutionContext,
} from '../../src/engine/artifacts.js';
import { MalformedFeatureManifestError, worktreeManifestSource } from '../../src/engine/feature-manifest-source.js';

type StoriesReferenceResolver = (
  source: ReturnType<typeof worktreeManifestSource>,
  planRepoPath: string,
  planContent: string,
) => Promise<string | null>;

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(slug: string, artifacts: readonly { kind: string; path: string }[]): string {
  return JSON.stringify({ schemaVersion: 1, slug, artifacts });
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'feature-resolvers-manifest-'));
  cleanupRoots.push(root);
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }));
  return root;
}

async function resolveFeatureStoriesRef(): Promise<StoriesReferenceResolver | undefined> {
  const module = await import('../../src/engine/plan-stories-reference.js') as typeof import('../../src/engine/plan-stories-reference.js') & {
    resolveFeatureStoriesRef?: StoriesReferenceResolver;
  };
  return module.resolveFeatureStoriesRef;
}

function resolutionContext(featureDesc: string): ArtifactResolutionContext {
  return {
    featureDesc,
    featureIdentities: [featureDesc],
    changedPaths: new Set(),
  };
}

describe('feature resolvers — manifest routing', () => {
  it('keeps a feature’s manifest stories entry authoritative over its plan’s cross-feature Stories line', async () => {
    const root = await writeTree({
      '.docs/f/manifest.json': manifest('f', [
        { kind: 'plan', path: '.docs/plans/f.md' },
        { kind: 'stories', path: '.docs/stories/f.md' },
      ]),
      '.docs/plans/f.md': '**Stories:** .docs/stories/other.md\n',
      '.docs/stories/f.md': '# Feature stories\n',
      '.docs/stories/other.md': '# Other stories\n',
    });
    const storiesRef = await resolveFeatureStoriesRef();

    expect(storiesRef).toBeTypeOf('function');
    if (!storiesRef) return;

    await expect(
      storiesRef(worktreeManifestSource(root), '.docs/plans/f.md', '**Stories:** .docs/stories/other.md\n'),
    ).resolves.toBe('.docs/stories/f.md');
    await expect(resolveFeatureStoriesPath(root, 'f')).resolves.toBe(join(root, '.docs/stories/f.md'));
  });

  it('uses relocated manifest paths for feature plan, stories, and PRD resolution, and treats an omitted PRD as absent', async () => {
    const root = await writeTree({
      '.docs/f/manifest.json': manifest('f', [
        { kind: 'plan', path: '.docs/f/2-machine/tasks.md' },
        { kind: 'stories', path: '.docs/f/2-machine/stories.md' },
        { kind: 'prd', path: '.docs/f/requirements.md' },
      ]),
      '.docs/f/2-machine/tasks.md': '# Plan\n',
      '.docs/f/2-machine/stories.md': '# Stories\n',
      '.docs/f/requirements.md': '# Requirements\n',
      '.docs/specs/f.md': '# Legacy requirements\n',
    });

    await expect(resolveFeaturePlanPath(root, 'f')).resolves.toBe(join(root, '.docs/f/2-machine/tasks.md'));
    await expect(resolveFeatureStoriesPath(root, 'f')).resolves.toBe(join(root, '.docs/f/2-machine/stories.md'));
    await expect(resolveFeaturePrdPaths(root, resolutionContext('f'))).resolves.toEqual([
      join(root, '.docs/f/requirements.md'),
    ]);

    await writeFile(
      join(root, '.docs/f/manifest.json'),
      manifest('f', [
        { kind: 'plan', path: '.docs/f/2-machine/tasks.md' },
        { kind: 'stories', path: '.docs/f/2-machine/stories.md' },
      ]),
    );

    await expect(resolveFeaturePrdPaths(root, resolutionContext('f'))).resolves.toEqual([]);
  });

  it('preserves fixed legacy outputs both without a manifest and with legacy paths registered in one', async () => {
    const root = await writeTree({
      '.docs/plans/f.md': '**Stories:** .docs/stories/f.md\n',
      '.docs/stories/f.md': '# Stories\n',
      '.docs/specs/f.md': '# Requirements\n',
    });
    const storiesRef = await resolveFeatureStoriesRef();

    expect(storiesRef).toBeTypeOf('function');
    if (!storiesRef) return;

    const expectedPlan = join(root, '.docs/plans/f.md');
    const expectedStories = join(root, '.docs/stories/f.md');
    const expectedPrds = [join(root, '.docs/specs/f.md')];
    const assertLegacyOutputs = async (): Promise<void> => {
      await expect(resolveFeaturePlanPath(root, 'f')).resolves.toBe(expectedPlan);
      await expect(resolveFeatureStoriesPath(root, 'f')).resolves.toBe(expectedStories);
      await expect(resolveFeaturePrdPaths(root, resolutionContext('f'))).resolves.toEqual(expectedPrds);
      await expect(
        storiesRef(worktreeManifestSource(root), '.docs/plans/f.md', '**Stories:** .docs/stories/f.md\n'),
      ).resolves.toBe('.docs/stories/f.md');
    };

    await assertLegacyOutputs();
    await mkdir(join(root, '.docs/f'), { recursive: true });
    await writeFile(join(root, '.docs/f/manifest.json'), manifest('f', [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'stories', path: '.docs/stories/f.md' },
      { kind: 'prd', path: '.docs/specs/f.md' },
    ]));
    await assertLegacyOutputs();
  });

  it('falls through legacy PRD identities when the active plan and feature description stems do not match', async () => {
    const root = await writeTree({
      '.docs/specs/approved-prd.md': '# Requirements\n',
    });

    await expect(resolveFeaturePrdPaths(root, {
      activePlanPath: join(root, '.docs/plans/active-plan.md'),
      featureDesc: 'feature-description',
      featureIdentities: ['active-plan', 'feature-description', 'approved-prd'],
      changedPaths: new Set(),
    })).resolves.toEqual([join(root, '.docs/specs/approved-prd.md')]);
  });

  it('fails closed on a malformed manifest instead of resolving the legacy feature plan', async () => {
    const root = await writeTree({
      '.docs/f/manifest.json': '{ malformed JSON',
      '.docs/plans/f.md': '# Legacy plan\n',
    });

    await expect(resolveFeaturePlanPath(root, 'f')).rejects.toThrow(MalformedFeatureManifestError);
    await expect(resolveFeaturePlanPath(root, 'f')).rejects.toThrow('.docs/f/manifest.json');
  });
});
