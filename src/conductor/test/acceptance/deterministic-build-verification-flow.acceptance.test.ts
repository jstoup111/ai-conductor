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

  it('joins the BUILD verification group before dispatching paid review or SHIP', async () => {
    const timeline: string[] = [];
    const deprecatedSteps: string[] = [];
    const recomputedMembers: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('deprecated_step', (event) => {
      if (event.type === 'deprecated_step') deprecatedSteps.push(event.step);
    });
    events.on('build_member_evidence_recomputed', (event) => {
      if (event.type === 'build_member_evidence_recomputed') recomputedMembers.push(event.member);
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

    // wiring_check is a deprecated no-op: it resolves as a step name and
    // passes without dispatching, so test_suite is the group's only live
    // member (adr-2026-08-11-deprecated-no-op-step-retirement).
    expect(timeline.slice(0, 2)).toEqual([
      'test_suite',
      'build_review',
    ]);
    expect(timeline).not.toContain('wiring_check');
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(deprecatedSteps).toEqual(['wiring_check']);
    expect(recomputedMembers).not.toContain('wiring_check');
    expect(timeline.indexOf('manual_test')).toBeGreaterThan(
      timeline.indexOf('build_review'),
    );
  });

  it('emits one deprecation notice when serial execution runs wiring_check', async () => {
    const deprecatedSteps: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('deprecated_step', (event) => {
      if (event.type === 'deprecated_step') deprecatedSteps.push(event.step);
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: {
        run: async (step: StepName) => step === 'manual_test'
          ? { success: false, output: 'stop after serial wiring_check event proof' }
          : { success: true },
      },
      events,
      projectRoot,
      mode: 'default',
      fromStep: 'wiring_check',
      maxRetries: 1,
      verifyArtifacts: false,
      fullSuiteVerifier: {
        ensure: async () => ({
          status: 'REUSED',
          freshness: { status: 'CURRENT', evidence: PASS_EVIDENCE },
          evidence: PASS_EVIDENCE,
        }),
        inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE }),
      },
    });

    await conductor.run();

    expect(deprecatedSteps).toEqual(['wiring_check']);
  });

  it.each([
    {
      label: 'aggregate suite',
      wiringPasses: true,
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

      expect(dispatched).toContain('test_suite');
      expect(dispatched).not.toContain('build_review');
      expect(dispatched).not.toContain('manual_test');
      expect(dispatched).not.toContain('prd_audit');
      expect(dispatched).not.toContain('architecture_review_as_built');
    },
  );

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

    expect(timeline.slice(0, 2)).toEqual([
      'test_suite',
      'build_review',
    ]);
  });

  it('reuses a satisfied persisted verdict on resume without re-dispatching the group', async () => {
    // A satisfied persisted verdict is normal resume state, not a BUILD
    // repair. The already-done member retains its shortcut, and with
    // wiring_check retired to a no-op the group needs no dispatch at all.
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

    expect(timeline.slice(0, 1)).toEqual(['build_review']);
    expect(timeline).not.toContain('test_suite');
    expect(timeline).not.toContain('wiring_check');
    // A fully-satisfied group keeps the serial event shape — no parallel
    // round is opened for a member that never needs dispatch.
    expect(parallelStarted.filter((event) => event.step === 'wiring_check')).toEqual([]);
    expect(parallelStarted.every((event) => !event.branches.includes('test_suite'))).toBe(true);
  });
});
