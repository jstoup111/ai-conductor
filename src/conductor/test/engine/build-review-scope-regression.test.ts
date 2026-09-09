// Covers: task:18
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { compareBuildReviewScope } from '../../scripts/compare-build-review-scope.mts';

describe('portable build-review scope regression (#2231)', () => {
  it('registers the portable comparison through its configured production command', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['compare:build-review-scope']).toContain('scripts/compare-build-review-scope.mts');
  });

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
    // Decision 11 requires each measurement separately for both sides over the
    // same fixture; a combined figure cannot show what the new scope costs.
    expect(result.counts).toMatchObject({
      sourceReads: { legacy: expect.any(Number), scoped: expect.any(Number) },
      declarations: 8,
      targets: { legacy: 724, scoped: 3 },
      candidates: { legacy: 0, scoped: 3 },
      sharedSources: 1,
      ambiguousCandidates: 1,
    });
    // Whole-file admission read one blob; scoped analysis reads both pinned
    // sides plus the plan and stories through the frozen reader.
    expect(result.counts.sourceReads.scoped).toBeGreaterThan(result.counts.sourceReads.legacy);
    expect(result.projectionBytes).toEqual({ legacy: 17_295, scoped: 18_183 });
    expect(result.dispatchCounts).toEqual({ legacy: 1, scoped: 1, realProviders: 0 });
    expect(result.elapsedAnalysisMs.legacy).toBeGreaterThanOrEqual(0);
    expect(result.elapsedAnalysisMs.scoped).toBeGreaterThanOrEqual(0);
    expect(result.retainedEvidence).toEqual({ shared: true, ambiguous: true });
  });

  it('labels projection bytes as bytes rather than claiming provider-token or end-to-end savings', async () => {
    const result = await compareBuildReviewScope();

    expect(result.projectionBytes).toEqual({ legacy: 17_295, scoped: 18_183 });
    expect(result).not.toHaveProperty('tokenSavings');
    expect(result).not.toHaveProperty('endToEndLatencySavings');
    expect(JSON.stringify(result)).not.toMatch(/token|end-to-end|latency savings/i);
  });
});
