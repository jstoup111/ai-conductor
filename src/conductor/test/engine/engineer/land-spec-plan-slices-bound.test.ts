// Covers: task:8
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

function plan(rows: string[]): string {
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
    ...Array.from({ length: 6 }, (_, index) => task(index + 1)),
  ].join('\n');
}

const fiveSlices = [
  '| 1 | First | 1 |',
  '| 2 | Second | 2 |',
  '| 3 | Third | 3 |',
  '| 4 | Fourth | 4 |',
  '| 5 | Fifth | 5, 6 |',
];

const sixSlices = [
  '| 1 | First | 1 |',
  '| 2 | Second | 2 |',
  '| 3 | Third | 3 |',
  '| 4 | Fourth | 4 |',
  '| 5 | Fifth | 5 |',
  '| 6 | Sixth | 6 |',
];

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
  it('lands exactly five slices and refuses the same fixture shape with one added slice', async () => {
    const fiveSlicePlan = plan(fiveSlices);
    const validation = validatePlanSlices(fiveSlicePlan);
    expect(validation).toMatchObject({ kind: 'sliced' });
    expect(validation.kind === 'sliced' && validation.slices).toHaveLength(5);

    const sixSliceWorktree = await seed(plan(sixSlices));
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, sixSliceWorktree, undefined, options)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });

    await git(['worktree', 'remove', '--force', sixSliceWorktree]);
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(fiveSlicePlan), undefined, options))
      .resolves.toMatchObject({ branch: 'spec/plan-slice-bound' });
    expect((await git(['rev-parse', 'spec/plan-slice-bound'])).trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lands one slice holding every task', async () => {
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan([
      '| 1 | Everything | 1, 2, 3, 4, 5, 6 |',
    ])), undefined, options)).resolves.toMatchObject({ branch: 'spec/plan-slice-bound' });
  });

  it('refuses six slices with the bound violation', async () => {
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan(sixSlices)), undefined, options)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });
    expect((error as Error).message).toContain('plan declares 6 slices and the bound is 5');
  });

  it('refuses six slices with an empty slice in one refusal naming both violations', async () => {
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, await seed(plan([
      ...sixSlices.slice(0, 4),
      '| 5 | Fifth | |',
      '| 6 | Sixth | 5, 6 |',
    ])), undefined, options).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });
    expect((error as Error).message).toContain('bound is 5');
    expect((error as Error).message).toContain('slice 5 is empty');
  });
});
