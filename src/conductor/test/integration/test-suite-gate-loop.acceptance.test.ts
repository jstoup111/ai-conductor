import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunOptions } from '../../src/engine/conductor.js';
import type {
  FullSuiteFailureReason,
  FullSuitePassEvidence,
} from '../../src/engine/full-suite-evidence.js';
import type { FullSuiteVerifierResult } from '../../src/engine/full-suite-verifier.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:current-test-inputs',
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
  startedAt: '2026-07-25T17:00:00.000Z',
  endedAt: '2026-07-25T17:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0,
  stdout: 'all tests passed\n',
  stderr: '',
};

const FRONT_DONE: ConductState = {
  complexity_tier: 'M',
  feature_desc: 'full-suite gate integration',
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  prd: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'done',
  plan: 'done',
  coherence_check: 'done',
  architecture_diagram: 'done',
  architecture_review: 'done',
  acceptance_specs: 'done',
  build: 'done',
  build_review: 'done',
};

describe('test_suite native gate loop', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'test-suite-gate-loop-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeState(stateFilePath, { ...FRONT_DONE });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('holds every SHIP validator until native verification passes, then advances to manual_test', async () => {
    const timeline: string[] = [];
    let releasePass!: (result: FullSuiteVerifierResult) => void;
    const pendingPass = new Promise<FullSuiteVerifierResult>((resolve) => {
      releasePass = resolve;
    });
    const ensure = vi.fn(async () => {
      timeline.push('test_suite');
      return pendingPass;
    });
    const inspect = vi.fn(async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE } as const));
    const runner: StepRunner = {
      run: async (step: StepName) => {
        timeline.push(step);
        if (step === 'wiring_check') {
          await writeFile(
            join(projectRoot, '.pipeline/wiring-evidence.json'),
            JSON.stringify({
              schema: 1,
              base: 'base-sha',
              head: 'head-sha',
              layer2: { applicable: false, reason: 'no TypeScript project' },
              waivers: [],
              tasks: [],
            }),
          );
        }
        if (step === 'manual_test') return { success: false, output: 'stop after ordering proof' };
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
      verifyArtifacts: true,
      fullSuiteVerifier: { ensure, inspect },
    });

    const run = conductor.run();
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    // wiring_check is a deprecated no-op that settles in-process without a
    // provider dispatch, so test_suite is the group's only timeline entry.
    expect(timeline).toEqual(['test_suite']);
    expect(timeline).not.toContain('manual_test');
    expect(timeline).not.toContain('prd_audit');
    expect(timeline).not.toContain('architecture_review_as_built');

    releasePass({
      status: 'EXECUTED',
      freshness: { status: 'STALE', reason: 'missing' },
      evidence: PASS_EVIDENCE,
    });
    await run;

    expect(timeline.slice(0, 1)).toEqual(['test_suite']);
    expect(timeline.indexOf('manual_test')).toBeGreaterThan(timeline.indexOf('test_suite'));
    expect(timeline.slice(1).sort()).toEqual([
      'architecture_review_as_built',
      'manual_test',
      'prd_audit',
    ]);
    expect(inspect).toHaveBeenCalled();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('reuses a current suite proof once and retains the joined pass through finish', async () => {
    await writeState(stateFilePath, {
      ...FRONT_DONE,
      build_review: 'pending',
    });
    const timeline: string[] = [];
    const joined: string[][] = [];
    const ensure = vi.fn(async () => {
      timeline.push('test_suite');
      return {
        status: 'REUSED',
        freshness: { status: 'CURRENT', evidence: PASS_EVIDENCE },
        evidence: PASS_EVIDENCE,
      } as const;
    });
    const inspect = vi.fn(async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE } as const));
    const events = new ConductorEventEmitter();
    events.on('parallel_completed', (event) => {
      if (event.type === 'parallel_completed') joined.push(event.branches);
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: {
        run: async (step: StepName) => {
          timeline.push(step);
          if (step === 'finish') {
            return { success: false, output: 'stop at finish proof boundary' };
          }
          return { success: true };
        },
      },
      events,
      projectRoot,
      mode: 'auto',
      fromStep: 'wiring_check',
      maxRetries: 1,
      verifyArtifacts: false,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: {
        inspect,
        ensure,
      },
      onRecovery: async () => 'quit',
    });

    await conductor.run();
    const persisted = await readState(stateFilePath);
    const finalState = persisted.ok ? persisted.value : {};

    expect({
      ensureCalls: ensure.mock.calls.length,
      inspectCalls: inspect.mock.calls.length,
      buildJoin: joined.find((branches) => branches.includes('test_suite')),
      reachedFinish: timeline.at(-1),
      retainedSuiteState: finalState.test_suite,
    }).toEqual({
      ensureCalls: 1,
      inspectCalls: 1,
      buildJoin: ['wiring_check', 'test_suite'],
      reachedFinish: 'finish',
      retainedSuiteState: 'done',
    });
  });

  it('emits stale native verification freshness before executing the verifier', async () => {
    await writeState(stateFilePath, {
      ...FRONT_DONE,
      wiring_check: 'done',
      test_suite: 'pending',
      manual_test: 'pending',
      prd_audit: 'pending',
      architecture_review_as_built: 'pending',
      retro: 'done',
    });
    const observed: unknown[] = [];
    const events = new ConductorEventEmitter();
    events.on('test_suite_verification', (event) => {
      observed.push({
        type: event.type,
        freshness: (event as { freshness?: unknown }).freshness,
      });
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: { run: async () => ({ success: true }) },
      events,
      projectRoot,
      mode: 'auto',
      fromStep: 'test_suite',
      maxRetries: 1,
      fullSuiteVerifier: {
        inspect: async () => ({ status: 'STALE', reason: 'source_changed' }),
        ensure: async () => {
          observed.push('ensure');
          return {
            status: 'EXECUTED',
            freshness: { status: 'STALE', reason: 'source_changed' },
            evidence: PASS_EVIDENCE,
          };
        },
      },
    });

    // This assertion targets the native verifier seam itself. A synthetic
    // all-success conductor run would continue into the unrelated SHIP
    // convergence loop after the verifier completes.
    await (conductor as unknown as { runTestSuiteStep: () => Promise<unknown> })
      .runTestSuiteStep();

    expect(observed).toEqual([
      {
        type: 'test_suite_verification',
        freshness: { status: 'STALE', reason: 'source_changed' },
      },
      'ensure',
    ]);
  });

  it.each<{
    label: string;
    reason: FullSuiteFailureReason;
    message: string;
  }>([
    {
      label: 'non-zero exit',
      reason: 'nonzero_exit',
      message: 'unit/auth.test.ts failed; credential=[REDACTED]',
    },
    {
      label: 'missing config',
      reason: 'missing_config',
      message: 'Project config must declare test_suite',
    },
    {
      label: 'launch error',
      reason: 'unlaunchable',
      message: 'Unable to launch configured aggregate command',
    },
    {
      label: 'timeout',
      reason: 'timeout',
      message: 'Aggregate suite timed out after 30 seconds',
    },
    {
      label: 'fingerprint preflight failure',
      reason: 'preflight_failed',
      message: 'Unable to fingerprint declared test input',
    },
  ])(
    'routes persistent $label evidence through BUILD twice, then halts at the shared cap',
    async ({ reason, message }) => {
      await writeState(stateFilePath, {
        ...FRONT_DONE,
        wiring_check: 'done',
        test_suite: 'pending',
        manual_test: 'pending',
        prd_audit: 'pending',
        architecture_review_as_built: 'pending',
        retro: 'done',
      });
      const timeline: string[] = [];
      const buildRetryReasons: Array<string | undefined> = [];
      const ensure = vi.fn(async () => {
        timeline.push('test_suite');
        return { status: 'FAILED', reason, message } as const;
      });
      const runner: StepRunner = {
        run: async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          timeline.push(step);
          if (step === 'build') buildRetryReasons.push(options?.retryReason);
          return { success: true };
        },
      };
      const events = new ConductorEventEmitter();
      const kickbacks: Array<{ evidence?: string; count: number }> = [];
      let haltReason = '';
      events.on('kickback', (event) => {
        if (event.type === 'kickback' && event.from === 'test_suite') {
          kickbacks.push({ evidence: event.evidence, count: event.count });
        }
      });
      events.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') haltReason = event.reason;
      });
      const conductor = new Conductor({
        stateFilePath,
        stepRunner: runner,
        events,
        projectRoot,
        mode: 'auto',
        fromStep: 'test_suite',
        // The native gate owns a single attempt regardless of the generic
        // retry policy; BUILD must intervene before ensure() can run again.
        maxRetries: 7,
        fullSuiteVerifier: {
          ensure,
          inspect: async () => ({ status: 'FAILED', reason, message }),
        },
      });

      await conductor.run();

      const persisted = await readState(stateFilePath);
      const finalState = persisted.ok ? persisted.value : {};
      const haltMarker = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf-8');
      const haltClass = await readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf-8');
      const routedEvidence =
        `full-suite verification failed (${reason}): ${message}\n` +
        'Evidence: .pipeline/test-suite-evidence.json';
      expect({
        ensureCalls: ensure.mock.calls.length,
        relevantTimeline: timeline.filter((step) => step === 'test_suite' || step === 'build'),
        shipDispatches: timeline.filter((step) =>
          ['manual_test', 'prd_audit', 'architecture_review_as_built'].includes(step),
        ),
        kickbacks,
        buildRetryReasons,
        haltReason,
        haltMarker,
        haltClass,
        finalGateState: finalState.test_suite,
        restagedDownstreamState: finalState.retro,
      }).toEqual({
        ensureCalls: 3,
        relevantTimeline: ['test_suite', 'build', 'test_suite', 'build', 'test_suite'],
        shipDispatches: [],
        kickbacks: [
          { evidence: routedEvidence, count: 1 },
          { evidence: routedEvidence, count: 2 },
        ],
        // Both rounds take the serial path: wiring_check is a deprecated no-op
        // that settles once and is never re-staled, so test_suite is the only
        // live BUILD-verification member and the group never fans out.
        buildRetryReasons: [
          `test_suite failed:\n${routedEvidence}\nFix and commit the failure before the suite is re-run.`,
          `test_suite failed:\n${routedEvidence}\nFix and commit the failure before the suite is re-run.`,
        ],
        haltReason:
          `test_suite failure unresolved after 2 build kickback(s) (cap 2): ${routedEvidence}`,
        haltMarker:
          `test_suite failure unresolved after 2 build kickback(s) (cap 2): ${routedEvidence}\n`,
        haltClass: 'mechanical',
        finalGateState: 'failed',
        restagedDownstreamState: 'stale',
      });
    },
  );
});
