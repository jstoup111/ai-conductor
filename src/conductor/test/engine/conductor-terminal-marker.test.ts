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
import { mkdtemp, rm, mkdir, access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// execa is consumed transitively (WorktreeManager); never fork real git.
vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor, resolveLastStep } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';

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
      complexity_tier: 'M',
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

  it('daemon: the backstop HALT reason includes resolved last step, last event, and exit index — never "unknown"', async () => {
    // Task 4: the finally backstop must wire resolveLastStep + the breadcrumb
    // into the HALT reason so operators get an actionable message instead of
    // the bare 'unknown' placeholder. The marker file and the emitted
    // loop_halt event must carry the IDENTICAL string.
    await writeState(statePath, {
      complexity_tier: 'S',
      build: 'pending',
    } as ConductState);

    let emittedReason: string | undefined;
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') emittedReason = e.reason;
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

    await conductor.run();

    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    const breadcrumb = (conductor as unknown as {
      _breadcrumb?: { lastAdvancedStep?: string; exitIndex?: number; lastEventType?: string };
    })._breadcrumb;

    expect(halt).toContain('manual_test');
    expect(halt).toContain(`last event: ${breadcrumb?.lastEventType ?? 'none'}`);
    expect(halt).toContain(`exit index: ${breadcrumb?.exitIndex ?? 'n/a'}`);
    expect(halt).not.toMatch(/unknown/);

    expect(emittedReason).toBeDefined();
    expect(emittedReason).toBe(halt.replace(/\n$/, ''));
  });

  it('daemon: with no breadcrumb and no last event, the backstop still HALTs and names the absence', async () => {
    // Task 5: when the finally backstop's diagnostics-assembly seams have
    // nothing recorded at all (fresh _breadcrumb, no event ever emitted), the
    // reason string must still name the absence explicitly rather than
    // producing a blank/garbled reason — and a marker + event must still be
    // produced.
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

    // Force the breadcrumb to look untouched by the time the finally backstop
    // runs, by clearing it out the moment the loop emits its last event
    // (gate_blocked) but before the early return unwinds into finally.
    events.on('gate_blocked', () => {
      (conductor as unknown as { _breadcrumb: Record<string, unknown> })._breadcrumb = {};
    });

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toContain('no step recorded');
    expect(halt).toContain('last event: none');
    expect(haltEvents.some((r) => r.includes('no step recorded'))).toBe(true);
  });

  it('daemon: the backstop never throws even when diagnostics assembly itself throws', async () => {
    // Task 5: if resolveLastStep/breadcrumb access throws while the finally
    // backstop is building the HALT reason, the backstop must still park the
    // run with a fixed fallback reason instead of propagating the throw
    // (which would strand the worktree with no marker at all).
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

    // Corrupt the breadcrumb into a throwing accessor right before the early
    // return unwinds into the finally backstop, so resolveLastStep(state,
    // breadcrumb) and the breadcrumb field reads inside the reason template
    // literal all throw.
    events.on('gate_blocked', () => {
      Object.defineProperty(conductor, '_breadcrumb', {
        configurable: true,
        get() {
          throw new Error('breadcrumb access boom');
        },
      });
    });

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt.trim().length).toBeGreaterThan(0);
    expect(haltEvents.length).toBeGreaterThan(0);
  });

  it('daemon: reconstructs the last step from state when no last_step/breadcrumb is set, never "unknown"', async () => {
    // Task 6: seed done progress ({ build: 'done', manual_test: 'done' }) with
    // no `last_step` recorded and no usable breadcrumb (cleared the instant
    // the loop's gate_blocked fires, mirroring the established pattern from
    // the "no breadcrumb" test above). resolveLastStep must reconstruct
    // 'manual_test' as the furthest-progressed done step in ALL_STEPS order.
    await writeState(statePath, {
      complexity_tier: 'S',
      build: 'done',
      manual_test: 'done',
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

    events.on('gate_blocked', () => {
      (conductor as unknown as { _breadcrumb: Record<string, unknown> })._breadcrumb = {};
    });

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toContain('manual_test');
    expect(halt).not.toMatch(/unknown/);
    expect(haltEvents.some((r) => r.includes('manual_test'))).toBe(true);
    expect(haltEvents.every((r) => !/unknown/.test(r))).toBe(true);
  });

  it('daemon: a fully empty state (no step keys, no last_step) still HALTs naming the absence, never "unknown"', async () => {
    // Task 6: empty-state coverage. No step keys at all, and the breadcrumb
    // cleared before the finally backstop runs (same established pattern),
    // means resolveLastStep has nothing to reconstruct from and must fall
    // back to the explicit 'no step recorded' sentinel rather than 'unknown'.
    await writeState(statePath, {
      complexity_tier: 'S',
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

    events.on('gate_blocked', () => {
      (conductor as unknown as { _breadcrumb: Record<string, unknown> })._breadcrumb = {};
    });

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toContain('no step recorded');
    expect(halt).not.toMatch(/unknown/);
    expect(haltEvents.some((r) => r.includes('no step recorded'))).toBe(true);
    expect(haltEvents.every((r) => !/unknown/.test(r))).toBe(true);
  });

  it('source: the finally backstop no longer falls back to the literal `?? \'unknown\'` for the last step', async () => {
    // Task 6: confirms the old unknown-fallback that used to name the last
    // step in the HALT reason (superseded by resolveLastStep in Task 3/4) is
    // fully gone from the backstop's reason-assembly code, not just
    // untested. Scoped to the backstop's `reason = ...` assignment rather
    // than the whole file: other, unrelated `?? 'unknown'` fallbacks exist
    // elsewhere in conductor.ts (e.g. completion-check / HEAD-sha / retry-hint
    // messages) and are out of scope for this task.
    const source = await readFile(join(process.cwd(), 'src/engine/conductor.ts'), 'utf-8');
    const marker = 'Terminal-marker guarantee (failure side).';
    const backstopStart = source.indexOf(marker);
    expect(backstopStart).toBeGreaterThan(-1);
    const backstopSnippet = source.slice(backstopStart, backstopStart + 2000);
    expect(backstopSnippet).toContain('resolveLastStep(');
    expect(backstopSnippet).not.toContain("?? 'unknown'");
  });

  it('non-daemon (interactive): a blocked-gate early return writes NO marker', async () => {
    // The same blocked-gate exit in a non-daemon run must stay markerless —
    // interactive runs don't use DONE/HALT and the daemon never reads them.
    await writeState(statePath, {
      complexity_tier: 'M',
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

  it('daemon: an escaped step-transition rejection (advanceTail throw) HALTs with the tagged error AND its stack', async () => {
    // Task 7: a rejection thrown from the step-transition seam (advanceTail)
    // used to surface as `conductor error: <message>` only — the stack trace
    // (which pinpoints which internal call actually failed) was dropped. The
    // reason written to .pipeline/HALT and emitted on loop_halt must contain
    // both the error message and its stack.
    await writeState(statePath, {
      complexity_tier: 'S',
      feature_desc: 'add foo',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'skipped',
      plan: 'done',
      architecture_diagram: 'skipped',
      architecture_review: 'skipped',
      acceptance_specs: 'skipped',
      build: 'pending',
    } as ConductState);

    const okRunner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          const evidence = await createTaskEvidence(dir);
          evidence.evidenceStamps.set('t1', { sha: '0'.repeat(40), form: 'test-stub' });
          await evidence.write();
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
          );
        }
        return { success: true, output: 'ok' };
      }),
    };

    const haltEvents: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push(e.reason);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: okRunner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'build',
      escalateBuildFailure: NOOP_ESCALATION,
    });

    const forcedError = new Error('advanceTail boom');
    vi.spyOn(conductor as unknown as { advanceTail: () => Promise<unknown> }, 'advanceTail')
      .mockRejectedValue(forcedError);

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    expect(await exists(join(dir, '.pipeline/DONE'))).toBe(false);

    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toContain('advanceTail boom');
    expect(forcedError.stack).toBeDefined();
    expect(halt).toContain((forcedError.stack as string).split('\n')[1] ?? forcedError.stack);

    expect(haltEvents.length).toBeGreaterThan(0);
    expect(haltEvents[0]).toContain('advanceTail boom');
    expect(haltEvents[0]).toContain((forcedError.stack as string).split('\n')[1] ?? forcedError.stack);
  });

  it('daemon: a non-Error step-transition rejection (advanceTail throws a string) still HALTs safely', async () => {
    // Task 8: the Task 7 tagging wrap and the outer catch's stack-preserving
    // reason-builder both dereference `.message`/`.stack`. If either ever did
    // so unconditionally (without an `instanceof Error` guard), a non-Error
    // rejection (a bare string, undefined, etc.) would throw a TypeError from
    // *inside* the error handler itself, escaping the loop with no HALT
    // marker at all. Assert the non-Error case still produces a well-formed
    // HALT and loop_halt event, with no throw escaping conductor.run().
    await writeState(statePath, {
      complexity_tier: 'S',
      feature_desc: 'add foo',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'skipped',
      plan: 'done',
      architecture_diagram: 'skipped',
      architecture_review: 'skipped',
      acceptance_specs: 'skipped',
      build: 'pending',
    } as ConductState);

    const okRunner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          const evidence = await createTaskEvidence(dir);
          evidence.evidenceStamps.set('t1', { sha: '0'.repeat(40), form: 'test-stub' });
          await evidence.write();
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
          );
        }
        return { success: true, output: 'ok' };
      }),
    };

    const haltEvents: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push(e.reason);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: okRunner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'build',
      escalateBuildFailure: NOOP_ESCALATION,
    });

    vi.spyOn(conductor as unknown as { advanceTail: () => Promise<unknown> }, 'advanceTail')
      .mockRejectedValue('transition failed');

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    expect(await exists(join(dir, '.pipeline/DONE'))).toBe(false);

    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toContain('transition failed');
    expect(halt).not.toContain('undefined');
    expect(halt).not.toMatch(/\[object Object\]/);

    expect(haltEvents.length).toBeGreaterThan(0);
    expect(haltEvents[0]).toContain('transition failed');
  });
});

describe('resolveLastStep (Task 3): pure helper, never returns "unknown"', () => {
  it('prefers the furthest-progressed done step per canonical step order when no last_step/breadcrumb', () => {
    expect(
      resolveLastStep({ build: 'done', manual_test: 'done' } as unknown as ConductState, {}),
    ).toBe('manual_test');
  });

  it('returns the literal "no step recorded" when nothing is known', () => {
    expect(resolveLastStep({} as unknown as ConductState, {})).toBe('no step recorded');
  });

  it('never returns the bare string "unknown"', () => {
    expect(resolveLastStep({} as unknown as ConductState, {})).not.toBe('unknown');
    expect(
      resolveLastStep({ build: 'done' } as unknown as ConductState, {}),
    ).not.toBe('unknown');
  });

  it('prefers state.last_step over everything else', () => {
    expect(
      resolveLastStep(
        { last_step: 'plan', build: 'done' } as unknown as ConductState,
        {},
      ),
    ).toBe('plan');
  });

  it('falls back to breadcrumb.lastAdvancedStep when state.last_step is absent', () => {
    expect(
      resolveLastStep({} as unknown as ConductState, { lastAdvancedStep: 'stories' }),
    ).toBe('stories');
  });
});

describe('conductor/resolveLastStep', () => {
  it('picks the furthest-progressed done step per canonical ALL_STEPS order', () => {
    expect(
      resolveLastStep({ build: 'done', manual_test: 'done' } as unknown as ConductState, {}),
    ).toBe('manual_test');
  });

  it('returns the literal "no step recorded" when nothing is known', () => {
    expect(resolveLastStep({} as unknown as ConductState, {})).toBe('no step recorded');
  });

  it('never returns the string "unknown"', () => {
    expect(resolveLastStep({} as unknown as ConductState, {})).not.toBe('unknown');
    expect(
      resolveLastStep({ build: 'done', manual_test: 'done' } as unknown as ConductState, {}),
    ).not.toBe('unknown');
  });

  it('prefers state.last_step over everything else', () => {
    expect(
      resolveLastStep(
        { last_step: 'plan', build: 'done' } as unknown as ConductState,
        { lastAdvancedStep: 'manual_test' },
      ),
    ).toBe('plan');
  });

  it('uses breadcrumb.lastAdvancedStep when state.last_step is absent', () => {
    expect(resolveLastStep({} as unknown as ConductState, { lastAdvancedStep: 'stories' })).toBe(
      'stories',
    );
  });
});
