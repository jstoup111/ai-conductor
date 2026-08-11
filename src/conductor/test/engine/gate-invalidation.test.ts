import { describe, expect, it } from 'vitest';
import {
  classifyGateInvalidation,
  featureTestPaths,
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
        'test_suite',
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
        'test_suite',
      ].sort(),
    );
  });

  it('foreign test-only delta preserves the feature-scoped judged gates, build_review, and all-runtime gates; only test_suite re-runs', () => {
    // `x.test.ts` is not in F, so it is a FOREIGN test path: it cannot change
    // the feature's own diff, so build_review's plan-vs-diff grade still
    // holds. test_suite stays 'any-codetest' — its proof is of the whole
    // tree, so any delta stales it.
    const D = ['x.test.ts'];
    const F: string[] = [];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.preserved.sort()).toEqual(
      [
        'build_review',
        'wiring_check',
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ].sort(),
    );
    expect(result.invalidated).toEqual(['test_suite']);
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
        'test_suite',
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
      ['build_review', 'prd_audit', 'architecture_review_as_built'].sort(),
    );
    expect(result.invalidated.sort()).toEqual(
      ['wiring_check', 'test_suite', 'manual_test'].sort(),
    );
  });
});

/**
 * build_review grades THE FEATURE'S OWN diff against its plan, so a rebase
 * delta that never touches the feature's own code or tests cannot change that
 * grade. It therefore sits on 'feature-codetest', not the maximally
 * aggressive 'any-codetest'.
 *
 * A NEW kind is required rather than plain 'feature-runtime' because
 * `partitionDelta` tests `isTestPath` FIRST and never consults `F` for a test
 * path — so a feature's OWN changed test file lands in `test`, never in
 * `featureSrc`. Under 'feature-runtime' (preserve iff `featureSrc` is empty)
 * build_review would be preserved across a change to the feature's own tests,
 * which is exactly what its "were the plan's tests written?" rubric grades.
 */
describe('build_review feature-codetest surface (foreign-only deltas preserve the verdict)', () => {
  it('partitionDelta routes a FEATURE-OWNED test path to `test`, never to `featureSrc`', () => {
    const D = ['src/feature.test.ts'];
    const F = ['src/feature.test.ts']; // the feature owns this test file

    const result = partitionDelta(D, F);

    expect(result.test).toEqual(['src/feature.test.ts']);
    expect(result.featureSrc).toEqual([]);
    expect(result.foreignSrc).toEqual([]);
  });

  it('featureTestPaths selects only the delta test paths inside F', () => {
    const D = ['src/feature.test.ts', 'test/foreign.test.ts', 'src/feature.ts'];
    const F = ['src/feature.test.ts', 'src/feature.ts'];

    expect(featureTestPaths(D, F)).toEqual(['src/feature.test.ts']);
  });

  it('declares build_review on feature-codetest and leaves test_suite on any-codetest', () => {
    expect(GATE_SURFACE.build_review).toBe('feature-codetest');
    expect(GATE_SURFACE.test_suite).toBe('any-codetest');
  });

  it('a foreign-only runtime delta PRESERVES build_review', () => {
    const D = ['src/foreign.ts'];
    const F = ['src/feature.ts', 'src/feature.test.ts'];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.preserved).toContain('build_review');
    expect(result.invalidated).not.toContain('build_review');
  });

  it('a foreign-only TEST delta PRESERVES build_review', () => {
    const D = ['test/foreign.test.ts'];
    const F = ['src/feature.ts', 'src/feature.test.ts'];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.preserved).toContain('build_review');
  });

  it("a delta touching the feature's OWN source INVALIDATES build_review", () => {
    const D = ['src/feature.ts'];
    const F = ['src/feature.ts', 'src/feature.test.ts'];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.invalidated).toContain('build_review');
    expect(result.preserved).not.toContain('build_review');
  });

  it("a delta touching the feature's OWN tests INVALIDATES build_review", () => {
    const D = ['src/feature.test.ts'];
    const F = ['src/feature.ts', 'src/feature.test.ts'];

    const result = classifyGateInvalidation(D, F, true);

    expect(result.invalidated).toContain('build_review');
    expect(result.preserved).not.toContain('build_review');
  });

  it('regression guard: test_suite still invalidates on EVERY non-empty code/test delta', () => {
    const F = ['src/feature.ts', 'src/feature.test.ts'];
    const deltas = [
      ['src/foreign.ts'],
      ['test/foreign.test.ts'],
      ['src/feature.ts'],
      ['src/feature.test.ts'],
    ];

    for (const D of deltas) {
      const result = classifyGateInvalidation(D, F, true);
      expect(result.invalidated, `delta ${D[0]}`).toContain('test_suite');
      expect(result.preserved, `delta ${D[0]}`).not.toContain('test_suite');
    }
  });
});
