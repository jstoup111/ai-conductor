// Covers: task:12
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  parseBuildReviewFindingAnchor,
  parseBuildReviewFindingConcernKind,
} from '../../src/engine/build-review-domain.js';

const testQualitySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-test-quality/SKILL.md', import.meta.url),
);
const securitySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-security/SKILL.md', import.meta.url),
);

function judgementSection(skill: string): string {
  return skill.split('## Judgement\n')[1]?.split('\n## ')[0] ?? '';
}

function expectVocabularyDefinitions(skill: string, rubric: keyof typeof BUILD_REVIEW_FINDING_VOCABULARIES): void {
  const judgement = judgementSection(skill);

  expect(judgement).not.toBe('');
  for (const concernKind of BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds) {
    expect(judgement).toContain(`\`${concernKind}\``);
  }
}

describe('build-review Test Quality skill contract', () => {
  it('requires concrete stub-passable evidence rather than treating preflight as a verdict', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/`stayed-green`.*not automatically/i);
    expect(skill).toMatch(/concrete,\s+stub-passable assertion/i);
    expect(skill).toMatch(/infrastructure failure.*not a finding/i);
  });

  it('is a gating build-phase judgement-only contract that the engine dispatches, never the operator', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');
    const frontmatter = skill.split('---')[1] ?? '';

    expect(frontmatter).toMatch(/^name: build-review-test-quality$/m);
    expect(frontmatter).toMatch(/^disable-model-invocation: true$/m);
    expect(frontmatter).toMatch(/^enforcement: gating$/m);
    expect(frontmatter).toMatch(/^phase: build$/m);
    expect(skill).toMatch(/judgement-only contract/i);
  });

  it('defines its engine vocabulary and non-finding conditions in Judgement', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expectVocabularyDefinitions(skill, 'testQuality');
    expect(skill).toMatch(/`supports` means either an executed in-scope example fails on the reverted tree, or the reverted\s+production causes the intended tests to fail during collection or load/i);
    expect(skill).toMatch(/`indeterminate`[\s\S]*#1915 database-auth or boot failures/i);
    expect(skill).toMatch(/`indeterminate`[\s\S]*neither sensitivity support nor a finding/i);
    expect(skill).toMatch(/`not-applicable` means the counterfactual evidence does not apply/i);
  });

  it('judges only the supplied projection and excludes out-of-scope tests', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/engine owns scope selection,\s+evidence assembly,\s+result validation,\s+finding identity,\s+the stamped result envelope,\s+and the outer gate verdict/i);
    expect(skill).toMatch(/Tests outside the\s+supplied in-scope set are not this rubric's concern/i);
    expect(skill).not.toMatch(/build-review accept|record-reduced-coverage/);
  });
});

describe('build-review Security skill contract', () => {
  it('is a gating build-phase judgement-only contract', async () => {
    const skill = await readFile(securitySkillPath, 'utf8');
    const frontmatter = skill.split('---')[1] ?? '';

    expect(frontmatter).toMatch(/^name: build-review-security$/m);
    expect(frontmatter).toMatch(/^disable-model-invocation: true$/m);
    expect(frontmatter).toMatch(/^enforcement: gating$/m);
    expect(frontmatter).toMatch(/^phase: build$/m);
    expect(skill).toMatch(/judgement-only contract/i);
  });

  it('defines all ten concern kinds, explicit non-findings, and integer confidence', async () => {
    const skill = await readFile(securitySkillPath, 'utf8');

    expectVocabularyDefinitions(skill, 'security');
    for (const kind of BUILD_REVIEW_FINDING_VOCABULARIES.security.concernKinds) {
      expect(skill).toMatch(new RegExp('`' + kind + '`[\\s\\S]{0,700}?(?:Non-finding|not a finding)', 'i'));
    }
    expect(skill).toMatch(/one finding per independent defect/i);
    expect(skill).toMatch(/introducing hunk/i);
    expect(skill).toMatch(/unchanged sinks?[^.]*`evidenceLocations`/i);
  });

  it('models an unchanged-sink finding with the sink only in evidence locations', () => {
    const locus = {
      path: 'src/request.ts',
      contentHash: `sha256:${'a'.repeat(64)}`,
      display: 'changed request construction hunk',
    };
    const finding = {
      concernKind: 'injection',
      confidence: 90,
      summary: 'The changed request construction exposes the existing execution sink.',
      evidenceLocations: ['src/legacy-request.ts:42'],
      anchor: { rubric: 'security', locus },
    };

    expect(parseBuildReviewFindingConcernKind(finding.concernKind, 'security')).toBe('injection');
    expect(parseBuildReviewFindingAnchor(finding.anchor, {
      changedTests: [], changedContentRegions: [locus], changedPaths: [locus.path], planTasks: [],
    })).toEqual(finding.anchor);
    expect(finding.anchor.locus.path).toBe('src/request.ts');
    expect(finding.evidenceLocations).toEqual(['src/legacy-request.ts:42']);
  });
});
