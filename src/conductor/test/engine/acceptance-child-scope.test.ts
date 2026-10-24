// Covers: task:5, task:14, task:15, task:17, task:18, task:19
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const { hasDurableChildState, resolveActiveChild, resolveChildBase } = vi.hoisted(() => ({
  hasDurableChildState: vi.fn(),
  resolveActiveChild: vi.fn(),
  resolveChildBase: vi.fn(),
}));

vi.mock('../../src/engine/child-cursor.js', () => ({ hasDurableChildState, resolveActiveChild, resolveChildBase }));

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import {
  checkStepCompletion,
} from '../../src/engine/artifacts.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

const execFile = promisify(execFileCallback);

function slicedPlan(story1 = 'Story 1', story2 = 'Story 2'): string {
  return `# Implementation Plan: feature

**Stories:** .docs/stories/feature.md

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | First | 1 |
| 2 | Second | 2 |

### Task 1: First
**Story:** ${story1}
**Dependencies:** none

### Task 2: Second
**Story:** ${story2}
**Dependencies:** 1
`;
}

async function recordStackPositions(root: string): Promise<void> {
  await execFile('git', ['init', '-q', '-b', 'feat/daemon-feature'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'acceptance@example.test'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Acceptance test'], { cwd: root });
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const positionsPath = join(root, 'positions.json');
  await writeFile(positionsPath, '[1,2]');
  const { stdout } = await execFile('git', ['hash-object', '-w', positionsPath], { cwd: root });
  await execFile('git', ['update-ref', 'refs/conductor/feature/positions', stdout.trim()], { cwd: root });
}

describe('acceptance_specs child scope', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    vi.resetAllMocks();
  });

  it('dispatches only the active child\'s owned story criteria', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-child-scope-'));
    roots.push(root);
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), slicedPlan());
    await writeFile(join(root, '.docs', 'stories', 'feature.md'), `# Stories

## Story 1: first child
### Happy Path
- Given child 1, When it writes specs, Then only its criterion is included.
### Negative Paths
- Given child 1 fails, When it runs, Then its failure is recorded.

## Story 2: second child
### Happy Path
- Given child 2, When it writes specs, Then only its criterion is included.
### Negative Paths
- Given child 2 fails, When it runs, Then its failure is recorded.
`);
    resolveActiveChild.mockResolvedValue({ kind: 'active', child: 2, position: 2, isLeaf: false, branch: 'feat/c2/feature' });
    const invoke = vi.fn().mockResolvedValue({ success: true, output: 'done', exitCode: 0 });
    const runner = new DefaultStepRunner(
      { lifecycleCapability: { synchronousSpawnPermit: true }, invoke } as LLMProvider,
      'session', root, { featureDesc: 'feature', projectRoot: root },
    );

    await runner.run('acceptance_specs', {});

    const systemPrompt = invoke.mock.calls[0]?.[0]?.systemPrompt as string;
    expect(systemPrompt).toContain('active child 2');
    expect(systemPrompt).toContain('Story 2: second child');
    expect(systemPrompt).not.toContain('Story 1: first child');
  });
});

describe('acceptance_specs prior-child-green exception', () => {
  const roots: string[] = [];
  const child2 = parseChildId(2)!;

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    vi.resetAllMocks();
  });

  async function createFile(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }

  async function seed(attribution: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-prior-child-green-'));
    roots.push(root);
    await createFile(root, 'test/acceptance/feature.acceptance.test.ts', '// generated child 2 spec\n');
    await createFile(
      root,
      '.pipeline/children/2/acceptance-specs-red.json',
      JSON.stringify({
        outcome: 'specs-generated',
        command: 'npm test -- test/acceptance/feature.acceptance.test.ts',
        targetSpecs: ['test/acceptance/feature.acceptance.test.ts'],
        executed: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        errors: 0,
        failingTests: [],
        ranAt: '2026-10-09T12:00:00.000Z',
        intentRationale: 'Child 1 already implemented this child 2 criterion.',
        exception: {
          kind: 'prior-child-green',
          reason: 'The child 2 acceptance spec passes because child 1 already delivered the behavior.',
          attribution,
        },
      }),
    );
    return root;
  }

  it('accepts child 2 only when prior-child-green names its parent closure tip', async () => {
    const root = await seed('parent-closure-tip');
    resolveChildBase.mockResolvedValue({ kind: 'parent', parent: 1, sha: 'parent-closure-tip' });

    await expect(checkStepCompletion(root, 'acceptance_specs', {
      activeChild: child2,
      featureDesc: 'feature',
    })).resolves.toEqual({ done: true, viaException: true });
    expect(resolveChildBase).toHaveBeenCalledWith(root, 'feature', child2, {});
  });

  it('refuses a prior-child-green attribution other than the parent closure tip', async () => {
    const root = await seed('some-other-sha');
    resolveChildBase.mockResolvedValue({ kind: 'parent', parent: 1, sha: 'parent-closure-tip' });

    await expect(checkStepCompletion(root, 'acceptance_specs', {
      activeChild: child2,
      featureDesc: 'feature',
    })).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
      reason: expect.stringContaining('some-other-sha'),
    });
  });
});

describe('acceptance_specs child-scoped disposition grounding', () => {
  const roots: string[] = [];
  const child2 = parseChildId(2)!;

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createFile(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }

  const story1Happy = 'Story 1 happy: Given child 1 works, When it records evidence, Then its result is accepted.';
  const story2Happy = 'Story 2 happy: Given child 2 works, When it records evidence, Then its result is accepted.';
  const story2Negative = 'Story 2 negative: Given child 2 fails, When it records evidence, Then it is refused.';

  function record(criterion: string) {
    return {
      criterion,
      disposition: 'existing-sufficient-test' as const,
      citation: 'test/engine/existing-behavior.test.ts:1',
    };
  }

  async function seed(dispositions: readonly ReturnType<typeof record>[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-child-disposition-'));
    roots.push(root);
    await createFile(root, '.docs/plans/feature.md', slicedPlan());
    await createFile(root, '.docs/stories/feature.md', `# Stories

## Story 1: first child
### Happy Path
- Given child 1 works, When it records evidence, Then its result is accepted.

## Story 2: second child
### Happy Path
- Given child 2 works, When it records evidence, Then its result is accepted.
### Negative Paths
- Given child 2 fails, When it records evidence, Then it is refused.
`);
    await createFile(root, 'test/engine/existing-behavior.test.ts', '// existing proof\n');
    await createFile(
      root,
      '.pipeline/children/2/acceptance-specs-red.json',
      JSON.stringify({ outcome: 'disposition-only', dispositions }),
    );
    await recordStackPositions(root);
    resolveChildBase.mockResolvedValue({ kind: 'none' });
    return root;
  }

  const context = {
    activeChild: child2,
    featureDesc: 'feature',
    artifactResolution: {
      featureIdentities: ['feature'],
      // Child 1's files are not a child 2 change. Child-base attribution is
      // added separately; this fixture intentionally has no child 2 specs.
      changedPaths: new Set<string>(),
    },
  };

  it('grounds disposition-only evidence in loader ownership despite a stale envelope', async () => {
    const root = await seed([record(story2Happy), record(story2Negative)]);
    await createFile(root, '.pipeline/coverage-binding.json', JSON.stringify({
      version: 1,
      slug: 'feature',
      runId: 'stale',
      status: 'disabled',
      storyOwnership: { '1': 2, '2': 1 },
    }));

    await expect(checkStepCompletion(root, 'acceptance_specs', context)).resolves.toEqual({
      done: true,
      viaException: false,
    });
  });

  it('refuses an omitted criterion owned by child 2', async () => {
    const root = await seed([record(story2Happy)]);

    await expect(checkStepCompletion(root, 'acceptance_specs', context)).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
      reason: expect.stringContaining(`omitted: ${story2Negative}`),
    });
  });

  it('refuses a foreign-story criterion as not owned by child 2', async () => {
    const root = await seed([record(story2Happy), record(story2Negative), record(story1Happy)]);

    await expect(checkStepCompletion(root, 'acceptance_specs', context)).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
      reason: expect.stringContaining(`not owned by child 2: ${story1Happy}`),
    });
  });

  it('does not attribute a parent child\'s acceptance specs to child 2', async () => {
    const root = await seed([record(story2Happy), record(story2Negative)]);
    await createFile(root, 'test/acceptance/feature.acceptance.test.ts', '// committed by child 1\n');
    resolveChildBase.mockResolvedValue({ kind: 'parent', parent: 1, sha: 'child-1-tip' });
    const git = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    await expect(checkStepCompletion(root, 'acceptance_specs', {
      ...context,
      git,
    })).resolves.toEqual({ done: true, viaException: false });
    expect(resolveChildBase).toHaveBeenCalledWith(root, 'feature', child2, { git });
    expect(git).toHaveBeenCalledWith(['diff', '--name-only', 'child-1-tip', 'HEAD']);
  });

  it('refuses disposition-only evidence when the parent child branch is missing', async () => {
    const root = await seed([record(story2Happy), record(story2Negative)]);
    resolveChildBase.mockResolvedValue({
      kind: 'parent-missing', parent: 1, branch: 'feat/c1/feature',
    });

    await expect(checkStepCompletion(root, 'acceptance_specs', context)).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
      reason: expect.stringContaining('feat/c1/feature'),
    });
  });
});

describe('acceptance_specs child with no owned criteria', () => {
  const roots: string[] = [];
  const child1 = parseChildId(1)!;

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    vi.resetAllMocks();
  });

  async function createFile(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }

  it('uses loader ownership for no-owned-criteria despite a stale envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-child-empty-'));
    roots.push(root);
    await createFile(root, '.docs/plans/feature.md', slicedPlan('n/a', 'Story 2'));
    await createFile(root, '.docs/stories/feature.md', `# Stories

## Story 2: second child
### Happy Path
- Given child 2, When it writes specs, Then only its criterion is included.
`);
    const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
    await createFile(root, '.pipeline/conduct-state.json', JSON.stringify({
      ...state,
      feature_desc: 'feature',
      acceptance_specs: 'pending',
      build: 'pending',
    }));
    await createFile(root, '.pipeline/children/1/conduct-state.json', JSON.stringify({
      acceptance_specs: 'pending',
      build: 'pending',
      test_suite: 'done',
      build_review: 'done',
    }));
    await recordStackPositions(root);
    await createFile(root, '.pipeline/coverage-binding.json', JSON.stringify({
      version: 1,
      slug: 'feature',
      runId: 'stale',
      status: 'disabled',
      storyOwnership: { '2': 1 },
    }));
    resolveActiveChild.mockResolvedValue({
      kind: 'active', child: child1, position: 1, isLeaf: false, branch: 'feat/c1/feature',
    });
    hasDurableChildState.mockResolvedValue(true);
    const run = vi.fn().mockResolvedValue({ success: true });

    await new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'feature',
      fromStep: 'acceptance_specs',
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      childRegionLifecycle: {
        resolveActiveChild,
        enterChildRegion: async () => ({ kind: 'completed' }),
      },
    }).run();

    expect(run.mock.calls.map(([step]) => step)).toEqual(['build']);
    await expect(readVerdict(root, 'acceptance_specs', child1)).resolves.toMatchObject({
      satisfied: true,
      outcome: 'no-owned-criteria',
    });
  });

  it('does not produce no-owned-criteria without an active child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-flat-'));
    roots.push(root);
    await createFile(root, '.docs/plans/feature.md', slicedPlan('n/a', 'Story 2'));
    await createFile(root, '.docs/stories/feature.md', `# Stories

## Story 2: second child
### Happy Path
- Given child 2, When it writes specs, Then only its criterion is included.
`);

    await expect(checkStepCompletion(root, 'acceptance_specs', { featureDesc: 'feature' })).resolves.not.toMatchObject({
      acceptanceOutcome: 'no-owned-criteria',
    });
  });
});
