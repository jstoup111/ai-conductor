import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { resolveActiveChild, resolveCoverageBindingDecideSet } = vi.hoisted(() => ({
  resolveActiveChild: vi.fn(),
  resolveCoverageBindingDecideSet: vi.fn(),
}));

vi.mock('../../src/engine/child-cursor.js', () => ({ resolveActiveChild }));
vi.mock('../../src/engine/coverage-binding-decide-set.js', () => ({ resolveCoverageBindingDecideSet }));

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
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
