import type { StepName } from '../types/index.js';
import type { ConductState } from '../types/index.js';
import { getStepDefinition } from './steps.js';
import { stepSatisfied } from './state.js';

export type GateResult =
  | { passed: true }
  | { passed: false; reason: string };

/**
 * Check whether a step's gate passes — all prerequisites must be satisfied.
 */
export function checkGate(step: StepName, state: ConductState): GateResult {
  const def = getStepDefinition(step);
  const unsatisfied = def.prerequisites.filter(
    (prereq) => !stepSatisfied(state, prereq),
  );

  if (unsatisfied.length === 0) {
    return { passed: true };
  }

  const names = unsatisfied.join(', ');
  return {
    passed: false,
    reason: `Prerequisites not satisfied: ${names}`,
  };
}

/**
 * True for steps with 'gating' enforcement level.
 */
export function isGatingStep(step: StepName): boolean {
  return getStepDefinition(step).enforcement === 'gating';
}

/**
 * Gating steps cannot be skipped.
 */
export function canSkipStep(step: StepName): boolean {
  return !isGatingStep(step);
}
