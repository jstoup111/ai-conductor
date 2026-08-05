import {
  STEP_SKILL_INVOCATIONS,
  renderSkillInvocation,
} from '../../src/engine/skill-invocation.js';
import type { StepName } from '../../src/types/index.js';

/** A registry-derived command the live smoke may resolve from its isolated home. */
export interface DispatchableStepCommand {
  readonly step: StepName;
  readonly skillName: string;
  readonly rendered: string;
}

/**
 * Derive the complete dispatchable command set from the engine's semantic
 * registry. Project-configuration custom steps and parallel branches are not
 * represented in that registry, so this helper intentionally covers only its
 * declared skill entries.
 */
export function dispatchableStepCommands(providerKey: string): readonly DispatchableStepCommand[] {
  return Object.entries(STEP_SKILL_INVOCATIONS).flatMap(([step, descriptor]) => {
    if (descriptor.kind !== 'skill') return [];
    return [{
      step: step as StepName,
      skillName: descriptor.skillName,
      rendered: renderSkillInvocation(descriptor, providerKey),
    }];
  });
}
