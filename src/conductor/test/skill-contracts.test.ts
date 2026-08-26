import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const architectureReviewSkillPath = fileURLToPath(
  new URL('../../../skills/architecture-review/SKILL.md', import.meta.url),
);

describe('architecture-review skill contract', () => {
  it('requires the as-built reviewer to report PLAN_GAP delivery', async () => {
    const skill = await readFile(architectureReviewSkillPath, 'utf8');

    expect(skill).toContain('Verdict: APPROVED | APPROVED WITH DRIFT NOTES | PLAN_GAP | BLOCKED');
    expect(skill).toContain('Outcome delivered:');
  });
});
