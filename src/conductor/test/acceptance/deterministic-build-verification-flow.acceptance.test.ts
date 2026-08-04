import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { FullSuitePassEvidence } from '../../src/engine/full-suite-evidence.js';
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

  it('joins wiring and suite passes before dispatching paid review or SHIP', async () => {
    const timeline: string[] = [];
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
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      fromStep: 'wiring_check',
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
      'wiring_check',
      'test_suite',
      'build_review',
    ]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(timeline.indexOf('manual_test')).toBeGreaterThan(
      timeline.indexOf('build_review'),
    );
  });

  it.each([
    {
      label: 'aggregate suite',
      wiringPasses: true,
      suitePasses: false,
      expectedDiagnostic: 'suite regression',
    },
    {
      label: 'wiring probe',
      wiringPasses: false,
      suitePasses: true,
      expectedDiagnostic: 'unreachable production export',
    },
  ])(
    'blocks paid review and SHIP when the $label branch fails',
    async ({ wiringPasses, suitePasses, expectedDiagnostic }) => {
      const dispatched: string[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          dispatched.push(step);
          if (step === 'wiring_check' && !wiringPasses) {
            return { success: false, output: expectedDiagnostic };
          }
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
        fromStep: 'wiring_check',
        maxRetries: 1,
        verifyArtifacts: false,
        config: { validation_concurrency: 2 },
        fullSuiteVerifier: {
          ensure,
          inspect: async () => ({ status: 'STALE', reason: 'source_changed' }),
        },
      });

      await conductor.run();

      expect(dispatched).toContain('wiring_check');
      expect(dispatched).toContain('test_suite');
      expect(dispatched).not.toContain('build_review');
      expect(dispatched).not.toContain('manual_test');
      expect(dispatched).not.toContain('prd_audit');
      expect(dispatched).not.toContain('architecture_review_as_built');
    },
  );

  it('uses stable wiring-then-suite order at concurrency one before review', async () => {
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
      fromStep: 'wiring_check',
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

    expect(timeline.slice(0, 3)).toEqual([
      'wiring_check',
      'test_suite',
      'build_review',
    ]);
  });

  it('allows a one-member BUILD round while review waits for the dispatched member', async () => {
    // No persisted satisfied BUILD verdict or repair is present, so the
    // already-done sibling retains its normal resume shortcut. The pending
    // wiring member is the only branch that needs dispatch.
    await writeState(stateFilePath, {
      ...BUILD_COMPLETE,
      test_suite: 'done',
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
      fromStep: 'wiring_check',
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

    expect(timeline.slice(0, 2)).toEqual(['wiring_check', 'build_review']);
    expect(timeline).not.toContain('test_suite');
    // A one-member round keeps the serial event shape. The declared
    // wiring-then-suite ordering remains covered above when both dispatch;
    // here review follows only after the sole dispatched member settles.
    expect(parallelStarted.filter((event) => event.step === 'wiring_check')).toEqual([]);
    expect(parallelStarted.every((event) => !event.branches.includes('test_suite'))).toBe(true);
  });
});
