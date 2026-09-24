// Covers: task:2, task:3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
vi.mock('../../src/engine/artifacts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/artifacts.js')>();
  return { ...actual, checkStepCompletion: vi.fn() };
});

import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';

const completion = vi.mocked(checkStepCompletion);
type SeenEvent = Extract<ConductorEvent, { type: 'verdict_freshness' | 'step_started' }>;
const preservable: StepName[] = [
  'manual_test',
  'prd_audit',
  'architecture_review_as_built',
  'build_review',
];

function doneState(): ConductState {
  return Object.fromEntries([
    ...ALL_STEPS.map((step) => [step.name, 'done']),
    ['complexity_tier', 'M'],
  ]) as ConductState;
}

function runner(calls: StepName[]): StepRunner {
  return {
    run: async (step) => {
      calls.push(step);
      return { success: true };
    },
    resetSession: async () => undefined,
  };
}

describe('stale judged-gate pre-dispatch preservation (#2639)', () => {
  let projectRoot: string;
  let stateFilePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'stale-gate-predispatch-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    events = new ConductorEventEmitter();
    completion.mockReset();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function runStale(step: StepName, options: { fromStep?: StepName; verifyArtifacts?: boolean } = {}) {
    const state = doneState();
    state[step] = 'stale';
    await writeState(stateFilePath, state);
    const calls: StepName[] = [];
    const seen: SeenEvent[] = [];
    events.on('verdict_freshness', (event) => { seen.push(event as SeenEvent); });
    events.on('step_started', (event) => { seen.push(event as SeenEvent); });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner(calls),
      events,
      verifyArtifacts: options.verifyArtifacts ?? true,
      fromStep: options.fromStep,
    });
    await conductor.run();
    return { calls, seen, state: JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState };
  }

  it.each(preservable)('preserves stale %s before dispatch when its predicate is done', async (step) => {
    completion.mockResolvedValue({
      done: true,
      verdictFreshness: {
        artifact: '.pipeline/prd-audit.md',
        floorSource: 'attempt',
        outcome: 'preserved_surface_miss',
        fresh: true,
      },
    });

    const result = await runStale(step);

    expect(completion).toHaveBeenCalledWith(projectRoot, step, expect.any(Object));
    expect(result.state[step]).toBe('done');
    expect(result.calls).not.toContain(step);
    expect(result.seen.filter((event) => event.step === step && event.type === 'verdict_freshness')).toEqual([
      expect.objectContaining({ outcome: 'preserved_surface_miss' }),
    ]);
    expect(result.seen.some((event) => event.step === step && event.type === 'step_started')).toBe(false);
  });

  it.each([
    ['rejects', true],
    ['is incomplete', false],
  ])('dispatches when the stale predicate %s', async (_case, rejects) => {
    completion.mockImplementation(async (_root, step) => {
      if (step !== 'prd_audit') return { done: true };
      if (rejects) throw new Error('unreadable');
      return { done: false };
    });
    const result = await runStale('prd_audit');

    expect(result.calls).toContain('prd_audit');
    expect(result.seen.some((event) => event.step === 'prd_audit' && event.type === 'step_started')).toBe(true);
  });

  it.each([
    ['failed gate', 'prd_audit', { status: 'failed' as const }],
    ['explicit --from gate', 'prd_audit', { fromStep: 'prd_audit' as StepName }],
    ['verification disabled', 'prd_audit', { verifyArtifacts: false }],
    ['unflagged stale step', 'acceptance_specs', {}],
  ])('keeps %s on the dispatch path', async (_case, step, options) => {
    completion.mockImplementation(async () => {
      return { done: true };
    });
    const state = doneState();
    state[step as StepName] = (options as { status?: ConductState[StepName] }).status ?? 'stale';
    await writeState(stateFilePath, state);
    const calls: StepName[] = [];
    const recordingRunner: StepRunner = {
      run: async (calledStep) => {
        calls.push(calledStep);
        return { success: true };
      },
      resetSession: async () => undefined,
    };
    const conductor = new Conductor({
      projectRoot, stateFilePath, stepRunner: recordingRunner, events,
      verifyArtifacts: (options as { verifyArtifacts?: boolean }).verifyArtifacts ?? true,
      fromStep: (options as { fromStep?: StepName }).fromStep,
    });
    await conductor.run();

    expect(calls).toContain(step as StepName);
  });
});
