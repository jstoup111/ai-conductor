// Covers: task:2, task:3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderExhaustedMechanicalBuildReviewHalt,
  type StepRunner,
} from '../../src/engine/conductor.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../test-conductor.js';

describe('engine/conductor typed unretryable-input halts', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-unretryable-halt-'));
    statePath = join(dir, 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function runBuildReviewFailure(
    result: Awaited<ReturnType<StepRunner['run']>>,
  ): Promise<{ halt: string; haltClass: string }> {
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name === 'build_review') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => step === 'build_review' ? result : { success: true }),
    };
    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto',
      daemon: true,
      fromStep: 'build_review',
      maxRetries: 3,
    }).run();

    return {
      halt: await readFile(join(dir, '.pipeline/HALT'), 'utf8'),
      haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf8'),
    };
  }

  it('halts typed unretryable inputs with the prerequisite, never the runner message or retry exhaustion', async () => {
    const result = await runBuildReviewFailure({
      success: false,
      output: 'misleading human-facing text must not select the recovery path',
      unretryableInputs: { retryAfterStep: 'test_suite' },
    });

    expect(result).toEqual({
      halt: expect.stringMatching(/build_review.*inputs cannot change.*test_suite/is),
      haltClass: 'needs-human',
    });
    expect(result.halt).not.toContain('misleading human-facing text');
    expect(result.halt).not.toContain('retries exhausted');
  });

  it('keeps ordinary build_review runner failures on the existing generic halt', async () => {
    await expect(runBuildReviewFailure({ success: false, output: 'ordinary failure' })).resolves.toEqual({
      halt: "step 'build_review' failed in auto mode (retries exhausted)\n",
      haltClass: 'needs-human',
    });
  });

  it('routes finish unretryable inputs to its prerequisite without retrying finish', async () => {
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name === 'finish') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);

    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    const emitter = events as unknown as { emit(event: unknown): void };
    const emit = vi.spyOn(emitter, 'emit').mockImplementation((event) => {
      emitted.push(event);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => step === 'finish'
        ? { success: false, unretryableInputs: { retryAfterStep: 'test_suite' as const } }
        : { success: true }),
    };

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'finish',
      maxRetries: 3,
    }).run();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith('finish', expect.anything(), expect.anything());
    expect(runner.run).not.toHaveBeenCalledWith('remediate', expect.anything(), expect.anything());
    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'retry_decision',
      step: 'finish',
      attempt: 1,
      decision: 'route',
      signal: 'unretryable-inputs',
    }));
    expect(emitted.filter((event) => (event as { type?: string }).type === 'retry_decision')).toHaveLength(1);

    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
    expect(halt).toMatch(/finish.*inputs cannot change.*test_suite/is);
    expect(halt).not.toContain('retries exhausted');
    await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
    emit.mockRestore();
  });

  it('keeps build facet failures on the same retry ladder as ordinary runner failures', async () => {
    const runBuildFailure = async (withFacet: boolean) => {
      const state: Record<string, unknown> = { complexity_tier: 'M' };
      for (const step of ALL_STEPS) {
        if (step.name === 'build') break;
        state[step.name] = 'done';
      }
      await writeState(statePath, state as ConductState);

      const events = new ConductorEventEmitter();
      const retryDecisions: unknown[] = [];
      events.on('retry_decision', (event) => { retryDecisions.push(event); });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => step === 'build'
          ? {
            success: false,
            output: 'build failure',
            ...(withFacet ? { unretryableInputs: { retryAfterStep: 'test_suite' as const } } : {}),
          }
          : { success: true }),
      };

      await new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 3,
      }).run();

      return {
        buildDispatches: vi.mocked(runner.run).mock.calls.filter(([step]) => step === 'build').length,
        unretryableDecisions: retryDecisions.filter((event) =>
          (event as { signal?: string }).signal === 'unretryable-inputs'),
      };
    };

    await expect(runBuildFailure(true)).resolves.toEqual({
      buildDispatches: 3,
      unretryableDecisions: [],
    });
    await expect(runBuildFailure(false)).resolves.toEqual({
      buildDispatches: 3,
      unretryableDecisions: [],
    });
  });

  it('restores ordinary finish retries when retry routing is disabled', async () => {
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name === 'finish') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);

    const events = new ConductorEventEmitter();
    const retryDecisions: unknown[] = [];
    events.on('retry_decision', (event) => { retryDecisions.push(event); });
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => step === 'finish'
        ? { success: false, unretryableInputs: { retryAfterStep: 'test_suite' as const } }
        : { success: true }),
    };

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'finish',
      maxRetries: 3,
      config: { retry_routing: { enabled: false } },
    }).run();

    expect(vi.mocked(runner.run).mock.calls.filter(([step]) => step === 'finish')).toHaveLength(3);
    expect(retryDecisions).toEqual([]);
  });

  it('keeps facet-free finish failures on the ordinary retry ladder', async () => {
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name === 'finish') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);

    const events = new ConductorEventEmitter();
    const retryDecisions: unknown[] = [];
    events.on('retry_decision', (event) => { retryDecisions.push(event); });
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => step === 'finish'
        ? { success: false, output: 'ordinary finish failure' }
        : { success: true }),
    };

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'finish',
      maxRetries: 3,
    }).run();

    expect(vi.mocked(runner.run).mock.calls.filter(([step]) => step === 'finish')).toHaveLength(3);
    expect(retryDecisions.filter((event) =>
      (event as { signal?: string }).signal === 'unretryable-inputs')).toEqual([]);
  });

  it('skips an advisory facet failure and advances to the controlled next step', async () => {
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name === 'architecture_diagram') break;
      state[step.name] = 'done';
    }
    for (const step of ALL_STEPS) {
      if (step.name === 'architecture_review') continue;
      if (ALL_STEPS.indexOf(step) > ALL_STEPS.findIndex(({ name }) => name === 'architecture_review')) {
        state[step.name] = 'done';
      }
    }
    await writeState(statePath, state as ConductState);

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => step === 'architecture_diagram'
        ? { success: false, unretryableInputs: { retryAfterStep: 'test_suite' as const } }
        : { success: true }),
    };

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto',
      daemon: true,
      fromStep: 'architecture_diagram',
      maxRetries: 3,
    }).run();

    expect(vi.mocked(runner.run).mock.calls.map(([step]) => step)).toEqual([
      'architecture_diagram',
      'architecture_review',
    ]);
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ architecture_diagram: 'skipped' });
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('renderExhaustedMechanicalBuildReviewHalt', () => {
  const entry = {
    mechanicalFaults: 3,
    lastMechanicalFault: {
      rubric: 'testQuality' as const,
      reason: 'provider-error' as const,
      lapId: 'lap-ledger-fault',
      detail: 'provider returned a malformed rubric payload',
    },
  };

  it('falls back to the ledger record when the current-lap aggregate is unavailable', () => {
    expect(renderExhaustedMechanicalBuildReviewHalt(entry, { malformed: true })).toContain(
      'Last recorded fault: testQuality closed cause provider-error on lap lap-ledger-fault (provider returned a malformed rubric payload).',
    );
  });

  it('keeps the aggregate-present recovery text byte-for-byte unchanged', () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: 'lap-current' as never,
      snapshotDigest: 'sha256:current',
      results: {
        testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'current diagnostic' },
      },
    } as never);

    expect(renderExhaustedMechanicalBuildReviewHalt(entry, aggregate)).toBe([
      'build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.',
      'Current lap lap-current: testQuality closed cause provider-error (current diagnostic).',
      '1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-current --rubric testQuality --rationale "<rationale>".',
      '2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.',
    ].join('\n'));
  });

  it('renders a materialization excerpt from the current aggregate', () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: 'lap-current' as never,
      snapshotDigest: 'sha256:current',
      results: {
        testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'preflight-failed', detail: 'materialization-failed: boom-checkout' },
      },
    });

    expect(renderExhaustedMechanicalBuildReviewHalt(entry, aggregate)).toContain('boom-checkout');
  });
});
