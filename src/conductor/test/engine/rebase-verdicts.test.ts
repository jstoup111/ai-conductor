import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyRebaseVerdicts, type RebaseOutcome } from '../../src/engine/rebase.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';

const invalidationOverride = vi.hoisted(() => ({
  result: undefined as { preserved: string[]; invalidated: string[] } | undefined,
}));

vi.mock('../../src/engine/gate-invalidation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/gate-invalidation.js')>();
  return {
    ...actual,
    classifyGateInvalidation: (...args: Parameters<typeof actual.classifyGateInvalidation>) =>
      invalidationOverride.result ?? actual.classifyGateInvalidation(...args),
  };
});

describe('engine/rebase — tree-attesting gate pre-verification (Task 8)', () => {
  let projectRoot: string;

  const changed: RebaseOutcome = {
    kind: 'changed',
    changedCodePaths: ['src/base-change.ts'],
  };

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'rebase-verdicts-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    invalidationOverride.result = undefined;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('retains an identical suite fingerprint by mechanically re-verifying test_suite instead of kicking it back', async () => {
    const preVerified: string[] = [];

    const result = await applyRebaseVerdicts(projectRoot, changed, false, async (step) => {
      preVerified.push(step);
      return { done: step === 'build' || step === 'test_suite' };
    });

    expect({
      preVerified,
      result,
      testSuite: await readVerdict(projectRoot, 'test_suite'),
    }).toEqual({
      preVerified: ['build', 'test_suite'],
      result: {
        satisfied: true,
        kickedBack: ['coverage_binding', 'build_review', 'prd_audit', 'architecture_review_as_built'],
        reverified: ['build', 'test_suite'],
      },
      testSuite: expect.objectContaining({
        satisfied: true,
        reason: expect.stringContaining('re-verified mechanically'),
      }),
    });
  });

  it('invalidates test_suite when its mechanical fingerprint re-check is stale', async () => {
    const preVerified: string[] = [];

    const result = await applyRebaseVerdicts(projectRoot, changed, false, async (step) => {
      preVerified.push(step);
      return { done: step === 'build' };
    });

    expect({
      preVerified,
      kickedBack: result.kickedBack,
      testSuite: await readVerdict(projectRoot, 'test_suite'),
    }).toEqual({
      preVerified: ['build', 'test_suite'],
      kickedBack: ['coverage_binding', 'build_review', 'test_suite', 'prd_audit', 'architecture_review_as_built'],
      testSuite: expect.objectContaining({
        satisfied: false,
        reason: 'invalidated by file-changing rebase',
      }),
    });
  });

  it('writes a non-publishable rebase operation before downstream gate effects', async () => {
    await applyRebaseVerdicts(projectRoot, changed, false, async (step) => {
      if (step === 'build') {
        const rebase = await readVerdict(projectRoot, 'rebase');
        expect(rebase?.rebaseOperation).toMatchObject({
          status: 'applying',
          transition: { preserved: [], invalidated: [], reverified: [] },
        });
      }
      return { done: false };
    });
  });

  it('invalidates test_suite when its mechanical pre-verification throws', async () => {
    const preVerified: string[] = [];

    const result = await applyRebaseVerdicts(projectRoot, changed, false, async (step) => {
      preVerified.push(step);
      if (step === 'test_suite') throw new Error('suite inspection failed');
      return { done: true };
    });

    expect({
      preVerified,
      kickedBack: result.kickedBack,
      testSuite: await readVerdict(projectRoot, 'test_suite'),
    }).toEqual({
      preVerified: ['build', 'test_suite'],
      kickedBack: ['coverage_binding', 'build_review', 'test_suite', 'prd_audit', 'architecture_review_as_built'],
      testSuite: expect.objectContaining({
        satisfied: false,
        reason: 'invalidated by file-changing rebase',
      }),
    });
  });

  it('does not pre-verify build_review or manual_test and still invalidates both after a changed rebase', async () => {
    const preVerified: string[] = [];
    const outcome: RebaseOutcome = {
      kind: 'changed',
      changedCodePaths: ['src/feature-change.ts'],
      featureSurface: ['src/feature-change.ts'],
    };

    const result = await applyRebaseVerdicts(projectRoot, outcome, true, async (step) => {
      preVerified.push(step);
      return { done: false };
    });

    expect({
      preVerified,
      kickedBack: result.kickedBack,
      buildReview: await readVerdict(projectRoot, 'build_review'),
      manualTest: await readVerdict(projectRoot, 'manual_test'),
    }).toEqual({
      preVerified: ['build', 'test_suite'],
      kickedBack: [
        'coverage_binding',
        'build_review',
        'test_suite',
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ],
      buildReview: expect.objectContaining({ satisfied: false, reason: 'invalidated by file-changing rebase' }),
      manualTest: expect.objectContaining({ satisfied: false, reason: 'invalidated by file-changing rebase' }),
    });
  });

  it('uses classifyGateInvalidation\'s partition as the invalidation source', async () => {
    invalidationOverride.result = {
      preserved: ['test_suite', 'build_review'],
      invalidated: ['manual_test'],
    };
    const outcome: RebaseOutcome = {
      kind: 'changed',
      changedCodePaths: ['docs/unrelated.md'],
      featureSurface: ['src/feature-change.ts'],
    };

    const result = await applyRebaseVerdicts(projectRoot, outcome, false, async () => ({ done: false }));

    // manual_test is otherwise excluded when it did not run. The unproved
    // test_suite/build_review candidates prove that preservation additionally
    // requires their original PASS evidence, rather than trusting the
    // classifier partition alone.
    expect(result.kickedBack).toEqual(['build_review', 'test_suite', 'manual_test']);
  });

  it.each([
    ['a failing verdict', { satisfied: false, checkedAt: 1, reason: 'judge rejected the feature' }],
    ['an ordinary repair kickback', {
      satisfied: false,
      checkedAt: 1,
      reason: 'repair required',
      kickback: { from: 'build' as const, evidence: 'ordinary repair' },
    }],
    ['a skipped verdict', { satisfied: true, checkedAt: 1, reason: 'skipped: tier policy' }],
  ])('does not turn %s into a preserved PASS', async (_caseName, original) => {
    invalidationOverride.result = { preserved: ['build_review'], invalidated: [] };
    await writeVerdict(projectRoot, 'build_review', original);

    const result = await applyRebaseVerdicts(projectRoot, {
      kind: 'changed',
      changedCodePaths: ['src/feature-change.ts'],
      featureSurface: ['src/feature-change.ts'],
    }, false);

    if (original.reason?.startsWith('skipped: ')) {
      expect(result.kickedBack).not.toContain('build_review');
    } else {
      expect(result.kickedBack).toContain('build_review');
    }
    expect(await readVerdict(projectRoot, 'build_review')).toEqual(original);
  });

  it('invalidates a preservation candidate with no original verdict evidence', async () => {
    invalidationOverride.result = { preserved: ['build_review'], invalidated: [] };

    const result = await applyRebaseVerdicts(projectRoot, {
      kind: 'changed',
      changedCodePaths: ['src/feature-change.ts'],
      featureSurface: ['src/feature-change.ts'],
    }, false);

    expect(result.kickedBack).toContain('build_review');
    expect(await readVerdict(projectRoot, 'build_review')).toMatchObject({
      satisfied: false,
      reason: 'invalidated by file-changing rebase',
    });
  });

  it('reopens an applicable but unbindable coverage PASS instead of leaving it outside the applied decision', async () => {
    invalidationOverride.result = { preserved: ['coverage_binding'], invalidated: [] };
    await writeFile(
      join(projectRoot, '.pipeline/coverage-binding.json'),
      JSON.stringify({ version: 1, slug: 'feature', runId: 'run-1', status: 'disabled', entries: [] }),
    );
    await writeVerdict(projectRoot, 'coverage_binding', { satisfied: true, checkedAt: 1 });

    const result = await applyRebaseVerdicts(projectRoot, {
      kind: 'changed',
      changedCodePaths: ['src/feature-change.ts'],
      featureSurface: ['src/feature-change.ts'],
    }, false);

    expect(result.preservedGates).toBeUndefined();
    expect(result.kickedBack).toContain('coverage_binding');
    expect(await readVerdict(projectRoot, 'coverage_binding')).toMatchObject({
      satisfied: false,
      kickback: { from: 'rebase' },
    });
  });

  it('reopens an otherwise applicable PASS when it lacks bounded original-judge authority', async () => {
    invalidationOverride.result = { preserved: ['build_review'], invalidated: [] };
    const original = { satisfied: true, checkedAt: 2, reason: 'later reviewed PASS' };
    await writeFile(join(projectRoot, '.pipeline', 'build-review.json'), JSON.stringify({
      verdict: 'PASS',
      rubric: { testQuality: false },
      findings: {},
    }));
    await writeVerdict(projectRoot, 'build_review', original);

    const result = await applyRebaseVerdicts(projectRoot, {
      kind: 'changed',
      changedCodePaths: ['src/feature-change.ts'],
      featureSurface: ['src/feature-change.ts'],
    }, false);

    expect(result.kickedBack).toContain('build_review');
    expect(await readVerdict(projectRoot, 'build_review')).toMatchObject({
      satisfied: false,
      kickback: { from: 'rebase' },
    });
  });
});
