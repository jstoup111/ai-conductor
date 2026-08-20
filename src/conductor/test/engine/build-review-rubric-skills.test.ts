import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILD_REVIEW_FINDING_VOCABULARIES } from '../../src/engine/build-review-domain.js';

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

const vocabularyLine = /^\*\*Closed vocabulary:\*\*\s+(.+?)(?=\n\n)/ms;

function documentedVocabulary(skill: string): string[] {
  const matched = skill.match(vocabularyLine);
  if (!matched) throw new Error('missing closed vocabulary declaration');
  return [...matched[1].matchAll(/`([^`]+)`/g)].map((entry) => entry[1]).sort();
}

function expectFindingsOnlyProviderPayload(skill: string, rubric: string): void {
  expect(skill).toContain('Return exactly one JSON object whose only top-level field is `findings`, an array.');
  expect(skill).toContain('The engine owns\nthe `judged` envelope and stamps its kind, rubric, contract version, lap identity, and snapshot\nidentity after validating this findings-only payload.');
  expect(skill).toMatch(new RegExp(`empty\\s+array means (?:no ${rubric} concern was found|a PASS for this rubric)`, 'i'));
}

describe('engine/build-review rubric skill contracts', () => {
  it('keeps every rubric skill’s closed vocabulary equal to the engine source in both directions', async () => {
    const skills = {
      tautology: await readFile(tautologySkillPath, 'utf8'),
      scope: await readFile(scopeSkillPath, 'utf8'),
      rootCause: await readFile(rootCauseSkillPath, 'utf8'),
      completeness: await readFile(completenessSkillPath, 'utf8'),
    } as const;

    for (const rubric of Object.keys(skills) as Array<keyof typeof skills>) {
      expect(documentedVocabulary(skills[rubric]))
        .toEqual([...BUILD_REVIEW_FINDING_VOCABULARIES[rubric].members].sort());
      for (const member of BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds) {
        expect(skills[rubric]).toContain(`\`${member}\``);
      }
      for (const [field, members] of Object.entries(BUILD_REVIEW_FINDING_VOCABULARIES[rubric].anchorFields)) {
        expect(skills[rubric]).toContain(`\`${field}\``);
        for (const member of members) expect(skills[rubric]).toContain(`\`${member}\``);
      }
    }
  });

  it('defines the versioned Tautology judgement contract over its closed projection', async () => {
    const skill = await readFile(tautologySkillPath, 'utf8');

    expect(skill).toMatch(/^---\nname: build-review-tautology\n/m);
    expect(skill).toMatch(/^description: ".+"$/m);
    expect(skill).toMatch(/^enforcement: gating$/m);
    expect(skill).toMatch(/^phase: build$/m);

    expect(skill).toMatch(/projection version.*`v2`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/`contentDigest`/);
    expect(skill).toMatch(/current.*`test_suite`.*PASS/i);
    expect(skill).toMatch(/typed.*preflight evidence/i);
    expect(skill).toMatch(/changed-test selectors/i);
    // #1600 replaced the embedded reverted-production patch with a
    // content-free manifest (path + merge-base blob sha per file).
    expect(skill).toMatch(/reverted-production manifest/i);

    expect(skill).toContain('Return exactly one JSON object whose only top-level field is `findings`, an array.');
    expect(skill).toContain('The engine owns\nthe `judged` envelope and stamps its kind, rubric, contract version, lap identity, and snapshot\nidentity after validating this findings-only payload.');
    expect(skill).toMatch(/empty\s+array means no Tautology concern was found/i);
    expect(skill).toMatch(/concern kind/i);
    expect(skill).toMatch(/changed test/i);
    expect(skill).toMatch(/exercised behavior\/assertion/i);
    expect(skill).toMatch(/violation kind/i);
    expect(skill).toMatch(/"rubric": "tautology", "changedTest": \{"path": "<repository-relative path>",/);
    expect(skill).toMatch(/never\s+flattened/i);
    expect(skill).toMatch(/concrete evidence locations/i);
    expect(skill).toMatch(/every independent finding/i);

    expect(skill).toMatch(/`red`.*expected.*evidence/i);
    expect(skill).toMatch(/`stayed-green`.*blocking finding/i);
    expect(skill).toMatch(/`infrastructure-failure`.*not.*finding/i);
    expect(skill).toMatch(/does not.*(?:read|write|apply|decide).*disposition/i);

    expect(skill).not.toMatch(/run (?:the )?tests?/i);
    expect(skill).not.toMatch(/spawn subagents?|delegate (?:to )?(?:an )?agent/i);
  });

  it('defines the versioned Scope judgement contract over plan, widening, and operator-reseal context', async () => {
    const skill = await readFile(scopeSkillPath, 'utf8');

    expect(skill).toMatch(/^---\nname: build-review-scope\n/m);
    expect(skill).toMatch(/^description: ".+"$/m);
    expect(skill).toMatch(/^enforcement: gating$/m);
    expect(skill).toMatch(/^phase: build$/m);

    expect(skill).toMatch(/projection version.*`v2`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/`contentDigest`/);
    expect(skill).toMatch(/changed diff/i);
    expect(skill).toMatch(/approved plan/i);
    expect(skill).toMatch(/repair context/i);
    expect(skill).toMatch(/accepted scope widenings/i);
    expect(skill).toMatch(/operator-reseal/i);
    expect(skill).toMatch(/verbatim rationale/i);
    expect(skill).toMatch(/named paths/i);
    expect(skill).toMatch(/commit range/i);
    expect(skill).toMatch(/judge.*rationale/i);
    expect(skill).toMatch(/unmatched paths?.*normally/i);
    expect(skill).toMatch(/does not.*exempt/i);

    expect(skill).toContain('Return exactly one JSON object whose only top-level field is `findings`, an array.');
    expect(skill).toContain('The engine owns\nthe `judged` envelope and stamps its kind, rubric, contract version, lap identity, and snapshot\nidentity after validating this findings-only payload.');
    expect(skill).toMatch(/empty\s+array means no Scope concern was found/i);
    expect(skill).toMatch(/out-of-plan path or surface/i);
    expect(skill).toMatch(/plan-scope relation/i);
    expect(skill).toMatch(/"rubric": "scope", "path": "<string>"/);
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

    expect(skill).toMatch(/projection version.*`v2`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/`contentDigest`/);
    expect(skill).toMatch(/changed diff/i);
    expect(skill).toMatch(/approved plan/i);
    expect(skill).toMatch(/repair context/i);

    expect(skill).toMatch(/stated defect\/outcome/i);
    expect(skill).toMatch(/symptom-only/i);
    expect(skill).toMatch(/implementation mechanism or locus/i);
    expectFindingsOnlyProviderPayload(skill, 'Root Cause');
    expect(skill).toMatch(/"rubric": "rootCause", "statedDefect":/);
    expect(skill).toMatch(/"locus": \{"path": "<repository-relative path>",/);
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

    expect(skill).toMatch(/projection version.*`v2`/i);
    expect(skill).toMatch(/lap (?:ID|identity)/i);
    expect(skill).toMatch(/snapshot digest/i);
    expect(skill).toMatch(/`contentDigest`/);
    expect(skill).toMatch(/full changed diff/i);
    expect(skill).toMatch(/approved plan/i);
    expect(skill).toMatch(/holistically/i);
    expect(skill).toMatch(/plan.*diff.*whole/i);

    expect(skill).toMatch(/default-enabled/i);
    expectFindingsOnlyProviderPayload(skill, 'Completeness');
    expect(skill).toMatch(/engine.*explicit disablement/i);
    expect(skill).toMatch(/missing deliverable/i);
    expect(skill).toMatch(/approved plan outcome\/task/i);
    expect(skill).toMatch(/"rubric": "completeness", "planTask": "<projection task reference>"/);
    expect(skill).toMatch(/"missingSurface": "<task-owned plan surface reference>"/);
    expect(skill).toMatch(/"missingKind": "missing-deliverable"/);
    expect(skill).toMatch(/`missingKind`.*role-specific.*matches.*`concernKind`/is);
    expect(skill).toMatch(/typed logical anchors/i);
    expect(skill).toMatch(/concrete evidence locations/i);
    expect(skill).toMatch(/every independent finding/i);

    expect(skill).toMatch(/does not.*(?:read|write|apply|decide).*disposition/i);
    expect(skill).not.toMatch(/per-task SHA|commit reachability|corroborating evidence/i);
    expect(skill).not.toMatch(/run (?:the )?tests?/i);
    expect(skill).not.toMatch(/spawn subagents?|delegate (?:to )?(?:an )?agent/i);
  });

});
