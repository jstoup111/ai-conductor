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

  it('returns a findings-plus-optional-counterfactualSensitivity payload with closed vocabularies and a nested content-region anchor', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/required `findings` array and an optional\s+`counterfactualSensitivity` field/i);
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

  it('never reads, writes, or decides a disposition and judges only the supplied projection', async () => {
    const skill = await readFile(testQualitySkillPath, 'utf8');

    expect(skill).toMatch(/does not read, write, apply, or decide a disposition/i);
    expect(skill).toMatch(/engine owns scope selection,\s+evidence assembly,\s+result validation,\s+finding identity,\s+dispositions,\s+and the outer gate verdict/i);
    expect(skill).toMatch(/omit tests outside the supplied in-scope projection/i);
    expect(skill).not.toMatch(/build-review accept|record-reduced-coverage/);
  });
});
