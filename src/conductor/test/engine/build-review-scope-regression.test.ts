// Covers: task:18
import { describe, expect, it } from 'vitest';

import { compareBuildReviewScope } from '../../scripts/compare-build-review-scope.mts';

describe('portable build-review scope regression (#2231)', () => {
  it('compares the real frozen assembly and projection without Git objects, daemon state, or a provider', async () => {
    const result = await compareBuildReviewScope();

    expect(result.provenance).toEqual({
      issue: '#2231',
      base: 'e1226a981ab52c513e9da4a3ee5716db9b9b3d9f',
      head: 'c188c0cb6cef8aeaf020272dcb55297e24d688f0',
    });
    expect(result.legacy.projectedTitles).toBe(724);
    expect(result.scoped.changedBodies).toBe(8);
    expect(result.scoped.dispositions).toEqual({
      'criterion-bound body': 'target',
      'task-bound body': 'target',
      'criterion-three body': 'target',
      'unresolved body': 'unresolved-reference',
      'unbound body': 'unbound',
      'header-associated body': 'unresolved-reference',
      'ambiguous body': 'conflicting-associations',
      'removed-binding body': 'binding-removed',
    });
    expect(result.counts).toMatchObject({
      sourceReads: expect.any(Number),
      declarations: 8,
      targets: 3,
      candidates: 3,
      sharedSources: 1,
      ambiguousCandidates: 1,
    });
    expect(result.projectionBytes).toMatchObject({ legacy: expect.any(Number), scoped: expect.any(Number) });
    expect(result.dispatchCounts).toEqual({ legacy: 1, scoped: 1, realProviders: 0 });
    expect(result.elapsedAnalysisMs).toBeGreaterThanOrEqual(0);
    expect(result.retainedEvidence).toEqual({ shared: true, ambiguous: true });
  });

  it('labels projection bytes as bytes rather than claiming provider-token or end-to-end savings', async () => {
    const result = await compareBuildReviewScope();

    expect(result).not.toHaveProperty('tokenSavings');
    expect(result).not.toHaveProperty('endToEndLatencySavings');
    expect(JSON.stringify(result)).not.toMatch(/token|end-to-end|latency savings/i);
  });
});
