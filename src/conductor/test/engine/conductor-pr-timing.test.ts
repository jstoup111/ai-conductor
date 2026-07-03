/**
 * Regression harness for pr_timing configuration feature (TS-1..TS-5 / adr-2026-07-03-*).
 *
 * Task 3: Default-inert regression harness (TS-1, negative path)
 *
 * Purpose: Pin the invariant that with pr_timing key absent from config,
 * the conductor performs zero publish invocations (`gh pr create`/`gh pr ready` calls)
 * before the finish step. Today, this is trivially true because no
 * early-draft publish hooks are wired yet; this test ensures the default
 * remains inert once Task 4+ implements the feature.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import type { ConductState, HarnessConfig } from '../../src/types/index.js';
import type { StepRunResult, StepRunner } from '../../src/engine/conductor.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RecordedGhCall {
  args: string[];
  cwd: string;
}

interface FakeGh {
  gh: GhRunner;
  calls: RecordedGhCall[];
}

/** Build a fake gh runner that records all calls. */
function makeFakeGh(): FakeGh {
  const calls: RecordedGhCall[] = [];

  const gh: GhRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    // Return a dummy PR URL for `gh pr create` if called
    if (args[0] === 'pr' && args[1] === 'create') {
      return { stdout: 'https://github.com/acme/repo/pull/1\n' };
    }
    return { stdout: '' };
  };

  return { gh, calls };
}

/**
 * Seed state with every step before `fromStep` marked done/skipped,
 * mirroring the pattern in pr-timing-daemon-lifecycle.acceptance.test.ts.
 */
async function seedStateBefore(statePath: string, fromStep: string): Promise<void> {
  const state: ConductState = {};
  for (const s of ALL_STEPS) {
    if (s.name === fromStep) break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  await writeState(statePath, state);
}

/** Filter calls to find gh PR create operations. */
function ghPrCreateCalls(calls: RecordedGhCall[]): RecordedGhCall[] {
  return calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'create');
}

/** Filter calls to find gh PR ready operations. */
function ghPrReadyCalls(calls: RecordedGhCall[]): RecordedGhCall[] {
  return calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'ready');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('conductor pr_timing regression harness', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-pr-timing-'));
    statePath = join(dir, 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('TS-1: Default-inert regression (pr_timing absent)', () => {
    it('with pr_timing key absent, zero gh pr create calls before finish step', async () => {
      await seedStateBefore(statePath, 'build');

      const events = new ConductorEventEmitter();
      const { gh, calls } = makeFakeGh();

      const runner: StepRunner = {
        run: async (): Promise<StepRunResult> => ({ success: true }),
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
        mode: 'auto',
        fromStep: 'build',
        // pr_timing key is absent entirely — tests the default
        config: {} as unknown as HarnessConfig,
        gh,
      });

      await conductor.run();

      // Assert: zero `gh pr create` calls recorded before conductor finished
      expect(ghPrCreateCalls(calls)).toHaveLength(0);
    });

    it('with pr_timing key absent, zero gh pr ready calls before finish step', async () => {
      await seedStateBefore(statePath, 'build');

      const events = new ConductorEventEmitter();
      const { gh, calls } = makeFakeGh();

      const runner: StepRunner = {
        run: async (): Promise<StepRunResult> => ({ success: true }),
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
        mode: 'auto',
        fromStep: 'build',
        // pr_timing key is absent entirely — tests the default
        config: {} as unknown as HarnessConfig,
        gh,
      });

      await conductor.run();

      // Assert: zero `gh pr ready` calls recorded before conductor finished
      expect(ghPrReadyCalls(calls)).toHaveLength(0);
    });

    it('with pr_timing key absent, conductor still runs successfully', async () => {
      await seedStateBefore(statePath, 'build');

      const events = new ConductorEventEmitter();
      const { gh } = makeFakeGh();

      let stepsRun = 0;
      const runner: StepRunner = {
        run: async (): Promise<StepRunResult> => {
          stepsRun += 1;
          return { success: true };
        },
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
        mode: 'auto',
        fromStep: 'build',
        config: {} as unknown as HarnessConfig,
        gh,
      });

      await conductor.run();

      // Assert: the conductor still runs steps even with pr_timing absent
      expect(stepsRun).toBeGreaterThan(0);
    });
  });
});
