import { access } from 'node:fs/promises';
import { join } from 'node:path';
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

/** Verify that every registry-derived command resolves from the isolated home. */
export async function assertStepCommandsResolve(
  homeDir: string,
  providerKey = 'claude',
): Promise<void> {
  const skillsDir = join(homeDir, 'skills');

  await Promise.all(dispatchableStepCommands(providerKey).map(async ({ skillName, rendered }) => {
    try {
      await access(join(skillsDir, skillName, 'SKILL.md'));
    } catch {
      throw new Error(`Unable to resolve skill ${skillName} for ${rendered} in ${skillsDir}.`);
    }
  }));
}
