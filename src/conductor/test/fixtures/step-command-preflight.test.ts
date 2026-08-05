import { describe, expect, it } from 'vitest';
import {
  STEP_SKILL_INVOCATIONS,
  renderSkillInvocation,
} from '../../src/engine/skill-invocation.js';
import { dispatchableStepCommands } from './step-command-preflight.js';

describe('dispatchableStepCommands', () => {
  it('derives every skill command from the registry and excludes engine-native steps', () => {
    const commands = dispatchableStepCommands('claude');
    const expected = Object.entries(STEP_SKILL_INVOCATIONS)
      .filter((entry): entry is [string, Extract<typeof entry[1], { kind: 'skill' }>] =>
        entry[1].kind === 'skill',
      )
      .map(([step, descriptor]) => ({
        step,
        skillName: descriptor.skillName,
        rendered: renderSkillInvocation(descriptor, 'claude'),
      }));

    expect(commands).toEqual(expected);
    expect(commands.map(({ step }) => step)).not.toContain('build_review');
    expect(commands.map(({ step }) => step)).not.toContain('wiring_check');
    expect(commands.map(({ step }) => step)).not.toContain('test_suite');
    expect(commands.map(({ step }) => step)).not.toContain('attribution_verify');
  });
});
