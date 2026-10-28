// Covers: task:20
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const skillPath = new URL('../../../../skills/plan/SKILL.md', import.meta.url);

function section(skill: string, heading: string, nextHeading: string): string {
  const start = skill.indexOf(heading);
  const end = skill.indexOf(nextHeading, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return skill.slice(start, end);
}

describe('plan contradiction tier contract', () => {
  it('keeps §7b for Small tier and assigns Medium and Large contradictions to plan review', async () => {
    const skill = await readFile(skillPath, 'utf8');
    const coverageCheck = section(skill, '### 7. Coverage Check', '#### 7a.');
    const coverageJudgement = section(skill, '#### 7a.', '#### 7b.');
    const contradictionJudgement = section(skill, '#### 7b.', '**GATE: Every citable decision');

    expect(coverageCheck).toMatch(/Medium and Large[\s\S]*?plan review/i);
    expect(coverageJudgement).not.toMatch(/coherence-check[\s\S]*?repeats/i);
    expect(contradictionJudgement).toMatch(/only at tier S/i);
    expect(contradictionJudgement).toMatch(/stories file[\s\S]*?every plan task[\s\S]*?Decision.*approved ADR/i);
    expect(contradictionJudgement).toMatch(/would necessarily violate/i);
    expect(contradictionJudgement).toMatch(/cannot represent\s+state/i);
    expect(contradictionJudgement).toMatch(/Stop after three rounds/i);
    expect(contradictionJudgement).not.toMatch(/coherence-check[\s\S]*?repeats/i);
  });
});
