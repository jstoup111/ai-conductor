import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { buildStepRegistry, ALL_STEPS } from '../../src/engine/steps.js';
import { resolveSkill } from '../../src/engine/skill-resolver.js';
import { runWithHooks } from '../../src/engine/hooks.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName, ConductState, ConductorEvent } from '../../src/types/index.js';

class MockStepRunner implements StepRunner {
  calls: StepName[] = [];

  async run(step: StepName): Promise<StepRunResult> {
    this.calls.push(step);
    return { success: true };
  }
}

describe('Integration: config flow', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let runner: MockStepRunner;
  let collectedEvents: ConductorEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-config-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    runner = new MockStepRunner();
    collectedEvents = [];

    const eventTypes: ConductorEvent['type'][] = [
      'step_started', 'step_completed', 'step_failed',
      'tier_skip', 'config_skip', 'gate_blocked', 'feature_complete',
    ];
    for (const type of eventTypes) {
      events.on(type, (event: ConductorEvent) => {
        collectedEvents.push(event);
      });
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('Conductor with config disabling steps skips them', async () => {
    await writeState(statePath, { complexity_tier: 'L' } as ConductState);

    const config: HarnessConfig = {
      steps: {
        retro: { disable: true },
        architecture_review: { disable: true },
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      config,
    });

    await conductor.run();

    // Disabled steps should not appear in runner calls
    expect(runner.calls).not.toContain('retro');
    expect(runner.calls).not.toContain('architecture_review');
    // Disabling architecture_review also skips the as-built sweep (no ADRs to
    // audit) via skipWhenSkipped — even on L tier where it isn't tier-skipped.
    expect(runner.calls).not.toContain('architecture_review_as_built');

    // Dispatched to runner.run: everything except the 3 engine-managed steps
    // (complexity + worktree + rebase), the 2 disabled steps (retro +
    // architecture_review), and architecture_review_as_built (cascade-skipped
    // via skipWhenSkipped because architecture_review is disabled). `prd` runs
    // here because no track is set (defaults to product); `explore` + `prd`
    // replace the former single `brainstorm` step, and prd_audit still runs
    // (the PRD exists regardless of the architecture review).
    expect(runner.calls).toHaveLength(12);

    // Verify final state marks disabled steps as 'skipped'
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.retro).toBe('skipped');
    expect(result.value.architecture_review).toBe('skipped');
    expect(result.value.architecture_review_as_built).toBe('skipped');

    // Non-disabled steps should be 'done'
    expect(result.value.build).toBe('done');
    expect(result.value.finish).toBe('done');
    expect(result.value.feature_status).toBe('complete');

    // config_skip events emitted for each disabled step, plus the cascade-skip
    // of architecture_review_as_built (skipWhenSkipped → also a config_skip).
    const skipEvents = collectedEvents.filter((e) => e.type === 'config_skip');
    expect(skipEvents).toHaveLength(3);
    const skippedSteps = skipEvents.map((e) => (e as { step: string }).step);
    expect(skippedSteps).toContain('retro');
    expect(skippedSteps).toContain('architecture_review');
    expect(skippedSteps).toContain('architecture_review_as_built');
  });

  it('Conductor with custom step executes it at correct position', () => {
    const config: HarnessConfig = {
      steps: {
        security_scan: {
          after: 'build',
          skill: 'security-scan',
          enforcement: 'advisory',
        },
      },
    };

    const registry = buildStepRegistry(config);
    const buildIdx = registry.findIndex((s) => s.name === 'build');
    const customIdx = registry.findIndex((s) => s.name === 'security_scan');
    const manualTestIdx = registry.findIndex((s) => s.name === 'manual_test');

    expect(customIdx).toBe(buildIdx + 1);
    expect(manualTestIdx).toBe(customIdx + 1);

    const customStep = registry[customIdx];
    expect(customStep.phase).toBe('BUILD');
    expect(customStep.enforcement).toBe('advisory');
    expect(customStep.prerequisites).toEqual(['build']);
    expect(customStep.skillName).toBe('security-scan');

    // Registry length = ALL_STEPS count + 1 custom
    expect(registry).toHaveLength(ALL_STEPS.length + 1);
  });

  it('custom step after a reordered step (plan) inserts correctly', () => {
    // After the DECIDE reorder (architecture now precedes plan), custom steps
    // that target a built-in by name still resolve — buildStepRegistry inserts
    // by name, not absolute position.
    const config: HarnessConfig = {
      steps: {
        tech_review: { after: 'plan', skill: 'tech-review', enforcement: 'advisory' },
      },
    };
    const registry = buildStepRegistry(config);
    const archIdx = registry.findIndex((s) => s.name === 'architecture_review');
    const planIdx = registry.findIndex((s) => s.name === 'plan');
    const customIdx = registry.findIndex((s) => s.name === 'tech_review');
    const specsIdx = registry.findIndex((s) => s.name === 'acceptance_specs');

    expect(archIdx).toBeLessThan(planIdx); // architecture precedes plan (reorder)
    expect(customIdx).toBe(planIdx + 1); // custom step lands right after plan
    expect(specsIdx).toBe(customIdx + 1);
    expect(registry[customIdx].prerequisites).toEqual(['plan']);
  });

  it('Conductor with skill override uses project-local skill', async () => {
    // Create a project-local skill override file
    const projectRoot = dir;
    const overridePath = 'custom-skills/my-tdd/SKILL.md';
    const fullOverridePath = join(projectRoot, overridePath);
    await mkdir(join(projectRoot, 'custom-skills', 'my-tdd'), { recursive: true });
    await writeFile(fullOverridePath, [
      '---',
      'name: my-tdd',
      'description: Custom TDD skill',
      'enforcement: gating',
      'phase: BUILD',
      '---',
      '# My custom TDD',
    ].join('\n'));

    const config: HarnessConfig = {
      steps: {
        build: { skill: overridePath },
      },
    };

    const resolved = resolveSkill('build', config, projectRoot);

    expect(resolved.isOverride).toBe(true);
    expect(resolved.path).toBe(fullOverridePath);
    // build is enforcement-locked, so enforcement stays 'structural' not 'gating'
    expect(resolved.enforcement).toBe('structural');

    // Without override, default path is returned
    const defaultResolved = resolveSkill('build', {}, projectRoot);
    expect(defaultResolved.isOverride).toBe(false);
    expect(defaultResolved.path).toBe('skills/pipeline/SKILL.md');
  });

  it('Conductor with hooks wraps skill execution', async () => {
    const executionOrder: string[] = [];

    // Create hook scripts on disk so fileExists passes
    const beforeHookPath = join(dir, 'hooks', 'before-build.sh');
    const afterHookPath = join(dir, 'hooks', 'after-build.sh');
    await mkdir(join(dir, 'hooks'), { recursive: true });
    await writeFile(beforeHookPath, '#!/bin/bash\necho before');
    await writeFile(afterHookPath, '#!/bin/bash\necho after');

    const config: HarnessConfig = {
      steps: {
        build: {
          hooks: {
            before: beforeHookPath,
            after: afterHookPath,
          },
        },
      },
    };

    const mockHookRunner = {
      async runHook(scriptPath: string) {
        if (scriptPath.includes('before-build') || scriptPath === `bash ${beforeHookPath}`) {
          executionOrder.push('before-hook');
        } else if (scriptPath.includes('after-build') || scriptPath === `bash ${afterHookPath}`) {
          executionOrder.push('after-hook');
        }
        return { success: true, output: 'ok' };
      },
    };

    const skillRunner = async () => {
      executionOrder.push('skill');
      return { success: true, output: 'built' };
    };

    const result = await runWithHooks('build', config, dir, skillRunner, mockHookRunner);

    expect(result.success).toBe(true);
    expect(executionOrder).toEqual(['before-hook', 'skill', 'after-hook']);
  });
});
