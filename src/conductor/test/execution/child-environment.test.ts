import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  scrubTmuxEnvironment,
  TMUX_ENVIRONMENT_KEYS,
} from '../../src/execution/child-environment.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { executeFullSuite, type FullSuiteCommandRunner } from '../../src/engine/full-suite-executor.js';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';
import { provisionSandboxBuildEnv } from '../../src/engine/self-host/sandbox-build-env.js';
import { verifyTokenLiveness } from '../../src/engine/self-host/token-liveness.js';

// The daemon runs inside tmux. A child that inherits TMUX / TMUX_PANE and runs
// a targetless tmux command (`tmux respawn-pane -k`) resolves it to the
// daemon's own pane and kills the daemon. These tests pin that every spawn
// seam — both provider adapters, the self-host homes, the full-suite executor
// and the token-liveness probe — hands its child an env with both keys absent.

const TMUX_PARENT = { TMUX: '/tmp/tmux-1000/default,1234,0', TMUX_PANE: '%7' } as const;

function expectScrubbed(env: NodeJS.ProcessEnv | undefined): void {
  expect(env).toBeDefined();
  for (const key of TMUX_ENVIRONMENT_KEYS) expect(env![key]).toBeUndefined();
}

describe('scrubTmuxEnvironment', () => {
  it('masks TMUX and TMUX_PANE without mutating the input or dropping other keys', () => {
    const input: NodeJS.ProcessEnv = { ...TMUX_PARENT, PATH: '/usr/bin' };
    const scrubbed = scrubTmuxEnvironment(input);
    expectScrubbed(scrubbed);
    expect(scrubbed.PATH).toBe('/usr/bin');
    expect(input).toEqual({ ...TMUX_PARENT, PATH: '/usr/bin' });
    // Masked, not deleted: the key must shadow the parent value when execa
    // extends process.env underneath the overlay.
    expect(Object.keys(scrubbed)).toEqual(expect.arrayContaining([...TMUX_ENVIRONMENT_KEYS]));
    expectScrubbed(scrubbedWithNoInput());
  });

  it.each([
    ['extended (execa default)', true],
    ['replaced (extendEnv: false)', false],
  ])('leaves no tmux target in a real child env when the overlay is %s', async (_mode, extendEnv) => {
    // Local `sh` is the boundary under test (how execa/Node materialize an
    // undefined-valued overlay); nothing third-party is invoked.
    const parent = { ...process.env, ...TMUX_PARENT };
    const { stdout } = await execa(
      'sh',
      ['-c', 'printf "%s|%s" "${TMUX-unset}" "${TMUX_PANE-unset}"'],
      { extendEnv, env: scrubTmuxEnvironment(extendEnv ? TMUX_PARENT : parent) },
    );
    expect(stdout).toBe('unset|unset');
  });
});

function scrubbedWithNoInput(): NodeJS.ProcessEnv {
  return scrubTmuxEnvironment();
}

// ── Provider adapters ────────────────────────────────────────────────────────

type CapturedSpawn = { env: NodeJS.ProcessEnv | undefined };

const baseOptions: InvokeOptions = {
  prompt: 'Do the thing',
  sessionId: 'tmux-scrub-env-test',
  resume: false,
};

function claudeCapture() {
  const calls: CapturedSpawn[] = [];
  const subprocessFactory = vi.fn(
    (_file: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ env: options.env });
      return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0, failed: false }) as any;
    },
  );
  return { calls, provider: new ClaudeProvider(undefined, subprocessFactory) };
}

function codexCapture() {
  const runDoctor = vi.fn(async () => ({
    stdout: JSON.stringify({
      schemaVersion: 1,
      auth: { selectedMode: 'cached-login', configured: true },
      transport: { authenticated: true },
    }),
    exitCode: 0,
  }));
  const calls: CapturedSpawn[] = [];
  const subprocessFactory = vi.fn(
    (_file: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ env: options.env });
      return Promise.resolve({
        stdout: [
          JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }),
          JSON.stringify({ type: 'turn.completed' }),
        ].join('\n'),
        stderr: '',
        exitCode: 0,
        failed: false,
      }) as any;
    },
  );
  return { calls, provider: new CodexProvider(runDoctor, 'codex', undefined, subprocessFactory as any) };
}

describe('provider child env tmux scrub', () => {
  const saved: Partial<Record<(typeof TMUX_ENVIRONMENT_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of TMUX_ENVIRONMENT_KEYS) saved[key] = process.env[key];
    Object.assign(process.env, TMUX_PARENT);
  });

  afterEach(() => {
    for (const key of TMUX_ENVIRONMENT_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('claude: scrubs the inherited env and a self-host overlay that carries tmux keys', async () => {
    const { calls, provider } = claudeCapture();
    await provider.invoke({
      ...baseOptions,
      selfHost: {
        executable: '/throwaway/claude',
        args: [],
        env: { ...TMUX_PARENT, CLAUDE_CONFIG_DIR: '/throwaway/home' },
        teardown: async () => {},
      },
    });
    expect(calls).toHaveLength(1);
    expectScrubbed(calls[0]!.env);
    expect(calls[0]!.env?.CLAUDE_CONFIG_DIR).toBe('/throwaway/home');
    expect(calls[0]!.env?.CONDUCT_DAEMON_SESSION).toBe('1');
  });

  it('codex: masks tmux keys in the overlay so execa cannot re-extend them from the parent', async () => {
    const { calls, provider } = codexCapture();
    await provider.invoke({
      ...baseOptions,
      selfHost: {
        executable: '/throwaway/codex',
        args: [],
        env: { ...TMUX_PARENT, CODEX_HOME: '/throwaway/home' },
        teardown: async () => {},
      },
    });
    expect(calls).toHaveLength(1);
    const env = calls[0]!.env!;
    expectScrubbed(env);
    // The codex overlay is merged over process.env by execa: the keys must be
    // present-and-undefined, not merely absent, for the mask to hold.
    expect(Object.keys(env)).toEqual(expect.arrayContaining([...TMUX_ENVIRONMENT_KEYS]));
    expect(env.CODEX_HOME).toBe('/throwaway/home');
  });
});

// ── Self-host homes ──────────────────────────────────────────────────────────

describe('self-host child env tmux scrub', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tmux-scrub-'));
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it.each(['claude', 'codex'] as const)('provider home (%s) childEnv drops inherited tmux keys', async (id) => {
    const worktree = join(root, 'worktree');
    const baseDir = join(root, 'homes');
    await Promise.all([
      mkdir(join(worktree, 'skills'), { recursive: true }),
      mkdir(baseDir, { recursive: true }),
    ]);
    const home = await provisionProviderHome({
      provider: { id, prepareSelfHostAuth: async () => ({ env: {} }) },
      worktreeRoot: worktree,
      baseDir,
      parentEnv: { PATH: '/usr/bin', ...TMUX_PARENT },
      installEngineControls: async () => ({ env: {} }),
    });
    try {
      expectScrubbed(home.childEnv());
      expect(home.childEnv().PATH).toBe('/usr/bin');
    } finally {
      await home.teardown();
    }
  });

  it('sandbox build env childEnv drops inherited tmux keys', async () => {
    const worktree = join(root, 'worktree');
    const globalConfig = join(root, 'global');
    const base = join(root, 'homes');
    await Promise.all([
      mkdir(join(worktree, 'skills'), { recursive: true }),
      mkdir(join(worktree, 'hooks'), { recursive: true }),
      mkdir(globalConfig, { recursive: true }),
      mkdir(base, { recursive: true }),
    ]);
    const sandbox = await provisionSandboxBuildEnv({
      worktreeRoot: worktree,
      harnessRoot: worktree,
      baseDir: base,
      globalStateFile: join(globalConfig, '.claude.json'),
      parentEnv: { PATH: '/usr/bin', ...TMUX_PARENT },
    });
    try {
      expectScrubbed(sandbox.childEnv());
      expect(sandbox.childEnv().CLAUDE_CONFIG_DIR).toBe(sandbox.configDir);
    } finally {
      await sandbox.teardown();
    }
  });

  it('token-liveness probe env drops inherited tmux keys', async () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const saved = { ...TMUX_PARENT };
    for (const key of TMUX_ENVIRONMENT_KEYS) saved[key] = process.env[key] as never;
    Object.assign(process.env, TMUX_PARENT);
    try {
      await verifyTokenLiveness({
        token: 'probe-token',
        baseDir: root,
        spawner: async (_argv, env) => {
          seen.push(env);
          return { exitCode: 0, stdout: JSON.stringify({ type: 'result', is_error: false }), timedOut: false };
        },
      });
    } finally {
      for (const key of TMUX_ENVIRONMENT_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
    expect(seen).toHaveLength(1);
    expectScrubbed(seen[0]);
    expect(seen[0]!.CLAUDE_CODE_OAUTH_TOKEN).toBe('probe-token');
  });
});

// ── Test / verification subprocesses ─────────────────────────────────────────

describe('full-suite executor tmux scrub', () => {
  it('hands the runner an env with tmux keys masked and everything else intact', async () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const runner: FullSuiteCommandRunner = async (_command, options) => {
      seen.push(options.env);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const result = await executeFullSuite({
      projectRoot: '/repo',
      testSuite: { command: 'npm test' },
      environment: { PATH: '/fixture/bin', ...TMUX_PARENT },
      runner,
    });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expectScrubbed(seen[0]);
    expect(seen[0]!.PATH).toBe('/fixture/bin');
  });
});
