// Covers: task:10, task:rem-as-built-rem-ab4-1
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeSkippedOutcome, runGroupBranch, type GroupBranchLifecycleObserver } from '../../src/engine/group-core.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';

const temporaryRoots: string[] = [];

const lifecycleObserver: GroupBranchLifecycleObserver = {
  onAdmitted: () => undefined,
  onAttempt: () => undefined,
  onRetry: () => undefined,
  onSettled: () => undefined,
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('custom parallel step registry', () => {
  it('registers a custom parallel-only group after its target without a top-level skill', () => {
    const config: HarnessConfig = {
      steps: {
        fanout: {
          after: 'build',
          when: 'tier == L',
          parallel: [
            { name: 'review', skill: 'skills/review/SKILL.md' },
            { name: 'security', skill: 'skills/security/SKILL.md' },
          ],
        },
      },
    };

    const registry = buildStepRegistry(config);
    const buildIndex = registry.findIndex((step) => step.name === 'build');
    const fanout = registry[buildIndex + 1];

    expect(fanout).toMatchObject({
      name: 'fanout',
      phase: 'BUILD',
      prerequisites: ['build'],
    });
    expect(fanout?.skillName).toBeUndefined();
  });

  it('continues to skip a custom step with neither a skill nor a parallel group', () => {
    const registry = buildStepRegistry({
      steps: { inert: { after: 'build' } },
    });

    expect(registry.map((step) => step.name)).not.toContain('inert' as StepName);
  });

  it('dispatches a custom branch skill while preserving built-in branch dispatch', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'custom-parallel-dispatch-'));
    temporaryRoots.push(projectRoot);
    const branchSkill = '.agents/skills/lint-x/SKILL.md';
    const branchSkillPath = join(projectRoot, branchSkill);
    await mkdir(dirname(branchSkillPath), { recursive: true });
    await writeFile(branchSkillPath, '---\nname: lint-x\n---\n');
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
    };
    const runner = new DefaultStepRunner(provider, 'custom-parallel-session', projectRoot, {
      config: {
        steps: {
          fanout: {
            after: 'build',
            parallel: [{ name: 'lint', skill: branchSkill }],
          },
          // Registers the branch name for the runner's resolved policy. The
          // group branch skill, not this fallback, owns the dispatched prompt.
          lint: {
            after: 'fanout',
            skill: '.agents/skills/not-the-branch-skill/SKILL.md',
          },
        },
      },
    });

    await runGroupBranch(
      { name: 'lint', skill: branchSkill, outcome: makeSkippedOutcome() },
      {} as ConductState,
      { stepRunner: runner, lifecycleObserver },
      1,
    );
    await runGroupBranch(
      { name: 'manual_test', skill: branchSkill, outcome: makeSkippedOutcome() },
      {} as ConductState,
      { stepRunner: runner, lifecycleObserver },
      1,
    );

    const prompts = vi.mocked(provider.invoke).mock.calls.map(([options]) => options.prompt);
    expect(prompts).toEqual(['/lint-x', '/manual-test']);
    expect(prompts).not.toContain('/lint');
  });
});
