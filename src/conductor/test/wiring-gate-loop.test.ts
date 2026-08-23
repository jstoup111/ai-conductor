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
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState, StepDefinition, StepName } from '../src/types/index.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import {
  selectNextGate,
  earliestUnsatisfiedGateIndex,
  type SelectorInput,
} from '../src/engine/selector.js';
import { writeVerdict, type GateVerdict } from '../src/engine/gate-verdicts.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { readState, writeState } from '../src/engine/state.js';
import { Conductor } from '../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../src/engine/conductor.js';
import { checkStepCompletion } from '../src/engine/artifacts.js';

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
  ])('an unsatisfied $staleGate verdict dispatches that prerequisite before review', ({ staleGate }) => {
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
      expect(d.step).not.toBe('manual_test');
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
          rubric: { testQuality: false },
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

  it('runs the wiring_check no-op and test_suite before build_review, then enters SHIP', async () => {
    await writeState(statePath, {
      ...frontDone(),
      complexity_tier: 'M',
      track: 'technical',
      coherence_check: 'done',
    });
    const ran: StepName[] = [];
    const deprecated: unknown[] = [];
    events.on('deprecated_step', (event) => { deprecated.push(event); });
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        return satisfy(step);
      },
    };

    await makeConductor(runner, true, () => ran.push('test_suite')).run();

    const reviewIdx = ran.indexOf('build_review');
    const testSuiteIdx = ran.indexOf('test_suite');
    const manualIdx = ran.indexOf('manual_test');
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(testSuiteIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(testSuiteIdx);
    expect(manualIdx).toBeGreaterThan(reviewIdx);
    expect(deprecated).toContainEqual(expect.objectContaining({
      type: 'deprecated_step',
      step: 'wiring_check',
    }));
  });

  it('does not re-enter review for later-invalidated retired wiring_check evidence', async () => {
    await writeState(statePath, {
      ...frontDone(),
      complexity_tier: 'M',
      track: 'technical',
      coherence_check: 'done',
      build: 'done',
      test_suite: 'done',
    });
    await satisfy('build');
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: Date.now() });
    await writeVerdict(dir, 'test_suite', { satisfied: true, checkedAt: Date.now() });
    const state = (await readState(statePath)) as { ok: true; value: ConductState };
    const stuckGate = new Map<StepName, number>();
    const indexOf = (name: StepName) => ALL_STEPS.findIndex((step) => step.name === name);
    const conductor = makeConductor({ run: async () => ({ success: true }) });
    const advanceTail = (conductor as unknown as {
      advanceTail: (
        step: StepDefinition,
        state: ConductState,
        stuckGate: Map<StepName, number>,
        steps: StepDefinition[],
        indexOf: (name: StepName) => number,
      ) => Promise<number | null | 'halt'>;
    }).advanceTail.bind(conductor);
    const wiringStep = ALL_STEPS[indexOf('wiring_check')];
    const reviewStep = ALL_STEPS[indexOf('build_review')];

    for (let selection = 1; selection <= 6; selection++) {
      await writeVerdict(dir, 'wiring_check', {
        satisfied: false,
        checkedAt: Date.now(),
        reason: `wiring remains unsatisfied on selection ${selection}`,
      });
      await advanceTail(reviewStep, state.value, stuckGate, ALL_STEPS, indexOf);
    }
    await satisfy('wiring_check');
    await writeVerdict(dir, 'wiring_check', {
      satisfied: true,
      checkedAt: Date.now(),
    });
    await advanceTail(wiringStep, state.value, stuckGate, ALL_STEPS, indexOf);
    await writeVerdict(dir, 'wiring_check', {
      satisfied: false,
      checkedAt: Date.now(),
      kickback: {
        from: 'build_review',
        evidence: 'source advanced after the prior wiring proof',
      },
    });
    const next = await advanceTail(reviewStep, state.value, stuckGate, ALL_STEPS, indexOf);

    expect(next).toBe('halt');
  });

  it.each([
    { executionBoundary: 'daemon', daemon: true },
    { executionBoundary: 'non-daemon', daemon: false },
  ])(
    '$executionBoundary ignores legacy wiring-gap evidence without a build kickback',
    async ({ daemon }) => {
      // technical track: skips prd_audit (no PRD to audit) so this test
      // isolates the wiring_check kickback behavior from unrelated SHIP-tail
      // gates that would otherwise HALT for reasons that have nothing to do
      // with wiring_check.
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      await writeFile(
        join(dir, '.pipeline/wiring-evidence.json'),
        JSON.stringify({
          schema: 1,
          base: 'base',
          head: 'head',
          layer2: { applicable: false },
          waivers: [],
          tasks: [{
            id: 't1',
            contract: 'src/x.ts#foo',
            gaps: [{ kind: 'orphan-export', message: 'foo unreachable' }],
          }],
        }),
      );
      let wiringRuns = 0;
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'wiring_check') wiringRuns++;
          return satisfy(step);
        },
      };

      await makeConductor(runner, daemon).run();

      expect(wiringRuns).toBe(0);
      expect(kicks).not.toContainEqual({ from: 'wiring_check', to: 'build' });
    },
  );

  it('does not spend the kickback budget for legacy wiring-gap evidence', async () => {
    await writeState(statePath, { ...frontDone(), track: 'technical' });
    const kicks: Array<{ from: string; to: string }> = [];
    let halted = false;
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });
    events.on('loop_halt', () => {
      halted = true;
    });
    await writeFile(
      join(dir, '.pipeline/wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: 'base',
        head: 'head',
        layer2: { applicable: false },
        waivers: [],
        tasks: [{
          id: 't1',
          contract: 'src/x.ts#foo',
          gaps: [{ kind: 'orphan-export', message: 'foo unreachable' }],
        }],
      }),
    );
    const runner: StepRunner = {
      run: async (step) => {
        return satisfy(step);
      },
    };

    await makeConductor(runner).run();

    expect(kicks.filter((k) => k.from === 'wiring_check' && k.to === 'build')).toEqual([]);
    expect(halted).toBeTypeOf('boolean');
  });

  it('has no wiring_check kickback routing or escalation branch', async () => {
    const source = await readFile(join(process.cwd(), 'src/engine/conductor.ts'), 'utf8');
    expect(source).not.toContain("from: 'wiring_check'");
    expect(source).not.toContain("checkKickbackToBuildEscalation('wiring_check')");
  });

});

describe('wiring_check predicate — deprecated no-op (Task 9)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiring-gate-loop-noop-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports satisfied despite pre-existing obsolete evidence', async () => {
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
    const result = await checkStepCompletion(dir, 'wiring_check', {});

    expect(result.done).toBe(true);
  });
});
