// Covers: task:4, task:18, task:19, task:20
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const skillsPath = fileURLToPath(new URL('../../../../skills/', import.meta.url));
const planSkillPath = fileURLToPath(
  new URL('../../../../skills/plan/SKILL.md', import.meta.url),
);

const nonInterferenceItem =
  /tasks do not invalidate each other's fixtures or assertions[\s\S]*?plan review[\s\S]*?Medium and Large[\s\S]*?Small[\s\S]*?no required step/i;

function verificationSections(skill: string): string[] {
  const starts = [...skill.matchAll(/^## Verification$/gm)]
    .map((match) => match.index ?? -1);

  return starts.map((start, index) =>
    skill.slice(start + '## Verification'.length, starts[index + 1] ?? skill.length));
}

async function readSkill(name: string): Promise<string> {
  return readFile(
    new URL(`../../../../skills/${name}/SKILL.md`, import.meta.url),
    'utf8',
  );
}

describe('plan skill non-interference contract', () => {
  it('keeps acyclic dependencies and task non-interference as separate verification checks', async () => {
    const planSkill = await readFile(planSkillPath, 'utf8');
    const sections = verificationSections(planSkill);

    expect(sections).toHaveLength(2);
    for (const section of sections) {
      const acyclicItems = section.split('\n').filter((line) => /acyclic/i.test(line));

      expect(acyclicItems).toHaveLength(1);
      expect(acyclicItems[0]).toMatch(/dependenc/i);
      expect(acyclicItems[0]).not.toMatch(/interfer|independen/i);
      expect(section).toMatch(nonInterferenceItem);
    }
  });

  it('assigns the required task-versus-task sweep to plan review', async () => {
    const skillNames = await readdir(skillsPath);
    const skillTexts = await Promise.all(
      skillNames.map(async (name) => [name, await readSkill(name)] as const),
    );
    const taskPairReferences = skillTexts.filter(([, text]) =>
      /task(?:-versus-|\s+versus\s+|↔)task/i.test(text),
    );

    expect(taskPairReferences.map(([name]) => name).sort())
      .toEqual(['coherence-check', 'conflict-check', 'plan-review']);

    const planReview = taskPairReferences.find(([name]) => name === 'plan-review')?.[1] ?? '';
    const planSkill = await readFile(planSkillPath, 'utf8');

    expect(planReview).toMatch(/task-versus-task[\s\S]*?other direction/i);
    expect(planReview).toMatch(/Cross-layer and task versus task[\s\S]*?plan review at Medium and Large/i);
    expect(planSkill).toMatch(nonInterferenceItem);
    expect(planSkill).toMatch(/plan review[\s\S]*?Medium and Large/i);
  });
});
