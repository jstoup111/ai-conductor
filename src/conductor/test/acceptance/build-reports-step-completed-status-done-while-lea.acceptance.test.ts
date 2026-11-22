// Covers: task:1
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StepRunner } from '../../src/engine/conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import type { ConductorEvent, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import { readVerdict, type GateVerdict } from '../../src/engine/gate-verdicts.js';
import { Conductor } from '../test-conductor.js';
import { seedCleanFeatureSimplifyRecord } from '../fixtures/feature-simplify-record.js';

// RED acceptance coverage for #1270, Stories S3 and S5. These specs drive the
// real production entry point, Conductor.run()'s BUILD retry loop. The two
// correctness-critical production call sites are:
// - conductor.ts: the normal post-attempt completion predicate;
// - conductor.ts: the anyAttemptMovedHead budget-exhaustion escape.
//
// Technical track, no PRD: FR-coverage evidence does not apply. S1/S2/S4/S6/
// S8 are single-operation contracts owned by the plan's lower-layer TDD tests.
// S7 deliberately leaves its post-rebase behavior decision to plan Task 11.

async function initGitRepo(dir: string): Promise<void> {
  await initTestRepo(dir);
  await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
  await writeFile(join(dir, 'README.md'), '# Test\n');
  await execa('git', ['add', '.gitignore', 'README.md'], { cwd: dir });
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
}

async function seedArtifacts(dir: string): Promise<void> {
  const artifacts: Array<[string, string]> = [
    ['.docs/decisions/technical-assessment-2026-08-04.md', 'x'],
    ['.docs/specs/2026-08-04-feature.md', 'x'],
    ['.docs/stories/feature.md', 'x'],
    ['.docs/conflicts/2026-08-04.md', 'x'],
    ['.docs/coherence/2026-08-04.md', 'x'],
    ['.docs/architecture/architecture.md', 'x'],
    ['.docs/decisions/adr-001.md', 'x'],
    ['spec/acceptance/feature_spec.rb', 'x'],
    [
      '.pipeline/acceptance-specs-red.json',
      JSON.stringify({
        outcome: 'specs-generated',
        command: 'bundle exec rspec spec/acceptance/feature_spec.rb',
        targetSpecs: ['spec/acceptance/feature_spec.rb'],
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
      }),
    ],
  ];

  for (const [relativePath, content] of artifacts) {
    const absolutePath = join(dir, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, content);
  }
}

async function writePlanAndStatus(dir: string, status: 'pending' | 'completed'): Promise<void> {
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(join(dir, '.docs/plans/2026-08-04-plan.md'), '# Plan\n\n### Task 1: Work\n');
  await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: 1, status }] }));
  await seedCleanFeatureSimplifyRecord(dir);
  const resolvedBeforeBuild = Object.fromEntries(
    ALL_STEPS.slice(
      0,
      ALL_STEPS.findIndex((step) => step.name === 'build'),
    ).map((step) => [step.name, 'done']),
  );
  await writeFile(
    join(dir, '.pipeline/conduct-state.json'),
    JSON.stringify({
      ...resolvedBeforeBuild,
      complexity_tier: 'M',
      track: 'technical',
    }),
  );
  await execa('git', ['add', '.docs', 'spec'], { cwd: dir });
  await execa('git', ['commit', '-m', 'docs: approve decide artifacts'], { cwd: dir });
}

async function commitPlainWork(dir: string, sequence: number): Promise<void> {
  const relativePath = `landed-${sequence}.txt`;
  await writeFile(join(dir, relativePath), `landed work ${sequence}\n`);
  await execa('git', ['add', relativePath], { cwd: dir });
  await execa('git', ['commit', '-m', `chore: land work ${sequence}`], { cwd: dir });
}

describe('#1270 BUILD completion floor (real Conductor.run() retry loop)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let stepStarts: StepName[];
  let completedBuilds: number;
  let uncommittedWorkEvents: Array<Extract<ConductorEvent, { type: 'build_uncommitted_work' }>>;
  let currentCommitSha: { mockRestore: () => void };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-uncommitted-floor-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    events = new ConductorEventEmitter();
    stepStarts = [];
    completedBuilds = 0;
    events.on('step_started', (event) => {
      if (event.type === 'step_started') stepStarts.push(event.step);
    });
    events.on('step_completed', (event) => {
      if (event.type === 'step_completed' && event.step === 'build' && event.status === 'done') {
        completedBuilds += 1;
      }
    });
    uncommittedWorkEvents = [];
    events.on('build_uncommitted_work', (event) => {
      if (event.type === 'build_uncommitted_work') uncommittedWorkEvents.push(event);
    });
    await initGitRepo(dir);
    await seedArtifacts(dir);
    currentCommitSha = vi.spyOn(projectPrelude, 'currentCommitSha').mockImplementation(async (projectRoot) => {
      try {
        return (await execa('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim();
      } catch {
        return null;
      }
    });
  });

  afterEach(async () => {
    currentCommitSha.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  // `refuseCommits` models a hook rejecting the engine's own commit at the
  // injected git boundary, which is the only way a settled attempt's dirty
  // work still reaches the dirty-tree miss (adr-2026-08-03 D10).
  function makeConductor(runner: StepRunner, maxRetries = 2, options: { refuseCommits?: boolean } = {}): Conductor {
    const git: GitRunner = async (args, { cwd }) => {
      if (options.refuseCommits && args[0] === 'commit') {
        throw Object.assign(new Error('git commit refused'), { stderr: 'commit-msg: rejected by fixture hook' });
      }
      const result = await execa('git', args, { cwd });
      return { stdout: result.stdout };
    };
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries,
      fromStep: 'build',
      escalateBuildFailure: async () => ({}),
      git,
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    });
  }

  describe('Story S3: budget-exhaustion routing observes the final worktree', () => {
    it('does not emit BUILD done or dispatch build_review after commit movement leaves tracked work dirty and the engine commit is refused', async () => {
      await writePlanAndStatus(dir, 'pending');
      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step) => {
          if (step === 'build') {
            attempt += 1;
            await commitPlainWork(dir, attempt);
            if (attempt === 2) {
              await writeFile(join(dir, 'README.md'), '# Test\n\nuncommitted repair\n');
            }
          }
          return { success: true };
        }),
      };

      await makeConductor(runner, 2, { refuseCommits: true }).run();

      expect(attempt).toBe(2);
      expect(completedBuilds).toBe(0);
      expect(stepStarts).not.toContain('build_review');
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf-8')).resolves.toMatch(
        /^1 uncommitted paths: README\.md/m,
      );
    });

    it('persists the clean-tree exhaustion route before subsequent build_review dispatch', async () => {
      await writePlanAndStatus(dir, 'pending');
      let attempt = 0;
      let forwardedVerdict: GateVerdict | null = null;
      const observedBuildReview = new Error('observed build_review');
      const runner: StepRunner = {
        run: vi.fn(async (step) => {
          if (step === 'build') {
            attempt += 1;
            if (attempt > 2) throw new Error('unexpected third build attempt');
            await commitPlainWork(dir, attempt);
          } else if (step === 'build_review') {
            forwardedVerdict = await readVerdict(dir, 'build');
            throw observedBuildReview;
          }
          return { success: true };
        }),
      };

      await makeConductor(runner).run();

      expect(attempt).toBe(2);
      expect(completedBuilds).toBe(1);
      expect(stepStarts).toContain('build_review');
      // A clean, self-committed attempt never triggers the engine commit.
      expect(uncommittedWorkEvents).toEqual([]);
      expect(forwardedVerdict).toEqual(
        expect.objectContaining({
          satisfied: true,
          reason: expect.stringMatching(/commit movement/),
          checkedAt: expect.any(Number),
        }),
      );
    });
  });

  describe('Story S9 (#3229): the engine commits settled work the attempt left uncommitted', () => {
    it('commits the dirty work with the active task trailer so the attempt completes without a retry', async () => {
      await writePlanAndStatus(dir, 'pending');
      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step) => {
          if (step === 'build') {
            attempt += 1;
            // The builder's `task start` stamp, written during the attempt.
            await writeFile(join(dir, '.pipeline/current-task'), '1\n');
            await writeFile(join(dir, 'README.md'), '# Test\n\nuncommitted repair\n');
          } else if (step === 'build_review') {
            throw new Error('observed build_review');
          }
          return { success: true };
        }),
      };

      await makeConductor(runner).run();

      const head = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
      const message = (await execa('git', ['log', '-1', '--format=%B'], { cwd: dir })).stdout;
      const porcelain = (await execa('git', ['status', '--porcelain'], { cwd: dir })).stdout;
      expect({ attempt, completedBuilds, porcelain, uncommittedWorkEvents }).toEqual({
        attempt: 1,
        completedBuilds: 1,
        porcelain: '',
        uncommittedWorkEvents: [
          expect.objectContaining({
            step: 'build',
            attempt: 1,
            paths: ['README.md'],
            taskIds: ['1'],
            outcome: 'committed',
            sha: head,
          }),
        ],
      });
      expect(message).toMatch(/^build: commit work left uncommitted by BUILD attempt 1/);
      expect(message).toMatch(/^Task: 1$/m);
      expect(stepStarts).toContain('build_review');
    });

    it('falls back to the dirty-tree miss, naming the commit failure, when the engine commit is refused', async () => {
      await writePlanAndStatus(dir, 'completed');
      let attempt = 0;
      const retryReasons: Array<string | undefined> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step, _state, options) => {
          if (step === 'build') {
            attempt += 1;
            retryReasons.push(options?.retryReason);
            if (attempt === 1) {
              await writeFile(join(dir, 'README.md'), '# Test\n\nuncommitted repair\n');
            } else {
              await execa('git', ['add', 'README.md'], { cwd: dir });
              await execa('git', ['commit', '-m', 'fix: commit repair'], { cwd: dir });
            }
          }
          return { success: true };
        }),
      };

      await makeConductor(runner, 2, { refuseCommits: true }).run();

      expect(attempt).toBe(2);
      expect(retryReasons[1]).toMatch(/1 uncommitted paths: README\.md/);
      expect(retryReasons[1]).toMatch(
        /engine commit of uncommitted BUILD work failed: commit-msg: rejected by fixture hook/,
      );
      expect(uncommittedWorkEvents).toEqual([
        expect.objectContaining({
          attempt: 1,
          paths: ['README.md'],
          outcome: 'failed',
          reason: expect.stringContaining('rejected by fixture hook'),
        }),
      ]);
      expect(completedBuilds).toBe(1);
    });
  });

  describe('Story S5: an uncommitted miss self-heals through the next dispatch', () => {
    it('names the dirty path in the retry hint and completes after the next attempt commits it', async () => {
      await writePlanAndStatus(dir, 'completed');
      let attempt = 0;
      const retryReasons: Array<string | undefined> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step, _state, options) => {
          if (step === 'build') {
            attempt += 1;
            retryReasons.push(options?.retryReason);
            if (attempt === 1) {
              await writeFile(join(dir, 'README.md'), '# Test\n\nuncommitted repair\n');
            } else {
              await execa('git', ['add', 'README.md'], { cwd: dir });
              await execa('git', ['commit', '-m', 'fix: commit repair'], { cwd: dir });
            }
          }
          return { success: true };
        }),
      };

      await makeConductor(runner, 2, { refuseCommits: true }).run();

      expect(attempt).toBe(2);
      expect(retryReasons[1]).toMatch(/README\.md/);
      expect(retryReasons[1]).toMatch(/commit/i);
      expect(completedBuilds).toBe(1);
    });
  });
});
