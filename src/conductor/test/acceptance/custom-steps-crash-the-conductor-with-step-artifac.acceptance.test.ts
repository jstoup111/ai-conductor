// Covers: tasks:6,7
/**
 * Acceptance coverage for chained custom SHIP-tail steps selected with --from.
 *
 * The fixture enters at `doc-pass`, invokes the real Conductor loop, and uses a
 * faithful StepRunner fake at the external execution boundary. Every built-in
 * step is pre-resolved so the run is bounded to the two custom steps and finish.
 */

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

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, HarnessConfig, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const DOC_PASS = 'doc-pass' as StepName;
const RELEASE_NOTE = 'release-note' as StepName;

describe('inline --from with chained custom SHIP-tail steps', () => {
  let projectRoot: string;
  let statePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'custom-steps-acceptance-'));
    statePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });

    const state: Record<string, unknown> = {
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'chained custom SHIP-tail steps',
    };
    for (const step of ALL_STEPS) state[step.name] = 'done';
    // These default-mode validators are unrelated to the SHIP-tail transition
    // under test; the real conductor recognizes their explicit skip state.
    state.manual_test = 'skipped';
    state.prd_audit = 'skipped';
    state.architecture_review_as_built = 'skipped';
    delete state.finish;
    await writeState(statePath, state as ConductState);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('runs both custom steps and advances to finish without halting', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        calls.push(step);
        if (step === DOC_PASS) {
          await writeFile(join(projectRoot, '.pipeline/doc-pass'), 'PASS\n', 'utf-8');
        }
        if (step === RELEASE_NOTE) {
          await writeFile(join(projectRoot, '.pipeline/release-note'), 'PASS\n', 'utf-8');
        }
        return { success: true };
      },
    };

    const config: HarnessConfig = {
      steps: {
        'doc-pass': {
          after: 'rebase',
          skill: 'skills/doc-pass/SKILL.md',
          enforcement: 'gating',
          completion_artifact: '.pipeline/doc-pass',
        },
        'release-note': {
          after: 'doc-pass',
          skill: 'skills/release-note/SKILL.md',
          enforcement: 'gating',
          completion_artifact: '.pipeline/release-note',
        },
      },
    } as unknown as HarnessConfig;

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'default',
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: DOC_PASS,
      config,
    }).run();

    expect(calls).toEqual(expect.arrayContaining([DOC_PASS, RELEASE_NOTE, 'finish']));
    expect(calls.indexOf(DOC_PASS)).toBeLessThan(calls.indexOf(RELEASE_NOTE));
    expect(calls.indexOf(RELEASE_NOTE)).toBeLessThan(calls.indexOf('finish'));
    const state = await readState(statePath);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value[DOC_PASS]).toBe('done');
      expect(state.value[RELEASE_NOTE]).toBe('done');
    }
    await expect(readFile(join(projectRoot, '.pipeline/HALT'), 'utf-8')).rejects.toThrow();
  });

  it('keeps the first step done when the second custom marker is missing', async () => {
    const failures: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_failed', (event) => {
      if (event.type === 'step_failed') failures.push(event.error);
    });
    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        if (step === DOC_PASS) {
          await writeFile(join(projectRoot, '.pipeline/doc-pass'), 'PASS\n', 'utf-8');
        }
        return { success: true };
      },
    };
    const config: HarnessConfig = {
      steps: {
        'doc-pass': {
          after: 'rebase',
          skill: 'skills/doc-pass/SKILL.md',
          enforcement: 'gating',
          completion_artifact: '.pipeline/doc-pass',
        },
        'release-note': {
          after: 'doc-pass',
          skill: 'skills/release-note/SKILL.md',
          enforcement: 'gating',
          completion_artifact: '.pipeline/release-note',
        },
      },
    } as unknown as HarnessConfig;

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'default',
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: DOC_PASS,
      config,
      onRecovery: async () => 'quit',
    }).run();

    const state = await readState(statePath);
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8').catch(() => '');
    expect({
      docPass: state.ok ? state.value[DOC_PASS] : undefined,
      releaseNote: state.ok ? state.value[RELEASE_NOTE] : undefined,
      failure: failures[0],
      diagnostic: `${failures.join('\n')}${halt}`,
    }).toEqual({
      docPass: 'done',
      releaseNote: 'failed',
      failure:
        `Step '${RELEASE_NOTE}' completed but completion check failed: ` +
        `configured completion artifact ".pipeline/release-note" is missing — ${RELEASE_NOTE} must write it after a passing review`,
      diagnostic: expect.not.stringContaining('not iterable'),
    });
  });
});
