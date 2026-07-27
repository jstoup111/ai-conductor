import { mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { phaseMarkerPath } from '../../src/engine/phase-marker.js';
import type { StepName } from '../../src/types/index.js';

// Task 4, #788: phase-active marker write on BUILD/SHIP step entry, and
// unconditional clear on step-attempt completion (success, failure, throw).
describe('conductor writes phase-active marker on BUILD/SHIP step entry (Task 4, #788)', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'phase-marker-write-'));
    statePath = join(dir, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the marker with the resolved allowlist while a BUILD-phase step (acceptance_specs) is dispatched', async () => {
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');

    let sawMarkerDuringRun = false;
    let markerContents = '';
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'acceptance_specs') {
          sawMarkerDuringRun = existsSync(phaseMarkerPath(dir));
          if (sawMarkerDuringRun) {
            markerContents = readFileSync(phaseMarkerPath(dir), 'utf8');
          }
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'acceptance_specs',
      // The marker contract is per-step. Default mode keeps this fixture on
      // the serial dispatch path instead of exercising validator fan-out.
      mode: 'default',
    });

    await conductor.run();

    expect(sawMarkerDuringRun).toBe(true);
    expect(markerContents).toContain('step: acceptance_specs');
    expect(markerContents).toContain('phase: BUILD');
    expect(markerContents).toContain('allow: .docs/release-waivers/');
  });

  it('writes the marker for a novel custom-step name inheriting a SHIP phase (keyed off step.phase, not an enumerated name list)', async () => {
    await writeFile(
      statePath,
      JSON.stringify({
        acceptance_specs: 'done',
        build: 'done',
        build_review: 'done',
        wiring_check: 'done',
        test_suite: 'done',
        manual_test: 'done',
      }),
      'utf8',
    );

    // Custom step names configured via `config.steps` are not part of the
    // built-in StepName literal union but flow through the engine as valid
    // runtime step identifiers — this fixture proves the marker write is
    // keyed off step.phase, not an enumerated name list, so the cast below
    // mirrors the (already-cast) `fromStep` below it.
    const novelStep = 'totally_novel_ship_step' as StepName;

    let sawMarkerDuringRun = false;
    let markerContents = '';
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === novelStep) {
          sawMarkerDuringRun = existsSync(phaseMarkerPath(dir));
          if (sawMarkerDuringRun) {
            markerContents = readFileSync(phaseMarkerPath(dir), 'utf8');
          }
        }
        if (step === novelStep) throw new Error('stop after marker observation');
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {
        steps: {
          totally_novel_ship_step: {
            after: 'manual_test',
            skill: 'manual-test',
          },
        },
      } as never,
      fromStep: 'totally_novel_ship_step' as StepName,
      mode: 'default',
      maxRetries: 1,
    });

    await conductor.run().catch(() => {});

    expect(sawMarkerDuringRun).toBe(true);
    expect(markerContents).toContain('step: totally_novel_ship_step');
    expect(markerContents).toContain('phase: SHIP');
  });

  it('clears the marker after a successful BUILD-phase step attempt', async () => {
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => ({ success: true }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'acceptance_specs',
    });

    await conductor.run();

    expect(existsSync(phaseMarkerPath(dir))).toBe(false);
  });

  it('clears the marker after a non-throwing failed BUILD-phase step attempt', async () => {
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => ({ success: false, output: 'boom' }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: { max_retries: 1 } as never,
      fromStep: 'acceptance_specs',
      mode: 'auto',
    });

    await conductor.run();

    expect(existsSync(phaseMarkerPath(dir))).toBe(false);
  });

  it('clears the marker when the step runner throws', async () => {
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => {
        throw new Error('kaboom');
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: { max_retries: 1 } as never,
      fromStep: 'acceptance_specs',
      mode: 'auto',
    });

    await conductor.run().catch(() => {
      // Thrown errors may propagate out of run() depending on mode; the
      // assertion below is what matters.
    });

    expect(existsSync(phaseMarkerPath(dir))).toBe(false);
  });
});
