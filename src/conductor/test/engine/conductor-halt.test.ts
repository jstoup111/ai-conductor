import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StepRunner } from '../../src/engine/conductor.js';
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
});
