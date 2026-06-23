import { describe, it, expect } from 'vitest';
import { ALL_STEPS } from '../../src/engine/steps.js';
import {
  gateSatisfied,
  selectNextGate,
  type SelectorInput,
} from '../../src/engine/selector.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { GateVerdict } from '../../src/engine/gate-verdicts.js';

// Front-half steps that the linear flow produces before the loop engages.
function frontDone(): ConductState {
  return {
    worktree: 'done',
    memory: 'done',
    brainstorm: 'done',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'done',
    plan: 'done',
    architecture_diagram: 'done',
    architecture_review: 'done',
    acceptance_specs: 'done',
  };
}

function input(
  state: ConductState,
  verdicts: Partial<Record<StepName, GateVerdict>> = {},
  regionStart: StepName = 'stories',
): SelectorInput {
  return { steps: ALL_STEPS, state, verdicts, regionStart };
}

const VSAT: GateVerdict = { satisfied: true, checkedAt: 1 };

describe('engine/selector — selectNextGate', () => {
  it('lands on build in normal entry (front half done, no loop verdicts yet)', () => {
    const d = selectNextGate(input(frontDone()));
    expect(d).toEqual({ kind: 'run', step: 'build', reason: expect.any(String) });
  });

  it('routes back to plan on a kickback, ahead of build', () => {
    const state: ConductState = {
      ...frontDone(),
      plan: 'stale', // navigateBack staled it
      build: 'pending',
    };
    const verdicts: Partial<Record<StepName, GateVerdict>> = {
      plan: {
        satisfied: false,
        checkedAt: 2,
        kickback: { from: 'build', evidence: 'AC-7 needs a new table' },
      },
    };
    const d = selectNextGate(input(state, verdicts));
    expect(d.kind).toBe('run');
    if (d.kind === 'run') {
      expect(d.step).toBe('plan');
      expect(d.reason).toMatch(/kickback from build/);
      expect(d.reason).toMatch(/AC-7/);
    }
  });

  it('returns done when every gate in the region is satisfied', () => {
    const verdicts: Partial<Record<StepName, GateVerdict>> = {
      build: VSAT,
      manual_test: VSAT,
      retro: VSAT,
      finish: VSAT,
    };
    const d = selectNextGate(input(frontDone(), verdicts));
    expect(d.kind).toBe('done');
  });

  it('skips a tier-skipped step (retro on Small) and selects finish', () => {
    const state: ConductState = { ...frontDone(), complexity_tier: 'S' };
    const verdicts: Partial<Record<StepName, GateVerdict>> = {
      build: VSAT,
      manual_test: VSAT,
      // retro has no verdict and is pending, but is skippable for Small
    };
    const d = selectNextGate(input(state, verdicts));
    expect(d).toMatchObject({ kind: 'run', step: 'finish' });
  });

  it('does not select a step explicitly marked skipped', () => {
    const state: ConductState = {
      ...frontDone(),
      build: 'skipped',
      manual_test: 'skipped',
      retro: 'skipped',
    };
    const verdicts: Partial<Record<StepName, GateVerdict>> = {};
    const d = selectNextGate(input(state, verdicts));
    expect(d).toMatchObject({ kind: 'run', step: 'finish' });
  });

  it('selects a stale step (no verdict) ahead of downstream work', () => {
    const state: ConductState = { ...frontDone(), plan: 'stale' };
    const d = selectNextGate(input(state));
    expect(d).toMatchObject({ kind: 'run', step: 'plan' });
  });

  it('throws when regionStart is not in the step list', () => {
    expect(() =>
      selectNextGate(input(frontDone(), {}, 'nope' as StepName)),
    ).toThrow(/regionStart/);
  });
});

describe('engine/selector — gateSatisfied', () => {
  it('verdict is authoritative over state', () => {
    const state: ConductState = { build: 'done' };
    expect(gateSatisfied('build', state, { build: { satisfied: false, checkedAt: 1 } })).toBe(false);
    expect(gateSatisfied('build', state, { build: VSAT })).toBe(true);
  });

  it('falls back to state when no verdict; stale is not satisfied', () => {
    expect(gateSatisfied('plan', { plan: 'done' }, {})).toBe(true);
    expect(gateSatisfied('plan', { plan: 'skipped' }, {})).toBe(true);
    expect(gateSatisfied('plan', { plan: 'stale' }, {})).toBe(false);
    expect(gateSatisfied('plan', { plan: 'pending' }, {})).toBe(false);
  });

  it('stale overrides a stale satisfied verdict (kickback cascade re-opens it)', () => {
    expect(gateSatisfied('build', { build: 'stale' }, { build: VSAT })).toBe(false);
  });
});
