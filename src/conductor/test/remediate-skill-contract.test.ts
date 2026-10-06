// Covers: S1.2, task:10

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const remediateSkillPath = new URL('../../../skills/remediate/SKILL.md', import.meta.url);

describe('remediate refusal-rework contract', () => {
  it('defines the engine-supplied refusal evidence block', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');

    expect(skill).toMatch(/refusal evidence/i);
    expect(skill).toMatch(/one refusal evidence entry per refused finding/i);
    expect(skill).toMatch(/presentation key/i);
    expect(skill).toMatch(/decision id and revision/i);
    expect(skill).toMatch(/operator's recorded refusal rationale/i);
    expect(skill).toMatch(/original-source snapshot/i);
  });

  it('requires the refusal-<decisionId> gap id, derived from the decision id only', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');

    expect(skill).toMatch(/`refusal-<decisionId>`/);
    expect(skill).toMatch(/durable decision id only/i);
    expect(skill).toMatch(/never from the presentation key/i);
  });

  it('admits one build disposition with concrete removal/rework tasks per refusal', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');

    expect(skill).toMatch(/`build` disposition whose `id`/i);
    expect(skill).toMatch(/concrete, file-scoped removal\/rework tasks/i);
  });

  it('keeps a refusal gap removal-only and forbids new capability', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');

    expect(skill).toMatch(/removal-only/i);
    expect(skill).toMatch(/remove the refused behavior or rework it/i);
    expect(skill).toMatch(/no task may introduce new capability/i);
    expect(skill).toMatch(/no new behavior may be\s+introduced/i);
  });
});