// Covers: task:2
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa, type Options as ExecaOptions } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { PiProvider, type PiEnvironment, type PiSubprocessFactory } from '../../src/execution/pi-provider.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const harnessPath = '/test-home/.agents/skills/HARNESS.md';
const roots: string[] = [];

function fakePiEnvironment(): PiEnvironment {
  return {
    stat: async (path) => {
      if (path === harnessPath) return { isFile: () => true, isDirectory: () => false };
      const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    },
    env: { PATH: process.env.PATH ?? '' },
    homeDir: () => '/test-home',
    cwd: () => '/test-project',
  };
}

describe('PiProvider prepared-worktree git guard integration', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('runs the fixture guard through Pi child environment and refuses forced clean', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'pi-provider-git-guard-'));
    roots.push(fixture);
    await initTestRepo(fixture);
    await prepareWorktree(fixture);
    const untracked = join(fixture, 'untracked.txt');
    await writeFile(untracked, 'keep me\n');

    let resolvedGit: Awaited<ReturnType<typeof execa>> | undefined;
    let clean: Awaited<ReturnType<typeof execa>> | undefined;
    const guardedGit = join(fixture, '.pipeline', 'bin', 'git');
    const subprocessFactory: PiSubprocessFactory = async (_file, _args, options: ExecaOptions) => {
      const childOptions = { cwd: options.cwd, env: options.env, reject: false } as const;
      resolvedGit = await execa('sh', ['-c', 'command -v git'], childOptions);
      if (resolvedGit.stdout.trim() === guardedGit) {
        clean = await execa('sh', ['-c', 'git clean -f'], childOptions);
      }
      return {
        stdout: JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: resolvedGit.stdout }] },
        }),
        stderr: '',
        exitCode: 0,
      };
    };
    const options: InvokeOptions = {
      prompt: 'Run the requested command.',
      sessionId: 'pi-git-guard-integration',
      resume: false,
      cwd: fixture,
    };

    const result = await new PiProvider('pi', subprocessFactory, fakePiEnvironment()).invoke(options);

    expect(result.output.trim().split('\n')[0]).toBe(guardedGit);
    expect(resolvedGit?.stdout.trim()).toBe(guardedGit);
    expect(clean?.exitCode).not.toBe(0);
    expect(clean?.stderr).toContain('ai-conductor git guard: refused');
    await expect(readFile(untracked, 'utf8')).resolves.toBe('keep me\n');
    expect(result.gitGuardInstalled).toBe(true);
  });
});
