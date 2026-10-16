// Covers: task:204
import { describe, expect, it } from 'vitest';

import { PREREQUISITE_CLAIM_SCHEMA, parseBuilderClaim } from '../../../src/engine/routing/prerequisite-claim.js';

describe('routed build prerequisite claim schema', () => {
  it('keeps the terminal claim contract closed', () => {
    expect(PREREQUISITE_CLAIM_SCHEMA).toMatchObject({ oneOf: expect.any(Array) });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: 2 }))
      .toEqual({ kind: 'claim', claim: { outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: 2 } });
  });

  it('treats a completed or absent result as no claim and rejects partial claims', () => {
    expect(parseBuilderClaim(undefined)).toEqual({ kind: 'none' });
    expect(parseBuilderClaim({ outcome: 'completed' })).toEqual({ kind: 'none' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite' })).toEqual({ kind: 'malformed' });
    expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, extra: true })).toEqual({ kind: 'malformed' });
  });
});
