// Covers: task:13
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { validatePlanSlices } from '../../src/engine/plan-slices.js';

const planSkillPath = fileURLToPath(
  new URL('../../../../skills/plan/SKILL.md', import.meta.url),
);

function assertSkillSliceExample(skillText: string): string {
  const sectionStart = skillText.indexOf('## Slice manifest');
  const sectionEnd = skillText.indexOf('\n### `**Stories:**`', sectionStart);
  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);
  const section = skillText.slice(sectionStart, sectionEnd);
  const examples = [...section.matchAll(/```markdown\n([\s\S]*?)\n```/g)];
  expect(examples).toHaveLength(1);
  const example = examples[0][1];
  const validation = validatePlanSlices(example);
  if (validation.kind !== 'sliced') {
    const messages = validation.kind === 'invalid'
      ? validation.violations.map(({ message }) => message).join('; ')
      : 'the example has no Slices section';
    throw new Error(`documented slice example must validate as sliced: ${messages}`);
  }
  return example;
}

describe('plan skill slice-manifest contract', () => {
  it('documents one valid, fully assigned sliced plan example', async () => {
    const example = assertSkillSliceExample(await readFile(planSkillPath, 'utf8'));
    const result = validatePlanSlices(example);

    expect(result).toMatchObject({
      kind: 'sliced',
      slices: [
        { position: 1, taskIds: ['1', '2'] },
        { position: 2, taskIds: ['3'] },
      ],
    });
  });

  it('keeps the documented example sensitive to unknown slice task references', async () => {
    const skill = await readFile(planSkillPath, 'utf8');
    const unknownTask = skill.replace('| 2 | Follow-up | 3 |', '| 2 | Follow-up | 99 |');

    expect(() => assertSkillSliceExample(unknownTask)).toThrow(/Task 99.*unknown task id/i);
  });

  it('refuses a Tasks 1–3 Dependencies reference', async () => {
    const skill = await readFile(planSkillPath, 'utf8');
    const malformedDependencies = skill.replace('**Dependencies:** Tasks 1, 2', '**Dependencies:** Tasks 1–3');

    expect(() => assertSkillSliceExample(malformedDependencies))
      .toThrow('Task 3 has malformed Dependencies "Tasks 1–3"');
  });
});
