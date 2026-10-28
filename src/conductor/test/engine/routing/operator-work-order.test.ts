// Covers: task:21
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assembleBuildReviewInputs } from '../../../src/engine/build-review-inputs.js';
import type { GitRunner } from '../../../src/engine/rebase.js';

const proof = { status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' } as never } as const;

function git(): GitRunner {
  return async (args) => {
    if (args[0] === 'remote') return { exitCode: 0, stdout: 'origin\n', stderr: '' };
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'ls-remote') return { exitCode: 0, stdout: 'base\trefs/heads/main\n', stderr: '' };
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args.at(-1) === 'HEAD' ? 'head\n' : 'base\n', stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: '', stderr: '' };
    if (args[0] === 'show') return { exitCode: 0, stdout: '# Plan\n', stderr: '' };
    if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

describe('operator work order build-review input', () => {
  it('pins the operator work order in the build-review snapshot and digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operator-work-order-'));
    const plan = join(root, 'plan.md');
    await writeFile(plan, '# Plan\n');
    try {
      const options = { inspectTestSuite: async () => proof };
      const first = await assembleBuildReviewInputs(git(), plan, { ...options, operatorWorkOrder: 'repair reviewer edit A' });
      const second = await assembleBuildReviewInputs(git(), plan, { ...options, operatorWorkOrder: 'repair reviewer edit B' });
      expect(first.sourceSnapshot.operatorWorkOrder).toBe('repair reviewer edit A');
      expect(second.sourceSnapshot.operatorWorkOrder).toBe('repair reviewer edit B');
      expect(first.sourceSnapshot.digest).not.toBe(second.sourceSnapshot.digest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
