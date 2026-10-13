// Covers: task:1, task:2, task:3

import { access, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { ALL_STEPS, OUT_OF_BAND_STEPS } from '../src/engine/steps.js';

const enforcementRank = {
  advisory: 0,
  gating: 1,
  structural: 2,
  mechanical: 3,
} as const;

const builtInSteps = [...ALL_STEPS, ...Object.values(OUT_OF_BAND_STEPS)];

function stepMappedSkills(): Map<string, typeof builtInSteps> {
  const skills = new Map<string, typeof builtInSteps>();

  for (const step of builtInSteps) {
    if (!step.skillName) continue;
    const mappedSteps = skills.get(step.skillName) ?? [];
    mappedSteps.push(step);
    skills.set(step.skillName, mappedSteps);
  }

  return skills;
}

function declaredEnforcement(skill: string): string | undefined {
  return skill.match(/^enforcement:\s*(\S+)$/m)?.[1];
}

function declaredRequires(skill: string): string[] {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  const declaration = frontmatter?.[1].match(/^requires:\s*\[(.*)\]$/m)?.[1];

  return declaration
    ? declaration.split(',').map((requirement) => requirement.trim().replaceAll(/^['"]|['"]$/g, '')).filter(Boolean)
    : [];
}

describe('skill frontmatter engine drift', () => {
  it('requires every step-mapped skill directory to exist', async () => {
    const missing: string[] = [];

    for (const step of builtInSteps) {
      if (!step.skillName) continue;

      const skillPath = `skills/${step.skillName}/SKILL.md`;
      try {
        await access(new URL(`../../../${skillPath}`, import.meta.url));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          missing.push(`${step.name}: ${skillPath} missing`);
          continue;
        }
        throw error;
      }
    }

    expect(missing).toEqual([]);
  });

  it('keeps step-mapped skill enforcement aligned with the strictest mapped engine step', async () => {
    const mappedSkills = stepMappedSkills();
    const mismatches: string[] = [];

    for (const [skillName, steps] of mappedSkills) {
      let skill: string;
      try {
        skill = await readFile(new URL(`../../../skills/${skillName}/SKILL.md`, import.meta.url), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const expected = steps.reduce((strictest, step) => (
        enforcementRank[step.enforcement] > enforcementRank[strictest] ? step.enforcement : strictest
      ), steps[0]!.enforcement);
      const declared = declaredEnforcement(skill);

      if (declared !== expected) {
        mismatches.push(`${skillName}: declared ${declared ?? 'missing'}, expected ${expected} (from ${steps.map((step) => step.name).join(', ')})`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('does not compare skills that no built-in step maps', () => {
    const mappedSkills = stepMappedSkills();

    expect(mappedSkills.has('tdd')).toBe(false);
    expect(mappedSkills.has('verify-claims')).toBe(false);
  });

  it('does not allow step-mapped skills to require a skill that runs later', async () => {
    const mappedSkills = stepMappedSkills();
    const orderedSkillIndices = new Map<string, number[]>();
    const mismatches: string[] = [];

    for (const [index, step] of ALL_STEPS.entries()) {
      if (!step.skillName) continue;
      const indices = orderedSkillIndices.get(step.skillName) ?? [];
      indices.push(index);
      orderedSkillIndices.set(step.skillName, indices);
    }

    for (const [skillName] of mappedSkills) {
      const sourceIndices = orderedSkillIndices.get(skillName);
      if (!sourceIndices) continue;

      let skill: string;
      try {
        skill = await readFile(new URL(`../../../skills/${skillName}/SKILL.md`, import.meta.url), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const requirement of declaredRequires(skill)) {
        const requiredIndices = orderedSkillIndices.get(requirement);
        if (!requiredIndices) continue;

        const sourceLatestIndex = Math.max(...sourceIndices);
        const requiredEarliestIndex = Math.min(...requiredIndices);
        if (requiredEarliestIndex > sourceLatestIndex) {
          mismatches.push(
            `${skillName} requires ${requirement}, but ${requirement} (earliest step ${ALL_STEPS[requiredEarliestIndex]!.name}, index ${requiredEarliestIndex}) runs after ${skillName} (latest step ${ALL_STEPS[sourceLatestIndex]!.name}, index ${sourceLatestIndex})`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
