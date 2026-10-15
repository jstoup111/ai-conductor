// Covers: task:8
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  provisionSandboxBuildEnv,
  realSandboxFs,
  sandboxLinkTargets,
  SandboxProvisionError,
  type SandboxFs,
  withSandboxBuildEnv,
} from '../../../src/engine/self-host/sandbox-build-env.js';
import { verifyTokenLiveness } from '../../../src/engine/self-host/token-liveness.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

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
      const skills = await lstat(join(sandbox.configDir, 'skills'));
      expect(skills.isDirectory()).toBe(true);
      expect(skills.isSymbolicLink()).toBe(false);
      expect(existsSync(join(sandbox.configDir, 'hooks'))).toBe(false);
      const generated = await readFile(join(sandbox.configDir, 'settings.json'), 'utf8');
      for (const [, sentinel] of sentinels) expect(generated).not.toContain(sentinel);
      expect(generated).toContain('write-fence.sh');
    } finally {
      await sandbox.teardown();
    }
    await expect(Promise.all(sentinels.map(async ([relative]) => readFile(join(globalConfig, relative), 'utf8')))).resolves.toEqual(before);
  });

  it('links each worktree skill under its frontmatter name', async () => {
    const renamedSkill = join(worktree, 'skills', 'legacy-skill');
    const fallbackSkill = join(worktree, 'skills', 'plain-skill');
    await Promise.all([
      mkdir(renamedSkill),
      mkdir(fallbackSkill),
    ]);
    await Promise.all([
      writeFile(join(renamedSkill, 'SKILL.md'), '---\nname: ac-renamed-skill\n---\n'),
      writeFile(join(fallbackSkill, 'SKILL.md'), '# no frontmatter name\n'),
    ]);

    const sandbox = await provisionSandboxBuildEnv(options());
    try {
      const skillsDir = join(sandbox.configDir, 'skills');
      expect((await lstat(skillsDir)).isDirectory()).toBe(true);
      expect((await lstat(skillsDir)).isSymbolicLink()).toBe(false);
      expect((await readdir(skillsDir)).sort()).toEqual(['ac-renamed-skill', 'plain-skill']);
      await expect(realpath(join(skillsDir, 'ac-renamed-skill'))).resolves.toBe(renamedSkill);
      await expect(realpath(join(skillsDir, 'plain-skill'))).resolves.toBe(fallbackSkill);
      await expect(sandboxLinkTargets(sandbox)).resolves.toEqual({
        'ac-renamed-skill': renamedSkill,
        'plain-skill': fallbackSkill,
      });
    } finally {
      await sandbox.teardown();
    }
  });

  it('fails closed and removes the partial sandbox when a skill link escapes the worktree skills directory', async () => {
    const outsideSkill = join(root, 'outside-skill');
    await mkdir(outsideSkill);
    await writeFile(join(outsideSkill, 'SKILL.md'), '---\nname: escape\n---\n');
    await symlink(outsideSkill, join(worktree, 'skills', 'escape'));

    await expect(provisionSandboxBuildEnv(options())).rejects.toBeInstanceOf(SandboxProvisionError);
    expect(await readdir(base)).toEqual([]);
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

  it('keeps Claude sandbox state in worktree scratch while token liveness uses and removes OS temp state', async () => {
    const { baseDir: _explicitBaseDir, ...defaulted } = options();
    const scratchRoot = join(worktree, '.daemon', 'scratch', 'run-12', '1-claude');
    const sandbox = await provisionSandboxBuildEnv({
      ...defaulted,
      repository: 'owner/repository',
      featureSlug: 'sandbox-build-env',
      runId: 'run-12',
      attempt: 1,
    });
    try {
      expect([sandbox.configDir, sandbox.childEnv().CLAUDE_CONFIG_DIR]).toEqual([
        expect.stringMatching(new RegExp(`^${scratchRoot}`)),
        expect.stringMatching(new RegExp(`^${scratchRoot}`)),
      ]);
      const lease = JSON.parse(await readFile(join(scratchRoot, 'owner.json'), 'utf8'));
      expect(Object.keys(lease).sort()).toEqual(['attempt', 'featureSlug', 'ownerPid', 'provider', 'repository', 'runId', 'startedAt']);
      expect(lease).toMatchObject({ repository: 'owner/repository', featureSlug: 'sandbox-build-env', runId: 'run-12', attempt: 1, ownerPid: process.pid });
      expect(new Date(lease.startedAt).toISOString()).toBe(lease.startedAt);

      let livenessConfigDir = '';
      await verifyTokenLiveness({
        token: 'test-token',
        spawner: async (_argv, env) => {
          livenessConfigDir = env.CLAUDE_CONFIG_DIR!;
          return { exitCode: 0, stdout: JSON.stringify({ is_error: false }), timedOut: false };
        },
      });
      expect(livenessConfigDir.startsWith(`${tmpdir()}/`)).toBe(true);
      expect(livenessConfigDir.startsWith(`${scratchRoot}/`)).toBe(false);
      await expect(access(livenessConfigDir)).rejects.toThrow();
    } finally {
      await sandbox.teardown();
    }
  });

  it('releases the production-written scratch lease when Claude provisioning fails after acquisition', async () => {
    const { baseDir: _explicitBaseDir, ...defaulted } = options();
    const scratchHome = join(worktree, '.daemon', 'scratch', 'run-15', '2-claude');
    let observedLease: Record<string, unknown> | undefined;
    const failingFs: SandboxFs = {
      ...realSandboxFs,
      writeFile: async (path, value) => {
        if (path.endsWith('settings.json')) {
          observedLease = JSON.parse(await readFile(join(scratchHome, 'owner.json'), 'utf8'));
          throw Object.assign(new Error('post-acquire Claude provisioning failure'), { path });
        }
        await realSandboxFs.writeFile(path, value);
      },
    };

    await expect(provisionSandboxBuildEnv({
      ...defaulted,
      repository: 'owner/repository',
      featureSlug: 'sandbox-build-env-failure',
      runId: 'run-15',
      attempt: 2,
      fs: failingFs,
    })).rejects.toThrow('post-acquire Claude provisioning failure');
    expect(observedLease).toMatchObject({
      repository: 'owner/repository',
      featureSlug: 'sandbox-build-env-failure',
      runId: 'run-15',
      attempt: 2,
      ownerPid: process.pid,
    });
    await expect(access(scratchHome)).rejects.toThrow();
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

  it('harvests Claude transcripts before removing its sandbox and emits one capture event', async () => {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const sandbox = await provisionSandboxBuildEnv(options({
      step: 'build', runId: 'r1', attempt: 1, events,
    }));
    const session = join(sandbox.configDir, 'projects', 'w', 's.jsonl');
    const subagent = join(sandbox.configDir, 'projects', 'w', 's', 'subagents', 'a.jsonl');
    await mkdir(join(session, '..'), { recursive: true });
    await mkdir(join(subagent, '..'), { recursive: true });
    await writeFile(session, '{"type":"assistant"}\n');
    await writeFile(subagent, '{"type":"assistant"}\n');

    try {
      await sandbox.teardown();
      await sandbox.teardown();
      const capture = join(worktree, '.pipeline', 'transcripts', 'build', 'r1-a1-claude');
      await expect(readFile(join(capture, 'projects', 'w', 's.jsonl'), 'utf8')).resolves.toContain('assistant');
      await expect(readFile(join(capture, 'projects', 'w', 's', 'subagents', 'a.jsonl'), 'utf8')).resolves.toContain('assistant');
      await expect(access(sandbox.configDir)).rejects.toThrow();
      const records = (await readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(records.filter((record) => record.type === 'provider_transcripts_captured')).toEqual([
        expect.objectContaining({
          step: 'build', runId: 'r1', attempt: 1, provider: 'claude',
          path: '.pipeline/transcripts/build/r1-a1-claude', files: 2,
        }),
      ]);
    } finally {
      persister.stop();
    }
  });

  it('keys a Claude capture by rubric member and reports a failed harvest without blocking teardown', async () => {
    const events = new ConductorEventEmitter();
    const captured: unknown[] = [];
    const failed: unknown[] = [];
    events.on('provider_transcripts_captured', (event) => { captured.push(event); });
    events.on('provider_transcripts_harvest_failed', (event) => { failed.push(event); });
    const sandbox = await provisionSandboxBuildEnv(options({
      step: 'build', runId: 'r1', attempt: 1, member: 'rubric-a', events,
    }));
    await mkdir(join(sandbox.configDir, 'projects', 'w'), { recursive: true });
    await writeFile(join(sandbox.configDir, 'projects', 'w', 's.jsonl'), '{"type":"assistant"}\n');

    await sandbox.teardown();
    expect(captured).toEqual([expect.objectContaining({
      path: '.pipeline/transcripts/build/r1-a1-rubric-a-claude', member: 'rubric-a',
    })]);
    expect(failed).toEqual([]);
    await expect(readFile(join(worktree, '.pipeline', 'transcripts', 'build', 'r1-a1-rubric-a-claude', 'projects', 'w', 's.jsonl'), 'utf8')).resolves.toContain('assistant');
  });

  it('reports a harvest failure and still removes the Claude sandbox', async () => {
    const events = new ConductorEventEmitter();
    const failed: unknown[] = [];
    events.on('provider_transcripts_harvest_failed', (event) => { failed.push(event); });
    const sandbox = await provisionSandboxBuildEnv(options({
      step: 'build', runId: 'r1', attempt: 1, events,
    }));
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'transcripts'), 'not a directory');

    await expect(sandbox.teardown()).resolves.toBeUndefined();
    expect(failed).toEqual([expect.objectContaining({
      step: 'build', runId: 'r1', attempt: 1, provider: 'claude',
      path: '.pipeline/transcripts/build/r1-a1-claude',
    })]);
    await expect(access(sandbox.configDir)).rejects.toThrow();
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
