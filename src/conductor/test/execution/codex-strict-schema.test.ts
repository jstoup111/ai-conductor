import { describe, expect, it } from 'vitest';
import { BUILD_REVIEW_CUSTOM_V1_SCHEMA, BUILD_REVIEW_JUDGED_V3_SCHEMAS, parseBuildReviewCustomReviewerPayload } from '../../src/engine/build-review-domain.js';
import { fromCodexStrictResult, toCodexStrictSchema } from '../../src/execution/codex-strict-schema.js';

type Json = Record<string, unknown>;

/** The rule the OpenAI strict structured-output API enforces on every object. */
function objectsMissingRequiredKeys(schema: unknown, path = '$'): string[] {
  if (Array.isArray(schema)) return schema.flatMap((child, index) => objectsMissingRequiredKeys(child, `${path}[${index}]`));
  if (typeof schema !== 'object' || schema === null) return [];
  const node = schema as Json;
  const own: string[] = [];
  if (typeof node.properties === 'object' && node.properties !== null) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    for (const key of Object.keys(node.properties)) if (!required.has(key)) own.push(`${path}.${key}`);
  }
  return [...own, ...Object.entries(node).flatMap(([key, child]) => objectsMissingRequiredKeys(child, `${path}.${key}`))];
}

describe('toCodexStrictSchema', () => {
  const engineSchemas = {
    custom: BUILD_REVIEW_CUSTOM_V1_SCHEMA,
    testQuality: BUILD_REVIEW_JUDGED_V3_SCHEMAS.testQuality,
    security: BUILD_REVIEW_JUDGED_V3_SCHEMAS.security,
  };

  it.each(Object.entries(engineSchemas))('requires every property of every object in the %s build-review schema', (_name, schema) => {
    expect(objectsMissingRequiredKeys(schema)).not.toEqual([]);
    expect(objectsMissingRequiredKeys(toCodexStrictSchema(schema))).toEqual([]);
  });

  it('makes originally optional properties nullable and keeps required ones unchanged', () => {
    const strict = toCodexStrictSchema(BUILD_REVIEW_CUSTOM_V1_SCHEMA) as Json;
    const findings = (strict.properties as Json).findings as { anyOf: [Json, Json] };
    expect(findings.anyOf[1]).toEqual({ type: 'null' });
    const item = findings.anyOf[0].items as Json;
    const properties = item.properties as Json;
    expect(properties.confidence).toEqual({ anyOf: [{ type: 'integer', enum: expect.any(Array) }, { type: 'null' }] });
    expect(properties.summary).not.toHaveProperty('anyOf');
    expect(BUILD_REVIEW_CUSTOM_V1_SCHEMA.properties.findings.items.required).not.toContain('confidence');
  });
});

describe('fromCodexStrictResult', () => {
  it('drops nulls for originally optional properties at every depth and keeps everything else', () => {
    const strictOutput = {
      kind: 'custom-findings',
      version: 'v1',
      requirement: null,
      findings: [{
        concernId: 'float-money',
        summary: 'Average uses float64.',
        confidence: null,
        evidenceLocations: ['internal/httpapi/average.go:12'],
        sourceRegions: [{ path: 'internal/httpapi/average.go', startLine: 12, endLine: 12, contentHash: 'sha256:abc', display: 'avg' }],
      }],
    };

    expect(fromCodexStrictResult(BUILD_REVIEW_CUSTOM_V1_SCHEMA, strictOutput)).toEqual({
      kind: 'custom-findings',
      version: 'v1',
      findings: [{
        concernId: 'float-money',
        summary: 'Average uses float64.',
        evidenceLocations: ['internal/httpapi/average.go:12'],
        sourceRegions: [{ path: 'internal/httpapi/average.go', startLine: 12, endLine: 12, contentHash: 'sha256:abc', display: 'avg' }],
      }],
    });
  });
});

describe('custom-v1 strict result parsing', () => {
  it.each([null, undefined, []])('accepts empty findings represented as %j after Codex normalization', (findings) => {
    const result = fromCodexStrictResult(BUILD_REVIEW_CUSTOM_V1_SCHEMA, {
      kind: 'custom-findings', version: 'v1', findings, requirement: null,
    });
    expect(parseBuildReviewCustomReviewerPayload(result)).toEqual({ kind: 'custom-findings', version: 'v1', findings: [] });
  });

  it('accepts direct null findings while retaining the closed payload grammar', () => {
    const payload = { kind: 'custom-findings', version: 'v1', findings: null };
    expect(parseBuildReviewCustomReviewerPayload(payload)).toEqual({ ...payload, findings: [] });
    expect(parseBuildReviewCustomReviewerPayload({ ...payload, unexpected: true })).toBeUndefined();
  });

  it.each([null, undefined, 'v2'])('still rejects invalid version %j', (version) => {
    const result = fromCodexStrictResult(BUILD_REVIEW_CUSTOM_V1_SCHEMA, {
      kind: 'custom-findings', version, findings: null, requirement: null,
    });
    expect(parseBuildReviewCustomReviewerPayload(result)).toBeUndefined();
  });

  it.each([{}, '', [null], Array(65).fill({})])('still rejects malformed or oversized findings %j', (findings) => {
    expect(parseBuildReviewCustomReviewerPayload({ kind: 'custom-findings', version: 'v1', findings })).toBeUndefined();
  });

  it('preserves unsupported-policy without inventing findings', () => {
    const result = fromCodexStrictResult(BUILD_REVIEW_CUSTOM_V1_SCHEMA, {
      kind: 'unsupported-policy', version: null, findings: null, requirement: 'Needs network access',
    });
    expect(parseBuildReviewCustomReviewerPayload(result)).toEqual({ kind: 'unsupported-policy', requirement: 'Needs network access' });
  });

  it.each(Object.entries(BUILD_REVIEW_JUDGED_V3_SCHEMAS))('keeps %s judged findings required and non-nullable', (_rubric, schema) => {
    const strict = toCodexStrictSchema(schema) as Json;
    expect((strict.properties as Json).findings).toMatchObject({ type: 'array' });
    expect((strict.properties as Json).findings).not.toHaveProperty('anyOf');
    expect(fromCodexStrictResult(schema, { findings: null })).toEqual({ findings: null });
  });
});
