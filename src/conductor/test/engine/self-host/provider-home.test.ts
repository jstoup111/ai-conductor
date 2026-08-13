import { describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  ProviderHomeProvisionError,
  provisionProviderHome,
  realProviderHomeFs,
  type ProviderHomeFs,
} from '../../../src/engine/self-host/provider-home.js';
import { OPERATOR_ONLY_SKILLS } from '../../../src/engine/worktree-prepare.js';

const execFile = promisify(execFileCb);

describe('provider-aware self-host homes', () => {
  it('provisions a Codex home from the worktree scratch root unless baseDir is explicit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-home-scratch-'));
    const worktree = join(root, 'worktree');
    const explicitBaseDir = join(root, 'explicit-homes');
    await Promise.all([
      mkdir(join(worktree, 'skills'), { recursive: true }),
      mkdir(explicitBaseDir, { recursive: true }),
    ]);

    const home = await provisionProviderHome({
      provider: { id: 'codex' },
      worktreeRoot: worktree,
      repository: 'owner/repository',
      featureSlug: 'provider-home',
      runId: 'run-11',
      attempt: 2,
    });
    const explicitHome = await provisionProviderHome({
      provider: { id: 'codex' },
      worktreeRoot: worktree,
      runId: 'run-11',
      attempt: 2,
      baseDir: explicitBaseDir,
    });
    try {
      const scratchRoot = join(worktree, '.daemon', 'scratch', 'run-11', '2-codex');
      expect([home.homeDir, home.childEnv().CODEX_HOME, explicitHome.homeDir]).toEqual([
        expect.stringMatching(new RegExp(`^${scratchRoot}/self-host-codex-`)),
        home.homeDir,
        expect.stringMatching(new RegExp(`^${explicitBaseDir}/self-host-codex-`)),
      ]);
      const lease = JSON.parse(await readFile(join(scratchRoot, 'owner.json'), 'utf8'));
      expect(Object.keys(lease).sort()).toEqual(['attempt', 'featureSlug', 'ownerPid', 'repository', 'runId', 'startedAt']);
      expect(lease).toMatchObject({ repository: 'owner/repository', featureSlug: 'provider-home', runId: 'run-11', attempt: 2, ownerPid: process.pid });
      expect(new Date(lease.startedAt).toISOString()).toBe(lease.startedAt);
    } finally {
      await Promise.all([home.teardown(), explicitHome.teardown()]);
      await rm(root, { recursive: true, force: true });
    }
  });

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

  it('preserves the missing-skills error and releases its default scratch lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-home-missing-skills-'));
    const worktree = join(root, 'worktree');
    const scratchHome = join(worktree, '.daemon', 'scratch', 'run-14', '5-claude');
    await mkdir(worktree, { recursive: true });
    let observedLease: Record<string, unknown> | undefined;
    const fs: ProviderHomeFs = {
      ...realProviderHomeFs,
      pathExists: async (path) => {
        if (path === join(worktree, 'skills')) {
          observedLease = JSON.parse(await readFile(join(scratchHome, 'owner.json'), 'utf8'));
          return false;
        }
        return realProviderHomeFs.pathExists(path);
      },
    };

    try {
      await expect(provisionProviderHome({
        provider: { id: 'claude' },
        worktreeRoot: worktree,
        repository: 'owner/repository',
        featureSlug: 'provider-home-missing-skills',
        runId: 'run-14',
        attempt: 5,
        fs,
      })).rejects.toEqual(expect.objectContaining({
        name: ProviderHomeProvisionError.name,
        message: `Self-host worktree is missing required asset 'skills' at ${join(worktree, 'skills')}.`,
      }));
      expect(observedLease).toMatchObject({
        repository: 'owner/repository',
        featureSlug: 'provider-home-missing-skills',
        runId: 'run-14',
        attempt: 5,
        ownerPid: process.pid,
      });
      await expect(access(scratchHome)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('releases the production-written scratch lease when preparation fails after acquisition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-home-leased-failure-'));
    const worktree = join(root, 'worktree');
    const scratchHome = join(worktree, '.daemon', 'scratch', 'run-14', '3-claude');
    await mkdir(join(worktree, 'skills'), { recursive: true });
    let observedLease: Record<string, unknown> | undefined;

    try {
      await expect(provisionProviderHome({
        provider: {
          id: 'claude',
          prepareSelfHostAuth: async () => {
            observedLease = JSON.parse(await readFile(join(scratchHome, 'owner.json'), 'utf8'));
            throw new Error('post-acquire failure');
          },
        },
        worktreeRoot: worktree,
        repository: 'owner/repository',
        featureSlug: 'provider-home-failure',
        runId: 'run-14',
        attempt: 3,
      })).rejects.toThrow('Failed to provision isolated claude self-host home: post-acquire failure');
      expect(observedLease).toMatchObject({
        repository: 'owner/repository',
        featureSlug: 'provider-home-failure',
        runId: 'run-14',
        attempt: 3,
        ownerPid: process.pid,
      });
      await expect(access(scratchHome)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a git worktree clean while its provider home exists under ignored scratch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-home-clean-worktree-'));
    const worktree = join(root, 'worktree');
    await mkdir(join(worktree, 'skills'), { recursive: true });
    await Promise.all([
      writeFile(join(worktree, '.gitignore'), '.daemon/\n'),
      writeFile(join(worktree, 'skills', 'SKILL.md'), 'skill\n'),
    ]);
    await execFile('git', ['init', '--quiet', '-b', 'main', worktree]);
    await execFile('git', ['-C', worktree, 'config', 'user.email', 'task14@example.test']);
    await execFile('git', ['-C', worktree, 'config', 'user.name', 'Task Fourteen']);
    await execFile('git', ['-C', worktree, 'add', '.']);
    await execFile('git', ['-C', worktree, 'commit', '--quiet', '-m', 'fixture']);

    const home = await provisionProviderHome({
      provider: { id: 'codex' },
      worktreeRoot: worktree,
      repository: 'owner/repository',
      featureSlug: 'provider-home-clean',
      runId: 'run-14',
      attempt: 4,
    });
    try {
      expect(home.homeDir).toContain(join('.daemon', 'scratch', 'run-14', '4-codex'));
      expect((await execFile('git', ['-C', worktree, 'status', '--porcelain'])).stdout).toBe('');
    } finally {
      await home.teardown();
      await rm(root, { recursive: true, force: true });
    }
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

  // Operator-only skills must not be loadable from a dispatched step, on EITHER
  // provider. Claude honors a `skillOverrides` entry; Codex discovers skills by
  // listing the directory and honors no override — so the enforcement that
  // covers both is pruning the throwaway copy, leaving no artifact to load.
  it.each(['claude', 'codex'] as const)(
    'prunes every operator-only skill from the %s throwaway skills copy, leaving the worktree intact',
    async (providerId) => {
      const root = await mkdtemp(join(tmpdir(), 'operator-only-home-'));
      const worktree = join(root, 'worktree');
      await mkdir(join(worktree, 'skills', 'HARNESS'), { recursive: true });
      // A skill that must survive, alongside every operator-only one.
      await mkdir(join(worktree, 'skills', 'keeper'), { recursive: true });
      await writeFile(join(worktree, 'skills', 'keeper', 'SKILL.md'), 'keep me\n', 'utf-8');
      for (const skill of OPERATOR_ONLY_SKILLS) {
        await mkdir(join(worktree, 'skills', skill), { recursive: true });
        await writeFile(join(worktree, 'skills', skill, 'SKILL.md'), 'operator only\n', 'utf-8');
      }

      const home = await provisionProviderHome({
        provider: { id: providerId },
        worktreeRoot: worktree,
        baseDir: root,
      });
      try {
        expect(OPERATOR_ONLY_SKILLS.length).toBeGreaterThan(0);
        for (const skill of OPERATOR_ONLY_SKILLS) {
          // Absent from the copy the provider actually reads…
          await expect(access(join(home.homeDir, 'skills', skill))).rejects.toThrow();
          // …and still present in the worktree, which is never pruned.
          await expect(access(join(worktree, 'skills', skill))).resolves.toBeUndefined();
        }
        // Codex's view is the same pruned copy, not a second path to the worktree.
        if (providerId === 'codex') {
          for (const skill of OPERATOR_ONLY_SKILLS) {
            await expect(access(join(home.homeDir, '.agents', 'skills', skill))).rejects.toThrow();
          }
        }
        // Pruning is surgical: every other skill survives.
        await expect(
          access(join(home.homeDir, 'skills', 'keeper', 'SKILL.md')),
        ).resolves.toBeUndefined();
      } finally {
        await home.teardown();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

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
