import type { StepName, StepDefinition, StepStatus } from '../types/index.js';
import type { ConductState } from '../types/index.js';
import { getStepDefinition } from './steps.js';
import { getStepStatus, stepSatisfied } from './state.js';

export type GateResult =
  | { passed: true }
  | {
    passed: false;
    reason: string;
    unsatisfied: Array<{ step: StepName; status: StepStatus }>;
  };

/**
 * Check whether a step's gate passes — all prerequisites must be satisfied.
 * Accepts a step name (resolved via the static registry) or a StepDefinition
 * directly (so custom config steps, absent from the static map, work too).
 */
export function checkGate(
  step: StepName | StepDefinition,
  state: ConductState,
): GateResult {
  const def = typeof step === 'string' ? getStepDefinition(step) : step;
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
    unsatisfied: unsatisfied.map((prereq) => ({
      step: prereq,
      status: getStepStatus(state, prereq),
    })),
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
