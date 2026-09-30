// Covers: task:13
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { validatePlanSlices } from '../../src/engine/plan-slices.js';

const planSkillPath = fileURLToPath(
  new URL('../../../../skills/plan/SKILL.md', import.meta.url),
);

function sliceExample(skillText: string): string {
  const sectionStart = skillText.indexOf('## Slice manifest');
  const sectionEnd = skillText.indexOf('\n### `**Stories:**`', sectionStart);
  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);
  const section = skillText.slice(sectionStart, sectionEnd);
  const examples = [...section.matchAll(/```markdown\n([\s\S]*?)\n```/g)];
  expect(examples).toHaveLength(1);
  return examples[0][1];
}

function invalidMessages(plan: string): string[] {
  const result = validatePlanSlices(plan);
  expect(result.kind).toBe('invalid');
  if (result.kind !== 'invalid') throw new Error('expected invalid sliced plan');
  return result.violations.map(({ message }) => message);
}

describe('plan skill slice-manifest contract', () => {
  it('documents one valid, fully assigned sliced plan example', async () => {
    const example = sliceExample(await readFile(planSkillPath, 'utf8'));
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
    const example = sliceExample(await readFile(planSkillPath, 'utf8'));
    const messages = invalidMessages(example.replace('| 2 | Follow-up | 3 |', '| 2 | Follow-up | 99 |'));

    expect(messages.join('; ')).toMatch(/Task 99.*unknown task id/i);
  });

  it('keeps every cited task dependent on its required Dependencies line', async () => {
    const example = sliceExample(await readFile(planSkillPath, 'utf8'));
    const withoutDependencies = example.replace(/^\*\*Dependencies:\*\*.*\n?/gm, '');
    const messages = invalidMessages(withoutDependencies);

    for (const taskId of ['1', '2', '3']) {
      expect(messages.join('; ')).toContain(`Task ${taskId} must declare exactly one Dependencies line`);
    }
  });
});
