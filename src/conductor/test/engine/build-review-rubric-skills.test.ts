import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const tautologySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-tautology/SKILL.md', import.meta.url),
);

describe('engine/build-review rubric skill contracts', () => {
  it('defines the versioned Tautology judgement contract over its closed projection', async () => {
    const skill = await readFile(tautologySkillPath, 'utf8');

    expect(skill).toMatch(/^---\nname: build-review-tautology\n/m);
    expect(skill).toMatch(/^description: ".+"$/m);
    expect(skill).toMatch(/^enforcement: gating$/m);
    expect(skill).toMatch(/^phase: build$/m);

    expect(skill).toMatch(/projection version.*`v1`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/current.*`test_suite`.*PASS/i);
    expect(skill).toMatch(/typed.*preflight evidence/i);
    expect(skill).toMatch(/changed-test selectors/i);
    expect(skill).toMatch(/reverted-production patch/i);

    expect(skill).toMatch(/contract version.*`v1`/i);
    expect(skill).toMatch(/concern kind/i);
    expect(skill).toMatch(/changed test/i);
    expect(skill).toMatch(/exercised behavior\/assertion/i);
    expect(skill).toMatch(/violation kind/i);
    expect(skill).toMatch(/concrete evidence locations/i);
    expect(skill).toMatch(/every independent finding/i);

    expect(skill).toMatch(/`red`.*expected.*evidence/i);
    expect(skill).toMatch(/`stayed-green`.*blocking finding/i);
    expect(skill).toMatch(/`infrastructure-failure`.*not.*finding/i);
    expect(skill).toMatch(/does not.*(?:read|write|apply|decide).*disposition/i);

    expect(skill).not.toMatch(/run (?:the )?tests?/i);
    expect(skill).not.toMatch(/spawn subagents?|delegate (?:to )?(?:an )?agent/i);
  });
});
