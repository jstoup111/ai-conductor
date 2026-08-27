/**
 * Acceptance coverage for the surviving BUILD-verification flows after the
 * retired BUILD gate is hard-deleted.
 *
 * Covers: S2.1, S2.2, S2.N1, S2.N2, task:13
 * Covers: S4.1, S4.N1, S4.N2, task:6
 *
 * Both cases drive the production Conductor.run() entry point with a faithful
 * fake at the provider boundary. They assert the operator-visible dispatch
 * order and event stream, not registry/source absence.
 */

import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { FullSuitePassEvidence } from '../../src/engine/full-suite-evidence.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { writeState } from '../../src/engine/state.js';
import { readTestSuiteRemediations } from '../../src/engine/test-suite-remediation.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:serial-build-verifier',
  categoryFingerprints: {
    additional_inputs: 'sha256:additional-inputs',
    dependencies: 'sha256:dependencies',
    environment: 'sha256:environment',
    migrations: 'sha256:migrations',
    project_config: 'sha256:project-config',
    source: 'sha256:source',
    test_infrastructure: 'sha256:test-infrastructure',
    tests: 'sha256:tests',
  },
  provenanceHeadSha: '0123456789abcdef',
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-08-26T12:00:00.000Z',
  endedAt: '2026-08-26T12:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0,
  stdout: 'AGGREGATE_TEST_SUITE_PASS\n',
  stderr: '',
};

const FRONT_DONE: ConductState = {
  run_started_at: 1,
  complexity_tier: 'M',
  track: 'technical',
  feature_desc: 'serial-build-verifier',
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  prd: 'skipped',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'done',
  plan: 'done',
  coherence_check: 'done',
  architecture_diagram: 'done',
  architecture_review: 'done',
  acceptance_specs: 'done',
};

describe('hard-deleted BUILD gate leaves one serial BUILD verifier', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'serial-build-verifier-'));
    stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await initTestRepo(projectRoot);
    await writeFile(join(projectRoot, '.gitignore'), '.pipeline/\n');
    await writeFile(join(projectRoot, 'README.md'), 'fixture\n');
    await commitAll(projectRoot, 'fixture');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('runs build, test_suite, and build_review serially without a BUILD fan-out event', async () => {
    await writeState(stateFilePath, { ...FRONT_DONE });
    const timeline: string[] = [];
    const buildVerificationRounds: StepName[][] = [];
    const events = new ConductorEventEmitter();
    events.on('parallel_started', (event) => {
      if (
        event.type === 'parallel_started' &&
        event.branches.some((branch) => branch === 'test_suite')
      ) {
        buildVerificationRounds.push(event.branches as StepName[]);
      }
    });

    const runner: StepRunner = {
      run: async (step) => {
        timeline.push(step);
        if (step === 'manual_test') {
          return { success: false, output: 'expected boundary after BUILD verification' };
        }
        return { success: true };
      },
    };
    const ensure = vi.fn(async () => {
      timeline.push('test_suite');
      return {
        status: 'EXECUTED',
        freshness: { status: 'STALE', reason: 'missing' },
        evidence: PASS_EVIDENCE,
      } as const;
    });

    await new Conductor({
      stateFilePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      verifyArtifacts: false,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: {
        ensure,
        inspect: async () => ({ status: 'STALE', reason: 'missing' }),
      },
    }).run();

    expect(timeline.slice(0, 3)).toEqual(['build', 'test_suite', 'build_review']);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(buildVerificationRounds).toEqual([]);
  });

  it('re-runs test_suite after a review-driven BUILD repair before reviewing again', async () => {
    await writeState(stateFilePath, {
      ...FRONT_DONE,
      build: 'done',
      test_suite: 'pending',
      build_review: 'pending',
    });
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
    );

    const timeline: string[] = [];
    const buildVerificationRounds: StepName[][] = [];
    const events = new ConductorEventEmitter();
    events.on('parallel_started', (event) => {
      if (
        event.type === 'parallel_started' &&
        event.branches.some((branch) => branch === 'test_suite')
      ) {
        buildVerificationRounds.push(event.branches as StepName[]);
      }
    });

    let buildRuns = 0;
    let reviewRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        timeline.push(step);
        if (step === 'build') {
          buildRuns += 1;
          await writeFile(join(projectRoot, 'repair.txt'), `repair ${buildRuns}\n`);
          execSync('git add repair.txt', { cwd: projectRoot });
          execSync(`git commit -q -m "repair ${buildRuns}"`, { cwd: projectRoot });
          return { success: true };
        }
        if (step === 'build_review') {
          reviewRuns += 1;
          const pass = reviewRuns === 2;
          await writeFile(
            join(projectRoot, '.pipeline', 'build-review.json'),
            JSON.stringify({
              verdict: pass ? 'PASS' : 'FAIL',
              reasons: pass ? [] : ['repair requested'],
              rubric: { testQuality: !pass },
              findings: pass ? {} : { testQuality: ['repair requested'] },
            }),
          );
          return { success: true };
        }
        if (step === 'manual_test') {
          return { success: false, output: 'expected boundary after repaired review' };
        }
        throw new Error(`unexpected provider dispatch: ${step}`);
      },
    };
    const ensure = vi.fn(async () => {
      timeline.push('test_suite');
      return {
        status: 'EXECUTED',
        freshness: { status: 'STALE', reason: 'fingerprint_mismatch' },
        evidence: PASS_EVIDENCE,
      } as const;
    });

    await new Conductor({
      stateFilePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      daemon: true,
      fromStep: 'test_suite',
      maxRetries: 1,
      verifyArtifacts: true,
      config: {
        validation_concurrency: 2,
        build_review: { enabled: true },
        kickback_escalation: { enabled: false },
      },
      git: async () => ({ stdout: '' }),
      fullSuiteVerifier: {
        ensure,
        inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE }),
      },
      escalateBuildFailure: async () => ({}),
    } as never).run();

    expect(timeline.filter((step) => step === 'test_suite')).toHaveLength(2);
    expect(timeline.filter((step) => step === 'build_review')).toHaveLength(2);
    expect(buildRuns).toBe(1);
    expect(timeline.lastIndexOf('test_suite')).toBeLessThan(timeline.lastIndexOf('build_review'));
    expect(buildVerificationRounds).toEqual([]);
  });

  it('recomputes test_suite evidence after an explicit repaired BUILD before review', async () => {
    await writeState(stateFilePath, {
      ...FRONT_DONE,
      build: 'done',
      test_suite: 'done',
      build_review: 'pending',
    });
    const timeline: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        timeline.push(step);
        if (step === 'build') {
          await writeFile(join(projectRoot, 'repair.txt'), 'repaired\n');
          execSync('git add repair.txt', { cwd: projectRoot });
          execSync('git commit -q -m "repair"', { cwd: projectRoot });
          return { success: true };
        }
        if (step === 'manual_test') {
          return { success: false, output: 'expected boundary after repaired verification' };
        }
        return { success: true };
      },
    };
    const inspect = vi.fn(async () => ({
      status: 'STALE' as const,
      reason: 'fingerprint_mismatch' as const,
    }));
    const ensure = vi.fn(async () => {
      timeline.push('test_suite');
      return {
        status: 'EXECUTED' as const,
        freshness: { status: 'STALE' as const, reason: 'fingerprint_mismatch' as const },
        evidence: PASS_EVIDENCE,
      };
    });

    await new Conductor({
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      verifyArtifacts: false,
      fullSuiteVerifier: { ensure, inspect },
    }).run();

    expect(timeline.slice(0, 3)).toEqual(['build', 'test_suite', 'build_review']);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('records one repair and one budget charge per deterministic suite failure', async () => {
    await writeState(stateFilePath, {
      ...FRONT_DONE,
      build: 'done',
      test_suite: 'pending',
      build_review: 'pending',
    });
    await writeFile(
      join(projectRoot, '.pipeline', 'events.jsonl'),
      `${JSON.stringify({
        type: 'rebase_changed',
        ts: new Date(Date.now() - 1_000).toISOString(),
        allChangedPaths: ['src/repair-1.ts', 'src/repair-2.ts'],
      })}\n`,
    );

    const kickbacks: Array<{ from: StepName; to: StepName; count: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns += 1;
          const repair = `repair-${buildRuns}.txt`;
          await writeFile(join(projectRoot, repair), 'repaired\n');
          execSync(`git add ${repair}`, { cwd: projectRoot });
          execSync(`git commit -q -m "repair ${buildRuns}"`, { cwd: projectRoot });
        }
        if (step === 'manual_test') {
          return { success: false, output: 'expected boundary after suite recovery' };
        }
        return { success: true };
      },
    };
    const failures = ['src/repair-1.ts failed', 'src/repair-2.ts failed'];
    const ensure = vi.fn(async () => {
      const message = failures.shift();
      if (message) {
        return {
          status: 'FAILED' as const,
          reason: 'nonzero_exit' as const,
          message,
        };
      }
      return {
        status: 'EXECUTED' as const,
        freshness: { status: 'STALE' as const, reason: 'fingerprint_mismatch' as const },
        evidence: PASS_EVIDENCE,
      };
    });

    await new Conductor({
      stateFilePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      fromStep: 'test_suite',
      maxRetries: 1,
      verifyArtifacts: false,
      fullSuiteVerifier: {
        ensure,
        inspect: async () => ({ status: 'STALE', reason: 'fingerprint_mismatch' }),
      },
    }).run();

    expect(buildRuns).toBe(2);
    expect(ensure).toHaveBeenCalledTimes(3);
    expect(kickbacks).toEqual([
      expect.objectContaining({ from: 'test_suite', to: 'build', count: 1 }),
      expect.objectContaining({ from: 'test_suite', to: 'build', count: 1 }),
    ]);
    expect((await readKickbackLedger(projectRoot)).gates.test_suite?.count).toBe(1);
    expect(await readTestSuiteRemediations(projectRoot)).toEqual([
      expect.objectContaining({ gate: 'test_suite', diagnostic: 'src/repair-1.ts failed' }),
      expect.objectContaining({ gate: 'test_suite', diagnostic: 'src/repair-2.ts failed' }),
    ]);
  });

  it('halts unchanged repeated suite failures at the existing per-gate cap', async () => {
    await writeState(stateFilePath, {
      ...FRONT_DONE,
      build: 'done',
      test_suite: 'pending',
      build_review: 'pending',
    });
    const kickbacks: Array<{ from: StepName; to: StepName; count: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') buildRuns += 1;
        if (step === 'build_review') throw new Error('review must stay blocked');
        return { success: true };
      },
    };
    const ensure = vi.fn(async () => ({
      status: 'FAILED' as const,
      reason: 'nonzero_exit' as const,
      message: 'src/no-progress.ts failed',
    }));

    await new Conductor({
      stateFilePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      fromStep: 'test_suite',
      maxRetries: 1,
      verifyArtifacts: false,
      fullSuiteVerifier: {
        ensure,
        inspect: async () => ({ status: 'STALE', reason: 'fingerprint_mismatch' }),
      },
    }).run();

    expect(buildRuns).toBe(2);
    expect(ensure).toHaveBeenCalledTimes(3);
    expect(kickbacks).toEqual([
      expect.objectContaining({ from: 'test_suite', to: 'build', count: 1 }),
      expect.objectContaining({ from: 'test_suite', to: 'build', count: 2 }),
    ]);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /test_suite failure unresolved after 2 build kickback\(s\)/,
    );
  });
});
