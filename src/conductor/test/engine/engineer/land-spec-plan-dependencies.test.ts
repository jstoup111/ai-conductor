// Covers: task:3
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec, resolveIdeaFiles } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { computeReviewedDigest, renderPlanReviewArtifact } from '../../../src/engine/plan-review-artifact.js';
import type { OwnerConfig } from '../../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);
const IDEA = 'plan dependencies';
const SLUG = 'plan-dependencies';
const STORIES = '# Stories: plan dependencies\n\n**Status:** Accepted\n\n## Story 1: validate plan dependencies\n### Acceptance Criteria\n#### Happy Path\n- Given a conforming plan, when land runs, then it commits.\n\n#### Negative Paths\n- Given an unresolvable plan graph, when land runs, then it refuses.\n';
let repoPath: string;

function task(id: number, dependencies?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    '**Story:** Story 1',
    ...(dependencies === undefined ? [] : [`**Dependencies:** ${dependencies}`]),
    '**Done when:**',
    '- Given a conforming plan, when land runs, then it commits.',
    '- Given an unresolvable plan graph, when land runs, then it refuses.',
  ].join('\n');
}

function plan(tasks: string[], prefix = ''): string {
  return [
    '# Implementation Plan: plan dependencies', '',
    '**Stories:** .docs/stories/plan-dependencies.md', '',
    prefix,
    ...tasks,
  ].join('\n');
}

function slicedPlan(tasks: string[]): string {
  return plan(tasks, ['## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |', '| 1 | Validation | 1, 2 |', ''].join('\n'));
}

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function seed(planContent: string): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', `${SLUG}.md`), '# PRD: plan dependencies\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', `${SLUG}.md`), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', `${SLUG}.md`), planContent);
  const reviewedDigest = computeReviewedDigest({
    planText: planContent,
    storiesText: STORIES,
    adrTexts: {},
    artifactTexts: { [`.docs/coherence/${SLUG}.md`]: '' },
    changedPaths: [...await resolveIdeaFiles(worktreePath, repoPath)],
  });
  await mkdir(join(worktreePath, '.docs', 'plan-review'), { recursive: true });
  await writeFile(join(worktreePath, '.docs', 'plan-review', `${SLUG}.md`), renderPlanReviewArtifact({
    round: 1, authoringHost: 'claude', reviewerProvider: 'codex', independence: 'cross-provider',
    findings: [], dispositions: [], reviewedDigest,
  }));
  return worktreePath;
}

function options(): { ownerConfig: OwnerConfig } {
  return { ownerConfig: { spec_owner: 'test-owner' } as OwnerConfig };
}

async function expectDependencyRefusal(planContent: string): Promise<LandGateError> {
  const worktreePath = await seed(planContent);
  const branchHeadBeforeLand = (await git(['rev-parse', `spec/${SLUG}`])).trim();
  const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
    .catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(LandGateError);
  expect(error).toMatchObject({ gate: 'plan-dependencies' });
  expect((await git(['rev-parse', `spec/${SLUG}`])).trim()).toBe(branchHeadBeforeLand);
  await git(['worktree', 'remove', '--force', worktreePath]);
  return error as LandGateError;
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-plan-dependencies-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => { await rm(repoPath, { recursive: true, force: true }); });

describe('plan-dependencies land rung', () => {
  it('refuses an unsliced two-task cycle without committing the spec branch', async () => {
    const error = await expectDependencyRefusal(plan([task(1, 'Task 2'), task(2, 'Task 1')]));

    expect(error.message).toMatch(/Tasks 1, 2 form a dependency cycle/);
  });

  it('refuses an unsliced plan that cites a nonexistent task', async () => {
    const error = await expectDependencyRefusal(plan([task(1, 'none'), task(2, 'Task 99')]));

    expect(error.message).toContain('Task 2');
    expect(error.message).toContain('Task 99');
  });

  it('refuses every task missing Dependencies when a graph section is present', async () => {
    const error = await expectDependencyRefusal(plan([task(1), task(2)], '## Task Dependency Graph\n\n```text\nTask 1 --> Task 2\n```\n'));

    expect(error.message).toContain('Task 1');
    expect(error.message).toContain('Task 2');
  });

  it('refuses a same-slice dependency cycle after the plan-slices rung passes', async () => {
    const error = await expectDependencyRefusal(slicedPlan([task(1, 'Task 2'), task(2, 'Task 1')]));

    expect(error.message).toMatch(/Tasks 1, 2 form a dependency cycle/);
  });

  it('keeps a malformed slice refusal ahead of dependency cycles', async () => {
    const malformedSlices = plan([
      task(1, 'Task 2'),
      task(2, 'Task 1'),
    ], ['## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |', '| 1 | Validation | 1 |', ''].join('\n'));
    const worktreePath = await seed(malformedSlices);
    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ gate: 'plan-slices' });
    expect((error as Error).message).not.toContain('dependency cycle');
    await git(['worktree', 'remove', '--force', worktreePath]);
  });

  it('commits a conforming unsliced plan', async () => {
    const worktreePath = await seed(plan([task(1, 'none'), task(2, 'Task 1')]));

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: `spec/${SLUG}` });
  });

  it('commits a conforming sliced plan', async () => {
    const worktreePath = await seed(slicedPlan([task(1, 'none'), task(2, 'Task 1')]));

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: `spec/${SLUG}` });
  });
});
