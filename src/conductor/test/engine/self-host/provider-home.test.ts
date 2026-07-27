import { describe, expect, it } from 'vitest';
import { access, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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
        // Skills are copied, not symlinked: a live link would let provider
        // warmup writes land back inside the git-tracked worktree.
        expect((await lstat(join(home.homeDir, 'skills'))).isSymbolicLink()).toBe(false);
        expect(await realpath(join(home.homeDir, 'skills'))).toBe(join(home.homeDir, 'skills'));
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

  it('gives Codex a child-only .agents/skills view backed by the throwaway copy, not the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-skill-home-'));
    const worktree = join(root, 'worktree');
    await mkdir(join(worktree, 'skills', 'HARNESS'), { recursive: true });
    const home = await provisionProviderHome({ provider: { id: 'codex' }, worktreeRoot: worktree, baseDir: root });
    try {
      expect(await realpath(join(home.homeDir, '.agents', 'skills'))).toBe(
        await realpath(join(home.homeDir, 'skills')),
      );
      expect(await realpath(join(home.homeDir, '.agents', 'skills'))).not.toBe(
        await realpath(join(worktree, 'skills')),
      );
    } finally {
      await home.teardown();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never lets provider skill-discovery writes land inside the worktree (isolation regression)', async () => {
    // Regression for the leak where $CODEX_HOME/skills symlinked straight to
    // <worktree>/skills, so Codex's own session-init skill warmup wrote
    // `.system/` bookkeeping through the link into the live git worktree
    // under test (observed as untracked `skills/.system/` in worktree git
    // status during self-host builds). Simulates that warmup write against
    // both provisioned skill paths without requiring a real Codex binary.
    const root = await mkdtemp(join(tmpdir(), 'codex-skill-leak-'));
    const worktree = join(root, 'worktree');
    await mkdir(join(worktree, 'skills', 'HARNESS'), { recursive: true });
    const home = await provisionProviderHome({ provider: { id: 'codex' }, worktreeRoot: worktree, baseDir: root });
    try {
      // Simulate Codex's skill-warmup writing its `.system/` bookkeeping
      // through both surfaces the child sees.
      await mkdir(join(home.homeDir, 'skills', '.system'), { recursive: true });
      await writeFile(join(home.homeDir, 'skills', '.system', 'warmup.json'), '{}');
      await mkdir(join(home.homeDir, '.agents', 'skills', '.system-agents'), { recursive: true });
      await writeFile(join(home.homeDir, '.agents', 'skills', '.system-agents', 'warmup.json'), '{}');

      const worktreeSkillEntries = await readdir(join(worktree, 'skills'));
      expect(worktreeSkillEntries).not.toContain('.system');
      expect(worktreeSkillEntries).not.toContain('.system-agents');
      expect(worktreeSkillEntries.sort()).toEqual(['HARNESS']);
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
