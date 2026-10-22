// Covers: task:204
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { MAX_CHILD_ID } from '../../../src/engine/child-context.js';
import { PREREQUISITE_CLAIM_SCHEMA, parseBuilderClaim } from '../../../src/engine/routing/prerequisite-claim.js';

describe('routed build prerequisite claim schema', () => {
  it('keeps the terminal claim contract closed', () => {
    expect(PREREQUISITE_CLAIM_SCHEMA).toMatchObject({ oneOf: expect.any(Array) });
    for (const [index, branch] of PREREQUISITE_CLAIM_SCHEMA.oneOf.entries()) {
      expect(branch.additionalProperties).toBe(false);
      expect(branch.properties.outcome.const).toBe(index === 0 ? 'completed' : 'blocked-by-prerequisite');
    }
    expect(PREREQUISITE_CLAIM_SCHEMA.oneOf[1].required).toContain('child');
    expect(PREREQUISITE_CLAIM_SCHEMA.oneOf[1]).toMatchObject({
      anyOf: [{ required: ['paths'] }, { required: ['symbols'] }],
      properties: { paths: { minItems: 1 }, symbols: { minItems: 1 } },
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: 2 }))
      .toEqual({ kind: 'claim', claim: { outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: 2 } });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: '2' })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'] })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2 })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [] })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, symbols: [] })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [], symbols: [] })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'unknown', child: 2 })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, extra: true })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'completed' })).toEqual({ kind: 'none' });
    expect(parseBuilderClaim(undefined)).toEqual({ kind: 'none' });
  });

  it('rejects every list the schema rejects, even beside a valid sibling list', () => {
    // The provider schema requires minItems 1 on each present list, so an
    // empty list next to a non-empty one is outside the closed contract.
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [], symbols: ['parseB'] })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: ['a.ts'], symbols: [] })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [''] })).toEqual({ kind: 'malformed' });
  });

  it('treats a completed or absent result as no claim and rejects partial claims', () => {
    expect(parseBuilderClaim(undefined)).toEqual({ kind: 'none' });
    expect(parseBuilderClaim({ outcome: 'completed' })).toEqual({ kind: 'none' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite' })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'] })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'unknown', child: 2 })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, extra: true })).toEqual({ kind: 'malformed' });
  });

  it('accepts exactly the claims the provider schema accepts', () => {
    const schemaAccepts = new Ajv().compile(PREREQUISITE_CLAIM_SCHEMA);
    const blocked = { outcome: 'blocked-by-prerequisite', symbols: ['parseB'] };
    const claims: readonly unknown[] = [
      { outcome: 'completed' },
      { outcome: 'completed', child: 2 },
      { ...blocked, child: 1 },
      { ...blocked, child: MAX_CHILD_ID },
      { ...blocked, child: MAX_CHILD_ID + 1 },
      { ...blocked, child: 0 },
      { ...blocked, child: 2.5 },
      { ...blocked, child: '2' },
      { outcome: 'blocked-by-prerequisite', child: 2, paths: ['a.ts'] },
      { outcome: 'blocked-by-prerequisite', child: 2 },
      { ...blocked, child: 2, paths: [] },
      { ...blocked, child: 2, extra: true },
      { outcome: 'unknown', child: 2 },
    ];
    for (const claim of claims) {
      expect(parseBuilderClaim(claim).kind !== 'malformed', JSON.stringify(claim)).toBe(schemaAccepts(claim));
    }
  });
});
