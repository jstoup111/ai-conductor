import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { FullSuitePassEvidence } from '../../src/engine/full-suite-evidence.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:deterministic-build-verification',
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
  startedAt: '2026-07-29T12:00:00.000Z',
  endedAt: '2026-07-29T12:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0,
  stdout: 'AGGREGATE_TEST_SUITE_PASS\n',
  stderr: '',
};

const BUILD_COMPLETE: ConductState = {
  complexity_tier: 'M',
  track: 'technical',
  feature_desc: 'deterministic test-suite step',
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  prd: 'skipped',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'done',
  plan: 'done',
  coherence_check: 'done',
  coverage_binding: 'done',
  architecture_diagram: 'done',
  architecture_review: 'done',
  acceptance_specs: 'done',
  build: 'done',
};

describe('Deterministic BUILD verification flow', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'deterministic-build-verification-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeState(stateFilePath, { ...BUILD_COMPLETE });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('runs build, test_suite, and build_review in serial order without a verification group event', async () => {
    const timeline: string[] = [];
    const parallelStarted: Array<{ step: string; branches: string[] }> = [];
    const events = new ConductorEventEmitter();
    events.on('parallel_started', (event) => {
      if (event.type === 'parallel_started') {
        parallelStarted.push({ step: event.step, branches: event.branches });
      }
    });
    const runner: StepRunner = {
      run: async (step: StepName) => {
        timeline.push(step);
        if (step === 'manual_test') {
          return { success: false, output: 'stop after BUILD-to-SHIP ordering proof' };
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
    const conductor = new Conductor({
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
    });

    await conductor.run();

    expect(timeline.slice(0, 3)).toEqual([
      'build',
      'test_suite',
      'build_review',
    ]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(parallelStarted).toContainEqual(expect.objectContaining({
      step: 'manual_test',
      branches: expect.arrayContaining(['manual_test', 'prd_audit', 'architecture_review_as_built']),
    }));
    // The serial BUILD path emits neither the former group identity nor a
    // fan-out that contains its only remaining member. SHIP's validation
    // group above is intentionally unrelated and still observable.
    const buildVerificationEvents = parallelStarted.filter((event) =>
      event.step === 'build' || event.branches.includes('test_suite'),
    );
    expect(buildVerificationEvents).toEqual([]);
    expect(timeline.indexOf('manual_test')).toBeGreaterThan(
      timeline.indexOf('build_review'),
    );
  });

  it.each([
    {
      label: 'aggregate suite',
      suitePasses: false,
      expectedDiagnostic: 'suite regression',
    },
  ])(
    'blocks paid review and SHIP when the $label branch fails',
    async ({ suitePasses, expectedDiagnostic }) => {
      const dispatched: string[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          dispatched.push(step);
          return { success: true };
        },
      };
      const ensure = vi.fn(async () => {
        dispatched.push('test_suite');
        return suitePasses
          ? {
              status: 'REUSED',
              freshness: { status: 'CURRENT', evidence: PASS_EVIDENCE },
              evidence: PASS_EVIDENCE,
            } as const
          : {
              status: 'FAILED',
              reason: 'nonzero_exit',
              message: expectedDiagnostic,
            } as const;
      });
      const conductor = new Conductor({
        stateFilePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        projectRoot,
        mode: 'auto',
        fromStep: 'test_suite',
        maxRetries: 1,
        verifyArtifacts: false,
        config: { validation_concurrency: 2 },
        fullSuiteVerifier: {
          ensure,
          inspect: async () => ({ status: 'STALE', reason: 'source_changed' }),
        },
      });

      await conductor.run();

      expect(dispatched).toContain('test_suite');
      expect(ensure).toHaveBeenCalledTimes(3);
      expect(dispatched).not.toContain('build_review');
      expect(dispatched).not.toContain('manual_test');
      expect(dispatched).not.toContain('prd_audit');
      expect(dispatched).not.toContain('architecture_review_as_built');
    },
  );

  it('restarts from the pending serial test_suite after BUILD completed', async () => {
    await writeState(stateFilePath, {
      ...BUILD_COMPLETE,
      test_suite: 'pending',
      build_review: 'pending',
    });
    const timeline: string[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        timeline.push(step);
        if (step === 'manual_test') {
          return { success: false, output: 'stop after restart topology proof' };
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
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      resume: true,
      maxRetries: 1,
      verifyArtifacts: false,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: {
        ensure,
        inspect: async () => ({ status: 'STALE', reason: 'missing' }),
      },
    }).run();

    expect(timeline.slice(0, 2)).toEqual(['test_suite', 'build_review']);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('dispatches the live verification member before review at concurrency one', async () => {
    const timeline: string[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        timeline.push(step);
        if (step === 'manual_test') {
          return { success: false, output: 'stop after cap-one ordering proof' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      fromStep: 'test_suite',
      maxRetries: 1,
      verifyArtifacts: false,
      config: { validation_concurrency: 1 },
      fullSuiteVerifier: {
        ensure: async () => {
          timeline.push('test_suite');
          return {
            status: 'REUSED',
            freshness: { status: 'CURRENT', evidence: PASS_EVIDENCE },
            evidence: PASS_EVIDENCE,
          };
        },
        inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE }),
      },
    });

    await conductor.run();

    expect(timeline.slice(0, 2)).toEqual([
      'test_suite',
      'build_review',
    ]);
  });

  it('reuses a satisfied persisted verdict on resume without re-dispatching the group', async () => {
    // A satisfied persisted verdict is normal resume state, not a BUILD
    // repair. The completed test suite retains its shortcut.
    await writeState(stateFilePath, {
      ...BUILD_COMPLETE,
      test_suite: 'done',
    });
    await writeVerdict(projectRoot, 'test_suite', {
      satisfied: true,
      checkedAt: 1,
    });
    const timeline: string[] = [];
    const parallelStarted: Array<{ step: StepName; branches: StepName[] }> = [];
    const events = new ConductorEventEmitter();
    events.on('parallel_started', (event) => {
      if (event.type === 'parallel_started') {
        parallelStarted.push({
          step: event.step,
          branches: event.branches as StepName[],
        });
      }
    });
    const runner: StepRunner = {
      run: async (step: StepName) => {
        timeline.push(step);
        if (step === 'manual_test') {
          return { success: false, output: 'stop after width-one exclusion proof' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      fromStep: 'build_review',
      maxRetries: 1,
      verifyArtifacts: false,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: {
        ensure: async () => {
          timeline.push('test_suite');
          return {
            status: 'REUSED',
            freshness: { status: 'CURRENT', evidence: PASS_EVIDENCE },
            evidence: PASS_EVIDENCE,
          };
        },
        inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE }),
      },
    });

    await conductor.run();

    expect(timeline.slice(0, 1)).toEqual(['build_review']);
    expect(timeline).not.toContain('test_suite');
    // A completed serial verifier opens no parallel round.
    expect(parallelStarted.every((event) => !event.branches.includes('test_suite'))).toBe(true);
  });
});
