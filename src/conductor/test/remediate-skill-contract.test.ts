// Covers: S1.2, task:10

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const remediateSkillPath = new URL('../../../skills/remediate/SKILL.md', import.meta.url);

describe('remediate refusal-rework contract', () => {
  it('keeps a refusal gap removal-only and forbids new capability', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');

    expect(skill).toMatch(/removal-only/i);
    expect(skill).toMatch(/remove the refused behavior or rework it/i);
    expect(skill).toMatch(/no task may introduce new capability/i);
    expect(skill).toMatch(/no new behavior may be\s+introduced/i);
  });
});
