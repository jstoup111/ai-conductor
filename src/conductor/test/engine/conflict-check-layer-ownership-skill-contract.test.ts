// Covers: task:3
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const conflictCheckSkillPath = fileURLToPath(
  new URL('../../../../skills/conflict-check/SKILL.md', import.meta.url),
);
const coherenceCheckSkillPath = fileURLToPath(
  new URL('../../../../skills/coherence-check/SKILL.md', import.meta.url),
);

function layerOwnershipStatement(skill: string): string {
  const start = skill.indexOf('**Layer ownership.**');
  const end = skill.indexOf('\n\n', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return skill.slice(start, end);
}

function expectLayerOwnership(statement: string): void {
  expect(statement).toMatch(/story↔story pairs belong to `\/conflict-check`/i);
  expect(statement).toMatch(/cross-layer pairs[\s\S]*belong to `\/coherence-check`/i);
  expect(statement).toMatch(/task↔task pairs belong to `\/coherence-check`/i);
}

describe('conflict-check layer-ownership contract', () => {
  it('assigns story pairs to conflict-check and later-visible pairs to coherence-check', async () => {
    const conflictCheckSkill = await readFile(conflictCheckSkillPath, 'utf8');
    const ownership = layerOwnershipStatement(conflictCheckSkill);

    expectLayerOwnership(ownership);
    expect(ownership).toMatch(/`\/conflict-check` runs before `\/plan`/i);
    expect(ownership).toMatch(/cannot\s+see tasks/i);
  });

  it('agrees with coherence-check on the three pair-class owners', async () => {
    const coherenceCheckSkill = await readFile(coherenceCheckSkillPath, 'utf8');

    expectLayerOwnership(layerOwnershipStatement(coherenceCheckSkill));
  });
});
