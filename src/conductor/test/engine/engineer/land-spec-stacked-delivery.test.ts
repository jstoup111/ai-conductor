// Covers: task:9
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { OwnerConfig } from '../../../src/engine/owner-gate/identity.js';

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

async function seed(planContent: string, complexity = 'Tier: M\n\nStacked-Delivery: approved\n'): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    ...['specs', 'stories', 'plans', 'complexity', 'conflicts', 'architecture', 'decisions']
      .map((directory) => mkdir(join(worktreePath, '.docs', directory), { recursive: true })),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'stacked-delivery.md'), '# PRD: stacked delivery\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'stacked-delivery.md'), STORIES);
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
});
