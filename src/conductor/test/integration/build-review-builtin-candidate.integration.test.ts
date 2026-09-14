// Covers: task:20
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'builtin-candidate-runner-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 1: review\n**Files:** src/a.ts\n');
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
  return root;
}

function git() {
  return async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'head\n', stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000src/a.ts\u0000', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n', stderr: '' };
    if (args[0] === 'show') return { exitCode: 0, stdout: 'export const value = 0;\n', stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  };
}

describe('built-in build-review candidate runner', () => {
  it.each([
    ['default built-in membership', { build_review: { enabled: true, rubrics: { testQuality: { enabled: true } } } } as HarnessConfig],
    ['an explicit empty custom container', { build_review: { enabled: true, rubrics: { testQuality: { enabled: true } }, custom_rubrics: {} } } as HarnessConfig],
  ])('keeps %s on the built-in path without custom discovery', async (_name, config) => {
    const root = await fixture();
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, exitCode: 0, output: 'unexpected provider call' })),
      lifecycleCapability: { synchronousSpawnPermit: true },
    };
    const discoverCustom = vi.fn(async () => []);
    const coordinator = vi.fn(async (_inputs, resolved) => {
      expect(resolved.catalog).toEqual([expect.objectContaining({ id: 'testQuality', kind: 'builtin' })]);
      return { success: true, output: 'built-in candidate settled' };
    });
    const runner = new DefaultStepRunner(provider, 'builtin-candidate', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(), config,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewPolicyCatalog: discoverCustom,
      buildReviewCoordinator: coordinator,
    });

    await expect(runner.run('build_review', { complexity_tier: 'S' } as never)).resolves.toMatchObject({
      success: true, output: 'built-in candidate settled',
    });
    expect(coordinator).toHaveBeenCalledOnce();
    expect(discoverCustom).not.toHaveBeenCalled();
    expect(provider.invoke).not.toHaveBeenCalled();
  });
});
