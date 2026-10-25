// Covers: task:7, task:8

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import type { BacklogTreeSource } from '../../src/engine/backlog-tree-source.js';
import { MANIFEST_KIND_LOCATIONS } from '../../src/engine/feature-manifest.js';
import {
  contractPatternKind,
  STEP_ARTIFACT_CONTRACTS,
} from '../../src/engine/artifacts.js';
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

describe('engine/artifacts — manifest kind contracts', () => {
  it('maps only the routed feature-scoped contract patterns to manifest kinds', () => {
    const mapped = [
      ['prd', 'prd'],
      ['stories', 'stories'],
      ['conflict_check', 'conflicts'],
      ['plan', 'plan'],
      ['coherence_check', 'coherence'],
    ] as const;

    for (const [step, kind] of mapped) {
      const [contract] = STEP_ARTIFACT_CONTRACTS[step];
      expect(contractPatternKind(step, contract!.pattern)).toBe(kind);
    }

    const mappedPatterns = new Set(mapped.map(([step]) => {
      const [contract] = STEP_ARTIFACT_CONTRACTS[step];
      return `${step}\u0000${contract!.pattern}`;
    }));
    for (const [step, contracts] of Object.entries(STEP_ARTIFACT_CONTRACTS)) {
      for (const contract of contracts) {
        if (mappedPatterns.has(`${step}\u0000${contract.pattern}`)) continue;
        expect(contractPatternKind(step as keyof typeof STEP_ARTIFACT_CONTRACTS, contract.pattern)).toBeNull();
      }
    }
  });

  it('pins legacy locations for kinds without step contracts and keeps step contracts unchanged', () => {
    expect(MANIFEST_KIND_LOCATIONS).toMatchObject({
      track: { directory: '.docs/track/', identity: 'plan-stem', filePattern: /\.md$/i },
      complexity: { directory: '.docs/complexity/', identity: 'plan-stem', filePattern: /\.md$/i },
      intake: { directory: '.docs/intake/', identity: 'plan-stem', filePattern: /\.md$/i },
      applicability: { directory: '.docs/applicability/', identity: 'plan-stem', filePattern: /\.md$/i },
      'coherence-waiver': { directory: '.docs/coherence-waivers/', identity: 'plan-stem', filePattern: /\.md$/i },
    });

    expect(STEP_ARTIFACT_CONTRACTS).toEqual({
      bootstrap: [],
      memory: [],
      assess: [{ pattern: '.docs/decisions/technical-assessment-*.md', scope: 'repository' }],
      explore: [],
      prd: [{
        pattern: '.docs/specs/*.md',
        scope: 'feature',
        identity: { strategy: 'normalized-stem', stripDatePrefix: true },
      }],
      complexity: [],
      stories: [{
        pattern: '.docs/stories/**/*.md',
        scope: 'feature',
        identity: { strategy: 'normalized-stem', stripDatePrefix: true },
      }],
      conflict_check: [{
        pattern: '.docs/conflicts/*.md',
        scope: 'feature',
        identity: { strategy: 'normalized-stem', stripDatePrefix: true },
      }],
      plan: [{ pattern: '.docs/plans/*.md', scope: 'feature', identity: { strategy: 'plan-stem' } }],
      coherence_check: [{ pattern: '.docs/coherence/*.md', scope: 'feature', identity: { strategy: 'plan-stem' } }],
      plan_review: [{ pattern: '.docs/plan-review/*.md', scope: 'feature', identity: { strategy: 'plan-stem' } }],
      architecture_diagram: [{ pattern: '.docs/architecture/*.md', scope: 'repository' }],
      architecture_review: [
        {
          pattern: '.docs/decisions/architecture-review-*.md',
          scope: 'feature',
          identity: {
            strategy: 'normalized-stem',
            stripDatePrefix: true,
            stripPrefixes: ['architecture-review'],
          },
        },
        { pattern: '.docs/decisions/adr-*.md', scope: 'repository' },
      ],
      worktree: [],
      coverage_binding: [{ pattern: '.pipeline/coverage-binding.json', scope: 'run' }],
      acceptance_specs: [
        'spec/acceptance/**/*', 'spec/requests/**/*', 'spec/system/**/*', 'test/acceptance/**/*',
        'test/**/*', 'tests/**/*', '__tests__/**/*', '*.test.js', '*.test.ts', '*.test.jsx',
        '*.test.tsx', '*.spec.js', '*.spec.ts', '*.spec.jsx', '*.spec.tsx',
      ].map((pattern) => ({ pattern, scope: 'repository' })),
      build: [{ pattern: '.pipeline/task-status.json', scope: 'run' }],
      build_review: [{ pattern: '.pipeline/build-review.json', scope: 'run' }],
      test_suite: [{ pattern: '.pipeline/test-suite-evidence.json', scope: 'run' }],
      manual_test: [{ pattern: '.pipeline/manual-test-results.md', scope: 'run' }],
      prd_audit: [{ pattern: '.pipeline/prd-audit.json', scope: 'run' }],
      architecture_review_as_built: [{ pattern: '.pipeline/architecture-review-as-built.json', scope: 'run' }],
      rebase: [],
      finish: [],
      remediate: [],
      attribution_verify: [],
    });
  });
});
