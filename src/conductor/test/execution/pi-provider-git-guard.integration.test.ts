// Covers: task:2, task:5
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    env: { PATH: '/usr/local/bin:/usr/bin' },
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

    let resolvedGit: { stdout: string } | undefined;
    let clean: { exitCode: number; stderr: string } | undefined;
    const guardedGit = join(fixture, '.pipeline', 'bin', 'git');
    const subprocessFactory: PiSubprocessFactory = async (_file, _args, options: ExecaOptions) => {
      const childOptions = { cwd: options.cwd, env: options.env, reject: false } as const;
      const command = await execa('sh', ['-c', 'command -v git'], childOptions);
      resolvedGit = { stdout: command.stdout };
      if (resolvedGit.stdout.trim() === guardedGit) {
        const refusal = await execa('sh', ['-c', 'git clean -f'], childOptions);
        clean = { exitCode: refusal.exitCode, stderr: refusal.stderr };
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

  it('launches unguarded outside an engine-prepared worktree', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'pi-provider-git-guard-unprepared-'));
    roots.push(fixture);
    const repository = join(fixture, 'repository');
    const linked = join(fixture, 'linked');
    await mkdir(repository);
    await initTestRepo(repository);
    await execa('git', ['-C', repository, 'worktree', 'add', '-q', '-b', 'linked', linked]);

    const cases = [
      ['a non-repository directory', fixture],
      ['an unprepared repository', repository],
      ['a linked worktree without worktreeConfig', linked],
    ] as const;

    for (const [name, cwd] of cases) {
      const spawns: Array<{ env?: Record<string, string | undefined> }> = [];
      const subprocessFactory: PiSubprocessFactory = async (_file, _args, options: ExecaOptions) => {
        spawns.push({ env: options.env });
        return {
          stdout: JSON.stringify({
            type: 'message_end',
            message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          }),
          stderr: '',
          exitCode: 0,
        };
      };

      const result = await new PiProvider('pi', subprocessFactory, fakePiEnvironment()).invoke({
        prompt: 'Run the requested command.',
        sessionId: `pi-git-guard-unprepared-${name}`,
        resume: false,
        cwd,
      });

      expect(spawns, name).toHaveLength(1);
      expect(spawns[0]?.env?.PATH?.split(':').some((entry) => entry.includes('.pipeline/bin')) ?? false, name).toBe(false);
      await expect(access(join(cwd, '.pipeline', 'bin', 'git')), name).rejects.toMatchObject({ code: 'ENOENT' });
      expect(result, name).toMatchObject({ success: true, gitGuardInstalled: false });
    }
  });
});
