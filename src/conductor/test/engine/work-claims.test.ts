// Covers: task:3
import { describe, expect, it } from 'vitest';

describe('InMemoryWorkClaims', () => {
  it('claims a slug once, reports it while active, and frees it on release', async () => {
    const module = await import('../../src/engine/work-claims.js');
    const claims = new module.InMemoryWorkClaims();

    expect({
      exports: Object.keys(module).sort(),
      operations: Object.getOwnPropertyNames(Object.getPrototypeOf(claims)).sort(),
      firstClaim: claims.claim('feature-a'),
      duplicateClaim: claims.claim('feature-a'),
      activeClaims: claims.list(),
      claimAfterRelease: (claims.release('feature-a'), claims.claim('feature-a')),
      activeClaimsAfterRelease: claims.list(),
    }).toEqual({
      exports: ['InMemoryWorkClaims'],
      operations: ['claim', 'constructor', 'list', 'release'],
      firstClaim: true,
      duplicateClaim: false,
      activeClaims: ['feature-a'],
      claimAfterRelease: true,
      activeClaimsAfterRelease: ['feature-a'],
    });
  });
});
