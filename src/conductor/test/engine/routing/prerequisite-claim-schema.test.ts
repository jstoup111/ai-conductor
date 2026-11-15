// Covers: task:1
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
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: 2 })).toEqual({
      kind: 'claim',
      claim: { outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: 2 },
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: '2' })).toEqual({
      kind: 'malformed',
      detail: 'child is not an integer from 1 to 9',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'] })).toEqual({
      kind: 'malformed',
      detail: 'child is missing; blocked-by-prerequisite requires an integer child from 1 to 9',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2 })).toEqual({
      kind: 'malformed',
      detail: 'blocked-by-prerequisite names neither paths nor symbols',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [] })).toEqual({
      kind: 'malformed',
      detail: 'paths must be a non-empty list of non-empty strings',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, symbols: [] })).toEqual({
      kind: 'malformed',
      detail: 'symbols must be a non-empty list of non-empty strings',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [], symbols: [] })).toEqual({
      kind: 'malformed',
      detail: 'paths must be a non-empty list of non-empty strings',
    });
    expect(parseBuilderClaim({ outcome: 'unknown', child: 2 })).toEqual({
      kind: 'malformed',
      detail: 'outcome is not completed or blocked-by-prerequisite',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, extra: true })).toEqual({
      kind: 'malformed',
      detail: 'unknown field extra',
    });
    expect(parseBuilderClaim({ outcome: 'completed' })).toEqual({ kind: 'none' });
    expect(parseBuilderClaim(undefined)).toEqual({ kind: 'none' });
  });

  it('rejects every list the schema rejects, even beside a valid sibling list', () => {
    // The provider schema requires minItems 1 on each present list, so an
    // empty list next to a non-empty one is outside the closed contract.
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [], symbols: ['parseB'] })).toEqual(
      { kind: 'malformed', detail: 'paths must be a non-empty list of non-empty strings' },
    );
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: ['a.ts'], symbols: [] })).toEqual({
      kind: 'malformed',
      detail: 'symbols must be a non-empty list of non-empty strings',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths: [''] })).toEqual({
      kind: 'malformed',
      detail: 'paths must be a non-empty list of non-empty strings',
    });
  });

  it('treats a completed or absent result as no claim and rejects partial claims', () => {
    expect(parseBuilderClaim(undefined)).toEqual({ kind: 'none' });
    expect(parseBuilderClaim({ outcome: 'completed' })).toEqual({ kind: 'none' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite' })).toEqual({
      kind: 'malformed',
      detail: 'child is missing; blocked-by-prerequisite requires an integer child from 1 to 9',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'] })).toEqual({
      kind: 'malformed',
      detail: 'child is missing; blocked-by-prerequisite requires an integer child from 1 to 9',
    });
    expect(parseBuilderClaim({ outcome: 'unknown', child: 2 })).toEqual({
      kind: 'malformed',
      detail: 'outcome is not completed or blocked-by-prerequisite',
    });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, extra: true })).toEqual({
      kind: 'malformed',
      detail: 'unknown field extra',
    });
  });

  it('names the rule behind each malformed claim without echoing unsafe values', () => {
    for (const child of [0, MAX_CHILD_ID + 1, 2.5, '2']) {
      expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child, symbols: ['parseB'] })).toEqual({
        kind: 'malformed',
        detail: `child is not an integer from 1 to ${MAX_CHILD_ID}`,
      });
    }
    for (const paths of [[], ['']]) {
      expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, paths })).toEqual({
        kind: 'malformed',
        detail: 'paths must be a non-empty list of non-empty strings',
      });
    }
    for (const symbols of [[], ['']]) {
      expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, symbols })).toEqual({
        kind: 'malformed',
        detail: 'symbols must be a non-empty list of non-empty strings',
      });
    }
    const untrustedOutcome = `${'~'.repeat(2_500)}\n${'~'.repeat(2_500)}`;
    const outcome = parseBuilderClaim({ outcome: untrustedOutcome });
    expect(outcome).toEqual({ kind: 'malformed', detail: 'outcome is not completed or blocked-by-prerequisite' });
    expect(outcome.detail).not.toMatch(/[\n~]/);
    expect(
      parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, symbols: ['parseB'], ['x'.repeat(70)]: true }),
    ).toEqual({ kind: 'malformed', detail: 'unknown field <unprintable>' });
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
