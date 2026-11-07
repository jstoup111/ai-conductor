// Covers: task:5
import { rmSync, writeFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchKickbackBudgetCommand, type KickbackBudgetCliDeps } from '../../src/engine/kickback-budget-cli.js';
import { writeKickbackLedger } from '../kickback-ledger-test-support.js';

const roots: string[] = [];
const slug = 'demo';

function markerPath(root: string): string {
  return join(root, '.daemon', 'parked', slug);
}

async function fixture(): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kickback-budget-owned-park-'));
  roots.push(root);
  const worktree = join(root, '.worktrees', slug);
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeKickbackLedger(worktree, {
    version: 1,
    gates: {
      build_review: {
        count: 1,
        cumulative: 5,
        treeHash: null,
        lastReason: 'review budget exhausted',
        priorVerdict: false,
        resolvedBefore: 0,
        capEvidence: {
          gate: 'build_review',
          consumed: 5,
          limit: 5,
          latestReason: 'review budget exhausted',
          haltGeneration: 'halt-1',
        },
      },
    },
  });
  await writeFile(join(worktree, '.pipeline', 'HALT'), 'Kickback halt generation: halt-1\n');
  await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'needs-human\n');
  return { root, worktree };
}

function raise(
  subject: { root: string },
  appendEvent: NonNullable<KickbackBudgetCliDeps['appendEvent']> = vi.fn(),
): Promise<number> {
  return dispatchKickbackBudgetCommand(
    {
      kind: 'kickback-budget',
      action: 'raise',
      feature: slug,
      gate: 'build_review',
      by: 1,
      rationale: 'one additional review pass',
      format: 'human',
    },
    {
      cwd: subject.root,
      resolveMainRoot: async () => subject.root,
      isInteractive: () => true,
      resolveOperator: () => 'operator',
      appendEvent,
      print: () => {},
    },
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('kickback-budget owned temporary park (Task 5)', () => {
  it('leaves a marker recreated by another process during raise in place', async () => {
    const subject = await fixture();
    const path = markerPath(subject.root);

    await expect(raise(subject, () => {
      rmSync(path, { force: true });
      writeFileSync(path, 'parked by another process\n');
    })).resolves.toBe(0);

    await expect(access(path)).resolves.toBeUndefined();
  });

  it('removes the temporary park it created after a completed raise', async () => {
    const subject = await fixture();

    await expect(raise(subject)).resolves.toBe(0);

    await expect(access(markerPath(subject.root))).rejects.toThrow();
  });
});
