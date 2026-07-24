/**
 * Acceptance specs for "wiring_check step joins the gate loop between
 * build_review and manual_test" — .docs/stories/2026-07-12-wiring-reachability-gate.md
 * (Story: "wiring_check step joins the gate loop between build_review and
 * manual_test", ~lines 127-172) + .docs/plans/2026-07-12-wiring-reachability-gate.md
 * (27 TDD tasks, NOT YET IMPLEMENTED as of this file's authoring).
 *
 * WHY ACCEPTANCE-LEVEL (not unit): this story is about TOPOLOGY — where a new
 * step sits in the linear `ALL_STEPS` registry and how the selector-driven
 * gate-loop tail (build -> build_review -> wiring_check -> manual_test)
 * dispatches around it. That can only be observed by driving the REAL
 * `Conductor` instance end-to-end (mirroring
 * `test/integration/gate-loop.test.ts`'s `build_review flag topology (TS-2)`
 * precedent, which pinned the SAME kind of "does the loop dispatch this step
 * between its neighbors" behavior for `build_review`), not by calling the
 * selector function directly with a hand-built ALL_STEPS array — a unit test
 * of that shape would prove the selector algorithm is correct in the
 * abstract, but not that the REAL registry wires `wiring_check` into the real
 * tail the daemon actually drives.
 *
 * PRE-FIX RED: as of this file's authoring, `src/conductor/src/engine/steps.ts`
 * has no `wiring_check` entry in `ALL_STEPS` and `manual_test.prerequisites`
 * still reads `['build_review']` (confirmed via
 * `grep -n "prerequisites: \['build_review'\]" src/conductor/src/engine/steps.ts`).
 * Every test below pins the FUTURE topology and is expected to FAIL against
 * today's code: `ALL_STEPS.find((s) => s.name === 'wiring_check')` resolves
 * `undefined`, `manual_test.prerequisites` is `['build_review']` not
 * `['wiring_check']`, and a real Conductor run today goes straight from
 * `build_review` to `manual_test` with no `wiring_check` dispatch at all —
 * exactly the wrong-topology outcome this feature must fix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';

const FRONT_DONE: ConductState = {
  // M tier: S-tier now legitimately skips manual_test (D5; see steps.ts
  // skippableForTiers), which would make manual_test never dispatch at all —
  // defeating this file's purpose of proving wiring_check sits between
  // build_review and manual_test in the real gate-loop tail.
  complexity_tier: 'M',
  feature_desc: 'add foo',
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  prd: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'skipped',
  plan: 'done',
  coherence_check: 'done',
  architecture_diagram: 'skipped',
  architecture_review: 'skipped',
  acceptance_specs: 'skipped',
};

describe('acceptance: wiring_check joins the gate loop between build_review and manual_test', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiring-gate-loop-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function conductorWith(runner: StepRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
    });
  }

  // Per-step artifact creation so each gate's objective verdict passes.
  // 'wiring_check' intentionally has NO branch here — today nothing checks
  // for it, so this fixture never satisfies a wiring gate that doesn't exist
  // yet, matching what production evidence would also be missing pre-fix.
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
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'prd_audit') {
      await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\nNo FRs to audit.\n');
    } else if (step === 'finish') {
      await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');
    }
    return { success: true };
  }

  it('registers wiring_check for ALL complexity tiers (skippableForTiers: [])', () => {
    // Today: ALL_STEPS has no 'wiring_check' entry at all -> find() is undefined.
    const wiringCheck = ALL_STEPS.find((s) => s.name === ('wiring_check' as unknown as (typeof ALL_STEPS)[number]['name']));
    expect(wiringCheck).toBeDefined();
    expect(wiringCheck?.skippableForTiers).toEqual([]);
  });

  it('repoints manual_test.prerequisites to [wiring_check] (build_review stays strictly upstream)', () => {
    // Today: manual_test.prerequisites reads ['build_review'].
    const manualTest = ALL_STEPS.find((s) => s.name === 'manual_test');
    const wiringCheck = ALL_STEPS.find((s) => s.name === ('wiring_check' as unknown as (typeof ALL_STEPS)[number]['name']));
    expect(manualTest?.prerequisites).toEqual(['wiring_check']);
    expect(wiringCheck?.prerequisites).toEqual(['build_review']);
  });

  it('dispatches wiring_check between build_review and manual_test in a real gate-loop run', async () => {
    await writeState(statePath, { ...FRONT_DONE });
    const config = { build_review: { enabled: true } };
    const ran: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        return satisfy(step);
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      config,
    });

    await conductor.run();

    const reviewIdx = ran.indexOf('build_review');
    // Today wiring_check is never dispatched (unknown step name), so
    // indexOf returns -1 and this assertion fails.
    const wiringIdx = ran.indexOf('wiring_check');
    const manualIdx = ran.indexOf('manual_test');
    expect(wiringIdx).toBeGreaterThan(-1); // wiring_check must dispatch at all
    expect(wiringIdx).toBeGreaterThan(reviewIdx);
    expect(manualIdx).toBeGreaterThan(wiringIdx);
  });

  it('a wiring gap kicks back to build with NO .pipeline/HALT written', async () => {
    await writeState(statePath, { ...FRONT_DONE });
    const config = { build_review: { enabled: true } };
    let wiringRuns = 0;
    let buildRuns = 0;
    const kicks: Array<{ from: string; to: string }> = [];
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns++;
          return satisfy('build');
        }
        if (step === 'wiring_check') {
          wiringRuns++;
          // Simulate the future gate's gap-kickback contract: write a
          // wiring-evidence.json recording the gap. Today no code path
          // reads this step name at all, so this branch never executes in
          // production — this simulates what the real predicate WILL do
          // once implemented, so the test can pin the observable contract
          // (kickback to build, no HALT) rather than the predicate's guts.
          await writeFile(
            join(dir, '.pipeline/wiring-evidence.json'),
            JSON.stringify({
              schema: 1,
              base: 'base-sha',
              head: 'head-sha',
              layer2: { applicable: false, reason: 'no TS project detected' },
              waivers: [],
              tasks: [
                {
                  id: 't1',
                  contract: 'foo#bar',
                  gaps:
                    wiringRuns === 1
                      ? [{ kind: 'orphan-export', message: 'foo unreachable' }]
                      : [],
                },
              ],
            }),
          );
          return wiringRuns === 1 ? { success: false, error: 'wiring gap' } : { success: true };
        }
        return satisfy(step);
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      config,
    });

    await conductor.run();

    // Today: wiring_check is never dispatched, so wiringRuns stays 0 and no
    // kickback from wiring_check is ever recorded — this fails cleanly
    // against today's topology rather than crashing.
    expect(wiringRuns).toBeGreaterThan(0);
    expect(kicks).toContainEqual({ from: 'wiring_check', to: 'build' });
    await expect(access(join(dir, '.pipeline/HALT'))).rejects.toThrow();
  });
});
