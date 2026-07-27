/**
 * RED acceptance specs for the repository-local documentation gate.
 *
 * Stories:
 * - Configure an opt-in custom-step completion artifact
 * - Require fresh pass evidence before advancing
 *
 * These specs drive the real Conductor.run entry point with a custom step
 * inserted after rebase. They assert the observable dispatch sequence and
 * persisted state. Calling checkStepCompletion directly would not prove that
 * the conductor consults configured evidence after a successful model return.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
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
const REVIEW = '.pipeline/maintain-documentation-review.md';

describe('repository-local documentation gate — real Conductor.run flow', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maintain-documentation-gate-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });

    const state: Record<string, unknown> = {
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'maintain-documentation',
    };
    for (const step of ALL_STEPS) state[step.name] = 'done';
    state.manual_test = 'skipped';
    state.prd_audit = 'skipped';
    state.architecture_review_as_built = 'skipped';
    delete state.finish;
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
      },
    } as unknown as HarnessConfig;
  }

  function conductor(runner: StepRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      mode: 'auto',
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: CUSTOM_STEP,
      config: config(),
    });
  }

  it('does not dispatch finish when the model returns success but only stale PASS evidence exists', async () => {
    const markerPath = join(dir, PASS_MARKER);
    await writeFile(markerPath, 'PASS\n', 'utf-8');
    const stale = new Date(Date.now() - 60_000);
    await utimes(markerPath, stale, stale);

    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        calls.push(step);
        if (step === CUSTOM_STEP) {
          await writeFile(join(dir, REVIEW), '# Documentation review\n\nBLOCKED\n', 'utf-8');
        }
        return { success: true };
      },
    };

    await conductor(runner).run();

    expect(calls).toContain(CUSTOM_STEP);
    expect(calls).not.toContain('finish');
    const state = await readState(statePath);
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.value[CUSTOM_STEP]).not.toBe('done');
  });

  it('dispatches finish exactly once when the custom step writes a fresh PASS marker', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        calls.push(step);
        if (step === CUSTOM_STEP) {
          await writeFile(join(dir, REVIEW), '# Documentation review\n\nPASS\n', 'utf-8');
          await writeFile(join(dir, PASS_MARKER), 'PASS\n', 'utf-8');
        }
        return { success: true };
      },
    };

    await conductor(runner).run();

    expect(calls.filter((step) => step === CUSTOM_STEP)).toHaveLength(1);
    expect(calls.filter((step) => step === 'finish')).toHaveLength(1);
    const state = await readState(statePath);
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.value[CUSTOM_STEP]).toBe('done');
  });
});
