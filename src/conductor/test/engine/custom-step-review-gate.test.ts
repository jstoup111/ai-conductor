// Covers: task:3
//
// These run the conductor across the custom-step boundary: the runner writes
// its configured completion marker, while artifact review remains uncalled
// because this step declares no reviewable artifact contracts or extra globs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return { ...actual, performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }) };
});

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, HarnessConfig, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const CUSTOM_STEP = 'maintain-documentation' as StepName;
const PASS_MARKER = '.pipeline/maintain-documentation-pass';

describe('custom step post-success artifact review gate', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'custom-step-review-gate-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });

    const state: Record<string, unknown> = {
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'custom-step-review-gate',
    };
    for (const step of ALL_STEPS) state[step.name] = 'done';
    state.manual_test = 'skipped';
    state.prd_audit = 'skipped';
    state.architecture_review_as_built = 'skipped';
    state.finish = 'done';
    await writeState(statePath, state as ConductState);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function config(): HarnessConfig {
    return {
      steps: {
        'maintain-documentation': {
          after: 'rebase',
          skill: '.agents/skills/maintain-documentation/SKILL.md',
          enforcement: 'gating',
          completion_artifact: PASS_MARKER,
        },
        'post-documentation': {
          after: 'maintain-documentation',
          skill: '.agents/skills/maintain-documentation/SKILL.md',
          enforcement: 'advisory',
        },
      },
    } as HarnessConfig;
  }

  function markerWritingRunner(calls: StepName[]): StepRunner {
    return {
      run: vi.fn(async (step): Promise<StepRunResult> => {
        calls.push(step);
        if (step === CUSTOM_STEP) await writeFile(join(dir, PASS_MARKER), 'PASS\n');
        return { success: true };
      }),
    };
  }

  for (const mode of ['default', 'auto'] as const) {
    it(`${mode} mode advances a completion-marker custom step without artifact review`, async () => {
      const calls: StepName[] = [];
      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const runner = markerWritingRunner(calls);

      await new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        projectRoot: dir,
        mode,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: CUSTOM_STEP,
        config: config(),
        onReviewArtifacts,
      }).run();

      const state = await readState(statePath);
      const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8').catch(() => undefined);
      expect({
        reviewCalls: onReviewArtifacts.mock.calls.length,
        customStep: state.ok ? state.value[CUSTOM_STEP] : undefined,
        advancedToNextStep: calls.includes('post-documentation' as StepName),
        halt,
      }).toEqual({
        reviewCalls: 0,
        customStep: 'done',
        advancedToNextStep: true,
        halt: undefined,
      });
    });
  }
});
