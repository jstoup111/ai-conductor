// Covers: task:1, task:2, task:19
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const coherenceCheckSkillPath = fileURLToPath(
  new URL('../../../../skills/coherence-check/SKILL.md', import.meta.url),
);

async function coherenceCheckSkill(): Promise<string> {
  return readFile(coherenceCheckSkillPath, 'utf8');
}

function verdictVocabularySection(skill: string): string {
  const start = skill.indexOf('### 4b. Verdict Vocabulary');
  const end = skill.indexOf('\n### 4c.', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return skill.slice(start, end);
}

function layerOwnershipSection(skill: string): string {
  const start = skill.indexOf('**Layer ownership.**');
  const end = skill.indexOf('\n\n', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return skill.slice(start, end);
}

describe('coherence-check task-versus-task sweep contract', () => {
  it('assigns story, cross-layer, and task-pair sweeps to their owning checks', async () => {
    const skill = await coherenceCheckSkill();
    const ownership = layerOwnershipSection(skill);

    expect(ownership).toMatch(/story↔story pairs belong to `\/conflict-check`/i);
    expect(ownership).toMatch(/cross-layer and task versus task\s+pairs belong to plan review at Medium and Large tier/i);
    expect(ownership).toMatch(/plan's §7b at Small tier/i);
    expect(ownership).toMatch(/`\/conflict-check` runs before `\/plan`/i);
  });

  it('limits same-layer deferrals to story pairs', async () => {
    const skill = await coherenceCheckSkill();

    expect(skill).not.toContain("same-layer pairs are `/conflict-check`'s sweep");
    expect(skill).not.toContain('same-layer contradictions are what `/conflict-check` already sweeps for');

    for (const line of skill.split('\n')) {
      if (/same-layer/i.test(line) && /`\/conflict-check`/i.test(line)) {
        expect(line).toMatch(/story.?story/i);
      }
    }
  });

  it('retires the duplicated coverage and contradiction sweeps while preserving the exact verdict vocabulary', async () => {
    const skill = await coherenceCheckSkill();
    const verdictVocabulary = verdictVocabularySection(skill);
    const verdicts = [...verdictVocabulary.matchAll(/^- \*\*([^*]+)\*\*/gm)].map(
      ([, verdict]) => verdict,
    );

    expect(skill).not.toMatch(/^### 4d\./m);
    expect(skill).not.toMatch(/Before writing the artifact, run the plan skill's independent coverage judgement/i);
    expect(skill).not.toMatch(/contradiction or oscillation sweep/i);
    expect(skill).not.toMatch(/criterion-conflict sweep/i);
    expect(verdictVocabulary).not.toMatch(/§4d/);
    expect(skill.slice(skill.indexOf('### 4e.'), skill.indexOf('### 4f.'))).not.toMatch(/§4d/);
    expect(skill).toMatch(/\*\*adr\*\* —/);
    expect(skill).toMatch(/### 4f\. Architecture-Decision ↔ Plan Tie-Out/);
    expect(verdicts).toEqual(['covered', 'gap', 'fail']);
  });
});
