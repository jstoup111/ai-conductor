import { access, lstat, readdir } from 'node:fs/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ProviderHomeProvisionError } from '../../src/engine/self-host/provider-home.js';
import type { ResolvedSelfHostProvider } from '../../src/engine/self-host/provider-home.js';
import {
  provisionLiveProviderHome,
} from './live-provider-home.js';

const execFileAsync = promisify(execFile);

async function git(sourceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: sourceRoot });
  return stdout;
}

async function createSourceCheckout(): Promise<string> {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'live-provider-home-source-'));
  await git(sourceRoot, ['init', '--initial-branch=main']);
  await git(sourceRoot, ['config', 'user.email', 'fixture@example.test']);
  await git(sourceRoot, ['config', 'user.name', 'Fixture']);
  await mkdir(join(sourceRoot, 'skills', 'pipeline'), { recursive: true });
  await writeFile(join(sourceRoot, 'skills', 'pipeline', 'SKILL.md'), '# Pipeline\n');
  await writeFile(join(sourceRoot, 'untracked-source-state.txt'), 'must remain untouched\n');
  await git(sourceRoot, ['add', 'skills']);
  await git(sourceRoot, ['commit', '-m', 'fixture']);
  return sourceRoot;
}

/** Test-only lifecycle exercise; the smoke owns teardown directly. */
async function withLiveProviderHome<T>(
  sourceRoot: string,
  use: (home: Awaited<ReturnType<typeof provisionLiveProviderHome>>) => Promise<T>,
): Promise<T> {
  const home = await provisionLiveProviderHome(sourceRoot);
  try {
    return await use(home);
  } finally {
    await home.teardown();
  }
}

describe('provisionLiveProviderHome', () => {
  it('copies skills from the explicit source root into a Claude provider home', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'live-provider-home-source-'));
    const skillsDir = join(sourceRoot, 'skills');

    try {
      await mkdir(join(skillsDir, 'pipeline'), { recursive: true });
      await writeFile(join(skillsDir, 'pipeline', 'SKILL.md'), '# Pipeline\n');

      const home = await provisionLiveProviderHome(sourceRoot);
      try {
        expect(home.childEnv().CLAUDE_CONFIG_DIR).toBe(home.homeDir);
        await expect(
          lstat(join(home.homeDir, 'skills', 'pipeline', 'SKILL.md')),
        ).resolves.toBeDefined();
        const copiedSkills = await lstat(join(home.homeDir, 'skills'));
        expect(copiedSkills.isDirectory()).toBe(true);
        expect(copiedSkills.isSymbolicLink()).toBe(false);
      } finally {
        await home.teardown();
      }
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the explicit source root has no skills directory', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'live-provider-home-no-skills-'));
    const homesRoot = await mkdtemp(join(tmpdir(), 'live-provider-home-homes-'));

    try {
      const error = await provisionLiveProviderHome(
        sourceRoot,
        undefined,
        homesRoot,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ProviderHomeProvisionError);
      expect(error).toMatchObject({
        message: expect.stringContaining(`'skills' at ${join(sourceRoot, 'skills')}`),
      });
      expect(await readdir(homesRoot)).toEqual([]);
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(homesRoot, { recursive: true, force: true });
    }
  });

  it('removes its home after normal and throwing use without changing the source checkout', async () => {
    const sourceRoot = await createSourceCheckout();

    try {
      const statusBefore = await git(sourceRoot, ['status', '--porcelain', '--untracked-files=all']);
      const normalHomeDir = await withLiveProviderHome(sourceRoot, async (home) => home.homeDir);
      await expect(access(normalHomeDir)).rejects.toThrow();

      const thrownHomeDir = await withLiveProviderHome(sourceRoot, async (home) => {
        throw Object.assign(new Error('caller failed'), { homeDir: home.homeDir });
      }).catch((error: unknown) => (error as { homeDir: string }).homeDir);
      await expect(access(thrownHomeDir)).rejects.toThrow();

      const home = await provisionLiveProviderHome(sourceRoot);
      await home.teardown();
      await home.teardown();
      await expect(access(home.homeDir)).rejects.toThrow();
      expect(await git(sourceRoot, ['status', '--porcelain', '--untracked-files=all'])).toBe(statusBefore);
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('keeps the Claude credential off a non-Claude provider leg', async () => {
    const sourceRoot = await createSourceCheckout();
    const authContexts: Array<{ provider: string; homeDir: string }> = [];
    const codexProvider: ResolvedSelfHostProvider = {
      id: 'codex',
      prepareSelfHostAuth: async (context) => {
        authContexts.push(context);
        return { env: { CODEX_API_KEY: 'codex-fixture-token' } };
      },
    };

    try {
      const home = await provisionLiveProviderHome(
        sourceRoot,
        'claude-fixture-token',
        undefined,
        codexProvider,
      );
      try {
        const env = home.childEnv();
        expect(home.provider).toBe('codex');
        expect(env.CODEX_HOME).toBe(home.homeDir);
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(env.CODEX_API_KEY).toBe('codex-fixture-token');
        expect(authContexts).toEqual([{ provider: 'codex', homeDir: home.homeDir }]);
      } finally {
        await home.teardown();
      }
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });
});
