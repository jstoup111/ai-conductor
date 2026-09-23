import type { HarnessConfig } from '../types/config.js';
import type { StepDefinition } from '../types/index.js';
import { ALL_STEPS } from './steps.js';

/**
 * Return config-declared gating steps with completion markers that occur
 * before FINISH in the resolved registry order.
 */
export function selectFinishPrerequisiteSteps(
  config: HarnessConfig,
  steps: readonly StepDefinition[],
): string[] {
  const builtInSteps = new Set(ALL_STEPS.map((step) => step.name));
  const finishIndex = steps.findIndex((step) => step.name === 'finish');

  return steps
    .slice(0, finishIndex === -1 ? 0 : finishIndex)
    .map((step) => step.name)
    .filter((name) => {
      const configStep = config.steps?.[name];
      return !builtInSteps.has(name)
        && configStep?.enforcement === 'gating'
        && configStep.completion_artifact !== undefined;
    });
}
