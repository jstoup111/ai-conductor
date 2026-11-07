// Covers: task:8
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { validatePlanDependencies } from '../../src/engine/plan-dependencies.js';

const planSkillPath = fileURLToPath(
  new URL('../../../../skills/plan/SKILL.md', import.meta.url),
);
const DEPENDENCY_TEMPLATE = '**Dependencies:** [Task N that must complete first, or "none"]';
const TASK_REFERENCE_ID = '[A-Za-z0-9._-]+';
const STRICT_DEPENDENCIES = new RegExp(
  `^(?:none|(?:Tasks?\\s+)?${TASK_REFERENCE_ID}(?:,\\s*(?:Tasks?\\s+)?${TASK_REFERENCE_ID})*)$`,
  'i',
);

function proseLines(skill: string): string[] {
  let fenced = false;
  return skill.split('\n').filter((line) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

function slicedPlanExample(skill: string): string {
  const sliceStart = skill.indexOf('## Slice manifest');
  const sliceEnd = skill.indexOf('\n### `**Stories:**`', sliceStart);
  const sliceSection = skill.slice(sliceStart, sliceEnd);
  const match = sliceSection.match(/```markdown\n([\s\S]*?)\n```/);
  if (!match) throw new Error('expected the Slice manifest to contain a Markdown example');
  return match[1];
}

describe('plan skill dependency contract', () => {
  it('states that Task Dependency Graph is optional and never sufficient on its own', async () => {
    const skill = await readFile(planSkillPath, 'utf8');

    expect(skill).not.toContain('or the plan includes a `## Task Dependency Graph` section');
    for (const line of proseLines(skill).filter((line) => line.includes('Task Dependency Graph'))) {
      expect(line).toMatch(/optional/i);
    }
  });

  it('states the complete enforced dependency rule in the section 1 precondition', async () => {
    const skill = await readFile(planSkillPath, 'utf8');
    const preconditions = skill.slice(
      skill.indexOf('### 1. Validate Preconditions'),
      skill.indexOf('### 2. Read All Stories'),
    );

    for (const required of [
      'exactly one', 'none', 'comma-separated', 'task reference', 'remediation',
      'declared', 'acyclic', 'land', '`plan` gate',
    ]) {
      expect(preconditions.toLowerCase()).toContain(required.toLowerCase());
    }
  });

  it('keeps documented Dependencies examples in strict grammar and the sliced example valid', async () => {
    const skill = await readFile(planSkillPath, 'utf8');
    const dependencies = [...skill.matchAll(/^\*\*Dependencies:\*\*\s*(.+)$/gm)]
      .map((match) => match[0])
      .filter((line) => line !== DEPENDENCY_TEMPLATE)
      .map((line) => line.replace(/^\*\*Dependencies:\*\*\s*/, ''));

    expect(dependencies).not.toHaveLength(0);
    for (const value of dependencies) {
      expect(value).toMatch(STRICT_DEPENDENCIES);
      expect(value).not.toMatch(/\d+\s*[–-]\s*\d+/);
    }
    expect(validatePlanDependencies(slicedPlanExample(skill))).toEqual([]);
  });
});
