// Covers: task:5
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { landSpec, resolveIdeaFiles } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { FeatureManifest } from '../../../src/engine/feature-manifest.js';
import { computeReviewedDigest, renderPlanReviewArtifact } from '../../../src/engine/plan-review-artifact.js';

const execFile = promisify(execFileCb);
const IDEA = 'manifest landing';
const SLUG = 'manifest-landing';
let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

const STORIES = [
  '# Stories: manifest landing',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: write the manifest',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given valid artifacts, when land runs, then it commits a manifest.',
  '',
  '#### Negative Paths',
  '- Given invalid artifacts, when land runs, then it refuses.',
  '',
].join('\n');

const PLAN = [
  '# Implementation Plan: manifest landing',
  '',
  `**Stories:** .docs/stories/${SLUG}.md`,
  '',
  '### Task 1: Register artifacts',
  '**Story:** Story 1',
  '',
  '**Done when:**',
  '- Given valid artifacts, when land runs, then it commits a manifest.',
  '- Given invalid artifacts, when land runs, then it refuses.',
  '',
  '## Coverage Check',
  '',
  '| Criterion | Task ids | Quote | Disposition |',
  '| --- | --- | --- | --- |',
  '| Story 1 happy: Given valid artifacts, when land runs, then it commits a manifest. | 1 | "Given valid artifacts, when land runs, then it commits a manifest." | diff-local |',
  '| Story 1 negative: Given invalid artifacts, when land runs, then it refuses. | 1 | "Given invalid artifacts, when land runs, then it refuses." | diff-local |',
  '',
].join('\n');

const ADR = [
  '# ADR: manifest landing',
  '',
  '**Status:** Approved',
  '',
  '## Decision',
  '',
  '1. **Land rebuilds the feature manifest.**',
  '',
  '## Assumptions',
  '',
  'No load-bearing assumptions.',
  '',
].join('\n');

const COHERENCE = [
  '# Coherence: manifest landing',
  '',
  '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |',
  '| --- | --- | --- | --- | --- |',
  '| story | story-1 | task-1 | covered | The task writes the manifest. |',
  '| task | task-1 | story-1 | covered | Serves story 1. |',
  '| criterion | Story 1 happy: Given valid artifacts, when land runs, then it commits a manifest. | 1 | covered | "Given valid artifacts, when land runs, then it commits a manifest." | diff-local |',
  '| criterion | Story 1 negative: Given invalid artifacts, when land runs, then it refuses. | 1 | covered | "Given invalid artifacts, when land runs, then it refuses." | diff-local |',
  '',
].join('\n');

function options() {
  return { ownerConfig: { spec_owner: 'test-owner' } };
}

async function manifest(worktreePath: string): Promise<FeatureManifest> {
  return JSON.parse(await readFile(join(worktreePath, '.docs', SLUG, 'manifest.json'), 'utf8')) as FeatureManifest;
}

async function writeCurrentPlanReview(worktreePath: string): Promise<void> {
  const planText = await readFile(join(worktreePath, '.docs', 'plans', `${SLUG}.md`), 'utf8');
  const storiesText = await readFile(join(worktreePath, '.docs', 'stories', `${SLUG}.md`), 'utf8');
  const coherenceText = await readFile(join(worktreePath, '.docs', 'coherence', `${SLUG}.md`), 'utf8');
  const reviewedDigest = computeReviewedDigest({
    planText,
    storiesText,
    adrTexts: {},
    artifactTexts: { [`.docs/coherence/${SLUG}.md`]: coherenceText },
    changedPaths: [...await resolveIdeaFiles(worktreePath, repoPath)],
  });
  await writeFile(
    join(worktreePath, '.docs', 'plan-review', `${SLUG}.md`),
    renderPlanReviewArtifact({
      round: 1,
      authoringHost: 'claude',
      reviewerProvider: 'codex',
      independence: 'cross-provider',
      findings: [],
      dispositions: [],
      reviewedDigest,
    }),
  );
}

async function seedWorktree(): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'track'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'conflicts'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'coherence'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'architecture'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'decisions'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plan-review'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(worktreePath, '.docs', 'stories', `${SLUG}.md`), STORIES),
    writeFile(join(worktreePath, '.docs', 'plans', `${SLUG}.md`), PLAN),
    writeFile(join(worktreePath, '.docs', 'track', `${SLUG}.md`), '# Track\n\nTrack: technical\n'),
    writeFile(join(worktreePath, '.docs', 'complexity', `${SLUG}.md`), '# Complexity\n\nTier: S\n'),
    writeFile(join(worktreePath, '.docs', 'conflicts', `${SLUG}.md`), '# Conflicts\n\nNone.\n'),
    writeFile(join(worktreePath, '.docs', 'coherence', `${SLUG}.md`), COHERENCE),
    writeFile(join(worktreePath, '.docs', 'architecture', `${SLUG}.md`), '# Architecture\n\nNo diagram.\n'),
    writeFile(join(worktreePath, '.docs', 'decisions', 'adr-2026-10-25-manifest-landing.md'), ADR),
    writeFile(join(worktreePath, '.docs', 'plan-review', `${SLUG}.md`), 'uncommitted review evidence\n'),
  ]);
  return worktreePath;
}

async function initializeRepository(): Promise<void> {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-manifest-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
}

beforeEach(async () => {
  await initializeRepository();
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('landSpec manifest registration', () => {
  it('commits a manifest listing every authored artifact and the amended ADR as a decision', async () => {
    const worktreePath = await seedWorktree();

    const result = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options());

    expect(await git(['show', '--name-only', '--format=', 'HEAD'], worktreePath)).toContain(`.docs/${SLUG}/manifest.json`);
    expect(await manifest(worktreePath)).toMatchObject({
      slug: SLUG,
      artifacts: expect.arrayContaining([
        { kind: 'plan', path: `.docs/plans/${SLUG}.md` },
        { kind: 'stories', path: `.docs/stories/${SLUG}.md` },
        { kind: 'track', path: `.docs/track/${SLUG}.md` },
        { kind: 'complexity', path: `.docs/complexity/${SLUG}.md` },
        { kind: 'conflicts', path: `.docs/conflicts/${SLUG}.md` },
        { kind: 'coherence', path: `.docs/coherence/${SLUG}.md` },
        { kind: 'architecture', path: `.docs/architecture/${SLUG}.md` },
        { kind: 'decision', path: '.docs/decisions/adr-2026-10-25-manifest-landing.md' },
      ]),
    });
    expect(result.added).toEqual(expect.arrayContaining([
      { kind: 'plan', path: `.docs/plans/${SLUG}.md` },
      { kind: 'decision', path: '.docs/decisions/adr-2026-10-25-manifest-landing.md' },
    ]));
  });

  it('lists the written intake marker and excludes a plan-review record', async () => {
    const worktreePath = await seedWorktree();

    await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options());

    const entries = (await manifest(worktreePath)).artifacts;
    expect(entries).toContainEqual({ kind: 'intake', path: `.docs/intake/${SLUG}.md` });
    expect(entries).not.toContainEqual(expect.objectContaining({ path: `.docs/plan-review/${SLUG}.md` }));
  });

  it('leaves manifest bytes unchanged and reports no added entries on an unchanged second land', async () => {
    const worktreePath = await seedWorktree();
    await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options());
    const before = await readFile(join(worktreePath, '.docs', SLUG, 'manifest.json'), 'utf8');

    const result = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options());

    expect(await readFile(join(worktreePath, '.docs', SLUG, 'manifest.json'), 'utf8')).toBe(before);
    expect(result.added).toEqual([]);
    expect(result.manifestChanged).toBe(false);
  });

  it('rebuilds without a deleted ADR decision or complexity entry', async () => {
    const worktreePath = await seedWorktree();
    await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options());
    await git(['rm', '.docs/decisions/adr-2026-10-25-manifest-landing.md', `.docs/complexity/${SLUG}.md`], worktreePath);
    await git(['commit', '-m', 'remove decision and complexity'], worktreePath);
    await writeCurrentPlanReview(worktreePath);

    const result = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options());

    const entries = (await manifest(worktreePath)).artifacts;
    expect(entries).not.toContainEqual({ kind: 'decision', path: '.docs/decisions/adr-2026-10-25-manifest-landing.md' });
    expect(entries).not.toContainEqual({ kind: 'complexity', path: `.docs/complexity/${SLUG}.md` });
    expect(result).toMatchObject({ manifestChanged: true, added: [] });
  });

  it('replaces missing-path, unparsable, and wrong-slug manifests instead of refusing', async () => {
    const cases = [
      '{"schemaVersion":1,"slug":"manifest-landing","artifacts":[{"kind":"plan","path":".docs/plans/missing.md"}]}\n',
      '{ nope\n',
      '{"schemaVersion":1,"slug":"other","artifacts":[{"kind":"plan","path":".docs/plans/other.md"}]}\n',
    ];
    for (const [index, existing] of cases.entries()) {
      if (index > 0) {
        await rm(repoPath, { recursive: true, force: true });
        await initializeRepository();
      }
      const worktreePath = await seedWorktree();
      await mkdir(join(worktreePath, '.docs', SLUG), { recursive: true });
      await writeFile(join(worktreePath, '.docs', SLUG, 'manifest.json'), existing);

      await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
        .resolves.toMatchObject({ slug: SLUG });

      expect(await manifest(worktreePath)).toMatchObject({
        slug: SLUG,
        artifacts: expect.arrayContaining([{ kind: 'plan', path: `.docs/plans/${SLUG}.md` }]),
      });
    }
  });
});
