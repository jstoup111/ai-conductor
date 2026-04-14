import path from 'node:path';
import type { HarnessConfig } from '../types/config.js';
import type { EnforcementLevel } from '../types/steps.js';
import { getStepDefinition } from './steps.js';
import type { StepName } from '../types/steps.js';

export interface ResolvedSkill {
  path: string;
  enforcement: EnforcementLevel;
  isOverride: boolean;
}

export function resolveSkill(
  stepName: string,
  config: HarnessConfig,
  projectRoot: string,
): ResolvedSkill {
  const stepDef = getStepDefinition(stepName as StepName);
  const overridePath = config.skills?.overrides?.[stepName];

  if (overridePath) {
    return {
      path: path.join(projectRoot, overridePath),
      enforcement: stepDef.enforcement,
      isOverride: true,
    };
  }

  const skillName = stepDef.skillName ?? stepName;
  return {
    path: `skills/${skillName}/SKILL.md`,
    enforcement: stepDef.enforcement,
    isOverride: false,
  };
}
