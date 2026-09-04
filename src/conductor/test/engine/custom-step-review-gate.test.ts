// Covers: tasks:3,4,5
//
// These run the conductor across the custom-step boundary: the runner writes
// its configured completion marker, while artifact review remains uncalled
// because this step declares no reviewable artifact contracts or extra globs.
//
// Task 4's plan-artifact prompt assertion is already covered by
// conductor.test.ts's "persists approvals to state after a successful review"
// case. `acceptance_specs` and `worktree` have fixed `auto` review policies,
// so their cases below assert their observable auto-approval/no-prompt behavior
// rather than an unreachable config override. The planned hand mutation that
// removes `extraArtifactGlobs` is not falsifiable through `acceptance_specs`:
// its built-in artifact contracts are non-empty, so the predicate's first term
// already holds. Keep the extra-glob term as defensive support for future
// extra-glob-only steps; it currently only returns values for acceptance_specs.

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
vi.mock('../../src/engine/artifacts.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/engine/artifacts.js')>(
    '../../src/engine/artifacts.js',
  );
  return { ...actual, resolveArtifactFiles: vi.fn(actual.resolveArtifactFiles) };
});

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { resolveArtifactFiles } from '../../src/engine/artifacts.js';
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
      const failures: string[] = [];
      const events = new ConductorEventEmitter();
      events.on('step_failed', (event) => {
        if (event.type === 'step_failed') failures.push(event.error);
      });
      const runner = markerWritingRunner(calls);
      vi.mocked(resolveArtifactFiles).mockClear();

      await new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
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
        artifactResolutionCalls: vi.mocked(resolveArtifactFiles).mock.calls.length,
        failures,
        customStep: state.ok ? state.value[CUSTOM_STEP] : undefined,
        advancedToNextStep: calls.includes('post-documentation' as StepName),
        halt,
      }).toEqual({
        reviewCalls: 0,
        artifactResolutionCalls: 0,
        failures: [],
        customStep: 'done',
        advancedToNextStep: true,
        halt: undefined,
      });
    });
  }

  it('fails closed with the configured marker path when a custom step writes no marker', async () => {
    const events = new ConductorEventEmitter();
    const failures: string[] = [];
    events.on('step_failed', (event) => {
      if (event.type === 'step_failed') failures.push(event.error);
    });

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async (): Promise<StepRunResult> => ({ success: true })) },
      events,
      projectRoot: dir,
      mode: 'default',
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: CUSTOM_STEP,
      config: config(),
      onRecovery: async () => 'quit',
    }).run();

    const state = await readState(statePath);
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8').catch(() => '');
    expect({
      customStep: state.ok ? state.value[CUSTOM_STEP] : undefined,
      failure: failures[0],
      diagnostic: `${failures.join('\n')}${halt}`,
    }).toEqual({
      customStep: 'failed',
      failure:
        `Step '${CUSTOM_STEP}' completed but completion check failed: ` +
        `configured completion artifact "${PASS_MARKER}" is missing — ${CUSTOM_STEP} must write it after a passing review`,
      diagnostic: expect.not.stringContaining('not iterable'),
    });
  });

  it('silently approves an acceptance-spec file matched only by its configured extra glob', async () => {
    const specPath = join(dir, 'custom-specs', 'reviewed.test.ts');
    await mkdir(join(dir, 'custom-specs'), { recursive: true });
    await writeFile(specPath, 'export {};\n');

    const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
    const runner: StepRunner = {
      run: vi.fn(async (): Promise<StepRunResult> => ({ success: true })),
    };

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      mode: 'default',
      verifyArtifacts: false,
      maxRetries: 1,
      fromStep: 'acceptance_specs',
      config: { acceptance_spec_globs: ['custom-specs/**/*.test.ts'] } as HarnessConfig,
      onReviewArtifacts,
    }).run();

    const state = await readState(statePath);
    expect(onReviewArtifacts).not.toHaveBeenCalled();
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.artifact_approvals).toHaveProperty('custom-specs/reviewed.test.ts');
    }
  });

  it('completes worktree without an artifact-review prompt', async () => {
    const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
    const runner: StepRunner = {
      run: vi.fn(async (): Promise<StepRunResult> => ({ success: true })),
    };

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      mode: 'default',
      verifyArtifacts: false,
      maxRetries: 1,
      fromStep: 'worktree',
      config: {} as HarnessConfig,
      onReviewArtifacts,
    }).run();

    const state = await readState(statePath);
    expect(onReviewArtifacts).not.toHaveBeenCalled();
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.value.worktree).toBe('done');
  });
});
