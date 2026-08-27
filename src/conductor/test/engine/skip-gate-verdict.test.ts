import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return { ...actual, performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }) };
});

import type { ConductState, StepDefinition, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import {
  isSkipVerdict,
  readVerdict,
  recordSkipVerdict,
  SKIP_VERDICT_PREFIX,
} from '../../src/engine/gate-verdicts.js';

/**
 * Regression: a verdict-bearing loop gate skipped for tier S must persist a
 * verdict. Every skip path resolved
 * the step with `saveStepStatus(..., 'skipped')` + `continue`, and the ONLY
 * place a run-step's verdict is persisted is `advanceTail`, which is reached
 * exclusively on the success tail. So the gate ended the run resolved with NO
 * `.pipeline/gates/<step>.json` at all, and `gateSatisfied` (selector.ts) then
 * fell back to the step-state flag — the self-report the verdict layer exists
 * to distrust. Observed in production: worktree
 * `.worktrees/parked-feature-reconciliation-1060` shipped `done` with nine gate
 * verdicts on disk for every skipped gate.
 */
describe('skip paths leave an honest gate verdict', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skip-verdict-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('recordSkipVerdict persists a satisfied verdict whose reason names the skip', async () => {
    const verdict = await recordSkipVerdict(dir, 'manual_test', 'complexity tier S');

    expect(verdict.satisfied).toBe(true);
    expect(verdict.reason).toBe(`${SKIP_VERDICT_PREFIX}complexity tier S`);
    expect(isSkipVerdict(verdict)).toBe(true);

    const onDisk = await readVerdict(dir, 'manual_test');
    expect(onDisk?.satisfied).toBe(true);
    expect(onDisk?.reason).toBe(`${SKIP_VERDICT_PREFIX}complexity tier S`);
    expect(onDisk?.checkedAt).toBeTypeOf('number');
  });

  it('isSkipVerdict tells a skip apart from evaluated evidence', async () => {
    expect(isSkipVerdict({ satisfied: true, checkedAt: 1 })).toBe(false);
    expect(isSkipVerdict({ satisfied: true, reason: 'artifact present', checkedAt: 1 })).toBe(
      false,
    );
    expect(isSkipVerdict(null)).toBe(false);
  });

  it('a tier-S run records the manual-test skip as a verdict instead of leaving the gate blank', async () => {
    // Bounded fixture: tier S skips manual_test before any dispatch; the mocked
    // runner succeeds for everything else and the run ends at `finish`.
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    const manualTest = await readVerdict(dir, 'manual_test');
    expect(manualTest).not.toBeNull();
    expect(manualTest?.satisfied).toBe(true);
    expect(isSkipVerdict(manualTest)).toBe(true);
    expect(manualTest?.reason).toContain('complexity tier S');
  });

  it('only verdict-bearing steps get a skip verdict — a plain step writes no gate file', async () => {
    // Scope guard: `recordStepSkip` must not manufacture verdicts for steps the
    // gate topology never tracks (`deriveGateTopology` keys on loopGate /
    // kickbackTarget), or `readAllVerdicts` starts reporting gates that do not
    // exist.
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: vi.fn().mockResolvedValue({ success: true }) },
      events,
    });
    const recordStepSkip = (
      conductor as unknown as {
        recordStepSkip: (
          state: ConductState,
          step: StepDefinition,
          cause: string,
        ) => Promise<void>;
      }
    ).recordStepSkip.bind(conductor);

    const manualTest = ALL_STEPS.find((s) => s.name === 'manual_test')!;
    const explore = ALL_STEPS.find((s) => s.name === 'explore')!;
    expect(manualTest.loopGate).toBe(true);
    expect(explore.loopGate).toBeUndefined();
    expect(explore.kickbackTarget).toBeUndefined();

    const state = {} as ConductState;
    await recordStepSkip(state, manualTest, 'complexity tier S');
    await recordStepSkip(state, explore, 'complexity tier S');

    expect(isSkipVerdict(await readVerdict(dir, 'manual_test'))).toBe(true);
    expect((await readVerdict(dir, 'manual_test'))?.reason).toContain('complexity tier S');
    expect(await readVerdict(dir, 'explore')).toBeNull();
    expect(state.manual_test).toBe('skipped');
    expect(state.explore).toBe('skipped');
  });

});
