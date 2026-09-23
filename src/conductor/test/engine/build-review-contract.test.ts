// Covers: task:1, task:3
// Covers: task:2
import { describe, expect, it, vi } from 'vitest';

import {
  renderRubricContractShape,
  resolveBuildReviewContractCatalog,
  type BuildReviewContractCatalogMember,
} from '../../src/engine/build-review-contract.js';
import {
  BUILD_REVIEW_CUSTOM_V1_SCHEMA,
  BUILD_REVIEW_FINDING_VOCABULARIES,
  BUILD_REVIEW_JUDGED_V3_SCHEMA,
  BUILD_REVIEW_JUDGED_V3_SCHEMAS,
  parseBuildReviewCustomReviewerPayload,
  parseBuildReviewJudgedResult,
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
  if (source.type === 'string') {
    return typeof value === 'string' && (typeof source.pattern !== 'string' || new RegExp(source.pattern).test(value));
  }
  if (source.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (source.type === 'array') {
    return Array.isArray(value) && value.length >= (typeof source.minItems === 'number' ? source.minItems : 0)
      && value.every((entry) => schemaAccepts(source.items, entry));
  }
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

  it('renders nested provider result guidance from object, array, required, and enum schema nodes', () => {
    const descriptor = {
      output: {
        jsonSchema: {
          type: 'object', additionalProperties: false, required: ['findings'],
          properties: {
            findings: {
              type: 'array', items: {
                type: 'object', additionalProperties: false, required: ['anchor'],
                properties: {
                  anchor: {
                    type: 'object', additionalProperties: false, required: ['kind'],
                    properties: { kind: { type: 'string', enum: ['nested-schema-kind'] } },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as Pick<typeof BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract, 'output'>;

    expect(renderRubricContractShape(descriptor)).toContain('`findings`: array of');
    expect(renderRubricContractShape(descriptor)).toContain('anchor: { kind:');
    expect(renderRubricContractShape(descriptor)).toContain('required: findings');
    expect(renderRubricContractShape(descriptor)).toContain('`nested-schema-kind`');
  });

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

  it('rejects a member without output.jsonSchema while resolving the contract catalog before any descriptor dispatch', () => {
    const dispatch = vi.fn();
    const member = {
      ...builtinMembers[0],
      contract: {
        ...builtinMembers[0]!.contract,
        projection: {
          ...builtinMembers[0]!.contract.projection,
          build: dispatch,
        },
        output: {
          ...builtinMembers[0]!.contract.output,
          jsonSchema: undefined,
        },
      },
    } as unknown as BuildReviewContractCatalogMember;

    expect(() => resolveBuildReviewContractCatalog([member])).toThrow(/testQuality.*output\.jsonSchema/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects duplicate rubric ids while resolving the contract catalog before any descriptor dispatch', () => {
    const dispatch = vi.fn();
    const [first] = builtinMembers;
    const dispatchingFirst = {
      ...first!,
      contract: {
        ...first!.contract,
        projection: {
          ...first!.contract.projection,
          build: dispatch,
        },
      },
    };
    const duplicate = { ...dispatchingFirst, id: dispatchingFirst.id };

    expect(() => resolveBuildReviewContractCatalog([dispatchingFirst, duplicate])).toThrow(/testQuality/i);
    expect(dispatch).not.toHaveBeenCalled();
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

  // D10.1: a grammar the parser enforces is stated in the descriptor's JSON
  // Schema whenever the native provider subset can express it.
  describe('schema/parser grammar agreement', () => {
    const sha = `sha256:${'a'.repeat(64)}`;
    const NATIVE_SCHEMA_KEYWORDS = new Set([
      'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'oneOf', 'pattern', 'minItems',
    ]);

    function schemaKeywords(schema: unknown, path = '$'): Array<{ path: string; keyword: string; value: unknown }> {
      const source = record(schema);
      const own = Object.entries(source)
        .filter(([keyword]) => keyword !== 'properties' && keyword !== 'items' && keyword !== 'oneOf')
        .map(([keyword, value]) => ({ path, keyword, value }));
      const nested = [
        ...Object.entries(record(source.properties ?? {})).flatMap(([key, child]) => schemaKeywords(child, `${path}.${key}`)),
        ...(source.items === undefined ? [] : schemaKeywords(source.items, `${path}[]`)),
        ...(Array.isArray(source.oneOf) ? source.oneOf.flatMap((alt, index) => schemaKeywords(alt, `${path}|${index}`)) : []),
      ];
      return [...own, ...nested];
    }

    it('keeps every descriptor schema inside the native provider keyword subset', () => {
      for (const schema of [...Object.values(BUILD_REVIEW_JUDGED_V3_SCHEMAS), BUILD_REVIEW_CUSTOM_V1_SCHEMA]) {
        for (const { path, keyword, value } of schemaKeywords(schema)) {
          expect(NATIVE_SCHEMA_KEYWORDS.has(keyword), `${path} uses unsupported keyword ${keyword}`).toBe(true);
          if (keyword === 'minItems') expect([0, 1], `${path} minItems`).toContain(value);
        }
      }
    });

    it.each(['testQuality', 'security'] as const)('states the %s built-in grammar the parser enforces', (rubric) => {
      const schema = BUILD_REVIEW_JUDGED_V3_SCHEMAS[rubric];
      const valid = {
        concernKind: BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds[0]!,
        summary: 'A concern.',
        evidenceLocations: ['src/a.ts:1'],
        anchor: { rubric, locus: { path: 'src/a.ts', contentHash: sha, display: 'a' } },
      };
      const parses = (finding: unknown) => parseBuildReviewJudgedResult({
        kind: 'judged', rubric, lapId: 'lap-1', snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [finding],
      }) !== undefined;
      const admits = (finding: unknown) => schemaAccepts(schema, { findings: [finding] });

      expect(parses(valid)).toBe(true);
      expect(admits(valid)).toBe(true);

      const defective: Record<string, unknown> = {
        'blank summary': { ...valid, summary: '  ' },
        'empty evidenceLocations': { ...valid, evidenceLocations: [] },
        'blank evidence location': { ...valid, evidenceLocations: [' '] },
        'blank locus display': { ...valid, anchor: { rubric, locus: { ...valid.anchor.locus, display: '' } } },
        'blank locus path': { ...valid, anchor: { rubric, locus: { ...valid.anchor.locus, path: '' } } },
        ...(rubric === 'security'
          ? { 'non-sha256 locus contentHash': { ...valid, anchor: { rubric, locus: { ...valid.anchor.locus, contentHash: 'sha256:short' } } } }
          : {}),
      };
      for (const [name, finding] of Object.entries(defective)) {
        expect(parses(finding), `${name} parses`).toBe(false);
        expect(admits(finding), `${name} admitted by schema`).toBe(false);
      }
    });

    it('states the custom-v1 grammar the parser enforces', () => {
      const region = { path: 'src/a.ts', startLine: 1, endLine: 2, contentHash: sha, display: 'a' };
      const valid = { concernId: 'public-boundary-gap', summary: 'A concern.', evidenceLocations: ['src/a.ts:1'], sourceRegions: [region] };
      const payload = (finding: unknown) => ({ kind: 'custom-findings', version: 'v1', findings: [finding] });

      expect(parseBuildReviewCustomReviewerPayload(payload(valid))).toBeDefined();
      expect(schemaAccepts(BUILD_REVIEW_CUSTOM_V1_SCHEMA, payload(valid))).toBe(true);

      const defective: Record<string, unknown> = {
        'non-identifier concernId': payload({ ...valid, concernId: '1 bad id' }),
        'blank summary': payload({ ...valid, summary: ' ' }),
        'empty evidenceLocations': payload({ ...valid, evidenceLocations: [] }),
        'blank evidence location': payload({ ...valid, evidenceLocations: [''] }),
        'empty sourceRegions': payload({ ...valid, sourceRegions: [] }),
        'non-sha256 region contentHash': payload({ ...valid, sourceRegions: [{ ...region, contentHash: 'abc' }] }),
        'blank region display': payload({ ...valid, sourceRegions: [{ ...region, display: ' ' }] }),
        'blank unsupported-policy requirement': { kind: 'unsupported-policy', requirement: ' ' },
      };
      for (const [name, value] of Object.entries(defective)) {
        expect(parseBuildReviewCustomReviewerPayload(value), `${name} parses`).toBeUndefined();
        expect(schemaAccepts(BUILD_REVIEW_CUSTOM_V1_SCHEMA, value), `${name} admitted by schema`).toBe(false);
      }
    });
  });
});
