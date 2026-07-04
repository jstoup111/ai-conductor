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
import { writeState, readState } from '../../src/engine/state.js';
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

  describe('T9: Step-boundary refresh (TS-3, early-draft mode)', () => {
    it('loopGate step completes with new commits ahead of base → one plain push', async () => {
      const state: ConductState = {};
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
      }
      state.worktree_branch = 'feat/test-branch';
      await writeState(statePath, state);

      const events = new ConductorEventEmitter();
      const { gh } = makeFakeGh();
      const { git, calls } = makeFakeGit(); // simulates 1 commit ahead of base

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
        selfHost: false,
        config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
        gh,
        gitForPublish: git,
      });

      await conductor.run();

      const pushCalls = calls.filter((c) => c.args[0] === 'push' && !c.args.includes('--force-with-lease'));
      expect(pushCalls.length).toBeGreaterThanOrEqual(1);
      for (const call of pushCalls) {
        expect(call.args).not.toContain('--force-with-lease');
        expect(call.args).not.toContain('--force');
      }
    });

    it('loopGate step completes with zero commits ahead of base → zero step-boundary pushes', async () => {
      const state: ConductState = {};
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
      }
      state.worktree_branch = 'feat/test-branch';
      await writeState(statePath, state);

      const events = new ConductorEventEmitter();
      const { gh } = makeFakeGh();

      // Fake git runner that always reports zero commits ahead of base.
      const calls: RecordedGitCall[] = [];
      const git: GitRunner = async (args, opts) => {
        calls.push({ args: [...args], cwd: opts.cwd });
        if (args[0] === 'rev-list' && args[args.length - 1]?.includes('..')) {
          return { stdout: '0\n' };
        }
        return { stdout: '' };
      };

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
        selfHost: false,
        config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
        gh,
        gitForPublish: git,
      });

      await conductor.run();

      // The build-start hook (T7) always performs one unconditional push
      // before the `build` step dispatches, regardless of ahead-count. The
      // step-boundary refresh hook (T9) under test here must contribute
      // ZERO additional pushes when there are no commits ahead of base at
      // each loopGate step boundary — so the total across the whole run
      // stays at exactly that one build-start push, never growing as
      // manual-test/retro/finish loopGate steps also complete.
      const pushCalls = calls.filter((c) => c.args[0] === 'push');
      expect(pushCalls).toHaveLength(1);
    });
  });

  describe('T14: Finish-step mark-ready (TS-5 happy path)', () => {
    it('with early-draft mode and an open draft PR, calls gh pr ready before the finish step dispatches', async () => {
      const events = new ConductorEventEmitter();
      const { gh, calls } = makeFakeGh();

      // Seed state with a draft PR already published by the build-start hook (T7).
      const state: ConductState = {};
      for (const s of ALL_STEPS) {
        if (s.name === 'finish') break;
        (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
      }
      state.worktree_branch = 'feat/test-branch';
      state.pr_url = 'https://github.com/acme/repo/pull/1';
      await writeState(statePath, state);

      let readyCallOrdinal: number | null = null;
      let finishDispatchOrdinal: number | null = null;
      let callCounter = 0;

      const runner: StepRunner = {
        run: async (): Promise<StepRunResult> => {
          callCounter++;
          finishDispatchOrdinal = callCounter;
          return { success: true };
        },
      };

      const wrappedGh: GhRunner = async (args, opts) => {
        if (args[0] === 'pr' && args[1] === 'ready') {
          callCounter++;
          readyCallOrdinal = callCounter;
        }
        return gh(args, opts);
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
        mode: 'auto',
        fromStep: 'finish',
        selfHost: false,
        config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
        gh: wrappedGh,
      });

      await conductor.run();

      // Assert: gh pr ready was called, and it happened before the finish step dispatched
      expect(ghPrReadyCalls(calls)).toHaveLength(1);
      expect(readyCallOrdinal).not.toBeNull();
      expect(finishDispatchOrdinal).not.toBeNull();
      expect(readyCallOrdinal!).toBeLessThan(finishDispatchOrdinal!);
    });

    it('with early-draft mode and an open draft PR, state.pr_url equals the draft PR URL (reused, not created), and exactly one PR total', async () => {
      const events = new ConductorEventEmitter();
      const { gh, calls } = makeFakeGh();

      const draftUrl = 'https://github.com/acme/repo/pull/42';
      const state: ConductState = {};
      for (const s of ALL_STEPS) {
        if (s.name === 'finish') break;
        (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
      }
      state.worktree_branch = 'feat/test-branch';
      state.pr_url = draftUrl;
      await writeState(statePath, state);

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
        fromStep: 'finish',
        selfHost: false,
        config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
        gh,
      });

      await conductor.run();

      // Assert: exactly one PR total (reused, not newly created) and state.pr_url
      // still equals the original draft PR URL.
      expect(ghPrCreateCalls(calls)).toHaveLength(0);
      const finalState = await readState(statePath);
      expect(finalState.ok && finalState.value.pr_url).toBe(draftUrl);
    });
  });
});
