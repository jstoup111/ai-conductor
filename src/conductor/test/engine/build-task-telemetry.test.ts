import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunResult, StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

vi.mock('execa', () => ({
  execa: vi.fn(async (command: string, args: string[]) => {
    if (command === 'git' && args[0] === 'rev-parse') return { stdout: '' };
    return { stdout: '' };
  }),
}));

describe('BUILD task telemetry', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('seeds task-status.json before dispatch without an enforcement cutover', async () => {
    root = await mkdtemp(join(tmpdir(), 'build-task-telemetry-'));
    const planDir = join(root, '.docs', 'plans');
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, 'telemetry-fixture.md'),
      '# Plan\n\n### Task 1: Seed progress rows\n\n**Dependencies:** none\n',
      'utf-8',
    );

    const state: Record<string, unknown> = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'build') break;
      state[step.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'telemetry-fixture';
    state.track = 'technical';
    const statePath = join(root, 'conduct-state.json');
    await writeState(statePath, state as unknown as ConductState);

    let statusAtDispatch: unknown;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') {
          statusAtDispatch = JSON.parse(
            await readFile(join(root!, '.pipeline', 'task-status.json'), 'utf-8'),
          );
        }
        return { success: true };
      },
    };

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      projectRoot: root,
      config: {},
      fromStep: 'build',
      events: new ConductorEventEmitter(),
    }).run();

    expect(statusAtDispatch).toEqual(expect.objectContaining({
      plan_ref: expect.any(String),
      tasks: [expect.objectContaining({ id: '1', status: 'pending' })],
    }));
  });
});
