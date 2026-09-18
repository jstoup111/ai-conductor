// Covers: task:9
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const coverageBindingSkillPath = new URL(
  '../../../../skills/coverage-binding/SKILL.md',
  import.meta.url,
);

describe('coverage-binding skill contract', () => {
  it('requires an independent digest-keyed verdict for every supplied claim', async () => {
    const skill = await readFile(coverageBindingSkillPath, 'utf8');

    expect({
      multiClaimEnvelope: skill.includes('{ "verdicts": [ { "digest": "...", "verdict": "asserts" }, { "digest": "...", "verdict": "does-not-assert", "missingAssertion": "..." } ] }'),
      oneEntryPerClaim: skill.includes('one entry per supplied claim, keyed by the supplied `digest`'),
      independentClaims: skill.includes("Each claim is judged independently")
        && skill.includes("No claim's\nverdict may be inferred from another claim."),
      closedVerdictVocabulary: skill.includes('`verdict` is closed to `asserts`\nor `does-not-assert`. Include a non-empty `missingAssertion` only with `does-not-assert`.'),
    }).toEqual({
      multiClaimEnvelope: true,
      oneEntryPerClaim: true,
      independentClaims: true,
      closedVerdictVocabulary: true,
    });
  });
});
