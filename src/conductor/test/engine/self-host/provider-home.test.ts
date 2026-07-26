import { describe, expect, it } from 'vitest';
import { access, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { provisionProviderHome } from '../../../src/engine/self-host/provider-home.js';

describe('provider-aware self-host homes', () => {
  it.each([
    ['claude', 'CLAUDE_CONFIG_DIR'],
    ['codex', 'CODEX_HOME'],
  ] as const)(
    'provisions a private %s home with only selected auth, engine controls, and worktree assets',
    async (provider, homeVariable) => {
      const root = await mkdtemp(join(tmpdir(), 'provider-home-'));
      const worktree = join(root, 'worktree');
      const baseDir = join(root, 'homes');
      await Promise.all([
        mkdir(join(worktree, 'skills'), { recursive: true }),
        mkdir(baseDir, { recursive: true }),
      ]);

      const authCalls: string[] = [];
      const controlCalls: string[] = [];
      const home = await provisionProviderHome({
        provider: {
          id: provider,
          prepareSelfHostAuth: async ({ homeDir }) => {
            authCalls.push(homeDir);
            return { env: { SELECTED_AUTH: `${provider}-only` } };
          },
        },
        worktreeRoot: worktree,
        baseDir,
        parentEnv: {
          PATH: '/usr/bin',
          CLAUDE_CONFIG_DIR: '/live/claude',
          CODEX_HOME: '/live/codex',
          CLAUDE_CODE_OAUTH_TOKEN: 'live-token',
        },
        installEngineControls: async ({ homeDir }) => {
          controlCalls.push(homeDir);
          return { env: { ENGINE_CONTROL: 'write-fence' } };
        },
      });

      try {
        expect(home.homeDir.startsWith(baseDir)).toBe(true);
        expect(home.homeDir).toContain(`self-host-${provider}-`);
        expect(authCalls).toEqual([home.homeDir]);
        expect(controlCalls).toEqual([home.homeDir]);
        expect(home.childEnv()).toMatchObject({
          [homeVariable]: home.homeDir,
          SELECTED_AUTH: `${provider}-only`,
          ENGINE_CONTROL: 'write-fence',
        });
        expect(home.childEnv()).toMatchObject({ PATH: '/usr/bin' });
        expect(home.childEnv().CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(home.childEnv().CLAUDE_CONFIG_DIR).toBe(
          provider === 'claude' ? home.homeDir : undefined,
        );
        expect(home.childEnv().CODEX_HOME).toBe(provider === 'codex' ? home.homeDir : undefined);
        expect(await realpath(join(home.homeDir, 'skills'))).toBe(await realpath(join(worktree, 'skills')));
        expect((await lstat(join(home.homeDir, 'skills'))).isSymbolicLink()).toBe(true);
      } finally {
        await home.teardown();
        await home.teardown();
        await expect(access(home.homeDir)).rejects.toThrow();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('cleans only the allocated home when preparation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-home-failure-'));
    const worktree = join(root, 'worktree');
    const baseDir = join(root, 'homes');
    await Promise.all([
      mkdir(join(worktree, 'skills'), { recursive: true }),
      mkdir(baseDir, { recursive: true }),
    ]);

    await expect(
      provisionProviderHome({
        provider: {
          id: 'codex',
          prepareSelfHostAuth: async () => {
            throw new Error('Authorization: Bearer CANARY_SECRET_PROVIDER_HOME');
          },
        },
        worktreeRoot: worktree,
        baseDir,
      }),
    ).rejects.toThrow('[REDACTED]');
    expect((await (await import('node:fs/promises')).readdir(baseDir))).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it('gives Codex a child-only .agents/skills view of worktree skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-skill-home-'));
    const worktree = join(root, 'worktree');
    await mkdir(join(worktree, 'skills', 'HARNESS'), { recursive: true });
    const home = await provisionProviderHome({ provider: { id: 'codex' }, worktreeRoot: worktree, baseDir: root });
    try {
      expect(await realpath(join(home.homeDir, '.agents', 'skills'))).toBe(
        await realpath(join(worktree, 'skills')),
      );
    } finally {
      await home.teardown();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes only its created home when auth preparation fails after assets are linked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-home-partial-'));
    const worktree = join(root, 'worktree');
    await mkdir(join(worktree, 'skills'), { recursive: true });
    await expect(provisionProviderHome({ provider: { id: 'claude', prepareSelfHostAuth: async () => { throw new Error('CANARY_SECRET_PARTIAL'); } }, worktreeRoot: worktree, baseDir: root })).rejects.toThrow('[REDACTED]');
    expect((await (await import('node:fs/promises')).readdir(root)).filter(name => name.startsWith('self-host-'))).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });
});
