// Covers: task:1, task:2
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const coherenceCheckSkillPath = fileURLToPath(
  new URL('../../../../skills/coherence-check/SKILL.md', import.meta.url),
);

async function taskOscillationSection(): Promise<string> {
  const skill = await readFile(coherenceCheckSkillPath, 'utf8');
  const start = skill.indexOf('**Task-versus-task oscillation.**');
  const end = skill.indexOf('\n**Preserved-behavior sweep.**', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return skill.slice(start, end);
}

async function coherenceCheckSkill(): Promise<string> {
  return readFile(coherenceCheckSkillPath, 'utf8');
}

function verificationSection(skill: string): string {
  const start = skill.indexOf('## Verification');

  expect(start).toBeGreaterThanOrEqual(0);
  return skill.slice(start);
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
  const end = skill.indexOf('\n**Task-versus-task oscillation.**', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return skill.slice(start, end);
}

describe('coherence-check task-versus-task sweep contract', () => {
  it('checks overlapping task pairs in both directions and records grounded invalidations', async () => {
    const section = await taskOscillationSection();

    expect(section).toMatch(/sharing (?:a )?behavior, entity, file or\s+fixture/i);
    expect(section).toMatch(/if I fully complete task A, does task B's `Done when` still hold\?/i);
    expect(section).toMatch(/both\s+directions/i);
    expect(section).toMatch(/affected `task` row[\s\S]*`fail`/i);
    expect(section).toMatch(/Notes[\s\S]*quot(?:e|ing)[\s\S]*opposing text from both tasks/i);
  });

  it('classifies grounded task invalidations without inventing a row verdict', async () => {
    const section = await taskOscillationSection();

    expect(section).toMatch(/both\s+directions[\s\S]*oscillation/i);
    expect(section).toMatch(/one direction.*contradiction/i);
    expect(section).toMatch(/record both as\s+`fail`/i);
    expect(section).toMatch(/`fail`, never (?:`oscillation`|`interference`)/i);
    expect(section).toMatch(/dependency graph[\s\S]*either\s+order/i);
  });

  it('escalates ungrounded suspicions and skips pairs with no shared scope', async () => {
    const section = await taskOscillationSection();

    expect(section).toMatch(/cannot be grounded.*quoted text from both tasks/i);
    expect(section).toMatch(/operator as an assumption.*no `fail`/i);
    expect(section).toMatch(/nothing shared[\s\S]*need no row, section,\s+or verdict/i);
    expect(section).toMatch(/existing `task` rows[\s\S]*coverage verdicts/i);
  });

  it('assigns story, cross-layer, and task-pair sweeps to their owning checks', async () => {
    const skill = await coherenceCheckSkill();
    const ownership = layerOwnershipSection(skill);

    expect(ownership).toMatch(/story↔story pairs belong to `\/conflict-check`/i);
    expect(ownership).toMatch(/cross-layer pairs[\s\S]*?belong to `\/coherence-check`/i);
    expect(ownership).toMatch(/task↔task pairs belong to `\/coherence-check`/i);
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

  it('checks task pairs and preserves the exact verdict vocabulary', async () => {
    const skill = await coherenceCheckSkill();
    const verification = verificationSection(skill);
    const verdictVocabulary = verdictVocabularySection(skill);
    const verdicts = [...verdictVocabulary.matchAll(/^- \*\*([^*]+)\*\*/gm)].map(
      ([, verdict]) => verdict,
    );

    expect(verification).toMatch(
      /Task↔task pairs sharing a behavior, entity, file or fixture checked in both directions; any\s+invalidation recorded as `fail` on the `task` row\./,
    );
    expect(verdicts).toEqual(['covered', 'gap', 'fail']);
  });
});
