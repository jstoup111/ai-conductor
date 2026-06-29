/**
 * Tests for the daemon-halt escalation wiring in Conductor.run().
 *
 * Cases:
 *   C1    — escalation that THROWS must not prevent HALT/state write or run() resolution.
 *   Happy — escalation success; called with right args; prUrl threads into loop_halt event.
 *   FR-8  — non-auto mode build failure does NOT invoke escalation.
 *   Guard — auto mode failure on any gating step (not just build) DOES invoke escalation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// execa is consumed transitively (WorktreeManager). Mock it so the engine
// never forks real git processes even if featureDesc were set.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState } from '../../src/engine/state.js';
import {
  Conductor,
} from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName } from '../../src/types/index.js';
import type { EscalateBuildFailureOpts, EscalateBuildFailureResult } from '../../src/engine/build-failure-escalation.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Step runner that fails exactly one step and succeeds all others. */
function makeRunner(failStep: StepName): StepRunner {
  return {
    run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
      if (step === failStep) return { success: false, output: `${failStep} blew up` };
      return { success: true };
    }),
  };
}

type FakeEscalation = (
  opts: EscalateBuildFailureOpts,
) => Promise<EscalateBuildFailureResult>;

// ── suite ────────────────────────────────────────────────────────────────────

describe('conductor/build-escalation', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-esc-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── C1: throwing escalation must not prevent HALT/state/resolve ─────────────

  it('C1: escalation that throws still writes HALT, state, and run() resolves', async () => {
    const throwingEscalation = vi.fn<FakeEscalation>().mockRejectedValue(
      new Error('gh exploded'),
    );
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeRunner('build'),
      events,
      projectRoot: dir,
      mode: 'auto',
      maxRetries: 1,
      escalateBuildFailure: throwingEscalation,
    });

    // run() must resolve (not throw) even though escalation throws.
    await expect(conductor.run()).resolves.toBeUndefined();

    // HALT marker must have been written with the step name in the reason.
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/build/);
    expect(halt).toMatch(/auto mode/);

    // State must have been written — build should be 'failed'.
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['build']).toBe('failed');
      // Feature did not complete.
      expect(result.value.feature_status).toBeUndefined();
    }
  });

  // ── Happy path: prUrl flows from escalation into loop_halt event ─────────────

  it('happy: escalation called with correct args; prUrl appears on loop_halt event', async () => {
    const fakePrUrl = 'https://github.com/test/repo/pull/99';
    const fakeEscalation = vi.fn<FakeEscalation>().mockResolvedValue({ prUrl: fakePrUrl });

    const haltEvents: Array<{ reason: string; prUrl?: string }> = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason, prUrl: e.prUrl });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeRunner('build'),
      events,
      projectRoot: dir,
      mode: 'auto',
      maxRetries: 1,
      escalateBuildFailure: fakeEscalation,
    });

    await conductor.run();

    // Escalation called exactly once.
    expect(fakeEscalation).toHaveBeenCalledOnce();

    // Called with the right projectRoot.
    const callArgs = fakeEscalation.mock.calls[0][0];
    expect(callArgs.projectRoot).toBe(dir);

    // failureReason contains the auto-mode reason string and the step's error output.
    expect(callArgs.failureReason).toContain("step 'build' failed in auto mode");
    expect(callArgs.failureReason).toContain('build blew up');

    // loop_halt event carries the prUrl.
    expect(haltEvents).toHaveLength(1);
    expect(haltEvents[0].prUrl).toBe(fakePrUrl);
  });

  // ── FR-8: non-auto mode must not invoke escalation ─────────────────────────

  it('FR-8: mode=default build failure does NOT call escalateBuildFailure', async () => {
    const fakeEscalation = vi.fn<FakeEscalation>().mockResolvedValue({
      prUrl: 'https://github.com/test/repo/pull/1',
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeRunner('build'),
      events,
      projectRoot: dir,
      mode: 'default', // NOT auto
      maxRetries: 1,
      escalateBuildFailure: fakeEscalation,
    });

    await conductor.run();

    expect(fakeEscalation).not.toHaveBeenCalled();
  });

  // ── Guard: ALL gating steps trigger escalation in auto mode, not just build ─

  it('guard: auto mode failure on a non-build gating step DOES call escalateBuildFailure', async () => {
    const fakePrUrl = 'https://github.com/test/repo/pull/2';
    const fakeEscalation = vi.fn<FakeEscalation>().mockResolvedValue({ prUrl: fakePrUrl });

    const haltEvents: Array<{ reason: string; prUrl?: string }> = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason, prUrl: e.prUrl });
    });

    // 'plan' is a gating step — it falls into the auto hard-failure block.
    // With the build guard removed, escalation must fire for ALL gating steps.
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeRunner('plan'),
      events,
      projectRoot: dir,
      mode: 'auto',
      maxRetries: 1,
      escalateBuildFailure: fakeEscalation,
    });

    await conductor.run();

    // Escalation MUST be called for non-build gating steps in auto mode.
    expect(fakeEscalation).toHaveBeenCalledOnce();

    // HALT marker written (confirming the hard-failure path ran for plan).
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/plan/);
    expect(halt).toMatch(/auto mode/);

    // prUrl must thread into the loop_halt event.
    expect(haltEvents).toHaveLength(1);
    expect(haltEvents[0].prUrl).toBe(fakePrUrl);
  });
});
