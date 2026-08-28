// Covers: task:2
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { Conductor } from './test-conductor.js';
import { readState, writeState } from '../src/engine/state.js';
import type { StepRunner } from '../src/engine/conductor.js';
import type { ConductState, StepName } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const MANUAL_TEST_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';

describe('manual_test FAIL kickback restage', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function runFailKickback(
    restageState: 'failed' | 'skipped',
  ): Promise<ConductState> {
    const dir = await mkdtemp(join(tmpdir(), 'manual-test-kickback-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
      stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
      build: 'done', build_review: 'done', wiring_check: 'skipped', test_suite: 'done',
      manual_test: 'pending', prd_audit: 'skipped', architecture_review_as_built: 'skipped',
      retro: 'skipped', rebase: 'skipped', finish: 'pending', track: 'technical',
    } as ConductState);

    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'manual_test') {
          await writeFile(join(dir, '.pipeline', 'manual-test-results.md'), MANUAL_TEST_FAIL);
          return { success: false, output: 'manual test failed' };
        }
        throw new Error(`unexpected dispatch: ${step}`);
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'manual_test',
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
    });

    // A skipped member cannot normally dispatch, so model the controlled
    // interleaving at the incident seam: immediately after its real rewind,
    // make the status skipped before the explicit restage commit runs.
    const originalNavigate = (conductor as any).navigateStateBack.bind(conductor);
    (conductor as any).navigateStateBack = async (...args: unknown[]) => {
      const index = await originalNavigate(...args);
      if (restageState === 'skipped') {
        (args[0] as Record<string, unknown>).manual_test = 'skipped';
        await writeState(statePath, args[0] as ConductState);
        (conductor as any).persistedStateSnapshot = { ...(args[0] as ConductState) };
      }
      return index;
    };

    await conductor.run();
    const state = await readState(statePath);
    if (!state.ok) throw new Error('kickback state must be readable');
    return state.value;
  }

  it('restages a failed manual_test after its FAIL kickback', async () => {
    expect((await runFailKickback('failed')).manual_test).toBe('stale');
  });

  it('preserves a skipped manual_test at the same FAIL kickback restage site', async () => {
    expect((await runFailKickback('skipped')).manual_test).toBe('skipped');
  });
});
