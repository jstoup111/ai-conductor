import { describe, expect, it } from 'vitest';
import { isCodeOrTestPath } from '../../src/engine/rebase.js';
import {
  classifyReplayGateInvalidation,
  isRuntimeSourcePath,
} from '../../src/engine/gate-invalidation.js';
import type { ReplayComparison, ReplayIdentity } from '../../src/engine/rebase-replay.js';

const identity: ReplayIdentity = {
  preRebaseHead: 'a'.repeat(40),
  mergeBase: 'b'.repeat(40),
  target: 'c'.repeat(40),
  completedHead: 'd'.repeat(40),
};

const unchangedReplay: ReplayComparison = {
  kind: 'unchanged',
  identity,
  expectedTree: 'e'.repeat(40),
  completedTree: 'e'.repeat(40),
};

const changedReplay: ReplayComparison = {
  kind: 'changed',
  identity,
  expectedTree: 'e'.repeat(40),
  completedTree: 'f'.repeat(40),
};

const unprovedReplay: ReplayComparison = {
  kind: 'unproved',
  identity,
  reason: 'reconstruction unavailable',
};

describe('Task 9–11 rebase path classification', () => {
  it('treats harness markdown as source while retaining the complete documentation and test exclusion matrix', () => {
    const source = [
      'HARNESS.md', 'AGENT_INSTRUCTIONS.md', 'agents/planner.md',
      'skills/tdd/SKILL.md', 'tech-context/x.md', 'templates/y.md', 'docs-note.md',
    ];
    const excluded = [
      '.docs/plans/x.md', '.docs/audits/y.json', '.docs/coherence/.gitkeep',
      'docs/guides/z.md', 'docs/_config.yml', 'README', 'README.md',
      'a/b/README.md', 'CHANGELOG.md', 'x.test.ts', 'test/y.ts', 'test/guide.md',
    ];

    expect(source.every(isRuntimeSourcePath)).toBe(true);
    expect(excluded.every((path) => !isRuntimeSourcePath(path))).toBe(true);
    expect(excluded.filter((path) => /(?:\.test\.|(?:^|\/)test\/)/.test(path))
      .every((path) => isCodeOrTestPath(path))).toBe(true);
  });

  it('preserves feature-scoped reviews only for a verified unchanged replay while suite and runtime retain the combined delta', () => {
    const result = classifyReplayGateInvalidation(
      ['src/shared.ts'],
      ['src/shared.ts'],
      true,
      unchangedReplay,
    );

    expect(result.preserved).toEqual([
      'coverage_binding',
      'build_review',
      'prd_audit',
      'architecture_review_as_built',
    ]);
    expect(result.invalidated).toEqual(['test_suite', 'manual_test']);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gate: 'build_review',
        decision: 'preserve',
        source: expect.objectContaining({ replay: 'unchanged', featureContribution: ['src/shared.ts'] }),
      }),
      expect.objectContaining({
        gate: 'test_suite',
        decision: 'invalidate',
        source: expect.objectContaining({ replay: 'unchanged', combinedDelta: ['src/shared.ts'] }),
      }),
      expect.objectContaining({
        gate: 'manual_test',
        decision: 'invalidate',
        source: expect.objectContaining({ replay: 'unchanged', combinedDelta: ['src/shared.ts'] }),
      }),
    ]));
  });

  it.each([
    ['changed', changedReplay],
    ['unproved', unprovedReplay],
  ] as const)('reopens affected feature reviews when replay proof is %s', (_kind, replay) => {
    const result = classifyReplayGateInvalidation(
      ['src/shared.ts'],
      ['src/shared.ts'],
      false,
      replay,
    );

    expect(result.preserved).toEqual([]);
    expect(result.invalidated).toEqual([
      'coverage_binding',
      'build_review',
      'test_suite',
      'prd_audit',
      'architecture_review_as_built',
    ]);
    expect(result.candidates.find(({ gate }) => gate === 'build_review')).toMatchObject({
      decision: 'invalidate',
      source: { replay: replay.kind, featureContribution: ['src/shared.ts'] },
    });
  });

  it('fails closed for feature-scoped reviews even when an unproved replay has only foreign runtime delta', () => {
    const result = classifyReplayGateInvalidation(
      ['src/foreign.ts'],
      ['src/feature.ts'],
      true,
      unprovedReplay,
    );

    expect(result.invalidated).toEqual([
      'coverage_binding',
      'build_review',
      'test_suite',
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ]);
    expect(result.preserved).toEqual([]);
  });

  it('retains active-document invalidation for an unchanged replay but ignores unrelated documents and skips manual_test when it did not run', () => {
    const active = classifyReplayGateInvalidation(
      ['.docs/stories/active.md', '.docs/plans/unrelated.md'],
      [],
      false,
      unchangedReplay,
      ['.docs/stories/active.md'],
    );

    expect(active.invalidated).toEqual(['coverage_binding', 'prd_audit']);
    expect(active.preserved).toEqual(['build_review', 'test_suite', 'architecture_review_as_built']);
    expect(active.candidates).toHaveLength(6);
    expect(active.candidates.find(({ gate }) => gate === 'prd_audit')).toMatchObject({
      decision: 'invalidate',
      source: {
        activeInputs: ['.docs/stories/active.md'],
        combinedDelta: ['.docs/stories/active.md', '.docs/plans/unrelated.md'],
      },
    });
    expect(active.candidates.find(({ gate }) => gate === 'coverage_binding')).toMatchObject({
      decision: 'invalidate',
      source: { activeInputs: ['.docs/stories/active.md'] },
    });

    const unrelated = classifyReplayGateInvalidation(
      ['.docs/plans/unrelated.md'],
      [],
      false,
      unchangedReplay,
      [],
    );
    expect(unrelated.invalidated).toEqual([]);
    expect(unrelated.preserved).toEqual([
      'coverage_binding',
      'build_review',
      'test_suite',
      'prd_audit',
      'architecture_review_as_built',
    ]);
  });
});
