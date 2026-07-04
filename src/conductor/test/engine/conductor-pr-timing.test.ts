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
 *
 * Task 7: Build-start publish hook (TS-2, positive path)
 *
 * Purpose: Pin the invariant that with `pr_timing: 'early-draft'` configured
 * and the branch NOT ahead of base (zero commits), the build-start hook
 * pushes the branch but makes zero `gh pr create` calls (publishEarlyDraft's
 * documented zero-commits-ahead behavior).
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
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';

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

interface RecordedGitCall {
  args: string[];
  cwd: string;
}

interface FakeGit {
  git: GitRunner;
  calls: RecordedGitCall[];
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

/** Build a fake git runner that records all calls and simulates a branch ahead of base. */
function makeFakeGit(): FakeGit {
  const calls: RecordedGitCall[] = [];

  const git: GitRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    // Simulate git rev-list returning commits ahead
    if (args[0] === 'rev-list' && args[args.length - 1]?.includes('..')) {
      return { stdout: '1\n' }; // One commit ahead
    }
    // Simulate git push success
    if (args[0] === 'push') {
      return { stdout: '' };
    }
    return { stdout: '' };
  };

  return { git, calls };
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

  describe('T8: Self-host downgrade (selfHost + pr_timing=early-draft)', () => {
    it('with selfHost=true and pr_timing=early-draft, zero gh pr create calls before finish step', async () => {
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
        selfHost: true,
        config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
        gh,
      });

      await conductor.run();

      // Assert: zero `gh pr create` calls recorded (early publish skipped on self-host)
      expect(ghPrCreateCalls(calls)).toHaveLength(0);
    });

    it('with selfHost=true and pr_timing=early-draft, logs exactly one downgrade message', async () => {
      await seedStateBefore(statePath, 'build');

      const events = new ConductorEventEmitter();
      const { gh } = makeFakeGh();

      let downgradeLogsEmitted = 0;
      const originalError = console.error;
      const mockConsoleError = (msg: string) => {
        if (msg.includes('early-draft') && msg.includes('self-host')) {
          downgradeLogsEmitted++;
        }
      };
      console.error = mockConsoleError;

      try {
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
          selfHost: true,
          config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
          gh,
        });

        await conductor.run();

        // Assert: exactly one downgrade log message emitted
        expect(downgradeLogsEmitted).toBe(1);
      } finally {
        console.error = originalError;
      }
    });

    it('with selfHost=false and pr_timing=early-draft, allow gh pr create calls (no downgrade)', async () => {
      await seedStateBefore(statePath, 'build');

      const events = new ConductorEventEmitter();
      const { gh, calls } = makeFakeGh();
      const { git } = makeFakeGit();

      const runner: StepRunner = {
        run: async (): Promise<StepRunResult> => ({ success: true }),
      };

      // Add worktree_branch to state so the hook has something to publish
      const state: ConductState = {};
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
      }
      state.worktree_branch = 'feat/test-branch';
      await writeState(statePath, state);

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
        mode: 'auto',
        fromStep: 'build',
        selfHost: false,
        config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
        gh,
        gitForPublish: git,
      });

      await conductor.run();

      // Assert: at least one gh call was recorded (the publish hook should run)
      // The hook will call publishEarlyDraft which calls gh pr create/ready
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});
