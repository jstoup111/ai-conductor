// Covers: task:9

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkStepCompletion,
  getArtifactStatus,
  type ArtifactResolutionContext,
} from '../../src/engine/artifacts.js';
import { renderPlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import type { StepName } from '../../src/types/index.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function renderManifest(slug: string, artifacts: readonly { kind: string; path: string }[]): string {
  return `${JSON.stringify({ schemaVersion: 1, slug, artifacts }, null, 2)}\n`;
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'artifacts-manifest-'));
  cleanupRoots.push(root);

  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }));

  return root;
}

function context(root: string, slug: string): ArtifactResolutionContext {
  return {
    activePlanPath: join(root, '.docs', 'plans', `${slug}.md`),
    featureIdentities: [slug],
    changedPaths: new Set(),
  };
}

function manifestForLegacyPaths(slug: string): string {
  return renderManifest(slug, [
    { kind: 'plan', path: `.docs/plans/${slug}.md` },
    { kind: 'prd', path: `.docs/specs/${slug}.md` },
    { kind: 'stories', path: `.docs/stories/${slug}.md` },
    { kind: 'conflicts', path: `.docs/conflicts/${slug}.md` },
    { kind: 'coherence', path: `.docs/coherence/${slug}.md` },
  ]);
}

describe('engine/artifacts — manifest-backed artifact resolution', () => {
  it('resolves a relocated plan from f\'s manifest through completion and dashboard status', async () => {
    const root = await writeTree({
      '.docs/f/manifest.json': renderManifest('f', [
        { kind: 'plan', path: '.docs/f/2-machine/tasks.md' },
      ]),
      '.docs/f/2-machine/tasks.md': '# Relocated plan',
    });
    const resolution = context(root, 'f');

    await expect(checkStepCompletion(root, 'plan', { artifactResolution: resolution })).resolves.toEqual({
      done: true,
    });
    await expect(getArtifactStatus(root, 'plan', resolution)).resolves.toEqual([
      {
        pattern: '.docs/plans/*.md',
        files: ['.docs/f/2-machine/tasks.md'],
        satisfied: true,
      },
    ]);
  });

  it('leaves architecture, ADR, and plan-review resolution unchanged when a manifest is present', async () => {
    const reviewRecord = renderPlanReviewArtifact({
      round: 1,
      authoringHost: 'test',
      reviewerProvider: 'test',
      independence: 'same-provider',
      findings: [],
      dispositions: [],
      reviewedDigest: {
        digest: 'sha256:test',
        planTaskDigests: {},
        storyDigests: {},
        adrDecisionDigests: {},
        artifactDigests: {},
      },
    });
    const files = {
      '.docs/f/manifest.json': renderManifest('f', [
        { kind: 'plan', path: '.docs/plans/f.md' },
        { kind: 'decision', path: '.docs/decisions/adr-f.md' },
        { kind: 'architecture', path: '.docs/architecture/f.md' },
      ]),
      '.docs/plans/f.md': '# Plan',
      '.docs/decisions/architecture-review-f.md': '# Architecture review',
      '.docs/decisions/adr-f.md': '# ADR F',
      '.docs/decisions/adr-other.md': '# ADR other',
      '.docs/architecture/f.md': '# Architecture F',
      '.docs/architecture/other.md': '# Architecture other',
      '.docs/plan-review/f.md': reviewRecord,
    };
    const withoutManifest = await writeTree(Object.fromEntries(
      Object.entries(files).filter(([path]) => path !== '.docs/f/manifest.json'),
    ));
    const withManifest = await writeTree(files);
    const withoutContext = context(withoutManifest, 'f');
    const withContext = context(withManifest, 'f');

    const [withoutArchitectureReview, withoutArchitecture, withoutPlanReview] = await Promise.all([
      getArtifactStatus(withoutManifest, 'architecture_review', withoutContext),
      getArtifactStatus(withoutManifest, 'architecture_diagram', withoutContext),
      getArtifactStatus(withoutManifest, 'plan_review', withoutContext),
    ]);

    expect(withoutArchitectureReview).toEqual([
      {
        pattern: '.docs/decisions/architecture-review-*.md',
        files: ['.docs/decisions/architecture-review-f.md'],
        satisfied: true,
      },
      {
        pattern: '.docs/decisions/adr-*.md',
        files: ['.docs/decisions/adr-f.md', '.docs/decisions/adr-other.md'],
        satisfied: true,
      },
    ]);
    expect(withoutArchitecture).toEqual([
      {
        pattern: '.docs/architecture/*.md',
        files: ['.docs/architecture/f.md', '.docs/architecture/other.md'],
        satisfied: true,
      },
    ]);
    expect(withoutPlanReview).toEqual([
      {
        pattern: '.docs/plan-review/*.md',
        files: ['.docs/plan-review/f.md'],
        satisfied: true,
      },
    ]);

    await expect(Promise.all([
      getArtifactStatus(withManifest, 'architecture_review', withContext),
      getArtifactStatus(withManifest, 'architecture_diagram', withContext),
      getArtifactStatus(withManifest, 'plan_review', withContext),
      checkStepCompletion(withManifest, 'architecture_review', { artifactResolution: withContext }),
      checkStepCompletion(withManifest, 'architecture_diagram', { artifactResolution: withContext }),
      checkStepCompletion(withManifest, 'plan_review', { featureDesc: 'f' }),
    ])).resolves.toEqual([
      withoutArchitectureReview,
      withoutArchitecture,
      withoutPlanReview,
      { done: true },
      { done: true },
      { done: true },
    ]);
  });

  it('keeps legacy-shaped manifest and no-manifest results identical across mapped kinds and isolates features', async () => {
    const mappedSteps = [
      ['prd', '.docs/specs/a.md'],
      ['stories', '.docs/stories/a.md'],
      ['conflict_check', '.docs/conflicts/a.md'],
      ['plan', '.docs/plans/a.md'],
      ['coherence_check', '.docs/coherence/a.md'],
    ] as const satisfies readonly [StepName, string][];
    const files: Record<string, string> = {
      '.docs/specs/a.md': '# A PRD',
      '.docs/stories/a.md': '# A stories',
      '.docs/conflicts/a.md': '# A conflicts',
      '.docs/plans/a.md': '# A plan',
      '.docs/coherence/a.md': '# A coherence',
      '.docs/specs/b.md': '# B PRD',
      '.docs/stories/b.md': '# B stories',
      '.docs/conflicts/b.md': '# B conflicts',
      '.docs/plans/b.md': '# B plan',
      '.docs/coherence/b.md': '# B coherence',
    };
    const withoutManifest = await writeTree(files);
    const withManifest = await writeTree({
      ...files,
      '.docs/a/manifest.json': manifestForLegacyPaths('a'),
      '.docs/b/manifest.json': manifestForLegacyPaths('b'),
    });

    for (const [step, expectedA] of mappedSteps) {
      const noManifestContext = context(withoutManifest, 'a');
      const manifestContext = context(withManifest, 'a');
      const featureBContext = context(withManifest, 'b');

      await expect(checkStepCompletion(withoutManifest, step, {
        artifactResolution: noManifestContext,
      })).resolves.toEqual({ done: true });
      await expect(checkStepCompletion(withManifest, step, {
        artifactResolution: manifestContext,
      })).resolves.toEqual({ done: true });
      await expect(getArtifactStatus(withoutManifest, step, noManifestContext)).resolves.toEqual([
        {
          pattern: expect.any(String),
          files: [expectedA],
          satisfied: true,
        },
      ]);
      await expect(getArtifactStatus(withManifest, step, manifestContext)).resolves.toEqual(
        await getArtifactStatus(withoutManifest, step, noManifestContext),
      );
      await expect(getArtifactStatus(withManifest, step, featureBContext)).resolves.toEqual([
        {
          pattern: expect.any(String),
          files: [expectedA.replace('/a.md', '/b.md')],
          satisfied: true,
        },
      ]);
    }
  });
});
