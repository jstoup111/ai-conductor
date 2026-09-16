// Covers: task:3
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { captureReplayIdentity, compareReplayTree, type ReplayIdentity } from '../../src/engine/rebase-replay.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);

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

async function createReplayFixture(extraCompletedEdit = false): Promise<{
  repo: string;
  identity: ReplayIdentity;
  completedTree: string;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-replay-'));
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await git(['config', 'user.name', 'Replay test']);
  await writeFile(join(repo, 'shared.txt'), 'feature-base\nunchanged\ntarget-base\n');
  await git(['add', 'shared.txt']);
  await git(['commit', '-qm', 'base']);

  await git(['checkout', '-qb', 'feature']);
  await writeFile(join(repo, 'shared.txt'), 'feature-change\nunchanged\ntarget-base\n');
  await git(['commit', '-am', 'feature change', '-q']);
  const preRebaseHead = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  await git(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'shared.txt'), 'feature-base\nunchanged\ntarget-change\n');
  await git(['commit', '-am', 'target change', '-q']);
  const target = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const mergeBase = (await git(['merge-base', preRebaseHead, target])).stdout.trim();

  await git(['checkout', '-q', 'feature']);
  await git(['rebase', 'main', '-q']);
  if (extraCompletedEdit) {
    await writeFile(join(repo, 'shared.txt'), 'feature-change\nresolution-extra-edit\ntarget-change\n');
    await git(['commit', '-am', 'resolution edit', '-q']);
  }
  const completedHead = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const completedTree = (await git(['rev-parse', `${completedHead}^{tree}`])).stdout.trim();
  return { repo, identity: { preRebaseHead, mergeBase, target, completedHead }, completedTree };
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

  it('proves a clean same-file disjoint replay using fixture-owned Git only', async () => {
    const fixture = await createReplayFixture();
    try {
      await expect(compareReplayTree(makeGitRunner(fixture.repo), fixture.identity))
        .resolves.toMatchObject({
          kind: 'unchanged',
          identity: fixture.identity,
          expectedTree: fixture.completedTree,
          completedTree: fixture.completedTree,
        });
      await expect(execFile('git', ['status', '--porcelain'], { cwd: fixture.repo }))
        .resolves.toMatchObject({ stdout: '' });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('reports changed when the completed same-file replay includes an extra edit', async () => {
    const fixture = await createReplayFixture(true);
    try {
      await expect(compareReplayTree(makeGitRunner(fixture.repo), fixture.identity))
        .resolves.toMatchObject({
          kind: 'changed',
          identity: fixture.identity,
          completedTree: fixture.completedTree,
        });
      await expect(execFile('git', ['status', '--porcelain'], { cwd: fixture.repo }))
        .resolves.toMatchObject({ stdout: '' });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing pre-rebase object', { ...identity, preRebaseHead: '' }, []],
    ['missing merge-base object', { ...identity, mergeBase: '' }, []],
    ['missing target object', { ...identity, target: '' }, []],
    ['missing completed object', { ...identity, completedHead: '' }, []],
    ['unavailable merge-tree option', identity, [{ exitCode: 129, stderr: 'unknown option --merge-base' }]],
    ['missing Git object', identity, [{ exitCode: 128, stderr: 'fatal: Not a valid object name' }]],
    ['conflicting reconstruction', identity, [{ exitCode: 1, stdout: 'CONFLICT (content): Merge conflict\n' }]],
    ['completed-tree command error', identity, [{ exitCode: 0, stdout: `${'e'.repeat(40)}\n` }, { exitCode: 128 }]],
    ['malformed expected tree', identity, [{ exitCode: 0, stdout: 'not-an-object\n' }, { exitCode: 0, stdout: 'e'.repeat(40) }]],
    ['malformed completed tree', identity, [{ exitCode: 0, stdout: `${'e'.repeat(40)}\n` }, { exitCode: 0, stdout: 'not-an-object\n' }]],
  ] as const)('fails closed for %s without fabricating preservation evidence', async (_name, replay, results) => {
    const result = await compareReplayTree(scripted(results), replay);
    expect(result).toMatchObject({ kind: 'unproved' });
    // `unproved` is the classifier's conservative branch: it carries a
    // reason only, never a tree comparison that could authorize preservation.
    expect(result).not.toHaveProperty('expectedTree');
    expect(result).not.toHaveProperty('completedTree');
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

  it.each([
    ['missing pre-rebase object', '', 'b'.repeat(40), 'c'.repeat(40), [{ exitCode: 0, stdout: `${'d'.repeat(40)}\n` }]],
    ['malformed pre-rebase object', 'not-an-object', 'b'.repeat(40), 'c'.repeat(40), [{ exitCode: 0, stdout: `${'d'.repeat(40)}\n` }]],
    ['missing merge-base object', 'a'.repeat(40), '', 'c'.repeat(40), [{ exitCode: 0, stdout: `${'d'.repeat(40)}\n` }]],
    ['malformed merge-base object', 'a'.repeat(40), 'not-an-object', 'c'.repeat(40), [{ exitCode: 0, stdout: `${'d'.repeat(40)}\n` }]],
    ['missing target object', 'a'.repeat(40), 'b'.repeat(40), '', [{ exitCode: 0, stdout: `${'d'.repeat(40)}\n` }]],
    ['malformed target object', 'a'.repeat(40), 'b'.repeat(40), 'not-an-object', [{ exitCode: 0, stdout: `${'d'.repeat(40)}\n` }]],
    ['missing completed object', 'a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), [{ exitCode: 1 }]],
    ['malformed completed object', 'a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), [{ exitCode: 0, stdout: 'not-an-object\n' }]],
  ] as const)('carries %s into the explicit unproved comparison branch', async (_name, preRebaseHead, mergeBase, target, completed) => {
    const captured = await captureReplayIdentity(scripted(completed), preRebaseHead, mergeBase, target);

    await expect(compareReplayTree(scripted([]), captured)).resolves.toEqual({
      kind: 'unproved',
      identity: captured,
      reason: 'replay identity is missing or malformed',
    });
  });
});
