import type { ComplexityTier, StepName } from '../types/index.js';
import { isGatingStep } from './gates.js';
import {
  resolvePlanPatternSource,
  type PatternSourceFileExists,
  type PlanPatternSourceResolution,
} from './plan-pattern-source.js';
import { ALL_STEPS } from './steps.js';

/** The tier scheduling projection derived from the active plan's content. */
export interface PlanContentScheduling {
  declaration: PlanPatternSourceResolution;
  skippedSteps: StepName[];
  enabledGateSteps: StepName[];
}

/**
 * Resolve plan content before deriving its tier policy. A replication declaration
 * intentionally does not alter tier policy, but it is retained in the returned
 * projection so both scheduler paths consume the same parsed plan boundary.
 */
export async function resolvePlanContentScheduling(input: {
  planPath: string;
  planContent: string;
  tier: ComplexityTier;
  fileExists: PatternSourceFileExists;
}): Promise<PlanContentScheduling> {
  const declaration = await resolvePlanPatternSource(
    input.planPath,
    input.planContent,
    input.fileExists,
  );
  const skippedSteps = ALL_STEPS
    .filter((step) => step.skippableForTiers.includes(input.tier))
    .map((step) => step.name);
  const enabledGateSteps = ALL_STEPS
    .filter((step) => isGatingStep(step.name) && !skippedSteps.includes(step.name))
    .map((step) => step.name);

  return { declaration, skippedSteps, enabledGateSteps };
}
