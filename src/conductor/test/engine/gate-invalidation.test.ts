import { describe, expect, it } from 'vitest';
import {
  classifyGateInvalidation,
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

describe('classifyGateInvalidation', () => {
  it('preserves everything on an empty delta', () => {
    const result = classifyGateInvalidation([], [], true);

    expect(result.invalidated).toEqual([]);
    expect(result.preserved.sort()).toEqual(
      [
        'build_review',
        'wiring_check',
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ].sort(),
    );
  });

  it('test-only delta preserves the feature-scoped judged gates and all-runtime gates; build_review re-runs on any code/test change', () => {
    const D = ['x.test.ts'];
    const F: string[] = [];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.preserved.sort()).toEqual(
      ['wiring_check', 'manual_test', 'prd_audit', 'architecture_review_as_built'].sort(),
    );
    expect(result.invalidated).toEqual(['build_review']);
  });

  it('when manual_test never ran, it is excluded from both lists on a test-only delta', () => {
    const D = ['x.test.ts'];
    const F: string[] = [];

    const result = classifyGateInvalidation(D, F, false);

    expect(result.preserved).not.toContain('manual_test');
    expect(result.invalidated).not.toContain('manual_test');
  });

  it('featureSrc touched invalidates the feature-scoped judged gates and the all-runtime gates', () => {
    const D = ['src/feature.ts'];
    const F = ['src/feature.ts'];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.invalidated.sort()).toEqual(
      [
        'build_review',
        'wiring_check',
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ].sort(),
    );
    expect(result.preserved).toEqual([]);
  });

  it('foreignSrc-only touched (feature surface untouched) preserves the feature-scoped judged gates but invalidates all-runtime gates', () => {
    const D = ['src/foreign.ts'];
    const F = ['src/feature.ts'];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.preserved.sort()).toEqual(
      ['prd_audit', 'architecture_review_as_built'].sort(),
    );
    expect(result.invalidated.sort()).toEqual(['build_review', 'wiring_check', 'manual_test'].sort());
  });
});
