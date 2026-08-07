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

/** The preflight's only external capability is filesystem access. */
export interface StepCommandPreflightDependencies {
  readonly access?: typeof access;
}

/**
 * Derive the complete dispatchable command set from the engine's semantic
 * registry. Project-configuration custom steps and parallel[].skill overrides
 * are not represented in that registry, so this helper intentionally covers
 * only its declared skill entries. Daemon-entry install-freshness owns the
 * global catalog; this preflight owns only the isolated run home.
 */
function deriveDispatchableStepCommands(providerKey: string): readonly DispatchableStepCommand[] {
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
async function assertStepCommandsResolve(
  homeDir: string,
  providerKey = 'claude',
  dependencies: StepCommandPreflightDependencies = {},
): Promise<void> {
  const skillsDir = join(homeDir, 'skills');
  const accessFile = dependencies.access ?? access;
  const unresolved = (await Promise.all(deriveDispatchableStepCommands(providerKey).map(async (command) => {
    try {
      await accessFile(join(skillsDir, command.skillName, 'SKILL.md'));
      return undefined;
    } catch {
      return command;
    }
  }))).filter((command): command is DispatchableStepCommand => command !== undefined);

  if (unresolved.length > 0) {
    const commands = unresolved.map(({ skillName, rendered }) => `${skillName} (${rendered})`);
    throw new Error(`Unable to resolve skills ${commands.join(', ')} in ${skillsDir}.`);
  }
}

/**
 * The registry-derived command collection is the fixture's sole public seam.
 * Its resolution operation stays on that seam rather than creating a second
 * test-only export that the runtime can never reach.
 */
export const dispatchableStepCommands = Object.assign(deriveDispatchableStepCommands, {
  assertResolves: assertStepCommandsResolve,
});
