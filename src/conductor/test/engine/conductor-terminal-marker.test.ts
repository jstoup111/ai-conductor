/**
 * Tests for the daemon terminal-marker guarantee in Conductor.run().
 *
 * The daemon classifies a run solely by `.pipeline/DONE` vs `.pipeline/HALT`
 * (see daemon-deps.readWorktreeOutcome). A few early `return`s in the loop —
 * a blocked gate (prerequisites unsatisfied) and a parallel-group gating
 * failure — exited WITHOUT writing either marker, so the daemon reported a
 * bare `error` and stranded the worktree ("loop ended without DONE or HALT
 * marker"). The guarantee:
 *   - failure side: a daemon run that reaches `finally` with neither marker
 *     writes a diagnostic HALT.
 *   - success side: reaching the completion path with no DONE (e.g. a resume
 *     where every step is already done) writes DONE, so a complete feature is
 *     never mis-parked by the failure backstop.
 *   - interactive (daemon:false) runs are untouched — they legitimately exit
 *     markerless and the daemon never reads their markers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, access, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// execa is consumed transitively (WorktreeManager); never fork real git.
vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';

// A runner that should never be invoked in these tests (the loop exits before
// dispatching, or runs nothing). Throws loudly if called so a misfire is caught.
const NO_DISPATCH_RUNNER: StepRunner = {
  run: vi.fn(async (step) => {
    throw new Error(`unexpected dispatch of step '${step}'`);
  }),
};

// Stub escalation so the HALT backstop's surfaceRemediationPr does no real
// git/gh work.
const NOOP_ESCALATION = async () => ({});

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('conductor/terminal-marker-guarantee', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-marker-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('daemon: a blocked-gate early return writes a diagnostic HALT (not a bare no-marker exit)', async () => {
    // manual_test's prerequisite (build) is unsatisfied → checkGate blocks and
    // the loop returns without writing a marker. The finally backstop must
    // convert that into a HALT.
    await writeState(statePath, {
      complexity_tier: 'S',
      build: 'pending',
    } as ConductState);

    const haltEvents: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push(e.reason);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: NO_DISPATCH_RUNNER,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'manual_test',
      escalateBuildFailure: NOOP_ESCALATION,
    });

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    expect(await exists(join(dir, '.pipeline/DONE'))).toBe(false);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/without a terminal verdict/);
    expect(haltEvents.some((r) => /without a terminal verdict/.test(r))).toBe(true);
  });

  it('daemon: a complete resume with no tail step run still writes DONE (success side)', async () => {
    // Every step already done → findResumeIndex starts past the end, the loop
    // body runs nothing, and advanceTail never converges to write DONE. The
    // success-side ensure must write it so the backstop does NOT park it.
    const allDone: Record<string, string> = {};
    for (const s of ALL_STEPS) allDone[s.name] = 'done';
    await writeState(statePath, allDone as unknown as ConductState);

    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: NO_DISPATCH_RUNNER,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      resume: true,
      escalateBuildFailure: NOOP_ESCALATION,
    });

    await conductor.run();

    expect(completed).toBe(true);
    expect(await exists(join(dir, '.pipeline/DONE'))).toBe(true);
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(false);
  });

  it('daemon: run-scoped breadcrumb records the last-advanced step and loop exit index', async () => {
    // Task 1 (groundwork for the HALT-message fix in Task 4/5): the run()
    // loop must track which step it last advanced into and at what index it
    // exited, on a seam observable from outside the loop. Until Task 4 wires
    // this into the finally backstop's message, we exercise the seam
    // directly via the private `_breadcrumb` field the implementation
    // stamps onto `this` for testability.
    await writeState(statePath, {
      complexity_tier: 'S',
      build: 'pending',
    } as ConductState);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: NO_DISPATCH_RUNNER,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'manual_test',
      escalateBuildFailure: NOOP_ESCALATION,
    });

    await conductor.run();

    const breadcrumb = (conductor as unknown as {
      _breadcrumb?: { lastAdvancedStep?: string; exitIndex?: number };
    })._breadcrumb;
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb?.lastAdvancedStep).toBe('manual_test');
    expect(typeof breadcrumb?.exitIndex).toBe('number');
  });

  it('daemon: run-scoped breadcrumb records the last emitted event type', async () => {
    // Task 2: the breadcrumb must also remember the `type` of the last event
    // the run loop emitted before an early return, so the finally backstop
    // (Task 4/5) can name what actually happened instead of just the step.
    // manual_test's prerequisite (build) is unsatisfied → checkGate blocks
    // and emits `gate_blocked` immediately before the loop's early return, so
    // that must be the last recorded event type.
    await writeState(statePath, {
      complexity_tier: 'S',
      build: 'pending',
    } as ConductState);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: NO_DISPATCH_RUNNER,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'manual_test',
      escalateBuildFailure: NOOP_ESCALATION,
    });

    await conductor.run();

    const breadcrumb = (conductor as unknown as {
      _breadcrumb?: { lastEventType?: string };
    })._breadcrumb;
    expect(breadcrumb?.lastEventType).toBe('gate_blocked');
  });

  it('non-daemon (interactive): a blocked-gate early return writes NO marker', async () => {
    // The same blocked-gate exit in a non-daemon run must stay markerless —
    // interactive runs don't use DONE/HALT and the daemon never reads them.
    await writeState(statePath, {
      complexity_tier: 'S',
      build: 'pending',
    } as ConductState);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: NO_DISPATCH_RUNNER,
      events,
      projectRoot: dir,
      mode: 'default',
      daemon: false,
      verifyArtifacts: true,
      fromStep: 'manual_test',
    });

    await conductor.run();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(false);
    expect(await exists(join(dir, '.pipeline/DONE'))).toBe(false);
  });
});
