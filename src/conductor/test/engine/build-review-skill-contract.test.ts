import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const tautologySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-tautology/SKILL.md', import.meta.url),
);

describe('build-review Tautology skill contract', () => {
  it('requires a finding when a red excerpt proves no test executed', async () => {
    const skill = await readFile(tautologySkillPath, 'utf8');

    expect(skill).toMatch(/run kind.*`passed`.*`nonzero-exit`/i);
    expect(skill).toMatch(/no test executed.*finding/i);
    expect(skill).toMatch(/never overrides.*four closed exceptions/i);
    expect(skill).toMatch(/never manufactures.*finding.*ambiguous excerpt/i);
  });
});
