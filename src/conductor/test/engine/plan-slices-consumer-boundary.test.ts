// Covers: task:1, task:5, task:14
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import { resolveIdeaFiles } from '../../src/engine/engineer/land-spec.js';
import { computeReviewedDigest, renderPlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import type { OwnerConfig } from '../../src/engine/owner-gate/identity.js';
import { loadSliceTopology } from '../../src/engine/slice-topology.js';

const execFile = promisify(execFileCb);
const IDEA = 'plan slices consumer boundary';
const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src');
let repoPath: string;

const STORIES = [
  '# Stories: plan slices consumer boundary',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: Validate plan consumers',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given a sliced plan, when it lands, then its consumers accept it.',
  '',
  '#### Negative Paths',
  '- Given an invalid sliced plan, when a consumer reads it, then it refuses.',
  '',
  '## Story 2: Preserve consumer boundaries',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given a sealed slice topology, when a consumer reads it, then task ownership remains stable.',
  '',
  '#### Negative Paths',
  '- Given unreadable topology, when a consumer reads it, then it reports the failure.',
  '',
].join('\n');

function task(id: number, dependency: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    `**Story:** Story ${id <= 4 ? 1 : 2}`,
    `**Dependencies:** ${dependency}`,
    '**Done when:**',
    '- Given a sliced plan, when it lands, then its consumers accept it.',
    '- Given an invalid sliced plan, when a consumer reads it, then it refuses.',
    '',
  ].join('\n');
}

const PLAN = [
  '# Implementation Plan: plan slices consumer boundary',
  '',
  '**Stories:** .docs/stories/plan-slices-consumer-boundary.md',
  '',
  '## Slices',
  '',
  '| Slice | Title | Tasks |',
  '| --- | --- | --- |',
  '| 1 | Foundation | 1, 2, 3, 4 |',
  '| 2 | Consumer boundary | 5, 6, 7, 8 |',
  '',
  ...Array.from({ length: 8 }, (_, index) => task(index + 1, index === 0 ? 'none' : String(index))),
].join('\n');

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function seed(plan = PLAN): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'plan-slices-consumer-boundary.md'), '# PRD\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'plan-slices-consumer-boundary.md'), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', 'plan-slices-consumer-boundary.md'), plan);
  const reviewedDigest = computeReviewedDigest({
    planText: plan,
    storiesText: STORIES,
    adrTexts: {},
    artifactTexts: { '.docs/coherence/plan-slices-consumer-boundary.md': '' },
    changedPaths: [...await resolveIdeaFiles(worktreePath, repoPath)],
  });
  await mkdir(join(worktreePath, '.docs', 'plan-review'), { recursive: true });
  await writeFile(
    join(worktreePath, '.docs', 'plan-review', 'plan-slices-consumer-boundary.md'),
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
  return worktreePath;
}

async function productionSources(): Promise<{ path: string; source: string }[]> {
  const paths = (await readdir(engineRoot, { recursive: true })).filter((path) => path.endsWith('.ts'));
  return Promise.all(paths.map(async (path) => ({ path, source: await readFile(join(engineRoot, path), 'utf8') })));
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'plan-slices-consumer-boundary-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('plan-slices consumer boundary', () => {
  it('lands a sliced plan whose sealed topology preserves task membership', async () => {
    const worktreePath = await seed();
    const ownerConfig = { spec_owner: 'test-owner', stacked_prs: { enabled: false } } as OwnerConfig;
    const landed = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, { ownerConfig });
    await expect(loadSliceTopology(worktreePath, landed.slug)).resolves.toMatchObject({
      kind: 'sliced',
      sliceMembership: {
        taskSlices: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 2, '6': 2, '7': 2, '8': 2 },
        titles: ['Foundation', 'Consumer boundary'],
      },
    });
    expect(await git(['rev-parse', 'HEAD'], worktreePath)).not.toBe(await git(['rev-parse', 'main'], worktreePath));
  });

  it('refuses an incomplete slice manifest even when stacked PRs are disabled', async () => {
    const worktreePath = await seed(PLAN.replace('| 2 | Consumer boundary | 5, 6, 7, 8 |', '| 2 | Consumer boundary | 5, 6, 7 |'));
    const headBeforeLanding = await git(['rev-parse', 'HEAD'], worktreePath);
    const ownerConfig = { spec_owner: 'test-owner', stacked_prs: { enabled: false } } as OwnerConfig;

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, { ownerConfig })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect((error as LandGateError).gate).toBe('plan-slices');
    expect((error as Error).message).toContain('Task 8');
    expect(await git(['rev-parse', 'HEAD'], worktreePath)).toBe(headBeforeLanding);
  });

  it('allows only land-spec and slice-topology to import plan-slices', async () => {
    const sources = await productionSources();
    const planSliceImporters = sources
      .filter(({ source }) => /from\s*['"][^'"]*plan-slices\.js['"]/.test(source))
      .map(({ path }) => path)
      .sort();
    expect(planSliceImporters).toEqual([
      join('engine', 'engineer', 'land-spec.ts'),
      join('engine', 'slice-topology.ts'),
    ]);

    expect(sources.filter(({ source }) => /\bSlices\b/.test(source)).map(({ path }) => path).sort())
      .toEqual([join('engine', 'plan-slices.ts')]);
    expect(sources.filter(({ source }) => /\bstacked_prs\b/.test(source)).map(({ path }) => path).sort())
      .toEqual([
      join('engine', 'conductor.ts'),
        join('engine', 'config.ts'),
      join('engine', 'engineer', 'land-spec.ts'),
      join('engine', 'plan-slices.ts'),
      join('engine', 'restack', 'cascade-allowance.ts'),
      join('engine', 'routing', 'operator-round.ts'),
      join('engine', 'routing', 'round-receipt.ts'),
      join('engine', 'routing', 'route-types.ts'),
      join('engine', 'slice-topology.ts'),
      join('engine', 'stack-land-cli.ts'),
      join('engine', 'stack-owners-cli.ts'),
      join('engine', 'stack-rounds-cli.ts'),
      join('types', 'config.ts'),
      ]);
  });
});
