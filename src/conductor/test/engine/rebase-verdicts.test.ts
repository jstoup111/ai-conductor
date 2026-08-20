import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyRebaseVerdicts, type RebaseOutcome } from '../../src/engine/rebase.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';

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
        kickedBack: ['build_review', 'prd_audit', 'architecture_review_as_built'],
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
      kickedBack: ['test_suite', 'build_review', 'prd_audit', 'architecture_review_as_built'],
      testSuite: expect.objectContaining({
        satisfied: false,
        reason: 'invalidated by file-changing rebase',
      }),
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
      kickedBack: ['test_suite', 'build_review', 'prd_audit', 'architecture_review_as_built'],
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
        'build',
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

    // manual_test is otherwise excluded when it did not run. Its presence
    // proves applyRebaseVerdicts consumes the classifier's returned partition
    // rather than independently rebuilding a gate list at the pre-verify site.
    expect(result.kickedBack).toEqual(['build', 'manual_test']);
  });
});
