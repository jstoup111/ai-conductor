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
 *   - a real Conductor run dispatches build_review, wiring_check, test_suite,
 *     then manual_test in that order (runtime registry/composition boundary);
 *   - a wiring gap kicks back to build WITHOUT ever writing .pipeline/HALT —
 *     kickback only, never an unconditional halt (conductor level, real
 *     Conductor runs across distinct daemon and non-daemon execution
 *     boundaries);
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
import { readHaltClass } from '../src/engine/halt-marker.js';

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

describe('selector — the deterministic BUILD verification group gates build_review', () => {
  it.each([
    { staleGate: 'wiring_check' as const },
    { staleGate: 'test_suite' as const },
  ])('an unsatisfied $staleGate verdict blocks build_review', ({ staleGate }) => {
    const state: ConductState = {
      ...frontDone(),
      build: 'done',
      wiring_check: staleGate === 'wiring_check' ? 'stale' : 'done',
      test_suite: staleGate === 'test_suite' ? 'stale' : 'done',
      build_review: 'pending',
      manual_test: 'pending',
    };
    const verdicts = {
      build: VSAT,
      wiring_check: staleGate === 'wiring_check' ? VUNSAT : VSAT,
      test_suite: staleGate === 'test_suite' ? VUNSAT : VSAT,
    };
    const d = selectNextGate(
      input(state, verdicts),
    );
    expect(d.kind).toBe('run');
    if (d.kind === 'run') {
      expect(d.step).toBe(staleGate);
      expect(d.step).not.toBe('build_review');
    }
  });

  it('current wiring_check and test_suite proofs unblock build_review', () => {
    const state: ConductState = {
      ...frontDone(),
      complexity_tier: 'M',
      build: 'done',
      wiring_check: 'done',
      test_suite: 'done',
      build_review: 'pending',
      manual_test: 'pending',
    };
    const d = selectNextGate(
      input(state, { build: VSAT, wiring_check: VSAT, test_suite: VSAT }),
    );
    expect(d.kind).toBe('run');
    if (d.kind === 'run') {
      expect(d.step).toBe('build_review');
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
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(dir, '.ai-conductor/config.yml'),
      'test_suite:\n  command: true\n  working_directory: .\n  timeout_seconds: 10\n',
    );
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

  function makeConductor(
    runner: StepRunner,
    daemon = true,
    onFullSuiteEnsure?: () => void,
    config: Record<string, unknown> = {},
    eventEmitter: ConductorEventEmitter = events,
    fromStep: StepName = 'build',
  ): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: eventEmitter,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep,
      maxRetries: 1,
      daemon,
      config: { build_review: { enabled: true }, ...config },
      git: fakeGit,
      shipmentEvidence: async (input) => ({
        kind: 'valid',
        slug: input.slug,
        pr: input.implementationPr,
        recordPath: `.docs/shipped/${input.slug}.md`,
        hash: 'fixture-hash',
        commit: input.candidateCommit,
      }),
      fullSuiteVerifier: {
        ensure: async () => {
          onFullSuiteEnsure?.();
          return { status: 'REUSED', evidence: {} as never };
        },
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    });
  }

  it('joins wiring_check and test_suite before build_review, then enters SHIP', async () => {
    await writeState(statePath, {
      ...frontDone(),
      complexity_tier: 'M',
      track: 'technical',
      coherence_check: 'done',
    });
    const ran: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        return satisfy(step);
      },
    };

    await makeConductor(runner, true, () => ran.push('test_suite')).run();

    const reviewIdx = ran.indexOf('build_review');
    const wiringIdx = ran.indexOf('wiring_check');
    const testSuiteIdx = ran.indexOf('test_suite');
    const manualIdx = ran.indexOf('manual_test');
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(wiringIdx).toBeGreaterThan(-1);
    expect(testSuiteIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(wiringIdx);
    expect(reviewIdx).toBeGreaterThan(testSuiteIdx);
    expect(manualIdx).toBeGreaterThan(reviewIdx);
  });

  it.each([
    { executionBoundary: 'daemon', daemon: true },
    { executionBoundary: 'non-daemon', daemon: false },
  ])(
    '$executionBoundary execution boundary: objective wiring-gap evidence kicks back to build with NO .pipeline/HALT written',
    async ({ daemon }) => {
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

      await makeConductor(runner, daemon).run();

      expect(wiringRuns).toBeGreaterThan(0);
      expect(kicks).toContainEqual({ from: 'wiring_check', to: 'build' });
      await expect(access(join(dir, '.pipeline/HALT'))).rejects.toThrow();
    },
  );

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

  it('keeps the wiring_check D2 check before its budget consumption and captures its baseline before navigateBack', async () => {
    const source = await readFile(join(process.cwd(), 'src/engine/conductor.ts'), 'utf8');
    const wiringBlock = source.slice(
      source.indexOf("if (step.name === 'wiring_check')"),
      source.indexOf('// Task 8: Stall remediation'),
    );

    const checkIndex = wiringBlock.indexOf("checkKickbackToBuildEscalation('wiring_check')");
    const budgetIndex = wiringBlock.indexOf("consumeKickbackBudget('wiring_check'");
    const captureIndex = wiringBlock.indexOf("captureKickbackToBuildContext('wiring_check')");
    const navigateIndex = wiringBlock.indexOf("navigateBack(state, 'build', steps)");

    expect({
      checkBeforeBudget: checkIndex >= 0 && checkIndex < budgetIndex,
      captureBeforeNavigate: captureIndex >= 0 && captureIndex < navigateIndex,
    }).toEqual({ checkBeforeBudget: true, captureBeforeNavigate: true });
  });

  it('halts an identical joined wiring gap at D2 before charging D1 again or reaching review or SHIP', async () => {
    await writeState(statePath, { ...frontDone(), track: 'technical', run_started_at: 1 });
    const gapEvidence = JSON.stringify({
      schema: 1,
      base: 'base',
      head: 'head',
      layer2: { applicable: false },
      waivers: [],
      tasks: [{
        id: 't1',
        contract: 'src/x.ts#foo',
        gaps: [{ kind: 'orphan-export', message: 'foo remains unreachable' }],
      }],
    });
    let firstDispatchGap = true;
    const first = makeConductor({
      run: async (step) => {
        if (step === 'wiring_check' && firstDispatchGap) {
          firstDispatchGap = false;
          await writeFile(join(dir, '.pipeline/wiring-evidence.json'), gapEvidence);
          return { success: true };
        }
        return satisfy(step);
      },
    });

    await first.run();
    await writeState(statePath, {
      ...frontDone(),
      track: 'technical',
      run_started_at: 1,
      build: 'done',
      wiring_check: 'pending',
      test_suite: 'pending',
      build_review: 'pending',
    }, { allowPrUrlClear: true });

    const secondEvents = new ConductorEventEmitter();
    const secondKickbackCounts: number[] = [];
    const downstreamDispatches: string[] = [];
    const downstream = new Set([
      'build_review',
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
      'retro',
      'rebase',
      'finish',
    ]);
    secondEvents.on('kickback', (event) => {
      if (event.type === 'kickback' && event.from === 'wiring_check') {
        secondKickbackCounts.push(event.count);
      }
    });
    secondEvents.on('step_started', (event) => {
      if (event.type === 'step_started' && downstream.has(event.step)) {
        downstreamDispatches.push(event.step);
      }
    });
    const second = makeConductor({
      run: async (step) => {
        if (step === 'wiring_check') {
          await writeFile(join(dir, '.pipeline/wiring-evidence.json'), gapEvidence);
          return { success: true };
        }
        return satisfy(step);
      },
    }, true, undefined, {}, secondEvents, 'wiring_check');

    await second.run();

    expect({
      secondKickbackCounts,
      downstreamDispatches,
      halt: await readFile(join(dir, '.pipeline/HALT'), 'utf8'),
      haltClass: await readHaltClass(dir),
    }).toEqual({
      secondKickbackCounts: [],
      downstreamDispatches: [],
      halt: expect.stringMatching(/wiring_check kickback-to-build no-op/i),
      haltClass: 'needs-human',
    });
  });

  it('leaves D1 active when D2 is disabled, so the identical-gap replay terminates at the persisted cap', async () => {
    await writeState(statePath, { ...frontDone(), track: 'technical', run_started_at: 1 });
    const gapEvidence = JSON.stringify({
      schema: 1, base: 'base', head: 'head', layer2: { applicable: false }, waivers: [],
      tasks: [{ id: 't1', contract: 'src/x.ts#foo', gaps: [{ kind: 'orphan-export', message: 'foo remains unreachable' }] }],
    });
    let firstDispatchGap = true;
    await makeConductor({
      run: async (step) => {
        if (step === 'wiring_check' && firstDispatchGap) {
          firstDispatchGap = false;
          await writeFile(join(dir, '.pipeline/wiring-evidence.json'), gapEvidence);
          return { success: true };
        }
        return satisfy(step);
      },
    }, true, undefined, { kickback_escalation: { enabled: false } }).run();

    // The first fixture run reaches finish after proving the first durable
    // kickback. Recreate the active gate state for the next daemon dispatch
    // without carrying its terminal shipment record into this loop test.
    await writeState(statePath, {
      ...frontDone(),
      track: 'technical',
      run_started_at: 1,
      build: 'done',
      build_review: 'done',
    }, { allowPrUrlClear: true });

    const secondEvents = new ConductorEventEmitter();
    const secondKickbackCounts: number[] = [];
    let secondBuildDispatches = 0;
    let secondWiringAttempts = 0;
    secondEvents.on('kickback', (event) => {
      if (event.type === 'kickback' && event.from === 'wiring_check') secondKickbackCounts.push(event.count);
    });
    const second = makeConductor({
      run: async (step) => {
        if (step === 'build') secondBuildDispatches++;
        if (step === 'wiring_check') {
          secondWiringAttempts++;
          await writeFile(join(dir, '.pipeline/wiring-evidence.json'), gapEvidence);
          return { success: true };
        }
        return satisfy(step);
      },
    }, true, undefined, { kickback_escalation: { enabled: false } }, secondEvents, 'wiring_check');

    await second.run();

    expect({
      secondKickbackCounts,
      secondBuildDispatches,
      secondWiringAttempts,
      halt: await readFile(join(dir, '.pipeline/HALT'), 'utf8'),
    }).toEqual({
      secondKickbackCounts: [2],
      // D1 permits the second actual kickback; the following unresolved
      // failure is what exhausts the cap and produces the classified HALT.
      secondBuildDispatches: 1,
      secondWiringAttempts: 2,
      halt: expect.stringMatching(/wiring_check.*cap 2/i),
    });
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
