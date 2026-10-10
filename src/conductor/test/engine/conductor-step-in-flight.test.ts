// Covers: task:3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { FullSuitePassEvidence } from '../../src/engine/full-suite-evidence.js';
import type { FullSuiteVerifierResult } from '../../src/engine/full-suite-verifier.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:fixture',
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
  provenanceHeadSha: 'fixture',
  command: 'fixture',
  workingDirectory: '.',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 0,
  exitCode: 0,
  stdout: '',
  stderr: '',
};

const PASS: FullSuiteVerifierResult = {
  status: 'EXECUTED',
  freshness: { status: 'STALE', reason: 'missing' },
  evidence: PASS_EVIDENCE,
};

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('conductor serial step-in-flight ticker', () => {
  let projectRoot: string;
  let stateFilePath: string;
  let events: ConductorEventEmitter;
  let recorded: ConductorEvent[];

  beforeEach(async () => {
    vi.useFakeTimers();
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-step-in-flight-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    events = new ConductorEventEmitter();
    recorded = [];
    for (const type of ['step_started', 'step_completed', 'step_in_flight', 'build_progress'] as const) {
      events.on(type, (event) => {
        recorded.push(event);
      });
    }
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seed(first: StepName, pendingSteps: StepName[] = [first]): Promise<void> {
    const state = Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done']));
    for (const step of pendingSteps) state[step] = 'pending';
    await writeState(stateFilePath, state as ConductState);
  }

  function conductor(options: {
    runner?: StepRunner;
    ensure?: () => Promise<FullSuiteVerifierResult>;
    disabled?: boolean;
    fromStep?: StepName;
  } = {}): Conductor {
    return new Conductor({
      stateFilePath,
      projectRoot,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: options.fromStep ?? 'test_suite',
      maxRetries: 1,
      verifyArtifacts: false,
      config: {
        build_progress: { enabled: !options.disabled, heartbeat_minutes: 5 },
      },
      stepRunner: options.runner ?? {
        run: async () => ({ success: false, output: 'stop after fixture boundary' }),
      },
      fullSuiteVerifier: {
        inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE }),
        ensure: options.ensure ?? (async () => PASS),
      },
      onRecovery: async () => 'quit',
    });
  }

  it('emits twice for an eleven-minute test_suite attempt and stops before terminal completion', async () => {
    await seed('test_suite');
    const suite = pending<FullSuiteVerifierResult>();
    const started = events.waitFor('step_started');
    const run = conductor({ ensure: async () => suite.promise }).run();
    await started;
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(11 * 60_000);
    suite.resolve(PASS);
    await run;

    const heartbeats = recorded.filter((event) => event.type === 'step_in_flight');
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats.every((event) => event.step === 'test_suite')).toBe(true);
    const completedAt = recorded.findIndex((event) => event.type === 'step_completed' && event.step === 'test_suite');
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(recorded.slice(completedAt + 1).filter((event) => event.type === 'step_in_flight')).toEqual([]);
  });

  it.each([
    ['succeeds', { success: true }],
    ['fails', { success: false, output: 'failed fixture' }],
    ['throws', new Error('fixture throw')],
    ['is refused', { success: false, refusal: { kind: 'needs-human' as const, reason: 'fixture refusal' } }],
  ])('does not emit when a test_suite attempt %s before the first interval', async (_case, outcome) => {
    await seed('test_suite');
    const release = pending<void>();
    const subject = conductor();
    (subject as unknown as { runTestSuiteStep: () => Promise<StepRunResult> }).runTestSuiteStep =
      async () => {
        await release.promise;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      };
    const started = events.waitFor('step_started');
    const run = subject.run().catch(() => undefined);
    await started;

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    release.resolve();
    await run;
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(recorded.filter((event) => event.type === 'step_in_flight')).toEqual([]);
  });

  it('keeps build progress separate and starts test_suite heartbeats only after build settles', async () => {
    await seed('build', ['build', 'test_suite']);
    const build = pending<StepRunResult>();
    const suite = pending<FullSuiteVerifierResult>();
    const subject = conductor({
      fromStep: 'build',
      runner: { run: async (step) => step === 'build' ? build.promise : { success: true } },
      ensure: async () => suite.promise,
    });
    const buildStarted = events.waitFor('step_started');
    const suiteStarted = new Promise<void>((resolve) => events.on('step_started', (event) => {
      if (event.type === 'step_started' && event.step === 'test_suite') resolve();
    }));
    const run = subject.run();
    await buildStarted;

    await vi.advanceTimersByTimeAsync(11 * 60_000);
    build.resolve({ success: true });
    await suiteStarted;
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    suite.resolve(PASS);
    await run;

    expect(recorded.filter((event) => event.type === 'step_in_flight').every((event) => event.step === 'test_suite')).toBe(true);
    const completedBuild = recorded.findIndex((event) => event.type === 'step_completed' && event.step === 'build');
    expect(recorded.slice(completedBuild + 1).filter((event) => event.type === 'build_progress')).toEqual([]);
  });

  it('does not emit when build_progress is disabled', async () => {
    await seed('test_suite');
    const suite = pending<FullSuiteVerifierResult>();
    const started = events.waitFor('step_started');
    const run = conductor({ disabled: true, ensure: async () => suite.promise }).run();
    await started;

    await vi.advanceTimersByTimeAsync(11 * 60_000);
    suite.resolve(PASS);
    await run;
    expect(recorded.filter((event) => event.type === 'step_in_flight')).toEqual([]);
  });
});
