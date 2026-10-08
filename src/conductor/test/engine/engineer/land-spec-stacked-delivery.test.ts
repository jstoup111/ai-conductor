// Covers: task:9, task:10, task:11, task:17, task:20
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { OwnerConfig } from '../../../src/engine/owner-gate/identity.js';
import { deriveStoryOwnership, evaluateStackEligibility, validatePlanSlices } from '../../../src/engine/plan-slices.js';

const execFile = promisify(execFileCb);
const IDEA = 'stacked delivery';
let repoPath: string;

const STORIES = `# Stories: stacked delivery

**Status:** Accepted

## Story 1: first child
### Acceptance Criteria
#### Happy Path
- Given a first child, when it lands, then it commits.

#### Negative Paths
- Given an invalid child, when it lands, then it refuses.

## Story 2: second child
### Acceptance Criteria
#### Happy Path
- Given a second child, when it lands, then it commits.

#### Negative Paths
- Given an invalid child, when it lands, then it refuses.
`;

const THREE_STORIES = `${STORIES}
## Story 3: third child
### Acceptance Criteria
#### Happy Path
- Given a third child, when it lands, then it commits.

#### Negative Paths
- Given an invalid third child, when it lands, then it refuses.
`;

function task(id: number, story?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    ...(story === undefined ? [] : [`**Story:** ${story}`]),
    '**Type:** happy-path',
    '**Dependencies:** none',
    '**Done when:**',
    '- Given a plan, when land runs, then it commits.',
    '- Given an invalid plan, when land runs, then it refuses.',
    '',
  ].join('\n');
}

function plan(options: { includeInertTasks?: boolean; spanning?: boolean } = {}): string {
  const story2 = options.spanning ? '2' : 'Story 2';
  return [
    '# Implementation Plan: stacked delivery',
    '',
    '**Stories:** .docs/stories/stacked-delivery.md',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    `| 1 | First | 1, 2${options.spanning ? ', 3' : ''} |`,
    `| 2 | Second | ${options.spanning ? '4' : '3, 4'} |`,
    '',
    task(1, '1'),
    task(2, 'Story 1'),
    task(3, story2),
    task(4, '2'),
    ...(options.includeInertTasks ? [task(5), task(6, 'n/a')] : []),
    '## Coverage Check',
    '',
    '| Criterion | Task ids | Quote | Disposition |',
    '| --- | --- | --- | --- |',
    '| Story 1 happy: Given a first child, when it lands, then it commits. | 1 | "Given a plan, when land runs, then it commits." | diff-local |',
    '| Story 1 negative: Given an invalid child, when it lands, then it refuses. | 1 | "Given an invalid plan, when land runs, then it refuses." | diff-local |',
    '| Story 2 happy: Given a second child, when it lands, then it commits. | 3 | "Given a plan, when land runs, then it commits." | diff-local |',
    '| Story 2 negative: Given an invalid child, when it lands, then it refuses. | 3 | "Given an invalid plan, when land runs, then it refuses." | diff-local |',
  ].join('\n');
}

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function writeProjectConfig(content: string): Promise<void> {
  await mkdir(join(repoPath, '.ai-conductor'), { recursive: true });
  await writeFile(join(repoPath, '.ai-conductor', 'config.yml'), content);
}

async function seed(
  planContent: string,
  complexity = 'Tier: M\n\nStacked-Delivery: approved\n',
  stories = STORIES,
): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    ...['specs', 'stories', 'plans', 'complexity', 'conflicts', 'architecture', 'decisions']
      .map((directory) => mkdir(join(worktreePath, '.docs', directory), { recursive: true })),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'stacked-delivery.md'), '# PRD: stacked delivery\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'stacked-delivery.md'), stories);
  await writeFile(join(worktreePath, '.docs', 'plans', 'stacked-delivery.md'), planContent);
  await writeFile(join(worktreePath, '.docs', 'complexity', 'stacked-delivery.md'), `# Complexity\n\n${complexity}`);
  await writeFile(join(worktreePath, '.docs', 'conflicts', 'stacked-delivery.md'), '# Conflicts\n\nNone.\n');
  await writeFile(join(worktreePath, '.docs', 'architecture', 'stacked-delivery.md'), '# Architecture\n\n```mermaid\nflowchart TD\n  A --> B\n```\n');
  await writeFile(join(worktreePath, '.docs', 'decisions', 'stacked-delivery.md'), '# Review\n\nApproved.\n');
  return worktreePath;
}

function options() {
  return {
    ownerConfig: { spec_owner: 'test-owner' } as OwnerConfig,
    renderDeps: {
      hasTool: async () => true,
      writeTemp: async () => '/tmp/land-spec-stacked-delivery.mmd',
      runMmdc: async () => ({ ok: true }),
    },
  };
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-stacked-delivery-'));
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

describe('stacked-delivery land rung', () => {
  it('lands an eligible signed, single-owner plan from canonical project config', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: true\n  max_slices: 2\n');
    const worktreePath = await seed(plan());

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/stacked-delivery' });
  });

  it('permits no-story and n/a tasks in an eligible child', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: true\n  max_slices: 2\n');
    const worktreePath = await seed(plan({ includeInertTasks: true }).replace('| 2 | Second | 3, 4 |', '| 2 | Second | 3, 4, 5, 6 |'));

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/stacked-delivery' });
  });

  it('keeps the stacked-delivery rung inert when the flag is off', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: false\n');
    const worktreePath = await seed(plan({ spanning: true }), 'Tier: S\n');
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/stacked-delivery' });

  });

  it('lands a three-slice plan without max_slices when the flag is off', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: false\n');
    const threeSlicePlan = plan()
      .replace('| 1 | First | 1, 2 |\n| 2 | Second | 3, 4 |', '| 1 | First | 1, 2 |\n| 2 | Second | 3 |\n| 3 | Third | 4 |');
    const worktreePath = await seed(threeSlicePlan);

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/stacked-delivery' });
  });

  it('keeps the stacked-delivery rung inert without a project config', async () => {
    const worktreePath = await seed(plan({ spanning: true }), 'Tier: S\n');
    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/stacked-delivery' });
  });

  it('refuses a sliced plan when the canonical project config is invalid', async () => {
    await writeProjectConfig('stacked_prs:\n  max_slices: 0\n');
    const worktreePath = await seed(plan());

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'stacked-delivery' });
    expect((error as Error).message).toContain('stacked_prs.max_slices');
  });

  it('refuses a story cited in two children without creating a commit', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: true\n  max_slices: 2\n');
    const worktreePath = await seed(plan({ spanning: true }));
    const headBefore = await git(['rev-parse', 'HEAD'], worktreePath);

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ gate: 'stacked-delivery' });
    expect((error as Error).message).toContain('Story 2 spans child positions 1 and 2');
    expect(await git(['rev-parse', 'HEAD'], worktreePath)).toBe(headBefore);
  });

  it('reports every story that spans children in one refusal', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: true\n  max_slices: 3\n');
    const threeSlicePlan = plan({ spanning: true })
      .replace(
        '| 1 | First | 1, 2, 3 |\n| 2 | Second | 4 |',
        '| 1 | First | 1, 2, 3, 5 |\n| 2 | Second | 7 |\n| 3 | Third | 4, 6 |',
      )
      .replace(
        '## Coverage Check',
        `${task(5, '3')}${task(6, 'Story 3')}${task(7, 'n/a')}## Coverage Check`,
      );
    const worktreePath = await seed(threeSlicePlan, undefined, THREE_STORIES);

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ gate: 'stacked-delivery' });
    expect((error as Error).message).toContain('Story 2 spans child positions 1 and 3');
    expect((error as Error).message).toContain('Story 3 spans child positions 1 and 3');
  });

  it.each([
    ['T2', '1, 2', 2],
    ['T4', 'FR-1 and FR-2', 4],
  ])('refuses multi-story lines on %s', async (taskName, storyLine, taskId) => {
    await writeProjectConfig('stacked_prs:\n  enabled: true\n  max_slices: 2\n');
    const planContent = plan().replace(
      `### Task ${taskId}: Task ${taskId}\n**Story:** ${taskId === 2 ? 'Story 1' : '2'}`,
      `### Task ${taskId}: Task ${taskId}\n**Story:** ${storyLine}`,
    );
    const worktreePath = await seed(planContent);

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ gate: 'stacked-delivery' });
    expect((error as Error).message).toContain(`Task ${taskName.slice(1)} has multiple story ids on Story line "${storyLine}"`);
  });

  it('does not refuse multi-story lines on an unsliced plan', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: true\n  max_slices: 2\n');
    const unslicedPlan = plan()
      .replace('## Slices\n\n| Slice | Title | Tasks |\n| --- | --- | --- |\n| 1 | First | 1, 2 |\n| 2 | Second | 3, 4 |\n\n', '')
      .replace('### Task 4: Task 4\n**Story:** 2', '### Task 4: Task 4\n**Story:** FR-1, FR-2, FR-3');
    const worktreePath = await seed(unslicedPlan);

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/stacked-delivery' });
  });

  it('joins exactly the ownership and eligibility reasons', async () => {
    await writeProjectConfig('stacked_prs:\n  enabled: true\n  max_slices: 1\n');
    const planContent = plan({ spanning: true });
    const worktreePath = await seed(planContent);
    const slices = validatePlanSlices(planContent);
    expect(slices.kind).toBe('sliced');
    if (slices.kind !== 'sliced') throw new Error('fixture must be sliced');
    const ownership = deriveStoryOwnership(planContent, slices.slices, new Set(['1', '2']));
    const eligibility = evaluateStackEligibility({
      tier: 'M',
      signoff: 'approved',
      slicePositions: slices.slices.map(({ position }) => position),
      maxSlices: 1,
      regionCoupledSteps: [],
      complexityPath: '.docs/complexity/stacked-delivery.md',
    });
    const reasons = [
      ...(ownership.kind === 'invalid' ? ownership.violations.map(({ message }) => message) : []),
      ...(eligibility.kind === 'ineligible' ? eligibility.reasons : []),
    ];

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ gate: 'stacked-delivery' });
    expect((error as Error).message).toBe(`landSpec: ${reasons.join('; ')}`);
  });
});
