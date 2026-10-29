// Covers: task:13, task:14
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyGateInvalidation, projectGateSurfaces } from '../../src/engine/gate-invalidation.js';
import { resolveReviewInputs } from '../../src/engine/rebase.js';

const listedStories = '.docs/f/review/stories.md';
const manifestPath = '.docs/f/manifest.json';
const citedAdr = '.docs/decisions/adr-2026-01-01-x.md';

let root: string;

async function write(path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function writeManifestFixture(): Promise<void> {
  await write('.pipeline/conduct-state.json', JSON.stringify({ feature_desc: 'f' }));
  await write(manifestPath, JSON.stringify({
    schemaVersion: 1,
    slug: 'f',
    artifacts: [
      { kind: 'plan', path: '.docs/f/review/plan.md' },
      { kind: 'stories', path: listedStories },
      { kind: 'prd', path: '.docs/f/review/prd.md' },
      { kind: 'coherence', path: '.docs/f/review/coherence.md' },
      { kind: 'decision', path: '.docs/decisions/adr-2026-01-01-listed.md' },
    ],
  }));
  await write('.docs/f/review/plan.md', '# Plan\n');
  await write(listedStories, '# Stories\n');
  await write('.docs/f/review/prd.md', '# PRD\n');
  await write('.docs/f/review/coherence.md', '# Coherence\n\nCites adr-2026-01-01-x.\n');
  await write('.docs/decisions/adr-2026-01-01-listed.md', '# Listed decision\n');
  await write(citedAdr, '# Cited decision\n');
}

describe('gate invalidation ownership (Task 13)', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gate-invalidation-ownership-'));
    await writeManifestFixture();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses only the manifest-owned review documents and their cited ADRs', async () => {
    const inputs = await resolveReviewInputs(root, [listedStories]);

    expect(inputs.sort()).toEqual([
      citedAdr,
      '.docs/decisions/adr-2026-01-01-listed.md',
      '.docs/f/review/coherence.md',
      '.docs/f/review/plan.md',
      '.docs/f/review/prd.md',
      listedStories,
      manifestPath,
    ].sort());
  });

  it('uses the manifest selected for rebase ownership when its plan has a non-slug filename', async () => {
    await write('.docs/f/manifest.json', JSON.stringify({
      schemaVersion: 1,
      slug: 'f',
      artifacts: [
        { kind: 'plan', path: '.docs/f/review/custom-plan-name.md' },
        { kind: 'stories', path: listedStories },
      ],
    }));
    await write('.docs/f/review/custom-plan-name.md', '# Plan\n');

    const inputs = await resolveReviewInputs(root, [listedStories]);
    const invalidated = classifyGateInvalidation([listedStories], [], true, inputs).invalidated.sort();

    expect(inputs).toEqual(expect.arrayContaining([
      manifestPath,
      '.docs/f/review/custom-plan-name.md',
      listedStories,
    ]));
    expect(invalidated).toEqual(['architecture_review_as_built', 'prd_audit']);
  });

  it('keeps a manifest that omits review kinds out of legacy same-stem resolution', async () => {
    await write(manifestPath, JSON.stringify({
      schemaVersion: 1,
      slug: 'f',
      artifacts: [
        { kind: 'plan', path: '.docs/f/review/plan.md' },
      ],
    }));
    await write('.docs/stories/f.md', '# Legacy stories that this manifest does not own\n');

    const inputs = await resolveReviewInputs(root, ['.docs/stories/f.md']);
    const invalidated = classifyGateInvalidation(['.docs/stories/f.md'], [], true, inputs).invalidated;

    expect(inputs).toEqual([manifestPath, '.docs/f/review/plan.md']);
    expect(invalidated).toEqual([]);
  });

  it('invalidates both document surfaces for a listed story or manifest delta', async () => {
    const inputs = await resolveReviewInputs(root, [listedStories]);
    const invalidated = [listedStories, manifestPath].map((path) =>
      classifyGateInvalidation([path], [], true, inputs).invalidated.sort(),
    );

    expect(invalidated).toEqual([
      ['architecture_review_as_built', 'prd_audit'],
      ['architecture_review_as_built', 'prd_audit'],
    ]);
  });

  it('invalidates both document surfaces for an ADR cited by a listed coherence document', async () => {
    const inputs = await resolveReviewInputs(root, [citedAdr]);
    const invalidated = classifyGateInvalidation([citedAdr], [], true, inputs).invalidated.sort();

    expect(invalidated).toEqual(['architecture_review_as_built', 'prd_audit']);
  });

  it('ignores unlisted same-stem and foreign feature documents', async () => {
    const inputs = await resolveReviewInputs(root, ['.docs/stories/f.md']);
    const invalidated = ['.docs/stories/f.md', '.docs/plans/g.md'].map((path) =>
      classifyGateInvalidation([path], [], true, inputs).invalidated,
    );

    expect(invalidated).toEqual([[], []]);
  });

  it('keeps same-stem review inputs for legacy features', async () => {
    await rm(join(root, '.docs', 'f'), { recursive: true, force: true });
    await write('.docs/plans/f.md', '# Legacy plan\n');
    await write('.docs/stories/f.md', '# Legacy stories\n');
    const legacyStory = '.docs/stories/f.md';
    const inputs = await resolveReviewInputs(root, [legacyStory]);
    const invalidated = classifyGateInvalidation([legacyStory], [], true, inputs).invalidated.sort();

    expect(invalidated).toEqual(['architecture_review_as_built', 'prd_audit']);
  });

  it('reports listed manifest-backed inputs as the declared prd_audit surface', async () => {
    const inputs = await resolveReviewInputs(root, [listedStories]);
    const projection = projectGateSurfaces([listedStories], [], inputs)['feature-prd-inputs'];

    expect(projection).toMatchObject({
      matchedPaths: [listedStories],
      declaredSurface: expect.arrayContaining([listedStories, manifestPath]),
    });
  });

  it('keeps the legacy prd_audit declaration as the document-prefix pair', async () => {
    await rm(join(root, '.docs', 'f'), { recursive: true, force: true });
    await write('.docs/stories/f.md', '# Legacy stories\n');
    const legacyStory = '.docs/stories/f.md';
    const inputs = await resolveReviewInputs(root, [legacyStory]);
    const projection = projectGateSurfaces([legacyStory], [], inputs)['feature-prd-inputs'];

    expect(projection.declaredSurface).toEqual(['<.docs/stories/|.docs/specs/>']);
  });
});
