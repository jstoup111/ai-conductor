/**
 * Covers: S2.1, S2.2, S4.1, S5.1, S5.2, task:5, task:10
 *
 * Acceptance RED for the operator-visible refusal lifecycle. The spec drives
 * the real Conductor.run() entry point twice against one persisted state:
 * a step writes a needs-human HALT, the operator clears only the HALT markers,
 * and resume must dispatch that same step without a conduct-state.json edit.
 * The StepRunner is the provider boundary and is faked; state, halt markers,
 * event persistence, outcome recording, and resume selection are real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import {
  HALT_CLASS_MARKER,
  HALT_MARKER,
  writeHaltMarker,
} from '../../src/engine/halt-marker.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const TARGET_STEP: StepName = 'acceptance_specs';

function doneBefore(target: StepName): ConductState {
  const state: Record<string, unknown> = {
    complexity_tier: 'M',
    track: 'technical',
    feature_desc: 'a-gate-halt-marks-a-completed-build-failed-and-the',
  };
  for (const step of ALL_STEPS) {
    if (step.name === target) break;
    state[step.name] = 'done';
  }
  state[target] = 'pending';
  return state as ConductState;
}

function parseJsonLines(contents: string): Array<Record<string, unknown>> {
  return contents
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('acceptance: a needs-human refusal clears and resumes without state surgery', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (roots.length > 0) {
      await rm(roots.pop()!, { recursive: true, force: true });
    }
  });

  it('records refused on the spine, preserves completed work, then re-dispatches after HALT clear', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'step-refusal-acceptance-'));
    roots.push(projectRoot);
    const stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    const eventsPath = join(projectRoot, '.pipeline', 'events.jsonl');
    await writeState(stateFilePath, doneBefore(TARGET_STEP));

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, events);
    persister.start();

    const firstRunner: StepRunner = {
      run: vi.fn(async (step) => {
        expect(step).toBe(TARGET_STEP);
        await writeHaltMarker(
          projectRoot,
          'approved criteria conflict with merged code; operator judgement required\n',
          'needs-human',
          events,
        );
        return { success: false, output: 'provider stopped for operator judgement' };
      }),
    };

    try {
      const firstRun = new Conductor({
        projectRoot,
        stateFilePath,
        stepRunner: firstRunner,
        events,
        fromStep: TARGET_STEP,
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
        verifyArtifacts: false,
        escalateBuildFailure: async () => ({}),
      });
      await firstRun.run();

      const stateResult = await readState(stateFilePath);
      if (!stateResult.ok) throw new Error(stateResult.error.message);
      const refusedState = stateResult.value;
      expect(refusedState.architecture_review).toBe('done');
      expect(refusedState[TARGET_STEP]).toBe('refused');
      expect(await readFile(join(projectRoot, HALT_CLASS_MARKER), 'utf8')).toBe('needs-human');
      expect(await readFile(join(projectRoot, HALT_MARKER), 'utf8')).toBe(
        'approved criteria conflict with merged code; operator judgement required\n',
      );

      const persisted = parseJsonLines(await readFile(eventsPath, 'utf8'));
      expect(persisted).toContainEqual(expect.objectContaining({
        type: 'step_refused',
        step: TARGET_STEP,
        kind: 'needs-human',
        reason: expect.stringContaining('operator judgement required'),
      }));
      expect(persisted).not.toContainEqual(expect.objectContaining({
        type: 'step_failed',
        step: TARGET_STEP,
      }));

      await unlink(join(projectRoot, HALT_MARKER));
      await unlink(join(projectRoot, HALT_CLASS_MARKER));
      const stateBeforeResume = await readFile(stateFilePath, 'utf8');
      let resumedStep: StepName | undefined;
      const resumeRunner: StepRunner = {
        run: vi.fn(async (step) => {
          resumedStep = step;
          await writeHaltMarker(projectRoot, 'sentinel: stop after resumed dispatch\n', 'needs-human', events);
          return { success: false, output: 'sentinel: stop after resumed dispatch' };
        }),
      };

      const resumedRun = new Conductor({
        projectRoot,
        stateFilePath,
        stepRunner: resumeRunner,
        events,
        resume: true,
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
        verifyArtifacts: false,
        escalateBuildFailure: async () => ({}),
      });

      expect(await readFile(stateFilePath, 'utf8')).toBe(stateBeforeResume);
      await resumedRun.run();
      expect(resumedStep).toBe(TARGET_STEP);
    } finally {
      persister.stop();
    }
  });
});
