import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  provisionSandboxBuildEnv,
  realSandboxFs,
  SandboxProvisionError,
  type SandboxFs,
  withSandboxBuildEnv,
} from '../../../src/engine/self-host/sandbox-build-env.js';

describe('minimal Claude self-host sandbox', () => {
  let root: string;
  let worktree: string;
  let globalConfig: string;
  let base: string;

  const options = (over: Record<string, unknown> = {}) => ({
    worktreeRoot: worktree,
    harnessRoot: worktree,
    baseDir: base,
    globalConfigDir: globalConfig,
    globalStateFile: join(globalConfig, '.claude.json'),
    ...over,
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'minimal-claude-home-'));
    worktree = join(root, 'worktree');
    globalConfig = join(root, 'global');
    base = join(root, 'homes');
    await Promise.all([
      mkdir(join(worktree, 'skills'), { recursive: true }),
      mkdir(join(worktree, 'hooks'), { recursive: true }),
      mkdir(globalConfig, { recursive: true }),
      mkdir(base, { recursive: true }),
    ]);
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('does not inherit a personal hook from operator settings', async () => {
    const personalHook = join(globalConfig, 'hooks', 'personal.sh');
    await mkdir(join(globalConfig, 'hooks'), { recursive: true });
    await writeFile(personalHook, 'operator hook');
    await writeFile(join(globalConfig, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ command: personalHook }] } }));

    const sandbox = await provisionSandboxBuildEnv(options());
    try {
      expect(await readFile(join(sandbox.configDir, 'settings.json'), 'utf8')).not.toContain(personalHook);
    } finally {
      await sandbox.teardown();
    }
  });

  it('contains only engine controls and worktree skills, never operator settings/state/extensions/history/sessions/hooks', async () => {
    const sentinels = [
      ['settings.json', 'PERSONAL_SETTINGS'],
      ['.claude.json', 'PERSONAL_TRUST_STATE'],
      ['extensions/enabled.json', 'PERSONAL_EXTENSION'],
      ['history.jsonl', 'PERSONAL_HISTORY'],
      ['sessions/live.json', 'PERSONAL_SESSION'],
      ['hooks/personal.sh', 'PERSONAL_HOOK'],
    ] as const;
    for (const [relative, value] of sentinels) {
      await mkdir(join(globalConfig, relative, '..'), { recursive: true });
      await writeFile(join(globalConfig, relative), value);
    }
    const before = await Promise.all(sentinels.map(async ([relative]) => readFile(join(globalConfig, relative), 'utf8')));

    const sandbox = await provisionSandboxBuildEnv(options());
    try {
      const entries = await readdir(sandbox.configDir);
      expect(entries.sort()).toEqual(['settings.json', 'skills', 'write-fence.sh']);
      expect((await lstat(join(sandbox.configDir, 'skills'))).isSymbolicLink()).toBe(true);
      expect(existsSync(join(sandbox.configDir, 'hooks'))).toBe(false);
      const generated = await readFile(join(sandbox.configDir, 'settings.json'), 'utf8');
      for (const [, sentinel] of sentinels) expect(generated).not.toContain(sentinel);
      expect(generated).toContain('write-fence.sh');
    } finally {
      await sandbox.teardown();
    }
    await expect(Promise.all(sentinels.map(async ([relative]) => readFile(join(globalConfig, relative), 'utf8')))).resolves.toEqual(before);
  });

  it('creates an engine-owned executable write fence and never a worktree hooks link', async () => {
    const sandbox = await provisionSandboxBuildEnv(options());
    try {
      const fence = join(sandbox.configDir, 'write-fence.sh');
      expect((await stat(fence)).mode & 0o100).not.toBe(0);
      expect(await readFile(fence, 'utf8')).toContain(`WORKTREE_ROOT="${worktree}"`);
      expect(existsSync(join(sandbox.configDir, 'hooks'))).toBe(false);
    } finally {
      await sandbox.teardown();
    }
  });

  describe('workspace-trust propagation (.claude.json)', () => {
    const stateFile = () => join(globalConfig, '.claude.json');
    const seeded = async (sandbox: { configDir: string }) =>
      JSON.parse(await readFile(join(sandbox.configDir, '.claude.json'), 'utf8'));

    it('seeds trust for the harness root the operator already trusts', async () => {
      await writeFile(
        stateFile(),
        JSON.stringify({
          hasCompletedOnboarding: true,
          oauthAccount: { accessToken: 'PERSONAL_TOKEN' },
          projects: { [worktree]: { hasTrustDialogAccepted: true, history: ['PERSONAL_HISTORY'] } },
        }),
      );

      const sandbox = await provisionSandboxBuildEnv(options());
      try {
        const raw = await readFile(join(sandbox.configDir, '.claude.json'), 'utf8');
        // The consulted key is the harness (git main) root — see the module docs.
        expect((await seeded(sandbox)).projects[worktree]).toEqual({ hasTrustDialogAccepted: true });
        // Propagation carries the trust bit ONLY — never operator secrets/history.
        expect(raw).not.toContain('PERSONAL_TOKEN');
        expect(raw).not.toContain('PERSONAL_HISTORY');
      } finally {
        await sandbox.teardown();
      }
    });

    it('seeds the build worktree key alongside the harness root', async () => {
      const buildWorktree = join(root, 'wt-build');
      await mkdir(join(buildWorktree, 'skills'), { recursive: true });
      await writeFile(
        stateFile(),
        JSON.stringify({ projects: { [worktree]: { hasTrustDialogAccepted: true } } }),
      );

      const sandbox = await provisionSandboxBuildEnv(options({ worktreeRoot: buildWorktree }));
      try {
        const state = await seeded(sandbox);
        expect(state.projects[worktree]).toEqual({ hasTrustDialogAccepted: true });
        expect(state.projects[buildWorktree]).toEqual({ hasTrustDialogAccepted: true });
      } finally {
        await sandbox.teardown();
      }
    });

    it('never fabricates trust the operator has not granted', async () => {
      await writeFile(
        stateFile(),
        JSON.stringify({ projects: { [worktree]: { hasTrustDialogAccepted: false } } }),
      );

      const sandbox = await provisionSandboxBuildEnv(options());
      try {
        expect(existsSync(join(sandbox.configDir, '.claude.json'))).toBe(false);
      } finally {
        await sandbox.teardown();
      }
    });

    it('seeds nothing when the operator state file is missing or malformed', async () => {
      for (const body of [null, 'not json', JSON.stringify({ projects: null })]) {
        if (body === null) await rm(stateFile(), { force: true });
        else await writeFile(stateFile(), body);
        const sandbox = await provisionSandboxBuildEnv(options());
        try {
          expect(existsSync(join(sandbox.configDir, '.claude.json'))).toBe(false);
        } finally {
          await sandbox.teardown();
        }
      }
    });
  });

  it('fails closed and removes the exact partial home when worktree skills are absent', async () => {
    await rm(join(worktree, 'skills'), { recursive: true, force: true });
    await expect(provisionSandboxBuildEnv(options())).rejects.toBeInstanceOf(SandboxProvisionError);
    expect(await readdir(base)).toEqual([]);
  });

  it('keeps the child env isolated and teardown idempotent on the crash path', async () => {
    const parentEnv = { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/operator/.claude' };
    let captured = '';
    await expect(withSandboxBuildEnv(options({ parentEnv }), async (sandbox) => {
      captured = sandbox.configDir;
      expect(sandbox.childEnv()).toMatchObject({ CLAUDE_CONFIG_DIR: sandbox.configDir, PATH: '/usr/bin' });
      throw new Error('build crash');
    })).rejects.toThrow('build crash');
    await expect(access(captured)).rejects.toThrow();
    expect(parentEnv.CLAUDE_CONFIG_DIR).toBe('/operator/.claude');
  });

  it('redacts and cleans a partial engine-control failure', async () => {
    let created = '';
    const failingFs: SandboxFs = {
      ...realSandboxFs,
      mkdtemp: async (prefix) => (created = await realSandboxFs.mkdtemp(prefix)),
      writeFile: async (path, value) => {
        if (path.endsWith('write-fence.sh')) throw Object.assign(new Error('CANARY_SECRET_FENCE'), { path });
        await realSandboxFs.writeFile(path, value);
      },
    };
    await expect(provisionSandboxBuildEnv(options({ fs: failingFs }))).rejects.toThrow('write-fence.sh');
    expect(existsSync(created)).toBe(false);
  });
});
