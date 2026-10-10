// Covers: task:1
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
});
