// Covers: task:10
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { makeGitRunner } from '../../src/engine/rebase.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('engine ref operations with installed ref hooks', () => {
  it('permits the engine update-ref recovery argv in a prepared worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ref-hooks-engine-')); roots.push(root);
    await initTestRepo(root); await writeFile(join(root, 'base.txt'), 'base\n');
    await execa('git', ['add', 'base.txt'], { cwd: root }); await execa('git', ['commit', '-m', 'base'], { cwd: root });
    const before = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout;
    await prepareWorktree(root);

    const result = await makeGitRunner(root)(['update-ref', 'HEAD', before, before]);

    expect(result.exitCode).toBe(0);
    expect((await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout).toBe(before);
  });
});
