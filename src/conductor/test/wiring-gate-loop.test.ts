/**
 * Task 10: wiring_check joins the gate-loop tail end-to-end.
 *
 * `wiring_check` was registered in ALL_STEPS with `manual_test.prerequisites:
 * ['wiring_check']` (Task 6) and got a completion predicate in
 * CUSTOM_COMPLETION_PREDICATES.wiring_check (Task 9). This file proves the
 * selector/tail loop actually HONORS that topology:
 *   - an unsatisfied wiring_check verdict blocks manual_test from being
 *     selected next (selector level);
 *   - a satisfied verdict unblocks manual_test (selector level);
 *   - a wiring gap kicks back to build WITHOUT ever writing .pipeline/HALT —
 *     kickback only, never an unconditional halt (conductor level, real
 *     Conductor run, daemon:true so the wiring_check kickback block engages,
 *     mirroring the existing build_review kickback path);
 *   - exceeding MAX_KICKBACKS_PER_GATE for wiring_check engages the SAME
 *     stall-escalation / HALT mechanism the other self-heal loops use
 *     (kickbackCounts cap in conductor.ts, MAX_KICKBACKS_PER_GATE = 2);
 *   - a state dir whose manual_test verdict predates wiring_check (topology
 *     from before this feature existed) re-derives topology without crashing
 *     — a migration/backward-compat check at the selector level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, access, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState, StepName } from '../src/types/index.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import {
  selectNextGate,
  earliestUnsatisfiedGateIndex,
  type SelectorInput,
} from '../src/engine/selector.js';
import type { GateVerdict } from '../src/engine/gate-verdicts.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { readState, writeState } from '../src/engine/state.js';
import { Conductor } from '../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../src/engine/conductor.js';
import { checkStepCompletion } from '../src/engine/artifacts.js';
import type { WiringEvidence } from '../src/engine/artifacts.js';

function frontDone(): ConductState {
  return {
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
  };
}

function input(
  state: ConductState,
  verdicts: Partial<Record<StepName, GateVerdict>> = {},
  regionStart: StepName = 'build',
): SelectorInput {
  return { steps: ALL_STEPS, state, verdicts, regionStart };
}

const VSAT: GateVerdict = { satisfied: true, checkedAt: 1 };
const VUNSAT: GateVerdict = { satisfied: false, checkedAt: 1, reason: 'wiring gap' };

describe('selector — wiring_check gates the build_review -> manual_test seam', () => {
  it('an unsatisfied wiring_check verdict blocks manual_test from being selected next', () => {
    const state: ConductState = {
      ...frontDone(),
      build: 'done',
      build_review: 'done',
      wiring_check: 'pending',
      manual_test: 'pending',
    };
    const d = selectNextGate(
      input(state, { build: VSAT, build_review: VSAT, wiring_check: VUNSAT }),
    );
    expect(d.kind).toBe('run');
    if (d.kind === 'run') {
      expect(d.step).toBe('wiring_check');
      expect(d.step).not.toBe('manual_test');
    }
  });

  it('a satisfied wiring_check verdict unblocks manual_test', () => {
    const state: ConductState = {
      ...frontDone(),
      // M tier: S-tier legitimately skips manual_test (D5), which would
      // make wiring_check's downstream neighbor prd_audit, not manual_test —
      // defeating the point of this test (proving wiring_check unblocks
      // manual_test specifically).
      complexity_tier: 'M',
      build: 'done',
      build_review: 'done',
      wiring_check: 'done',
      manual_test: 'pending',
    };
    const d = selectNextGate(
      input(state, { build: VSAT, build_review: VSAT, wiring_check: VSAT }),
    );
    expect(d.kind).toBe('run');
    if (d.kind === 'run') {
      expect(d.step).toBe('manual_test');
    }
  });

  it('a state dir whose manual_test predates wiring_check re-derives topology without crashing', () => {
    // Pre-feature topology: manual_test already 'done' (satisfied under the
    // OLD prerequisites: ['build_review']), but wiring_check never existed in
    // that run, so it's absent from state entirely (undefined, not
    // 'pending' — that's the exact shape a pre-migration state.json has).
    const state: ConductState = {
      ...frontDone(),
      build: 'done',
      build_review: 'done',
      manual_test: 'done',
      // wiring_check: intentionally absent
    };
    expect(() => earliestUnsatisfiedGateIndex(input(state, {}))).not.toThrow();
    const idx = earliestUnsatisfiedGateIndex(input(state, {}));
    const wiringIdx = ALL_STEPS.findIndex((s) => s.name === 'wiring_check');
    // The selector re-derives topology from current ALL_STEPS: an absent
    // wiring_check status defaults to 'pending' (getStepStatus fallback), so
    // it's the earliest unsatisfied gate — manual_test's old 'done' doesn't
    // let it slip through, because gateSatisfied is evaluated per-step, and
    // wiring_check strictly precedes manual_test in the resolved order.
    expect(idx).toBe(wiringIdx);
  });
});

describe('conductor — wiring_check kickback is kickback-only, never an unconditional HALT', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiring-gate-loop-'));
    // The `finish` completion predicate reads pr_url from the hardcoded
    // `.pipeline/conduct-state.json` path, so the engine's own state file
    // must live there for a daemon-mode run to converge past `finish`.
    statePath = join(dir, '.pipeline/conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
      );
    } else if (step === 'build_review') {
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { tautology: false, scope: false, rootCause: false },
        }),
      );
    } else if (step === 'wiring_check') {
      await writeFile(
        join(dir, '.pipeline/wiring-evidence.json'),
        JSON.stringify({
          schema: 1,
          base: 'base',
          head: 'head',
          layer2: { applicable: false },
          waivers: [],
          tasks: [{ id: 't1', contract: 'none (no new production surface)', gaps: [] }],
        }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'finish') {
      // Daemon mode only converges finish on choice='pr' with a recorded
      // pr_url — merge it into the engine's own state file so the finish
      // predicate (which reads `.pipeline/conduct-state.json` directly)
      // finds it.
      const current = await readState(statePath);
      const merged = { ...(current.ok ? current.value : {}), pr_url: 'https://example.com/pr/1' };
      await writeState(statePath, merged);
      await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');
    }
    return { success: true };
  }

  // Fake git runner so the finish predicate's push-evidence check
  // (headPushedToUpstream) resolves `true` instead of indeterminate (there's
  // no real git repo in the tmpdir fixture) — otherwise finish can never
  // converge in daemon mode and the run halts for reasons unrelated to
  // wiring_check, contaminating the "no HALT" assertion.
  const fakeGit = async (args: string[]): Promise<{ stdout: string }> => {
    if (args[0] === 'rev-parse' && args.includes('@{u}')) {
      return { stdout: 'refs/remotes/origin/main' };
    }
    if (args[0] === 'merge-base') {
      return { stdout: '' };
    }
    return { stdout: '' };
  };

  function makeConductor(runner: StepRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      daemon: true,
      config: { build_review: { enabled: true } },
      git: fakeGit,
    });
  }

  it('a wiring gap kicks back to build with NO .pipeline/HALT written', async () => {
    // technical track: skips prd_audit (no PRD to audit) so this test
    // isolates the wiring_check kickback behavior from unrelated SHIP-tail
    // gates that would otherwise HALT for reasons that have nothing to do
    // with wiring_check.
    await writeState(statePath, { ...frontDone(), track: 'technical' });
    let wiringRuns = 0;
    const kicks: Array<{ from: string; to: string }> = [];
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'wiring_check') {
          wiringRuns++;
          // First attempt: write gap-carrying evidence (unresolved gap).
          // Second+ attempt (after the build kickback): satisfy cleanly.
          if (wiringRuns === 1) {
            await writeFile(
              join(dir, '.pipeline/wiring-evidence.json'),
              JSON.stringify({
                schema: 1,
                base: 'base',
                head: 'head',
                layer2: { applicable: false },
                waivers: [],
                tasks: [
                  {
                    id: 't1',
                    contract: 'src/x.ts#foo',
                    gaps: [{ kind: 'orphan-export', message: 'foo unreachable' }],
                  },
                ],
              }),
            );
            return { success: true };
          }
          return satisfy('wiring_check');
        }
        return satisfy(step);
      },
    };

    await makeConductor(runner).run();

    expect(wiringRuns).toBeGreaterThan(0);
    expect(kicks).toContainEqual({ from: 'wiring_check', to: 'build' });
    await expect(access(join(dir, '.pipeline/HALT'))).rejects.toThrow();
  });

  it('exceeding MAX_KICKBACKS_PER_GATE for wiring_check engages the existing stall-escalation HALT', async () => {
    await writeState(statePath, { ...frontDone(), track: 'technical' });
    const kicks: Array<{ from: string; to: string }> = [];
    let halted = false;
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });
    events.on('loop_halt', () => {
      halted = true;
    });
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'wiring_check') {
          // ALWAYS write a gap — the gate never satisfies, forcing the
          // kickback to re-fire past MAX_KICKBACKS_PER_GATE.
          await writeFile(
            join(dir, '.pipeline/wiring-evidence.json'),
            JSON.stringify({
              schema: 1,
              base: 'base',
              head: 'head',
              layer2: { applicable: false },
              waivers: [],
              tasks: [
                {
                  id: 't1',
                  contract: 'src/x.ts#foo',
                  gaps: [{ kind: 'orphan-export', message: 'foo unreachable' }],
                },
              ],
            }),
          );
          return { success: true };
        }
        return satisfy(step);
      },
    };

    await makeConductor(runner).run();

    // The SAME cap (MAX_KICKBACKS_PER_GATE = 2) build_review's kickback path
    // uses: after the cap is exceeded the loop halts via the shared
    // LOOP_HALT_MARKER ('.pipeline/HALT'), same mechanism as every other
    // self-heal loop, not a bespoke wiring_check-only halt.
    expect(kicks.filter((k) => k.from === 'wiring_check' && k.to === 'build').length).toBeGreaterThan(0);
    expect(halted).toBe(true);
    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
  });
});

describe('wiring_check predicate — live probe invocation via ctx.wiringProbe (Task 18)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiring-gate-loop-probe-'));
    // Intentionally do NOT pre-create .pipeline/ — the predicate must
    // ensure-dir before writing evidence when no pre-existing fixture exists.
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('invokes the injected probe, writes .pipeline/wiring-evidence.json (creating .pipeline/ first), and reports satisfied when the probe finds zero gaps', async () => {
    const evidence: WiringEvidence = {
      schema: 1,
      base: 'base',
      head: 'head',
      layer2: { applicable: false },
      waivers: [],
      tasks: [{ id: 't1', contract: 'none (no new production surface)', gaps: [] }],
    };
    let probeCalls = 0;
    const result = await checkStepCompletion(dir, 'wiring_check', {
      getHeadSha: async () => 'head',
      wiringProbe: async () => {
        probeCalls++;
        return evidence;
      },
    });

    expect(probeCalls).toBe(1);
    expect(result.done).toBe(true);

    const written = await readFile(join(dir, '.pipeline/wiring-evidence.json'), 'utf-8');
    expect(JSON.parse(written)).toEqual(evidence);
  });

  it('invokes the injected probe and reports unsatisfied with the gap message when the probe finds a real gap', async () => {
    const evidence: WiringEvidence = {
      schema: 1,
      base: 'base',
      head: 'head',
      layer2: { applicable: false },
      waivers: [],
      tasks: [
        {
          id: 't1',
          contract: 'src/x.ts#foo',
          gaps: [{ kind: 'orphan-export', message: 'foo unreachable' }],
        },
      ],
    };
    const result = await checkStepCompletion(dir, 'wiring_check', {
      getHeadSha: async () => 'head',
      wiringProbe: async () => evidence,
    });

    expect(result.done).toBe(false);
    expect(result.reason).toContain('foo unreachable');

    const written = await readFile(join(dir, '.pipeline/wiring-evidence.json'), 'utf-8');
    expect(JSON.parse(written)).toEqual(evidence);
  });

  it('does not invoke the probe when a pre-existing fresh evidence file is already present', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: 'base',
        head: 'head',
        layer2: { applicable: false },
        waivers: [],
        tasks: [{ id: 't1', contract: 'none (no new production surface)', gaps: [] }],
      }),
    );
    let probeCalls = 0;
    const result = await checkStepCompletion(dir, 'wiring_check', {
      getHeadSha: async () => 'head',
      wiringProbe: async () => {
        probeCalls++;
        throw new Error('should not be called');
      },
    });

    expect(probeCalls).toBe(0);
    expect(result.done).toBe(true);
  });
});
