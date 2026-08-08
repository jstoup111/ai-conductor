/**
 * A step that writes its OWN `needs-human` HALT must stop the run, not be retried.
 *
 * Observed 2026-08-08 on feature `finish-s-stop-gate-does-not-stop-a-correct-refusal`:
 * the `acceptance_specs` agent determined the accepted DECIDE artifacts contradict a
 * merged commit, correctly refused to author any specs, and wrote `.pipeline/HALT`
 * (+ `.pipeline/HALT.class` = `needs-human`). The provider call was scored a success,
 * the completion contract then missed on `.pipeline/acceptance-specs-red.json`, and the
 * engine started `retry (try 2/3)` — re-dispatching the identical, unresolvable
 * contradiction and burying the agent's own reason under a generic contract miss.
 *
 * The engine's own dispatch-boundary HALT handling never consulted a marker written
 * mid-step by the step itself: `.pipeline/HALT` was read at only one point inside the
 * retry loop (the self-build credentials preflight, conductor.ts ~5782). The build
 * step's stall breaker reads a DIFFERENT marker (`.pipeline/halt-user-input-required`).
 *
 * Staleness is the load-bearing risk: `.pipeline/HALT` persists across steps and runs,
 * so halting on a leftover marker would be worse than the bug. Freshness is established
 * by snapshotting the marker's identity (presence + mtime + size) immediately before the
 * attempt is dispatched and requiring it to have appeared or changed. The check fails
 * SAFE — an indistinguishable marker is treated as stale and the run retries exactly as
 * it does today.
 *
 * Driven through the real `Conductor.run()` retry loop with a faithful fake at the
 * provider boundary (an injected `StepRunner`); no LLM, no network, real temp dirs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
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
import {
  HALT_MARKER,
  writeHaltMarker,
  snapshotHaltMarker,
  readStepWrittenHaltReason,
} from '../../src/engine/halt-marker.js';

/** The refusal the real acceptance_specs agent wrote, trimmed to its first lines. */
const REFUSAL_HALT_BODY =
  'The accepted DECIDE artifacts contradict merged commit 5bbc109e8 (#1372).\n' +
  'No acceptance spec can honestly be authored against them.\n' +
  'Required recovery: return to DECIDE and amend architecture, stories, conflict check,\n' +
  'plan, and coherence mapping.\n';

/**
 * Seeds every step 'done' EXCEPT `target`, so a run started at `target` settles
 * as soon as `target` resolves rather than continuing into later gates.
 */
async function seedAllDoneExcept(statePath: string, target: StepName): Promise<void> {
  const res = await readState(statePath);
  const state = (res.ok ? res.value : {}) as Record<string, unknown>;
  for (const s of ALL_STEPS) {
    if (s.name !== target) state[s.name] = 'done';
  }
  state.complexity_tier = 'M';
  state.feature_desc = 'step-written-halt';
  state.track = 'technical';
  await writeState(statePath, state as unknown as ConductState);
}

describe('a step that writes its own needs-human HALT is not retried', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'step-written-halt-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedAllDoneExcept(statePath, 'acceptance_specs');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * `onDispatch` stands in for the provider: it runs inside the dispatch, exactly
   * where a step's agent would write its markers. The step always reports success —
   * as codex did — so the completion contract is what misses (no spec files, no RED
   * evidence), which is the retry decision point under test.
   */
  function runConductor(onDispatch?: (step: StepName) => Promise<void>) {
    const dispatched: StepName[] = [];
    const retries: Array<{ step: StepName; reason: string }> = [];
    const halts: string[] = [];

    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        dispatched.push(step);
        await onDispatch?.(step);
        return { success: true };
      },
      resetSession: async () => {},
    };

    events.on('step_retry', (e) => {
      if (e.type === 'step_retry') retries.push({ step: e.step as StepName, reason: e.reason });
    });
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') halts.push(e.reason);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fromStep: 'acceptance_specs',
    });
    return { conductor, dispatched, retries, halts };
  }

  const acceptanceSpecsOf = (steps: StepName[]): StepName[] =>
    steps.filter((s) => s === 'acceptance_specs');

  it('halts on the step\'s own reason instead of consuming a retry', async () => {
    const { conductor, dispatched, retries, halts } = runConductor(async (step) => {
      if (step === 'acceptance_specs') {
        await writeHaltMarker(dir, REFUSAL_HALT_BODY, 'needs-human');
      }
    });

    await conductor.run();

    // Dispatched once. The old behavior burned all three attempts on the same
    // unresolvable contradiction.
    expect(acceptanceSpecsOf(dispatched)).toHaveLength(1);
    expect(retries.filter((r) => r.step === 'acceptance_specs')).toEqual([]);

    // The agent's own reason reaches the operator — not "acceptance-specs-red.json
    // is missing", and not "retries exhausted".
    expect(halts).toHaveLength(1);
    expect(halts[0]).toContain('contradict merged commit 5bbc109e8');
    expect(halts[0]).not.toContain('acceptance-specs-red.json');

    // The marker the step wrote is left exactly as written.
    expect(await readFile(join(dir, HALT_MARKER), 'utf-8')).toBe(REFUSAL_HALT_BODY);
    expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).not.toBe('done');
  });

  it('still retries a completion-contract miss when no halt marker is written', async () => {
    const { conductor, dispatched, retries } = runConductor();

    await conductor.run();

    // Unchanged from today: the full budget is spent on the failing contract.
    expect(acceptanceSpecsOf(dispatched)).toHaveLength(3);
    expect(retries.filter((r) => r.step === 'acceptance_specs')).toHaveLength(2);
  });

  it('ignores a stale needs-human HALT left by an earlier step and still retries', async () => {
    // A leftover marker from an unrelated earlier step/run. Nothing in this run
    // touches it, so it must not suppress a legitimate retry.
    await writeHaltMarker(dir, 'an earlier, unrelated step parked this feature\n', 'needs-human');

    const { conductor, dispatched, retries } = runConductor();

    await conductor.run();

    expect(acceptanceSpecsOf(dispatched)).toHaveLength(3);
    expect(retries.filter((r) => r.step === 'acceptance_specs')).toHaveLength(2);
  });

  it('ignores a HALT whose class is not needs-human', async () => {
    const { conductor, dispatched, retries } = runConductor(async (step) => {
      if (step === 'acceptance_specs') {
        await writeHaltMarker(dir, 'transient infrastructure blip\n', 'mechanical');
      }
    });

    await conductor.run();

    expect(acceptanceSpecsOf(dispatched)).toHaveLength(3);
    expect(retries.filter((r) => r.step === 'acceptance_specs')).toHaveLength(2);
  });
});

describe('readStepWrittenHaltReason — freshness against a pre-attempt snapshot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'halt-freshness-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the body of a needs-human HALT that appeared after the snapshot', async () => {
    const before = await snapshotHaltMarker(dir);
    expect(before.present).toBe(false);

    await writeHaltMarker(dir, REFUSAL_HALT_BODY, 'needs-human');

    expect(await readStepWrittenHaltReason(dir, before)).toBe(REFUSAL_HALT_BODY.trim());
  });

  it('returns null for an unchanged marker that predates the snapshot', async () => {
    await writeHaltMarker(dir, 'stale halt from an earlier step\n', 'needs-human');
    const before = await snapshotHaltMarker(dir);
    expect(before.present).toBe(true);

    expect(await readStepWrittenHaltReason(dir, before)).toBeNull();
  });

  it('returns the new body when a pre-existing marker is REWRITTEN during the attempt', async () => {
    await writeHaltMarker(dir, 'stale halt from an earlier step\n', 'needs-human');
    const before = await snapshotHaltMarker(dir);

    await writeHaltMarker(dir, REFUSAL_HALT_BODY, 'needs-human');

    expect(await readStepWrittenHaltReason(dir, before)).toBe(REFUSAL_HALT_BODY.trim());
  });

  it('returns null when the marker is absent, mis-classed, or empty', async () => {
    const before = await snapshotHaltMarker(dir);

    expect(await readStepWrittenHaltReason(dir, before)).toBeNull();

    await writeHaltMarker(dir, 'mechanical reason\n', 'mechanical');
    expect(await readStepWrittenHaltReason(dir, before)).toBeNull();

    await writeHaltMarker(dir, '   \n', 'needs-human');
    expect(await readStepWrittenHaltReason(dir, before)).toBeNull();

    // No sidecar at all (a legacy marker) is not a needs-human halt either.
    await writeFile(join(dir, HALT_MARKER), 'legacy body\n', 'utf-8');
    await rm(join(dir, '.pipeline/HALT.class'), { force: true });
    expect(await readStepWrittenHaltReason(dir, before)).toBeNull();
  });
});
