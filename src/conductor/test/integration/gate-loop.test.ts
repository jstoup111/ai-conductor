import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';

// Drives the gate-driven tail (build…finish) with verifyArtifacts on. The front
// half is pre-marked done and the loop is started at `build` (fromStep), so each
// test exercises the selector-driven tail directly. Small (S) tier so the tail
// is build → manual_test → (retro tier-skipped) → finish.

const FRONT_DONE: ConductState = {
  complexity_tier: 'S',
  feature_desc: 'add foo',
  worktree: 'done',
  memory: 'done',
  brainstorm: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'skipped',
  plan: 'done',
  architecture_diagram: 'skipped',
  architecture_review: 'skipped',
  acceptance_specs: 'skipped',
};

describe('integration/gate-loop', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gate-loop-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function conductorWith(runner: StepRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
    });
  }

  // Per-step artifact creation so each gate's objective verdict passes.
  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.docs/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'finish') {
      await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');
    }
    return { success: true };
  }

  it('drives build → manual_test → finish via the selector and writes DONE', async () => {
    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        return satisfy(step);
      },
    };
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(runner).run();

    expect(ran).toContain('build');
    expect(ran).toContain('manual_test');
    expect(ran).toContain('finish');
    expect(ran).not.toContain('retro'); // tier-skipped for Small
    expect(completed).toBe(true);
    await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
  });

  it('re-opens plan on a kickback, re-runs build, then converges', async () => {
    // Real stories + covering plan so the plan predicate passes on recompute.
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(dir, '.docs/stories/s.md'),
      '**Status:** Accepted\n\n## Story 1-1: foo\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then err\n',
    );
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs/plans/p.md'),
      '### Task 1\n**Story:** 1-1 (happy path)\n\n### Task 2\n**Story:** 1-1 (negative path)\n',
    );
    await writeState(statePath, { ...FRONT_DONE });

    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns++;
          await satisfy('build');
          if (buildRuns === 1) {
            // Simulate the build agent re-opening plan (kickback).
            await writeVerdict(dir, 'plan', {
              satisfied: false,
              checkedAt: 1,
              kickback: { from: 'build', evidence: 'AC negative path missing' },
            });
          }
          return { success: true };
        }
        return satisfy(step);
      },
    };
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(runner).run();

    expect(buildRuns).toBe(2); // built → kicked back to plan → rebuilt
    expect(completed).toBe(true);
  });

  it('HALTs (no completion) when a kickback target never satisfies', async () => {
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(dir, '.docs/stories/s.md'),
      '**Status:** Accepted\n\n## Story 1-1: foo\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then err\n',
    );
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    // Plan covers ONLY the happy path → plan verdict stays unsatisfied.
    await writeFile(
      join(dir, '.docs/plans/p.md'),
      '### Task 1\n**Story:** 1-1 (happy path)\n',
    );
    await writeState(statePath, { ...FRONT_DONE });

    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns++;
          await satisfy('build');
          if (buildRuns === 1) {
            await writeVerdict(dir, 'plan', {
              satisfied: false,
              checkedAt: 1,
              kickback: { from: 'build', evidence: 'negative path missing' },
            });
          }
          return { success: true };
        }
        return satisfy(step);
      },
    };
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(runner).run();

    expect(completed).toBe(false);
    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
  });

  it('runs a custom config step inserted via `after` (config compatibility)', async () => {
    // The conductor now drives the resolved registry (buildStepRegistry), so a
    // custom step from .ai-conductor/config.yml is dispatched and indexed.
    const config = {
      steps: { lint: { after: 'memory', skill: 'lint-skill' } },
    };
    const allDone: Record<string, string> = {};
    for (const s of ALL_STEPS) allDone[s.name] = 'done';
    await writeState(statePath, {
      ...(allDone as unknown as ConductState),
      complexity_tier: 'M',
    });

    const ran: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      config,
      fromStep: 'lint',
    });
    await conductor.run();

    expect(ran).toContain('lint'); // the custom step was dispatched
    const finalState = JSON.parse(await readFile(statePath, 'utf-8'));
    expect(finalState.lint).toBe('done');
  });

  it('freshContextPerStep resets the session before each tail step', async () => {
    // All front-half steps done; tail steps pending so they run. Start at build.
    const state: Record<string, string> = {};
    for (const s of ALL_STEPS) state[s.name] = 'done';
    for (const name of ['build', 'manual_test', 'retro', 'finish']) delete state[name];
    await writeState(statePath, {
      ...(state as unknown as ConductState),
      complexity_tier: 'S', // retro tier-skipped → tail is build, manual_test, finish
    });

    const resetSession = vi.fn(async () => {});
    const runner: StepRunner & { resetSession: typeof resetSession } = {
      run: async () => ({ success: true }),
      resetSession,
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      fromStep: 'build',
      freshContextPerStep: true,
    });
    await conductor.run();

    // build, manual_test, finish ran (retro tier-skipped) → one reset each.
    expect(resetSession).toHaveBeenCalledTimes(3);
  });
});
