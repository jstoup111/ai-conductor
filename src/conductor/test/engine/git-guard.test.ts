// Covers: task:6, task:7
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options as ExecaOptions } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { gitGuardPath, resolveRealGit } from '../../src/engine/git-guard.js';
import { GIT_GUARD_SCRIPT } from '../../src/engine/git-hook-assets.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { initTestRepo } from '../fixtures/git-repo.js';

describe('git guard provisioning primitives', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it('skips relative and .pipeline/bin PATH entries and resolves an absolute executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-guard-resolution-'));
    roots.push(root);
    const guard = join(root, '.pipeline', 'bin');
    const real = join(root, 'real-bin');
    await Promise.all([mkdir(guard, { recursive: true }), mkdir(real, { recursive: true })]);
    await writeFile(join(guard, 'git'), '#!/bin/sh\nexit 0\n');
    await writeFile(join(real, 'git'), '#!/bin/sh\nexit 0\n');
    await Promise.all([chmod(join(guard, 'git'), 0o755), chmod(join(real, 'git'), 0o755)]);

    await expect(resolveRealGit(['relative-bin', guard, real].join(':'))).resolves.toBe(join(real, 'git'));
  });

  it('provisions a regular executable guard with regular runtime data files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-guard-provision-'));
    roots.push(root);
    await initTestRepo(root);
    await prepareWorktree(root);
    const guard = gitGuardPath(root);
    const info = await lstat(guard);
    expect([info.isFile(), info.isSymbolicLink(), info.mode & 0o777]).toEqual([true, false, 0o755]);
    expect(await readFile(guard, 'utf8')).toBe(GIT_GUARD_SCRIPT);
    const realGit = (await readFile(join(root, '.pipeline', 'git-guard', 'real-git'), 'utf8')).trim();
    expect(realGit.startsWith('/')).toBe(true);
    expect(realGit).not.toContain('/.pipeline/bin/');
  });

  it.each([
    ['deleted', async (guard: string) => unlink(guard)],
    ['edited', async (guard: string) => writeFile(guard, '#!/bin/sh\nexit 0\n')],
    ['non-executable', async (guard: string) => chmod(guard, 0o644)],
  ])('repairs a %s guard before the Claude provider launches with the guarded PATH', async (_state, damage) => {
    const root = await mkdtemp(join(tmpdir(), 'git-guard-provider-repair-'));
    roots.push(root);
    await initTestRepo(root);
    await prepareWorktree(root);
    const guard = gitGuardPath(root);
    await damage(guard);

    const spawns: Array<{ env?: Record<string, string | undefined> }> = [];
    const provider = new ClaudeProvider(undefined, ((_file: string, _args: string[], options: ExecaOptions) => {
      spawns.push({ env: options.env });
      return Promise.resolve({
        stdout: JSON.stringify({ type: 'result', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }),
        stderr: '',
        exitCode: 0,
      }) as never;
    }) as never);

    await expect(provider.invoke({ prompt: 'no-op', sessionId: 'repair-check', resume: false, cwd: root }))
      .resolves.toMatchObject({ success: true });

    expect(spawns).toHaveLength(1);
    expect(spawns[0].env?.PATH?.split(':')[0]).toBe(join(root, '.pipeline', 'bin'));
    const info = await lstat(guard);
    expect([await readFile(guard, 'utf8'), info.mode & 0o777]).toEqual([GIT_GUARD_SCRIPT, 0o755]);
  });
});
