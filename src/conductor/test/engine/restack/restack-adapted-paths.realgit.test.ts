import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { adaptedPathsFor, checkPathOwnership, checkResolvedTipOwnership } from '../../../src/engine/restack/restack-ownership.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected full SHA: ${value}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-adapted-paths-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const write = async (path: string, contents: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), contents);
  };
  const commit = async (subject: string) => {
    await git(['add', '-A']);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack adapted paths']);
  await Promise.all([
    write('tests/b.test.ts', 'old parent test\n'),
    write('src/c.ts', 'old c\n'),
    write('src/main.ts', 'old main\n'),
    write('src/other.ts', 'old other\n'),
  ]);
  const oldParent = await commit('base');

  await git(['checkout', '-qb', 'child']);
  await Promise.all([
    write('src/c.ts', 'child c\n'),
    write('src/main.ts', 'child main\n'),
  ]);
  const oldTip = await commit('child owns c and main');

  await git(['checkout', '-q', 'main']);
  await Promise.all([
    write('tests/a.test.ts', 'parent added test\n'),
    write('tests/b.test.ts', 'parent changed test\n'),
    write('src/c.ts', 'parent c\n'),
  ]);
  const newParent = await commit('parent changes tests and c');

  const tip = async (name: string, change: () => Promise<void>) => {
    await git(['checkout', '-qB', `tip-${name}`, newParent]);
    await change();
    return commit(`resolved ${name}`);
  };

  return {
    git,
    write,
    tip,
    runner: makeGitRunner(repo),
    range: { oldParent, oldTip, kind: 'closed' as const },
    newParent,
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('resolved restack tip ownership (real local Git)', () => {
  it('accepts parent-test adaptations and reports their sorted adapted paths', async () => {
    const subject = await fixture();
    const adaptAdded = await subject.tip('adapt-added', () => subject.write('tests/a.test.ts', 'adapted added test\n'));
    const adaptChanged = await subject.tip('adapt-changed', () => subject.write('tests/b.test.ts', 'adapted changed test\n'));

    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, adaptAdded, subject.runner)).resolves.toEqual({
      kind: 'accepted', adaptedPaths: ['tests/a.test.ts'],
    });
    await expect(adaptedPathsFor(subject.range, subject.newParent, adaptAdded, subject.runner)).resolves.toEqual(['tests/a.test.ts']);
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, adaptChanged, subject.runner)).resolves.toEqual({
      kind: 'accepted', adaptedPaths: ['tests/b.test.ts'],
    });
    await expect(adaptedPathsFor(subject.range, subject.newParent, adaptChanged, subject.runner)).resolves.toEqual(['tests/b.test.ts']);
    await expect(checkPathOwnership(subject.range, subject.newParent, adaptChanged, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: ['tests/b.test.ts'],
    });
  });

  it('refuses parent reverts and paths outside the owned and parent-delta sets', async () => {
    const subject = await fixture();
    const deleteAdded = await subject.tip('delete-added', () => subject.git(['rm', 'tests/a.test.ts']).then(() => undefined));
    const restoreChanged = await subject.tip('restore-changed', () => subject.write('tests/b.test.ts', 'old parent test\n'));
    const unowned = await subject.tip('unowned', () => subject.write('src/other.ts', 'resolver changed other\n'));
    const mixed = await subject.tip('mixed', async () => {
      await Promise.all([
        subject.write('tests/a.test.ts', 'adapted added test\n'),
        subject.write('src/other.ts', 'resolver changed other\n'),
      ]);
    });

    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, deleteAdded, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'tests/a.test.ts', cause: 'parent-revert' }],
    });
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, restoreChanged, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'tests/b.test.ts', cause: 'parent-revert' }],
    });
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, unowned, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'src/other.ts', cause: 'unowned' }],
    });
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, mixed, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'src/other.ts', cause: 'unowned' }],
    });
  });
});
