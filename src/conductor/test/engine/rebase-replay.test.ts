import { describe, expect, it } from 'vitest';

import { captureReplayIdentity, compareReplayTree, type ReplayIdentity } from '../../src/engine/rebase-replay.js';
import type { GitRunner } from '../../src/engine/rebase.js';

const identity: ReplayIdentity = {
  preRebaseHead: 'a'.repeat(40),
  mergeBase: 'b'.repeat(40),
  target: 'c'.repeat(40),
  completedHead: 'd'.repeat(40),
};

function scripted(results: ReadonlyArray<{ exitCode: number; stdout?: string; stderr?: string }>): GitRunner {
  let index = 0;
  return async () => {
    const result = results[index++] ?? { exitCode: 1 };
    return { exitCode: result.exitCode, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

describe('compareReplayTree', () => {
  it('proves unchanged only when the reconstructed and completed tree objects match', async () => {
    const tree = 'e'.repeat(40);
    await expect(compareReplayTree(scripted([
      { exitCode: 0, stdout: `${tree}\n` },
      { exitCode: 0, stdout: `${tree}\n` },
    ]), identity)).resolves.toMatchObject({ kind: 'unchanged', expectedTree: tree, completedTree: tree });
  });

  it('reports a completed resolution edit as changed', async () => {
    await expect(compareReplayTree(scripted([
      { exitCode: 0, stdout: `${'e'.repeat(40)}\n` },
      { exitCode: 0, stdout: `${'f'.repeat(40)}\n` },
    ]), identity)).resolves.toMatchObject({ kind: 'changed' });
  });

  it.each([
    ['missing identity', { ...identity, target: '' }, []],
    ['unsupported merge-tree', identity, [{ exitCode: 129 }]],
    ['conflicting reconstruction', identity, [{ exitCode: 1 }]],
    ['malformed tree', identity, [{ exitCode: 0, stdout: 'not-an-object\n' }, { exitCode: 0, stdout: 'e'.repeat(40) }]],
  ] as const)('fails closed for %s', async (_name, replay, results) => {
    await expect(compareReplayTree(scripted(results), replay)).resolves.toMatchObject({ kind: 'unproved' });
  });
});

describe('captureReplayIdentity', () => {
  it('retains the target object captured before replay instead of resolving a mutable ref afterward', async () => {
    const target = 'c'.repeat(40);
    const completed = 'd'.repeat(40);
    const git = scripted([{ exitCode: 0, stdout: `${completed}\n` }]);

    await expect(captureReplayIdentity(git, 'a'.repeat(40), 'b'.repeat(40), target))
      .resolves.toEqual({
        preRebaseHead: 'a'.repeat(40),
        mergeBase: 'b'.repeat(40),
        target,
        completedHead: completed,
      });
  });
});
