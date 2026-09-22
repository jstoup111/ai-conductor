// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  resolveBuildReviewContractCatalog,
  type BuildReviewContractCatalogMember,
} from '../../src/engine/build-review-contract.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { BUILD_REVIEW_RUBRIC_REGISTRY } from '../../src/engine/build-review-registry.js';

function fixedFinding(rubric: 'testQuality' | 'security') {
  return {
    rubric,
    contractVersion: 'v3' as const,
    concernKind: rubric === 'testQuality' ? 'test-insensitive' as const : 'committed-secret' as const,
    anchor: {
      rubric,
      locus: {
        path: 'test/engine/build-review-contract.test.ts',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        display: 'fixed finding',
      },
    },
  };
}

const builtinMembers = Object.entries(BUILD_REVIEW_RUBRIC_REGISTRY).map(([id, member]) => ({
  id,
  contract: member.contract,
}));

describe('engine/build-review-contract', () => {
  it.each(['testQuality', 'security'] as const)(
    'gives %s an engine-owned v3 descriptor with canonical identity',
    (id) => {
      const { contract } = BUILD_REVIEW_RUBRIC_REGISTRY[id];
      const finding = fixedFinding(id);
      const expected = canonicalizeBuildReviewFindingIdentity(finding);

      expect(contract.projection.version).toBe('v3');
      expect(contract.output.version).toBe('v3');
      expect(Object.isFrozen(contract.output.jsonSchema)).toBe(true);
      expect(contract.identity.canonicalize(finding)?.id).toBe(expected?.id);
    },
  );

  it('rejects a member without output.jsonSchema while resolving the contract catalog', () => {
    const member = {
      ...builtinMembers[0],
      contract: {
        ...builtinMembers[0]!.contract,
        output: {
          ...builtinMembers[0]!.contract.output,
          jsonSchema: undefined,
        },
      },
    } as unknown as BuildReviewContractCatalogMember;

    expect(() => resolveBuildReviewContractCatalog([member])).toThrow(/testQuality.*output\.jsonSchema/i);
  });

  it('rejects duplicate rubric ids while resolving the contract catalog', () => {
    const [first] = builtinMembers;
    const duplicate = { ...first!, id: first!.id };

    expect(() => resolveBuildReviewContractCatalog([first!, duplicate])).toThrow(/testQuality/i);
  });
});
