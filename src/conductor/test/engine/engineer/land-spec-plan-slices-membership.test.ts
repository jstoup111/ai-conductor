// Covers: task:6
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
const IDEA = 'plan slices membership';
let repoPath: string;
const STORIES = '# Stories: plan slices membership\n\n**Status:** Accepted\n\n## Story 1: membership\n### Acceptance Criteria\n#### Happy Path\n- Given a plan, when land runs, then it commits.\n\n#### Negative Paths\n- Given an invalid plan, when land runs, then it refuses.\n';

function task(id: number | string): string {
  return `### Task ${id}: Task ${id}\n**Story:** Story 1\n**Dependencies:** none\n**Done when:**\n- Given a plan, when land runs, then it commits.\n- Given an invalid plan, when land runs, then it refuses.`;
}

function plan(rows: string[], taskIds: Array<number | string> = [1, 2, 3, 4, 5, 6]): string {
  return ['# Implementation Plan: plan slices membership', '', '**Stories:** .docs/stories/plan-slices-membership.md', '', '## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |', ...rows, '', ...taskIds.map(task)].join('\n');
}

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function seed(planContent: string, tier?: 'S' | 'M', waiver?: string): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }), mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }), mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true })]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'plan-slices-membership.md'), '# PRD: membership\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'plan-slices-membership.md'), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', 'plan-slices-membership.md'), planContent);
  if (tier) {
    await mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true });
    await writeFile(join(worktreePath, '.docs', 'complexity', 'plan-slices-membership.md'), `# Complexity\n\nTier: ${tier}\n`);
  }
  if (waiver) {
    await mkdir(join(worktreePath, '.docs', 'coherence-waivers'), { recursive: true });
    await writeFile(join(worktreePath, '.docs', 'coherence-waivers', 'membership.md'), waiver);
  }
  return worktreePath;
}

function options(): { ownerConfig: OwnerConfig } { return { ownerConfig: { spec_owner: 'test-owner' } as OwnerConfig }; }

async function refusal(planContent: string, tier?: 'S' | 'M', waiver?: string): Promise<Error> {
  const worktreePath = await seed(planContent, tier, waiver);
  const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(LandGateError);
  expect(error).toMatchObject({ gate: 'plan-slices' });
  expect(await git(['log', '--format=%s'])).toBe('init\n');
  await git(['worktree', 'remove', '--force', worktreePath]);
  return error as Error;
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-plan-slices-membership-'));
  await git(['init', '-b', 'main', '-q']); await git(['config', 'user.email', 'test@example.test']); await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n'); await git(['add', 'README.md']); await git(['commit', '-m', 'init']);
});
afterEach(async () => { await rm(repoPath, { recursive: true, force: true }); });

const FIXTURES = [
  { name: 'unassigned task', plan: () => plan(['| 1 | First | 1, 2, 3, 4, 5 |']), message: /Task 6 is in no slice/ },
  { name: 'duplicate task', plan: () => plan(['| 1 | First | 1, 2, 3 |', '| 2 | Second | 3, 4, 5, 6 |']), message: /Task 3 appears in slices 1 and 2/ },
  { name: 'empty slice', plan: () => plan(['| 1 | First | 1, 2, 3 |', '| 2 | Second |  |', '| 3 | Third | 4, 5, 6 |']), message: /slice 2 is empty/ },
  { name: 'duplicate position', plan: () => plan(['| 1 | First | 1, 2 |', '| 2 | Second | 3, 4 |', '| 2 | Again | 5, 6 |']), message: /duplicate slice position 2/ },
  { name: 'unknown task', plan: () => plan(['| 1 | First | 1, 2, 3, 4, 5, 6, 12 |']), message: /Task 12 cited by slice 1 is an unknown task id/ },
];

describe('plan-slices membership land rung', () => {
  it.each(FIXTURES)('refuses $name with the full validator message and no commit', async ({ plan: fixture, message }) => {
    const planContent = fixture(); const validation = validatePlanSlices(planContent);
    if (validation.kind !== 'invalid') throw new Error('fixture must be invalid');
    const error = await refusal(planContent);
    expect(error.message).toMatch(message);
    expect(error.message).toContain(validation.violations.map(({ message }) => message).join('; '));
  });

  it('reports missing and duplicate membership together', async () => {
    const planContent = FIXTURES[1].plan().replace('3, 4, 5, 6', '3, 4, 5'); const validation = validatePlanSlices(planContent);
    if (validation.kind !== 'invalid') throw new Error('fixture must be invalid');
    const error = await refusal(planContent);
    for (const violation of validation.violations) expect(error.message).toContain(violation.message);
  });

  it('refuses Small and Medium tier plans identically', async () => {
    const planContent = plan(['| 1 | First | 1 |']);
    expect((await refusal(planContent, 'S')).message).toBe((await refusal(planContent, 'M')).message);
  });

  it('does not let a coherence waiver waive membership', async () => {
    const planContent = FIXTURES[0].plan();
    await expect(refusal(planContent, undefined, 'Waives: Task 6 in no slice\n\nRationale: not applicable\n')).resolves.toMatchObject({ message: expect.stringContaining('Task 6') });
  });

  it('lands a clean membership plan', async () => {
    const worktreePath = await seed(plan(['| 1 | First | 1, 2, 3 |', '| 2 | Second | 4, 5, 6 |']));
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())).resolves.toMatchObject({ branch: 'spec/plan-slices-membership' });
  });
});
