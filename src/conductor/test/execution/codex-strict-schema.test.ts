import { describe, expect, it } from 'vitest';
import { BUILD_REVIEW_CUSTOM_V1_SCHEMA, BUILD_REVIEW_JUDGED_V3_SCHEMAS } from '../../src/engine/build-review-domain.js';
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
