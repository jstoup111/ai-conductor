// Covers: task:14
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { LandGateError, landSpec } from '../../src/engine/engineer/land-spec.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import type { OwnerConfig } from '../../src/engine/owner-gate/identity.js';

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
].join('\n');

function task(id: number, dependency: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    '**Story:** Story 1',
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

async function seed(): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'plan-slices-consumer-boundary.md'), '# PRD\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'plan-slices-consumer-boundary.md'), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', 'plan-slices-consumer-boundary.md'), PLAN);
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
  it('lands a sliced plan and accepts it at disabled coverage binding with stacked PRs off', async () => {
    const worktreePath = await seed();
    const ownerConfig = { spec_owner: 'test-owner', stacked_prs: { enabled: false } } as OwnerConfig;
    const landed = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, { ownerConfig });
    const provider: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: vi.fn() };
    const runner = new DefaultStepRunner(provider, 'plan-slices-consumer-boundary-run', worktreePath, {
      featureDesc: landed.slug,
      planPath: join(worktreePath, '.docs', 'plans', 'plan-slices-consumer-boundary.md'),
      config: { stacked_prs: { enabled: false }, coverage_binding: { judge: { enabled: false } } },
    });

    await expect(runner.run('coverage_binding', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: true,
      output: 'coverage_binding judge disabled',
    });
    const envelope = JSON.parse(await readFile(join(worktreePath, '.pipeline', 'coverage-binding.json'), 'utf8'));
    expect(envelope).toMatchObject({
      status: 'disabled',
      sliceMembership: {
        taskSlices: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 2, '6': 2, '7': 2, '8': 2 },
        titles: ['Foundation', 'Consumer boundary'],
      },
    });
    expect(await git(['rev-parse', 'HEAD'], worktreePath)).not.toBe(await git(['rev-parse', 'main'], worktreePath));
    expect(provider.invoke).not.toHaveBeenCalled();
  });

  it('refuses an incomplete slice manifest even when stacked PRs are disabled', async () => {
    const worktreePath = await seed();
    await writeFile(
      join(worktreePath, '.docs', 'plans', 'plan-slices-consumer-boundary.md'),
      PLAN.replace('| 2 | Consumer boundary | 5, 6, 7, 8 |', '| 2 | Consumer boundary | 5, 6, 7 |'),
    );
    const headBeforeLanding = await git(['rev-parse', 'HEAD'], worktreePath);
    const ownerConfig = { spec_owner: 'test-owner', stacked_prs: { enabled: false } } as OwnerConfig;

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, { ownerConfig })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect((error as LandGateError).gate).toBe('plan-slices');
    expect((error as Error).message).toContain('Task 8');
    expect(await git(['rev-parse', 'HEAD'], worktreePath)).toBe(headBeforeLanding);
  });

  it('keeps slice parsing and the stacked-PR flag at their intended consumers', async () => {
    const sources = await productionSources();
    const planSliceImporters = sources
      .filter(({ source }) => /from\s*['"][^'"]*plan-slices\.js['"]/.test(source))
      .map(({ path }) => path)
      .sort();
    expect(planSliceImporters).toEqual([
      join('engine', 'engineer', 'land-spec.ts'),
      join('engine', 'step-runners.ts'),
    ]);

    const runnerSource = sources.find(({ path }) => path === join('engine', 'step-runners.ts'))!.source;
    const runnerStart = runnerSource.indexOf('private async runCoverageBinding(');
    const sliceReferenceIndexes = [...runnerSource.matchAll(/\bvalidatePlanSlices\b/g)]
      .map((match) => match.index!)
      .filter((index) => index !== runnerSource.indexOf('validatePlanSlices'));
    expect(runnerStart).toBeGreaterThanOrEqual(0);
    expect(sliceReferenceIndexes).not.toEqual([]);
    expect(sliceReferenceIndexes.every((index) => index > runnerStart)).toBe(true);

    expect(sources.filter(({ source }) => /\bSlices\b/.test(source)).map(({ path }) => path).sort())
      .toEqual([join('engine', 'plan-slices.ts')]);
    expect(sources.filter(({ source }) => /\bstacked_prs\b/.test(source)).map(({ path }) => path).sort())
      .toEqual([join('engine', 'config.ts'), join('engine', 'plan-slices.ts'), join('types', 'config.ts')]);
  });
});
