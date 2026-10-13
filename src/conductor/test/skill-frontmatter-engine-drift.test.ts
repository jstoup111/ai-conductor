// Covers: task:1

import { readFile } from 'node:fs/promises';

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

describe('skill frontmatter engine drift', () => {
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
});
