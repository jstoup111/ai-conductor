/**
 * Task 11: acceptance_specs reports the completion gate's terminal RED verdict.
 *
 * This is deliberately a bounded conductor test: marker validation (including
 * the remediation exception) belongs to the acceptance-red validator. The
 * conductor consumes that verdict and reports it on the event spine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const checkStepCompletionMock = vi.fn();

vi.mock('../../src/engine/artifacts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/artifacts.js')>();
  return {
    ...actual,
    checkStepCompletion: (...args: unknown[]) => checkStepCompletionMock(...args),
  };
});
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
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return { ...actual, performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }) };
});

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

async function seedOnlyAcceptanceSpecs(statePath: string): Promise<void> {
  const state: Record<string, unknown> = {
    complexity_tier: 'M',
    feature_desc: 'acceptance-red-verdict',
    track: 'technical',
  };
  for (const step of ALL_STEPS) {
    if (step.name !== 'acceptance_specs') state[step.name] = 'done';
  }
  await writeState(statePath, state as ConductState);
}

function runner(): StepRunner {
  return {
    run: async (): Promise<StepRunResult> => ({ success: true }),
    resetSession: async () => {},
  };
}

describe('Conductor.run acceptance_specs RED verdict lifecycle (Task 11)', () => {
  let root: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    checkStepCompletionMock.mockReset();
    root = await mkdtemp(join(tmpdir(), 'acceptance-red-verdict-'));
    statePath = join(root, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedOnlyAcceptanceSpecs(statePath);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function runWithVerdicts(
    preflight: Record<string, unknown>,
    verdict: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    checkStepCompletionMock
      .mockResolvedValueOnce(preflight)
      .mockResolvedValueOnce(verdict);
    const observed: Array<Record<string, unknown>> = [];
    events.on('acceptance_red', (event) => {
      observed.push(event as unknown as Record<string, unknown>);
    });
    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner(),
      events,
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'acceptance_specs',
    }).run();
    return observed;
  }

  it('emits satisfied for an accepted marker verdict', async () => {
    const events = await runWithVerdicts({ done: true }, { done: true });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'acceptance_red', state: 'satisfied', step: 'acceptance_specs', viaException: false,
    }));
  });

  it('emits rejected with the validator reason for a refused marker verdict', async () => {
    const reason = 'acceptance specs ran green; RED was not established';
    const events = await runWithVerdicts({ done: true }, { done: false, reason });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'acceptance_red', state: 'rejected', step: 'acceptance_specs', reason, viaException: false,
    }));
  });

  it('reports a validator-accepted remediation waiver as satisfied via exception', async () => {
    const events = await runWithVerdicts(
      { done: true },
      { done: true, viaException: true },
    );

    expect(events).toContainEqual(expect.objectContaining({
      type: 'acceptance_red', state: 'satisfied', step: 'acceptance_specs', viaException: true,
    }));
  });

  it('keeps a rejected gate verdict when acceptance RED emission throws', async () => {
    const reason = 'first refusal remains authoritative';
    checkStepCompletionMock
      .mockResolvedValueOnce({ done: true })
      .mockResolvedValueOnce({ done: false, reason });
    const originalEmit = events.emit.bind(events);
    events.emit = vi.fn(async (event) => {
      if (event.type === 'acceptance_red') throw new Error('telemetry unavailable');
      return originalEmit(event);
    });

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner(),
      events,
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'acceptance_specs',
    }).run();

    const state = await readState(statePath);
    expect(state.ok && state.value.acceptance_specs).toBe('failed');
  });

  it('emits every repeated rejection with its own reason', async () => {
    const firstReason = 'first distinct refusal';
    const secondReason = 'second distinct refusal';
    checkStepCompletionMock
      .mockResolvedValueOnce({ done: true })
      .mockResolvedValueOnce({ done: false, reason: firstReason })
      .mockResolvedValueOnce({ done: false, reason: secondReason });
    const observed: Array<Record<string, unknown>> = [];
    events.on('acceptance_red', (event) => {
      observed.push(event as unknown as Record<string, unknown>);
    });

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner(),
      events,
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 2,
      fromStep: 'acceptance_specs',
    }).run();

    expect(observed.filter((event) => event.state === 'rejected')).toEqual([
      expect.objectContaining({ reason: firstReason }),
      expect.objectContaining({ reason: secondReason }),
    ]);
  });
});
