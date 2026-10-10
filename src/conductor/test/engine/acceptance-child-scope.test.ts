import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { resolveActiveChild, resolveChildBase, resolveCoverageBindingDecideSet } = vi.hoisted(() => ({
  resolveActiveChild: vi.fn(),
  resolveChildBase: vi.fn(),
  resolveCoverageBindingDecideSet: vi.fn(),
}));

vi.mock('../../src/engine/child-cursor.js', () => ({ resolveActiveChild, resolveChildBase }));
vi.mock('../../src/engine/coverage-binding-decide-set.js', () => ({ resolveCoverageBindingDecideSet }));

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import {
  ACCEPTANCE_SPECS_RED_EVIDENCE,
  checkStepCompletion,
} from '../../src/engine/artifacts.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

describe('acceptance_specs child scope', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    vi.resetAllMocks();
  });

  it('dispatches only the active child\'s owned story criteria', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-child-scope-'));
    roots.push(root);
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
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
    await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'second'] },
      storyOwnership: { '1': 1, '2': 2 },
    }));
    resolveActiveChild.mockResolvedValue({ kind: 'active', child: 1, position: 1, isLeaf: false, branch: 'feat/c1/feature' });
    resolveCoverageBindingDecideSet.mockResolvedValue({ storiesPath: '.docs/stories/feature.md' });
    const invoke = vi.fn().mockResolvedValue({ success: true, output: 'done', exitCode: 0 });
    const runner = new DefaultStepRunner(
      { lifecycleCapability: { synchronousSpawnPermit: true }, invoke } as LLMProvider,
      'session', root, { featureDesc: 'feature', projectRoot: root },
    );

    await runner.run('acceptance_specs', {});

    const systemPrompt = invoke.mock.calls[0]?.[0]?.systemPrompt as string;
    expect(systemPrompt).toContain('active child 1');
    expect(systemPrompt).toContain('Story 1: first child');
    expect(systemPrompt).not.toContain('Story 2: second child');
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
    await createFile(root, '.pipeline/coverage-binding.json', JSON.stringify({
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'second'] },
      storyOwnership: { '1': 1, '2': 2 },
    }));
    await createFile(root, 'test/engine/existing-behavior.test.ts', '// existing proof\n');
    await createFile(
      root,
      '.pipeline/children/2/acceptance-specs-red.json',
      JSON.stringify({ outcome: 'disposition-only', dispositions }),
    );
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

  it('accepts child 2 when every and only its owned criteria are disposed', async () => {
    const root = await seed([record(story2Happy), record(story2Negative)]);

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
