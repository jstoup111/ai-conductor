// Covers: task:10
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { GitRunner } from '../../../src/engine/rebase.js';
import { syncRestackedWorktree } from '../../../src/engine/restack/restack-sync.js';
import type { CommitSha } from '../../../src/engine/restack/restack-types.js';

const repositories: string[] = [];
const oldSha = 'a'.repeat(40) as CommitSha;
const newSha = 'b'.repeat(40) as CommitSha;

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('restack synchronization Git boundary', () => {
  it('never asks Git to stash or autostash', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'restack-no-stash-'));
    repositories.push(repository);
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(syncRestackedWorktree(repository, oldSha, newSha, { git })).resolves.toBeUndefined();

    expect(calls).toContainEqual(['read-tree', '-m', '-u', oldSha, newSha]);
    expect(calls.flat()).not.toContain('stash');
    expect(calls.flat()).not.toContain('--autostash');
  });
});
