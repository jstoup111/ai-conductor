/**
 * Task 9 (acceptance-specs-halts-when-the-red-evidence-marke plan): wires
 * `selfHealAcceptanceRed` into `Conductor.run`'s acceptance_specs step path.
 *
 * This is a narrow engine-level unit test that mocks
 * `../../src/engine/acceptance-red-runner.js` entirely, asserting only the
 * CALL-SITE contract: on an acceptance_specs completion-gate miss that names
 * the missing/invalid RED marker WITH spec files present, `Conductor.run`
 * invokes `selfHealAcceptanceRed` exactly once, BEFORE the retry budget is
 * spent (no `step_retry` event, no dispatch of the acceptance_specs skill),
 * and a heal success advances the step to 'done'. The full cross-module
 * flow (real contract parsing, real exec, HALT text) is covered by
 * test/acceptance/acceptance-specs-red-evidence.acceptance.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const selfHealAcceptanceRedMock = vi.fn();

vi.mock('../../src/engine/acceptance-red-runner.js', () => ({
  selfHealAcceptanceRed: (...args: unknown[]) => selfHealAcceptanceRedMock(...args),
}));
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

import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';

function trackingRunner(): { runner: StepRunner; log: string[] } {
  const log: string[] = [];
  const runner: StepRunner = {
    run: async (step: StepName): Promise<StepRunResult> => {
      log.push(`run:${step}`);
      return { success: true };
    },
    resetSession: async () => {
      log.push('reset');
    },
  };
  return { runner, log };
}

// Seeds every step 'done' EXCEPT `target`, so `Conductor.run()` starting
// from `target` (via `fromStep`) settles the moment `target` itself
// resolves, rather than continuing on into later steps (build, etc.) whose
// own gates/halts are irrelevant to this call-site test.
async function seedAllDoneExcept(statePath: string, target: StepName): Promise<void> {
  const res = await readState(statePath);
  const state = (res.ok ? res.value : {}) as Record<string, unknown>;
  for (const s of ALL_STEPS) {
    if (s.name !== target) state[s.name] = 'done';
  }
  state.complexity_tier = 'M';
  state.feature_desc = 'feat-741-t9';
  state.track = 'technical';
  await writeState(statePath, state as unknown as ConductState);
}

describe('Conductor.run acceptance_specs self-heal call site (Task 9)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    selfHealAcceptanceRedMock.mockReset();
    dir = await mkdtemp(join(tmpdir(), 'acceptance-red-callsite-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedAllDoneExcept(statePath, 'acceptance_specs');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, 'test', 'acceptance'), { recursive: true });
    await writeFile(join(dir, 'test', 'acceptance', 'feature.acceptance.test.ts'), '// spec\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function runConductor() {
    const { runner, log } = trackingRunner();
    const reasons: string[] = [];
    let haltReason: string | undefined;
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry') reasons.push(e.reason);
    });
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltReason = e.reason;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'acceptance_specs',
    });
    return { conductor, log, reasons, getHaltReason: () => haltReason };
  }

  it('invokes selfHealAcceptanceRed exactly once, before the retry budget is spent, and advances the step on heal success', async () => {
    // No run contract / marker on disk — the completion gate misses with the
    // "marker is missing" reason and committed spec files are present, which
    // is exactly the condition the self-heal call site must fire on.
    selfHealAcceptanceRedMock.mockResolvedValue({ healed: true });

    const { conductor, log, reasons, getHaltReason } = runConductor();
    await conductor.run();

    expect(selfHealAcceptanceRedMock).toHaveBeenCalledTimes(1);

    // Fired BEFORE the retry budget was spent: the acceptance_specs skill was
    // never dispatched, and no step_retry/loop_halt fired for this step.
    expect(log).not.toContain('run:acceptance_specs');
    expect(reasons).toEqual([]);
    expect(getHaltReason()).toBeUndefined();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).toBe('done');
  });

  it('falls through to the existing retry/HALT behavior unchanged when the heal fails', async () => {
    selfHealAcceptanceRedMock.mockResolvedValue({ healed: false, reason: 'run contract missing: x' });

    const { conductor, log, reasons } = runConductor();
    await conductor.run();

    expect(selfHealAcceptanceRedMock).toHaveBeenCalledTimes(1);

    // Heal failed — falls through to the normal dispatch/retry path, so the
    // acceptance_specs skill IS dispatched (maxRetries: 1 exhausts after one
    // attempt).
    expect(log).toContain('run:acceptance_specs');

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).not.toBe('done');
  });
});
