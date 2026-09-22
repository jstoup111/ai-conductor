// Covers: task:1, task:3
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
import {
  canonicalizeBuildReviewFindingIdentity,
  stampBuildReviewCustomJudgedResult,
} from '../../src/engine/build-review-finding-identity.js';
import { BUILD_REVIEW_CUSTOM_V1_CONTRACT } from '../../src/engine/build-review-policy-resolver.js';
import { BUILD_REVIEW_RUBRIC_REGISTRY, createBuildReviewRubricRegistry } from '../../src/engine/build-review-registry.js';
import { resolveBuildReviewConfig, resolveBuildReviewCustomCatalog } from '../../src/engine/resolved-config.js';
import type { HarnessConfig } from '../../src/types/config.js';

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

function schemaAccepts(schema: unknown, value: unknown): boolean {
  const source = record(schema);
  if (Array.isArray(source.oneOf)) return source.oneOf.some((alternative) => schemaAccepts(alternative, value));
  if (Array.isArray(source.enum) && !source.enum.includes(value)) return false;
  if (source.type === 'string') return typeof value === 'string';
  if (source.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (source.type === 'array') return Array.isArray(value) && value.every((entry) => schemaAccepts(source.items, entry));
  if (source.type !== 'object' || value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const schemaProperties = properties(source);
  if ((source.required as readonly string[]).some((key) => candidate[key] === undefined)) return false;
  if (source.additionalProperties === false && Object.keys(candidate).some((key) => !(key in schemaProperties))) return false;
  return Object.entries(candidate).every(([key, entry]) => schemaProperties[key] === undefined || schemaAccepts(schemaProperties[key], entry));
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

  it('gives a resolved custom member the shared v1 descriptor with schema and identity semantics', () => {
    const resolved = resolveBuildReviewConfig({
      build_review: {
        custom_rubrics: {
          boundaryPolicy: {
            enabled: true,
            skill: 'boundary-review',
            question: 'Are changed boundaries safe?',
          },
        },
      },
    } as HarnessConfig);
    const custom = resolved.catalog.find((member) => member.kind === 'custom');
    if (custom?.kind !== 'custom') throw new Error('expected resolved custom member');
    const customFinding = {
      concernId: 'public-boundary-gap',
      summary: 'The changed public boundary lacks compatibility evidence.',
      evidenceLocations: ['src/public-api.ts:8'],
      sourceRegions: [{
        path: 'src/public-api.ts', startLine: 8, endLine: 12,
        contentHash: `sha256:${'a'.repeat(64)}`, display: 'public boundary',
      }],
    };
    const stamped = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v1', findings: [customFinding],
    }, {
      rubric: custom.id,
      lapId: 'lap-1',
      declaration: { version: 'v1', rubricId: custom.id, semanticSkill: custom.skill, question: custom.question, resources: custom.resources },
      policy: { version: 'v1', bundleDigest: `sha256-v1:${'b'.repeat(64)}` },
      candidate: { provider: 'codex', model: 'gpt-5.6', effort: 'high' },
      reviewedInput: { version: 'v1', contentDigest: `sha256:${'c'.repeat(64)}` },
    }, { sourceRegions: customFinding.sourceRegions });

    expect(custom.contract).toBe(BUILD_REVIEW_CUSTOM_V1_CONTRACT);
    expect(custom.contract.output.version).toBe('v1');
    expect(schemaAccepts(custom.contract.output.jsonSchema, { kind: 'custom-findings', version: 'v1', findings: [] })).toBe(true);
    expect(schemaAccepts(custom.contract.output.jsonSchema, { kind: 'unsupported-policy', requirement: 'x' })).toBe(true);
    expect(custom.contract.identity.canonicalize(stamped?.findings[0])?.id).toBe(stamped?.findings[0]?.identity.id);
  });

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

  it('rejects an incomplete descriptor at the live registry construction boundary', () => {
    const malformed = {
      ...BUILD_REVIEW_RUBRIC_REGISTRY.testQuality,
      contract: {
        ...BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract,
        output: {
          ...BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract.output,
          jsonSchema: undefined,
        },
      },
    };

    expect(() => createBuildReviewRubricRegistry([
      { id: 'testQuality', descriptor: malformed as unknown as typeof BUILD_REVIEW_RUBRIC_REGISTRY.testQuality },
      { id: 'security', descriptor: BUILD_REVIEW_RUBRIC_REGISTRY.security },
    ])).toThrow(/testQuality.*output\.jsonSchema/i);
  });

  it('rejects an incomplete descriptor at the live custom catalog construction boundary', () => {
    const resolved = resolveBuildReviewConfig({
      build_review: {
        custom_rubrics: {
          boundaryPolicy: { enabled: true, skill: 'boundary-review', question: 'Are changed boundaries safe?' },
        },
      },
    } as HarnessConfig);
    const custom = resolved.catalog.find((member) => member.kind === 'custom');
    if (custom?.kind !== 'custom') throw new Error('expected resolved custom member');
    const malformed = {
      ...custom,
      contract: {
        ...custom.contract,
        output: { ...custom.contract.output, jsonSchema: undefined },
      },
    };

    expect(() => resolveBuildReviewCustomCatalog([
      malformed as unknown as typeof custom,
    ])).toThrow(/boundaryPolicy.*output\.jsonSchema/i);
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
