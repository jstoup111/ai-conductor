import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testQualitySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-test-quality/SKILL.md', import.meta.url),
);

describe('build-review Test Quality skill contract', () => {
  it('requires concrete stub-passable evidence rather than treating preflight as a verdict', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/`stayed-green`.*not automatically/i);
    expect(skill).toMatch(/concrete stub-passable assertion/i);
    expect(skill).toMatch(/`infrastructure-failure`.*not a finding/i);
  });
});
