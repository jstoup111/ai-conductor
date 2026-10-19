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
      completed: (claims.complete('feature-done'), claims.isCompleted('feature-done')),
      parked: (claims.park('feature-parked'), claims.isParked('feature-parked')),
      unparked: (claims.unpark('feature-parked'), claims.isParked('feature-parked')),
      claimAfterRelease: (claims.release('feature-a'), claims.claim('feature-a')),
      activeClaimsAfterRelease: claims.list(),
    }).toEqual({
      exports: ['InMemoryWorkClaims', 'decodeClaimKey', 'encodeClaimKey', 'featureSlugs'],
      operations: ['claim', 'complete', 'constructor', 'isCompleted', 'isParked', 'list', 'listParked', 'park', 'release', 'unpark'],
      firstClaim: true,
      duplicateClaim: false,
      activeClaims: ['feature-a'],
      claimAfterRelease: true,
      activeClaimsAfterRelease: ['feature-a'],
      completed: true,
      parked: true,
      unparked: false,
    });
  });

  it('round-trips reserved repair keys and projects only feature slugs', async () => {
    const module = await import('../../src/engine/work-claims.js');
    const claims = new module.InMemoryWorkClaims();
    const repair = { kind: 'repair' as const, prUrl: 'https://example.test/pull/17' };
    const feature = { kind: 'feature' as const, slug: 'feature-a' };

    expect(module.decodeClaimKey(module.encodeClaimKey(repair))).toEqual(repair);
    expect(module.decodeClaimKey(module.encodeClaimKey(feature))).toEqual(feature);
    claims.claim(module.encodeClaimKey(feature));
    claims.claim(module.encodeClaimKey(repair));
    expect({ claims: claims.list(), featureSlugs: module.featureSlugs(claims) }).toEqual({
      claims: ['feature-a', 'repair:https://example.test/pull/17'],
      featureSlugs: ['feature-a'],
    });
  });
});
