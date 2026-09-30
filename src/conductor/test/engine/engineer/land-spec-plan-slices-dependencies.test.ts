// Covers: task:7
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { validatePlanSlices } from '../../../src/engine/plan-slices.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { OwnerConfig } from '../../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);
const IDEA = 'plan slices dependencies';
let repoPath: string;
const STORIES = '# Stories: plan slices dependencies\n\n**Status:** Accepted\n\n## Story 1: dependencies\n### Acceptance Criteria\n#### Happy Path\n- Given valid sliced Dependencies, when land runs, then it commits.\n\n#### Negative Paths\n- Given invalid sliced Dependencies, when land runs, then it refuses.\n';

function task(id: number, dependencies?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    '**Story:** Story 1',
    ...(dependencies === undefined ? [] : [`**Dependencies:** ${dependencies}`]),
    '**Done when:**',
    '- Given valid sliced Dependencies, when land runs, then it commits.',
    '- Given invalid sliced Dependencies, when land runs, then it refuses.',
  ].join('\n');
}

function plan(dependencies: Record<number, string | undefined>): string {
  return [
    '# Implementation Plan: plan slices dependencies', '',
    '**Stories:** .docs/stories/plan-slices-dependencies.md', '',
    '## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |',
    '| 1 | First | 1, 2, 3 |', '| 2 | Second | 4, 5, 6 |', '| 3 | Third | 7, 8, 9 |', '',
    ...Array.from({ length: 9 }, (_, index) => {
      const id = index + 1;
      return task(id, Object.hasOwn(dependencies, id) ? dependencies[id] : 'none');
    }),
  ].join('\n');
}

async function git(args: string[], cwd = repoPath): Promise<string> { return (await execFile('git', args, { cwd })).stdout; }
async function seed(planContent: string): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }), mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }), mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true })]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'plan-slices-dependencies.md'), '# PRD: dependencies\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'plan-slices-dependencies.md'), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', 'plan-slices-dependencies.md'), planContent);
  return worktreePath;
}
function options(): { ownerConfig: OwnerConfig } { return { ownerConfig: { spec_owner: 'test-owner' } as OwnerConfig }; }

async function refusal(planContent: string): Promise<Error> {
  const worktreePath = await seed(planContent);
  const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(LandGateError);
  expect(error).toMatchObject({ gate: 'plan-slices' });
  expect(await git(['log', '--format=%s'])).toBe('init\n');
  await git(['worktree', 'remove', '--force', worktreePath]);
  return error as Error;
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-plan-slices-dependencies-'));
  await git(['init', '-b', 'main', '-q']); await git(['config', 'user.email', 'test@example.test']); await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n'); await git(['add', 'README.md']); await git(['commit', '-m', 'init']);
});
afterEach(async () => { await rm(repoPath, { recursive: true, force: true }); });

describe('plan-slices Dependencies land rung', () => {
  it.each([
    ['range', () => plan({ 4: 'Tasks 1–5' }), /malformed Dependencies/i],
    ['prose', () => plan({ 4: 'all prior.' }), /malformed Dependencies/i],
    ['missing line', () => plan({ 4: undefined }), /exactly one Dependencies/i],
    ['unknown task', () => plan({ 4: 'Task 20' }), /Task 20.*unknown/i],
    ['later slice', () => plan({ 2: 'Task 7' }), /Task 2.*slice 1.*Task 7.*slice 3/i],
  ])('refuses $0 Dependencies through the plan-slices gate', async (_name, fixture, message) => {
    const planContent = fixture();
    expect(validatePlanSlices(planContent)).toMatchObject({ kind: 'invalid' });
    expect((await refusal(planContent)).message).toMatch(message);
  });

  it('lands valid none, same-or-earlier, and annotated plural Dependencies', async () => {
    const worktreePath = await seed(plan({
      1: 'none', 2: 'Task 1', 3: 'Tasks 1, Task 2',
      4: 'Tasks 1 (prepared), Task 2 (reviewed), 3', 5: 'Task 4', 6: 'none',
      7: 'Tasks 1, 4, Task 6', 8: 'Task 7', 9: 'none',
    }));
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())).resolves.toMatchObject({ branch: 'spec/plan-slices-dependencies' });
  });
});
