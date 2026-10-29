// Covers: task:1, task:2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/engine/rebase.js')>(
    '../../src/engine/rebase.js',
  );
  return {
    ...actual,
    applyRebaseVerdicts: vi.fn(actual.applyRebaseVerdicts),
  };
});

import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { applyRebaseVerdicts } from '../../src/engine/rebase.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

function seedDoneThrough(stopAt: StepName): Record<string, unknown> {
  const state: Record<string, unknown> = { complexity_tier: 'S' };
  for (const step of ALL_STEPS) {
    if (step.name === stopAt) break;
    state[step.name] = 'done';
  }
  return state;
}

function runner(): StepRunner {
  return {
    run: async () => ({ success: true }),
    resetSession: async () => {},
  };
}

describe('stale rebase verdict reconciliation', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stale-rebase-verdict-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    vi.mocked(applyRebaseVerdicts).mockReset();
    const actual = await vi.importActual<typeof import('../../src/engine/rebase.js')>(
      '../../src/engine/rebase.js',
    );
    vi.mocked(applyRebaseVerdicts).mockImplementation(actual.applyRebaseVerdicts);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function staleFixture(): Promise<{ conductor: Conductor; state: ConductState }> {
    const state = seedDoneThrough('finish') as ConductState;
    await writeState(statePath, state);
    for (const step of ALL_STEPS.filter((candidate) => candidate.loopGate)) {
      if (step.name !== 'rebase' && step.name !== 'finish') {
        await writeVerdict(dir, step.name, { satisfied: true, checkedAt: 1 });
      }
    }
    await writeVerdict(dir, 'finish', { satisfied: false, checkedAt: 1 });
    await writeVerdict(dir, 'rebase', {
      satisfied: false,
      reason: 'routed leaf return requires fresh whole-feature validation for child 3',
      checkedAt: 1,
    });
    return {
      conductor: new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner(),
        events,
        verifyArtifacts: true,
      }),
      state,
    };
  }

  async function runRebaseStep(conductor: Conductor, state: ConductState): Promise<void> {
    await (conductor as unknown as {
      runRebaseStep: (current: ConductState) => Promise<unknown>;
    }).runRebaseStep(state);
  }

  async function advanceTail(conductor: Conductor, state: ConductState): Promise<number | null | 'halt'> {
    return (conductor as unknown as {
      advanceTail: (
        step: typeof ALL_STEPS[number],
        current: ConductState,
        stuckGate: Map<StepName, number>,
        steps: typeof ALL_STEPS,
        indexOf: (name: StepName) => number,
      ) => Promise<number | null | 'halt'>;
    }).advanceTail(
      ALL_STEPS.find((step) => step.name === 'rebase')!,
      state,
      new Map(),
      ALL_STEPS,
      (name) => ALL_STEPS.findIndex((step) => step.name === name),
    );
  }

  it('heals a stale no-op verdict and selects finish without re-running rebase', async () => {
    const { conductor, state } = await staleFixture();
    vi.mocked(applyRebaseVerdicts).mockImplementationOnce(async () => ({
      satisfied: true,
      kickedBack: [],
      reverified: [],
    }));

    const observed: Array<{ step: StepName; satisfied: boolean }> = [];
    const kickbacks: unknown[] = [];
    events.on('gate_verdict', (event) => {
      if (event.type === 'gate_verdict') observed.push({ step: event.step, satisfied: event.satisfied });
    });
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    const gates = join(dir, '.pipeline', 'gates');
    const otherGateBytes = new Map(await Promise.all(
      (await readdir(gates))
        .filter((name) => name !== 'rebase.json')
        .map(async (name) => [name, await readFile(join(gates, name), 'utf8')] as const),
    ));
    const dispatchStartedAt = Date.now();
    await runRebaseStep(conductor, state);
    const selected = await advanceTail(conductor, state);

    expect({
      selected,
      rebase: await readVerdict(dir, 'rebase'),
      state: state.rebase,
      observed,
      halt: await readFile(join(dir, '.pipeline', 'HALT'), 'utf8').catch(() => null),
    }).toEqual({
      selected: ALL_STEPS.findIndex((step) => step.name === 'finish'),
      rebase: expect.objectContaining({
        satisfied: true,
        reason: 'branch already current with base',
        checkedAt: expect.any(Number),
      }),
      state: 'done',
      observed: expect.arrayContaining([{ step: 'rebase', satisfied: true }]),
      halt: null,
    });
    expect((await readVerdict(dir, 'rebase'))!.checkedAt).toBeGreaterThanOrEqual(dispatchStartedAt);
    expect(kickbacks).toEqual([]);
    for (const [name, bytes] of otherGateBytes) {
      await expect(readFile(join(gates, name), 'utf8')).resolves.toBe(bytes);
    }
  });

  it('heals a stale mergeable-skip verdict and selects finish', async () => {
    const { conductor, state } = await staleFixture();
    vi.mocked(applyRebaseVerdicts).mockImplementationOnce(async () => ({
      satisfied: true,
      kickedBack: [],
      reverified: [],
    }));

    await runRebaseStep(conductor, state);
    (conductor as unknown as { lastRebaseOutcome: unknown }).lastRebaseOutcome = {
      kind: 'mergeable_skip', baseRef: 'origin/main', baseSha: 'abc', baseKind: 'remote',
    };

    expect({
      selected: await advanceTail(conductor, state),
      verdict: await readVerdict(dir, 'rebase'),
      state: state.rebase,
    }).toEqual({
      selected: ALL_STEPS.findIndex((step) => step.name === 'finish'),
      verdict: expect.objectContaining({
        satisfied: true,
        reason: expect.stringMatching(/^branch is mergeable with origin\/main@abc/),
      }),
      state: 'done',
    });
  });

  it('does not rewrite a no-op verdict written during its dispatch', async () => {
    const { conductor, state } = await staleFixture();

    await runRebaseStep(conductor, state);
    const written = await readFile(join(dir, '.pipeline', 'gates', 'rebase.json'), 'utf8');
    await advanceTail(conductor, state);

    await expect(readFile(join(dir, '.pipeline', 'gates', 'rebase.json'), 'utf8')).resolves.toBe(written);
    expect(applyRebaseVerdicts).toHaveBeenCalledTimes(1);
  });

  it('halts when a changed rebase dispatch leaves its verdict stale', async () => {
    const { conductor, state } = await staleFixture();
    vi.mocked(applyRebaseVerdicts).mockImplementationOnce(async () => ({
      satisfied: true,
      kickedBack: [],
      reverified: [],
    }));
    const loopHalts: string[] = [];
    const kickbacks: unknown[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') loopHalts.push(event.reason);
    });
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    const gates = join(dir, '.pipeline', 'gates');
    const otherGateBytes = new Map(await Promise.all(
      (await readdir(gates))
        .filter((name) => name !== 'rebase.json')
        .map(async (name) => [name, await readFile(join(gates, name), 'utf8')] as const),
    ));

    await runRebaseStep(conductor, state);
    (conductor as unknown as { lastRebaseOutcome: unknown }).lastRebaseOutcome = {
      kind: 'changed',
      baseSha: 'abc',
      changedCodePaths: ['src/a.ts'],
      allChangedPaths: ['src/a.ts'],
    };

    expect(await advanceTail(conductor, state)).toBe('halt');
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    const reason = "step 'rebase' completed but its gate verdict was not refreshed " +
      '(stale verdict: routed leaf return requires fresh whole-feature validation for child 3)';
    expect(halt).toContain(reason);
    expect(halt).not.toContain('selected');
    expect(halt).not.toContain('times without satisfying');
    await expect(readFile(join(dir, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(loopHalts).toEqual([reason]);
    expect(kickbacks).toEqual([]);
    for (const [name, bytes] of otherGateBytes) {
      await expect(readFile(join(gates, name), 'utf8')).resolves.toBe(bytes);
    }
  });

  it('uses the existing conflict halt instead of the stale-verdict halt', async () => {
    const { conductor, state } = await staleFixture();
    vi.mocked(applyRebaseVerdicts).mockImplementationOnce(async () => ({
      satisfied: true,
      kickedBack: [],
      reverified: [],
    }));
    const loopHalts: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') loopHalts.push(event.reason);
    });

    await runRebaseStep(conductor, state);
    (conductor as unknown as { lastRebaseOutcome: unknown }).lastRebaseOutcome = {
      kind: 'conflict_halt', reason: 'conflict in src/a.ts', conflicts: [],
    };

    expect(await advanceTail(conductor, state)).toBe('halt');
    expect(loopHalts).toEqual(['rebase conflict — parked for human resolution: conflict in src/a.ts']);
    expect(loopHalts.some((reason) => reason.includes('was not refreshed'))).toBe(false);
  });
});
