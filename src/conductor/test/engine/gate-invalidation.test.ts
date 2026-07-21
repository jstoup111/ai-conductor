import { describe, expect, it } from 'vitest';
import {
  GATE_SURFACE,
  isRuntimeSourcePath,
  partitionDelta,
} from '../../src/engine/gate-invalidation.js';

describe('gate-invalidation path predicates', () => {
  it('classifies a plain src path as runtime source', () => {
    expect(isRuntimeSourcePath('src/x.ts')).toBe(true);
  });

  it('classifies a test path as NOT runtime source', () => {
    expect(isRuntimeSourcePath('src/x.test.ts')).toBe(false);
  });

  it('classifies a docs path as NOT runtime source', () => {
    expect(isRuntimeSourcePath('.docs/y.md')).toBe(false);
  });
});

describe('GATE_SURFACE', () => {
  it('has keys exactly for the judged gates, and explicitly not build', () => {
    const keys = Object.keys(GATE_SURFACE).sort();
    expect(keys).toEqual(
      [
        'architecture_review_as_built',
        'build_review',
        'manual_test',
        'prd_audit',
        'wiring_check',
      ].sort(),
    );
    expect(GATE_SURFACE).not.toHaveProperty('build');
  });
});

describe('partitionDelta', () => {
  it('splits D into test/featureSrc/foreignSrc groups relative to F', () => {
    const D = ['src/a.ts', 'x.test.ts', 'src/foreign.ts'];
    const F = ['src/a.ts', 'x.test.ts'];

    const result = partitionDelta(D, F);

    expect(result).toEqual({
      test: ['x.test.ts'],
      featureSrc: ['src/a.ts'],
      foreignSrc: ['src/foreign.ts'],
    });

    // The three groups are pairwise disjoint.
    const all = [...result.test, ...result.featureSrc, ...result.foreignSrc];
    expect(new Set(all).size).toBe(all.length);

    // The runtime union (featureSrc ∪ foreignSrc) equals D ∩ runtime paths.
    const runtimeUnion = new Set([...result.featureSrc, ...result.foreignSrc]);
    const expectedRuntime = new Set(D.filter(isRuntimeSourcePath));
    expect(runtimeUnion).toEqual(expectedRuntime);
  });
});
