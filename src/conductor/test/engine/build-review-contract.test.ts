// Covers: task:1
// Covers: task:2
import { describe, expect, it } from 'vitest';

import {
  renderRubricContractShape,
  resolveBuildReviewContractCatalog,
  type BuildReviewContractCatalogMember,
} from '../../src/engine/build-review-contract.js';
import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  BUILD_REVIEW_JUDGED_V3_SCHEMA,
} from '../../src/engine/build-review-domain.js';
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

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected JSON Schema object');
  }
  return value as Record<string, unknown>;
}

function properties(schema: unknown): Record<string, unknown> {
  return record(record(schema).properties);
}

function enumValues(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(enumValues);
  if (schema === null || typeof schema !== 'object') return [];
  const source = schema as Record<string, unknown>;
  const direct = Array.isArray(source.enum)
    ? source.enum.flatMap((value) => typeof value === 'string' || typeof value === 'number' ? [String(value)] : [])
    : [];
  return [...direct, ...Object.values(source).flatMap(enumValues)];
}

function expectedShapeTokens(schema: unknown): string[] {
  return [...new Set([...Object.keys(properties(schema)), ...enumValues(schema)])].sort();
}

function renderedShapeTokens(shape: string): string[] {
  return [...new Set([...shape.matchAll(/`([^`]+)`/g)].map((match) => match[1]!))].sort();
}

function expectClosedJudgedV3TopLevel(schema: unknown): void {
  expect(Object.keys(properties(schema))).toEqual([
    'findings',
    'relocationAudit',
    'counterfactualSensitivity',
    'scopeResolutions',
  ]);
  expect(record(schema).additionalProperties).toBe(false);
}

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

  it('closes judged-v3 output to the four provider-owned fields', () => {
    expectClosedJudgedV3TopLevel(BUILD_REVIEW_JUDGED_V3_SCHEMA);

    expect(() => expectClosedJudgedV3TopLevel({
      ...BUILD_REVIEW_JUDGED_V3_SCHEMA,
      properties: { ...properties(BUILD_REVIEW_JUDGED_V3_SCHEMA), extra: { type: 'string' } },
    })).toThrow();
  });

  it.each(['testQuality', 'security'] as const)(
    'binds %s concern kinds directly from the engine vocabulary',
    (rubric) => {
      const findings = record(properties(BUILD_REVIEW_RUBRIC_REGISTRY[rubric].contract.output.jsonSchema).findings);
      const items = record(findings.items);
      const concernKind = record(properties(items).concernKind);

      expect(concernKind.enum).toEqual(BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds);
    },
  );

  it.each(['testQuality', 'security'] as const)(
    'renders %s prompt-shape tokens exclusively from its output schema',
    (rubric) => {
      const descriptor = BUILD_REVIEW_RUBRIC_REGISTRY[rubric].contract;

      expect(renderedShapeTokens(renderRubricContractShape(descriptor))).toEqual(
        expectedShapeTokens(descriptor.output.jsonSchema),
      );
    },
  );
});
