// Covers: task:4
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as planSlices from '../../../src/engine/plan-slices.js';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { OwnerConfig } from '../../../src/engine/owner-gate/identity.js';

vi.mock('../../../src/engine/plan-slices.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/plan-slices.js')>();
  return { ...actual, validatePlanSlices: vi.fn(actual.validatePlanSlices) };
});

const execFile = promisify(execFileCb);
const IDEA = 'plan slices';
let repoPath: string;

const STORIES = [
  '# Stories: plan slices',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: land slices',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given a plan, when land runs, then it commits.',
  '',
  '#### Negative Paths',
  '- Given an invalid plan, when land runs, then it refuses.',
  '',
].join('\n');

function task(id: number, dependencies?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    '**Story:** Story 1',
    ...(dependencies === undefined ? [] : [`**Dependencies:** ${dependencies}`]),
    '**Done when:**',
    '- Given a plan, when land runs, then it commits.',
    '- Given an invalid plan, when land runs, then it refuses.',
    '',
  ].join('\n');
}

function planWithTasks(tasks: string[], prefix = ''): string {
  return [
    '# Implementation Plan: plan slices',
    '',
    '**Stories:** .docs/stories/plan-slices.md',
    '',
    prefix,
    ...tasks,
  ].join('\n');
}

function slicedPlan(): string {
  return planWithTasks(
    Array.from({ length: 8 }, (_, index) => task(index + 1, index === 0 ? 'none' : String(index))),
    [
      '## Slices',
      '',
      '| Slice | Title | Tasks |',
      '| --- | --- | --- |',
      '| 1 | Config flag | 1, 2, 3 |',
      '| 2 | Land validation | 4, 5, 6 |',
      '| 3 | Re-validation | 7, 8 |',
      '',
    ].join('\n'),
  );
}

async function git(args: string[], cwd = repoPath): Promise<void> {
  await execFile('git', args, { cwd });
}

async function seed(plan: string): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'plan-slices.md'), '# PRD: plan slices\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'plan-slices.md'), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', 'plan-slices.md'), plan);
  return worktreePath;
}

function options(stackedPrsEnabled?: boolean) {
  return {
    ownerConfig: {
      spec_owner: 'test-owner',
      ...(stackedPrsEnabled === undefined ? {} : { stacked_prs: { enabled: stackedPrsEnabled } }),
    } as OwnerConfig,
  };
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-plan-slices-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
  vi.mocked(planSlices.validatePlanSlices).mockClear();
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('plan-slices land rung', () => {
  it.each([false, true])('lands unsliced free-form Dependencies with stacked_prs.enabled=%s', async (enabled) => {
    const worktreePath = await seed(planWithTasks([task(1, 'Tasks 1–9 all passing')]));

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options(enabled)))
      .resolves.toMatchObject({ branch: 'spec/plan-slices' });
  });

  it('lands an unsliced plan with only a Task Dependency Graph', async () => {
    const worktreePath = await seed(planWithTasks([], '## Task Dependency Graph\n```\n1 → 2\n```\n'));

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/plan-slices' });
  });

  it('lands a plan whose only Slices table is fenced', async () => {
    const worktreePath = await seed(planWithTasks([task(1, 'none')], [
      '```markdown',
      '## Slices',
      '| Slice | Title | Tasks |',
      '| --- | --- | --- |',
      '| 1 | Example | 1 |',
      '```',
      '',
    ].join('\n')));

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/plan-slices' });
  });

  it('lands the valid three-slice eight-task plan', async () => {
    const worktreePath = await seed(slicedPlan());

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/plan-slices' });
  });

  it('refuses every violation returned by the slice validator', async () => {
    vi.mocked(planSlices.validatePlanSlices).mockReturnValue({
      kind: 'invalid',
      violations: [
        { code: 'first', message: 'first slice violation' },
        { code: 'second', message: 'second slice violation', taskId: '6' },
      ],
    });
    const worktreePath = await seed(planWithTasks([task(1, 'none')]));

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'plan-slices' });
    expect((error as Error).message).toContain('first slice violation');
    expect((error as Error).message).toContain('second slice violation');
  });
});
