// Covers: task:11
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { coverageBindingEnvelopePath } from '../../src/engine/coverage-binding-envelope.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const amendedPlanWithUnassignedTask = [
  '# Plan',
  '',
  '## Slices',
  '',
  '| Slice | Title | Tasks |',
  '| --- | --- | --- |',
  '| 1 | Initial work | 1 |',
  '',
  '### Task 1: Initial work',
  '**Dependencies:** none',
  '',
  '### Task 9: Amended work',
  '**Dependencies:** none',
].join('\n');

const planWithRemediationOutsideSlices = [
  '# Plan',
  '',
  '## Slices',
  '',
  '| Slice | Title | Tasks |',
  '| --- | --- | --- |',
  '| 1 | Initial work | 1 |',
  '',
  '### Task 1: Initial work',
  '**Dependencies:** none',
  '',
  '### Task rem-build-review-2: Repair review finding',
  '**Dependencies:** none',
].join('\n');

function disabledProvider(): LLMProvider {
  return {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn(),
  };
}

async function runWithPlan(planText: string) {
  const projectDir = await mkdtemp(join(tmpdir(), 'coverage-binding-slice-layer-'));
  const planPath = join(projectDir, 'plan.md');
  await mkdir(join(projectDir, '.docs', 'coherence'), { recursive: true });
  await writeFile(planPath, planText);
  const provider = disabledProvider();
  const runner = new DefaultStepRunner(provider, 'coverage-binding-slice-layer', projectDir, {
    featureDesc: 'coverage-binding-slice-layer',
    planPath,
    config: { coverage_binding: { judge: { enabled: false } } },
  });
  return { projectDir, planPath, provider, runner };
}

describe('coverage-binding slice layer', () => {
  it.each(['S', 'M', 'L'] as const)('refuses an amended unassigned Task 9 before the disabled judge exit for tier %s', async (tier) => {
    const { projectDir, planPath, provider, runner } = await runWithPlan(amendedPlanWithUnassignedTask);
    try {
      await expect(runner.run('coverage_binding', { complexity_tier: tier })).resolves.toMatchObject({
        success: false,
        refusal: {
          kind: 'needs-human',
          reason: expect.stringContaining('Task 9'),
        },
      });
      expect(provider.invoke).not.toHaveBeenCalled();
      await expect(readFile(coverageBindingEnvelopePath(projectDir), 'utf8')).resolves.toContain('"status":"refused"');
      await expect(readFile(coverageBindingEnvelopePath(projectDir), 'utf8')).resolves.toContain('"entries":[]');
      await expect(readFile(planPath, 'utf8')).resolves.toBe(amendedPlanWithUnassignedTask);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('does not refuse an engine-appended remediation task outside slices', async () => {
    const { projectDir, provider, runner } = await runWithPlan(planWithRemediationOutsideSlices);
    try {
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(provider.invoke).not.toHaveBeenCalled();
      await expect(readFile(coverageBindingEnvelopePath(projectDir), 'utf8')).resolves.toContain('"status":"disabled"');
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
