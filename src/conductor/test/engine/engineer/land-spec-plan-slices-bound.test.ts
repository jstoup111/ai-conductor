// Covers: task:6, task:8
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { validatePlanSlices } from '../../../src/engine/plan-slices.js';
import type { OwnerConfig } from '../../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);
const IDEA = 'plan slice bound';
let repoPath: string;

const STORIES = [
  '# Stories: plan slice bound',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: bounded slices',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given a valid plan, when land runs, then it commits.',
  '',
  '#### Negative Paths',
  '- Given an invalid plan, when land runs, then it refuses.',
  '',
].join('\n');

function task(id: number): string {
  return [
    `### Task ${id}: Task ${id}`,
    '**Story:** Story 1',
    '**Dependencies:** none',
    '**Done when:**',
    '- Given a valid plan, when land runs, then it commits.',
    '- Given an invalid plan, when land runs, then it refuses.',
    '',
  ].join('\n');
}

function plan(rows: string[], taskCount = 6): string {
  return [
    '# Implementation Plan: plan slice bound',
    '',
    '**Stories:** .docs/stories/plan-slice-bound.md',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...Array.from({ length: taskCount }, (_, index) => task(index + 1)),
  ].join('\n');
}

function slices(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `| ${index + 1} | Slice ${index + 1} | ${index + 1} |`);
}

async function git(args: string[], cwd = repoPath): Promise<string> {
  const result = await execFile('git', args, { cwd });
  return result.stdout;
}

async function seed(planText: string): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'plan-slice-bound.md'), '# PRD: plan slice bound\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'plan-slice-bound.md'), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', 'plan-slice-bound.md'), planText);
  return worktreePath;
}

async function enableStackedPrs(): Promise<void> {
  await mkdir(join(repoPath, '.ai-conductor'), { recursive: true });
  await writeFile(join(repoPath, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n');
}

const options = { ownerConfig: { spec_owner: 'test-owner' } as OwnerConfig };

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-plan-slices-bound-'));
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

describe('plan-slices bound land rung', () => {
  it('lands exactly nine slices and refuses the same fixture shape with one added slice', async () => {
    const nineSlicePlan = plan(slices(9), 9);
    const validation = validatePlanSlices(nineSlicePlan);
    expect(validation).toMatchObject({ kind: 'sliced' });
    expect(validation.kind === 'sliced' && validation.slices).toHaveLength(9);

    const tenSliceWorktree = await seed(plan(slices(10), 10));
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, tenSliceWorktree, undefined, options)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });

    await git(['worktree', 'remove', '--force', tenSliceWorktree]);
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(nineSlicePlan), undefined, options))
      .resolves.toMatchObject({ branch: 'spec/plan-slice-bound' });
    expect((await git(['rev-parse', 'spec/plan-slice-bound'])).trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lands one slice holding every task', async () => {
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan([
      '| 1 | Everything | 1, 2, 3, 4, 5, 6 |',
    ])), undefined, options)).resolves.toMatchObject({ branch: 'spec/plan-slice-bound' });
  });

  it('lands seven slices with the flag off', async () => {
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan(slices(7), 7)), undefined, options))
      .resolves.toMatchObject({ branch: 'spec/plan-slice-bound' });
  });

  it('refuses ten slices with the bound violation', async () => {
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan(slices(10), 10)), undefined, options)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });
    expect((error as Error).message).toContain('plan declares 10 slices and the bound is 9');
  });

  it('refuses ten slices with the bound violation when stacked delivery is enabled', async () => {
    await enableStackedPrs();
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan(slices(10), 10)), undefined, options)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });
    expect((error as Error).message).toContain('plan declares 10 slices and the bound is 9');
  });

  it('refuses ten slices with an empty slice in one refusal naming both violations', async () => {
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan([
      ...slices(10).slice(0, 8),
      '| 9 | Ninth | |',
      '| 10 | Tenth | 10 |',
    ], 10)), undefined, options).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });
    expect((error as Error).message).toContain('bound is 9');
    expect((error as Error).message).toContain('slice 9 is empty');
  });
});
