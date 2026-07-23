import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { phaseMarkerPath, writePhaseMarker } from '../../src/engine/phase-marker.js';
import type { StepName } from '../../src/types/index.js';

// Task 3, #788: a leftover .pipeline/phase-active marker (e.g. left behind by
// a crash mid-BUILD) must not survive into the next step's dispatch. Every
// loop iteration must clear it before any skip/continue logic runs, so a
// stale BUILD marker never masks a later DECIDE-phase step as "still BUILD".
describe('conductor step-entry clears stale phase-active marker (Task 3, #788)', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'phase-marker-clear-'));
    statePath = join(dir, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('removes a leftover phase-active marker on entry to a DECIDE-phase step and does not rewrite it', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    // Simulate a stale marker left behind from a previous (e.g. crashed) BUILD step.
    writePhaseMarker(dir, { step: 'build', phase: 'BUILD', allow: [] });
    expect(existsSync(phaseMarkerPath(dir))).toBe(true);

    const runner: StepRunner = {
      run: async (_step: StepName): Promise<StepRunResult> => {
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
    });

    await conductor.run();

    expect(existsSync(phaseMarkerPath(dir))).toBe(false);
  });
});
