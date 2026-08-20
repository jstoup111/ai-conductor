import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyRebaseVerdicts, type RebaseOutcome } from '../../src/engine/rebase.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';

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
});
