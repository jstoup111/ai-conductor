import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const tautologySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-tautology/SKILL.md', import.meta.url),
);
const scopeSkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-scope/SKILL.md', import.meta.url),
);
const rootCauseSkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-root-cause/SKILL.md', import.meta.url),
);
const completenessSkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-completeness/SKILL.md', import.meta.url),
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

  it('defines the versioned Scope judgement contract over plan and widening context only', async () => {
    const skill = await readFile(scopeSkillPath, 'utf8');

    expect(skill).toMatch(/^---\nname: build-review-scope\n/m);
    expect(skill).toMatch(/^description: ".+"$/m);
    expect(skill).toMatch(/^enforcement: gating$/m);
    expect(skill).toMatch(/^phase: build$/m);

    expect(skill).toMatch(/projection version.*`v1`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/changed diff/i);
    expect(skill).toMatch(/approved plan/i);
    expect(skill).toMatch(/repair context/i);
    expect(skill).toMatch(/accepted scope widenings/i);

    expect(skill).toMatch(/contract version.*`v1`/i);
    expect(skill).toMatch(/out-of-plan path or surface/i);
    expect(skill).toMatch(/plan-scope relation/i);
    expect(skill).toMatch(/typed logical anchors/i);
    expect(skill).toMatch(/concrete evidence locations/i);
    expect(skill).toMatch(/every independent finding/i);

    expect(skill).toMatch(/does not.*(?:read|write|apply|decide).*disposition/i);
    expect(skill).not.toMatch(/\b(?:claim|bypass)\b/i);
    expect(skill).not.toMatch(/run (?:the )?tests?/i);
    expect(skill).not.toMatch(/spawn subagents?|delegate (?:to )?(?:an )?agent/i);
  });

  it('defines the versioned Root Cause judgement contract over the stated defect and implementation', async () => {
    const skill = await readFile(rootCauseSkillPath, 'utf8');

    expect(skill).toMatch(/^---\nname: build-review-root-cause\n/m);
    expect(skill).toMatch(/^description: ".+"$/m);
    expect(skill).toMatch(/^enforcement: gating$/m);
    expect(skill).toMatch(/^phase: build$/m);

    expect(skill).toMatch(/projection version.*`v1`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/changed diff/i);
    expect(skill).toMatch(/approved plan/i);
    expect(skill).toMatch(/repair context/i);

    expect(skill).toMatch(/stated defect\/outcome/i);
    expect(skill).toMatch(/symptom-only/i);
    expect(skill).toMatch(/implementation mechanism or locus/i);
    expect(skill).toMatch(/typed logical anchors/i);
    expect(skill).toMatch(/concrete evidence locations/i);
    expect(skill).toMatch(/every independent finding/i);
    expect(skill).toMatch(/empty array.*PASS/i);

    expect(skill).toMatch(/does not.*(?:read|write|apply|decide).*disposition/i);
    expect(skill).not.toMatch(/\bruntime\b|\bmanual[_ -]?test\b/i);
    expect(skill).not.toMatch(/run (?:the )?tests?/i);
    expect(skill).not.toMatch(/spawn subagents?|delegate (?:to )?(?:an )?agent/i);
  });

  it('defines the versioned Completeness judgement contract over the full plan and diff', async () => {
    const skill = await readFile(completenessSkillPath, 'utf8');

    expect(skill).toMatch(/^---\nname: build-review-completeness\n/m);
    expect(skill).toMatch(/^description: ".+"$/m);
    expect(skill).toMatch(/^enforcement: gating$/m);
    expect(skill).toMatch(/^phase: build$/m);

    expect(skill).toMatch(/projection version.*`v1`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/full changed diff/i);
    expect(skill).toMatch(/approved plan/i);
    expect(skill).toMatch(/holistically/i);
    expect(skill).toMatch(/plan.*diff.*whole/i);

    expect(skill).toMatch(/default-enabled/i);
    expect(skill).toMatch(/engine.*explicit disablement/i);
    expect(skill).toMatch(/missing deliverable/i);
    expect(skill).toMatch(/approved plan outcome\/task/i);
    expect(skill).toMatch(/typed logical anchors/i);
    expect(skill).toMatch(/concrete evidence locations/i);
    expect(skill).toMatch(/every independent finding/i);

    expect(skill).toMatch(/does not.*(?:read|write|apply|decide).*disposition/i);
    expect(skill).not.toMatch(/per-task SHA|commit reachability|corroborating evidence/i);
    expect(skill).not.toMatch(/run (?:the )?tests?/i);
    expect(skill).not.toMatch(/spawn subagents?|delegate (?:to )?(?:an )?agent/i);
  });
});
