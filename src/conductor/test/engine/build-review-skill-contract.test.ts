// Covers: task:12
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  parseBuildReviewFindingAnchor,
  parseBuildReviewFindingConcernKind,
} from '../../src/engine/build-review-domain.js';

const testQualitySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-test-quality/SKILL.md', import.meta.url),
);
const securitySkillPath = fileURLToPath(
  new URL('../../../../skills/build-review-security/SKILL.md', import.meta.url),
);

describe('build-review Test Quality skill contract', () => {
  it('requires concrete stub-passable evidence rather than treating preflight as a verdict', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/`stayed-green`.*not automatically/i);
    expect(skill).toMatch(/concrete stub-passable assertion/i);
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

  it('renders one coherent provider payload, while the engine stamps the v3 envelope afterward', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/Return exactly one provider payload JSON object with a required `findings` array, required\s+`scopeResolutions` array, and optional `counterfactualSensitivity` field/i);
    expect(skill).toMatch(/Do not return `kind`, `rubric`, `contractVersion`, `lapId`, `snapshotDigest`, or\s+`verdict`: the engine stamps that `judged` envelope identity after validating this provider payload/i);
    expect(skill).not.toMatch(/Return exactly one JSON object.*top-level.*`kind`/i);
    expect(skill).toMatch(/"counterfactualSensitivity": "supports \| indeterminate \| not-applicable"/);
    expect(skill).toMatch(/`supports` means either an executed in-scope example fails on the reverted tree, or the reverted\s+production causes the intended tests to fail during collection or load/i);
    expect(skill).toMatch(/`indeterminate`[\s\S]*#1915 database-auth or boot failures/i);
    expect(skill).toMatch(/`indeterminate`[\s\S]*neither sensitivity support nor a finding/i);
    expect(skill).toMatch(/`not-applicable` means the counterfactual evidence does not apply/i);
    expect(skill).toMatch(/\*\*Closed vocabulary:\*\* `test-insensitive`\./);
    expect(skill).toMatch(/sole allowed member `test-insensitive`/);
    expect(skill).toMatch(/`concernKind` field \(never `kind`\)/);
    expect(skill).toMatch(/"rubric": "testQuality", "locus"/);
    expect(skill).toMatch(/0-based ordinal .* omit when unique/);
    expect(skill).toMatch(/never flattened/i);
  });

  it('requires one source-grounded disposition for each supplied fallback candidate', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/`scopeResolutions`/i);
    expect(skill).toMatch(/`resolved`, `out-of-scope`, or `indeterminate`/i);
    expect(skill).toMatch(/candidateId/i);
  });

  it('reports candidate resolutions only from supplied authority and judges only the supplied projection', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/does not read, write, or apply a disposition/i);
    expect(skill).toMatch(/engine owns scope selection,\s+evidence assembly,\s+result validation,\s+finding identity,\s+the stamped result envelope,\s+and the outer gate verdict/i);
    expect(skill).toMatch(/omit tests outside the supplied in-scope projection/i);
    expect(skill).not.toMatch(/build-review accept|record-reduced-coverage/);
  });
});

describe('build-review Security skill contract', () => {
  it('is a gating build-phase judgement-only contract with a findings-only result', async () => {
    const skill = await readFile(securitySkillPath, 'utf8');
    const frontmatter = skill.split('---')[1] ?? '';

    expect(frontmatter).toMatch(/^name: build-review-security$/m);
    expect(frontmatter).toMatch(/^disable-model-invocation: true$/m);
    expect(frontmatter).toMatch(/^enforcement: gating$/m);
    expect(frontmatter).toMatch(/^phase: build$/m);
    expect(skill).toMatch(/judgement-only contract/i);
    expect(skill).toMatch(/required `findings` array/i);
    expect(skill).not.toMatch(/`scopeResolutions`/);
    expect(skill).not.toMatch(/`counterfactualSensitivity`/);
    expect(skill).not.toMatch(/`boundTo`/);
  });

  it('defines all ten concern kinds, explicit non-findings, and integer confidence', async () => {
    const skill = await readFile(securitySkillPath, 'utf8');
    const kinds = [
      'committed-secret', 'injection', 'broken-access-control', 'path-traversal',
      'unsafe-deserialization', 'cryptographic-failure', 'security-misconfiguration',
      'authentication-failure', 'integrity-failure', 'ssrf',
    ];

    for (const kind of kinds) {
      expect(skill).toMatch(new RegExp('`' + kind + '`[\\s\\S]{0,700}?(?:Non-finding|not a finding)', 'i'));
    }
    expect(skill).toMatch(/integer `confidence`/i);
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
