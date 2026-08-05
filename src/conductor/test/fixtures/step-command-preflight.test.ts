import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STEP_SKILL_INVOCATIONS,
  renderSkillInvocation,
} from '../../src/engine/skill-invocation.js';
import {
  assertStepCommandsResolve,
  dispatchableStepCommands,
} from './step-command-preflight.js';

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

  it('passes when the isolated home contains every registry-derived skill', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'step-command-preflight-'));

    try {
      await Promise.all(dispatchableStepCommands('claude').map(async ({ skillName }) => {
        const skillDir = join(homeDir, 'skills', skillName);
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'SKILL.md'), '# fixture\n');
      }));

      await expect(assertStepCommandsResolve(homeDir, 'claude')).resolves.toBeUndefined();
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('names the unresolved command, its rendered string, and the searched directory', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'step-command-preflight-'));
    const pipelineCommand = dispatchableStepCommands('claude').find(
      ({ skillName }) => skillName === 'pipeline',
    );

    try {
      await Promise.all(dispatchableStepCommands('claude')
        .filter(({ skillName }) => skillName !== 'pipeline')
        .map(async ({ skillName }) => {
          const skillDir = join(homeDir, 'skills', skillName);
          await mkdir(skillDir, { recursive: true });
          await writeFile(join(skillDir, 'SKILL.md'), '# fixture\n');
        }));

      await expect(assertStepCommandsResolve(homeDir, 'claude')).rejects.toThrow(
        new RegExp(`pipeline.*${pipelineCommand?.rendered}.*${homeDir}`, 's'),
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('reports every missing registry-derived command, including a non-pipeline command', async () => {
    const homes = await Promise.all([
      mkdtemp(join(tmpdir(), 'step-command-preflight-')),
      mkdtemp(join(tmpdir(), 'step-command-preflight-')),
    ]);
    const cases = [
      { homeDir: homes[0], missingSkillNames: new Set(['pipeline', 'bootstrap']) },
      { homeDir: homes[1], missingSkillNames: new Set(['bootstrap']) },
    ];

    try {
      await Promise.all(cases.map(async ({ homeDir, missingSkillNames }) => {
        await Promise.all(dispatchableStepCommands('claude')
          .filter(({ skillName }) => !missingSkillNames.has(skillName))
          .map(async ({ skillName }) => {
            const skillDir = join(homeDir, 'skills', skillName);
            await mkdir(skillDir, { recursive: true });
            await writeFile(join(skillDir, 'SKILL.md'), '# fixture\n');
          }));
      }));

      const failures = await Promise.all(cases.map(async ({ homeDir }) => {
        try {
          await assertStepCommandsResolve(homeDir, 'claude');
          return '';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }));

      expect(failures).toEqual([
        expect.stringMatching(/pipeline.*bootstrap|bootstrap.*pipeline/s),
        expect.stringMatching(/bootstrap/),
      ]);
    } finally {
      await Promise.all(homes.map((homeDir) => rm(homeDir, { recursive: true, force: true })));
    }
  });
});
