// Covers: task:14
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions, ResultPromise } from 'execa';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const reviewProfile = {
  kind: 'ready' as const,
  provider: 'codex' as const,
  profile: {
    scratch: '/review/private/codex',
    mountArgs: [
      '--ro-bind', '/review/source', '/review/source',
      '--ro-bind', '/review/policy', '/review/policy',
      '--bind', '/review/private/codex', '/review/private/codex',
    ],
  },
};

const claudeReviewProfile = {
  ...reviewProfile,
  provider: 'claude' as const,
  profile: {
    scratch: '/review/private/claude',
    mountArgs: [
      '--ro-bind', '/review/source', '/review/source',
      '--ro-bind', '/review/policy', '/review/policy',
      '--bind', '/review/private/claude', '/review/private/claude',
    ],
  },
};

const baseOptions: InvokeOptions = {
  prompt: 'Review the frozen implementation and return the required result.',
  systemPrompt: 'Selected policy:\n- required criterion\nSupport tree: /review/policy/resources/checklist.md',
  sessionId: 'review-session',
  resume: false,
  interactive: false,
  cwd: '/review/source',
};

function codexCompletion() {
  return [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'complete review envelope' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 2 } }),
  ].join('\n');
}

const AMBIENT = {
  PATH: '/fixture/bin', LANG: 'en_US.UTF-8', LC_ALL: 'C',
  GH_TOKEN: 'tracker-secret', GITHUB_TOKEN: 'tracker-secret-2', JIRA_API_TOKEN: 'jira-secret', FOO_SECRET: 'ambient-secret',
  ANTHROPIC_API_KEY: 'claude-auth', OPENAI_API_KEY: 'codex-auth',
  TMUX: '/tmp/tmux-1000/default,1,0', TMUX_PANE: '%3',
} as const;

function providerWithSpy(providerName: 'codex' | 'claude') {
  const subprocessFactory = vi.fn((_file: string, _args: readonly string[], _options: ExecaOptions) => Promise.resolve({
    stdout: providerName === 'codex' ? codexCompletion() : JSON.stringify({ type: 'result', result: 'ok' }),
    stderr: '', exitCode: 0, failed: false,
  }) as any);
  const runDoctor = vi.fn(async () => ({
    stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
    exitCode: 0,
  }));
  const provider = providerName === 'codex'
    ? new CodexProvider(runDoctor, '/provider/codex', undefined, subprocessFactory as never)
    : new ClaudeProvider(undefined, subprocessFactory as never);
  return { provider, subprocessFactory };
}

describe('build-review review-profile child environment (adr-2026-09-10 D5)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [key, value] of Object.entries(AMBIENT)) { saved[key] = process.env[key]; process.env[key] = value; }
  });
  afterEach(() => {
    for (const key of Object.keys(AMBIENT)) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });

  it.each([
    ['codex', reviewProfile, 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    ['claude', claudeReviewProfile, 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  ] as const)('withholds ambient tracker and service credentials from a contained %s reviewer', async (providerName, profile, ownAuth, otherAuth) => {
    const { provider, subprocessFactory } = providerWithSpy(providerName);

    await provider.invoke({ ...baseOptions, reviewAccess: profile });

    const options = subprocessFactory.mock.calls[0]![2];
    const env = options.env as NodeJS.ProcessEnv;
    // execa must not re-merge process.env underneath the allowlisted overlay.
    expect(options.extendEnv).toBe(false);
    for (const withheld of ['GH_TOKEN', 'GITHUB_TOKEN', 'JIRA_API_TOKEN', 'FOO_SECRET', otherAuth]) expect(env).not.toHaveProperty(withheld);
    expect(env.TMUX).toBeUndefined();
    expect(env.TMUX_PANE).toBeUndefined();
    expect(env).toMatchObject({
      PATH: '/fixture/bin', LANG: 'en_US.UTF-8', LC_ALL: 'C', [ownAuth]: AMBIENT[ownAuth],
      HOME: `${profile.profile.scratch}/home`, CONDUCT_DAEMON_SESSION: '1',
    });
  });

  it.each([
    ['codex', reviewProfile, 'CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_HOME'],
    ['claude', claudeReviewProfile, 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR'],
  ] as const)('filters self-host tracker state for a contained %s reviewer while retaining provider identity and engine redirections', async (
    providerName,
    profile,
    runtimeKey,
    authKey,
    redirectedKey,
  ) => {
    const { provider, subprocessFactory } = providerWithSpy(providerName);
    const selfHostEnv = {
      GH_TOKEN: 'self-host-tracker-secret',
      MCP_TRACKER_TOKEN: 'self-host-mcp-secret',
      [runtimeKey]: 'provider-runtime',
      [authKey]: 'provider-auth',
      [redirectedKey]: '/unsafe/self-host-state',
    };

    await provider.invoke({
      ...baseOptions,
      reviewAccess: profile,
      selfHost: { executable: `/private/${providerName}`, args: [], env: selfHostEnv, teardown: async () => {} },
    });

    const env = subprocessFactory.mock.calls[0]![2].env as NodeJS.ProcessEnv;
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('MCP_TRACKER_TOKEN');
    expect(env).toMatchObject({
      [runtimeKey]: 'provider-runtime', [authKey]: 'provider-auth',
      [redirectedKey]: providerName === 'codex'
        ? `${profile.profile.scratch}/codex-home`
        : `${profile.profile.scratch}/claude-config`,
    });
  });

  it('leaves an ordinary Claude invocation on the inherited environment', async () => {
    const { provider, subprocessFactory } = providerWithSpy('claude');

    await provider.invoke(baseOptions);

    const options = subprocessFactory.mock.calls[0]![2];
    expect(options.extendEnv).toBeUndefined();
    expect(options.env).toMatchObject({ GH_TOKEN: 'tracker-secret', FOO_SECRET: 'ambient-secret', PATH: '/fixture/bin' });
    expect((options.env as NodeJS.ProcessEnv).HOME).toBe(process.env.HOME);
  });

  it('leaves an ordinary Codex invocation as an overlay execa extends over the inherited environment', async () => {
    const { provider, subprocessFactory } = providerWithSpy('codex');

    await provider.invoke(baseOptions);

    const options = subprocessFactory.mock.calls[0]![2];
    expect(options.extendEnv).toBeUndefined();
    const env = options.env as NodeJS.ProcessEnv;
    expect(env).not.toHaveProperty('HOME');
    expect(env).not.toHaveProperty('PATH');
    expect(env.CONDUCT_DAEMON_SESSION).toBe('1');
  });
});

describe('build-review access profile', () => {
  it('wraps Codex review invocation around the proved profile while retaining its private bookkeeping', async () => {
    const subprocessFactory = vi.fn<
      (file: string, args: readonly string[], options: ExecaOptions) => ResultPromise
    >(() => Promise.resolve({ stdout: codexCompletion(), stderr: '', exitCode: 0, failed: false }) as any);
    const runDoctor = vi.fn(async () => ({
      stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
      exitCode: 0,
    }));
    const provider = new CodexProvider(runDoctor, '/provider/codex', undefined, subprocessFactory);

    const result = await provider.invoke({
      ...baseOptions,
      reviewAccess: reviewProfile,
      selfHost: {
        executable: '/private/codex',
        args: ['--config', 'provider_state=/review/private/codex'],
        env: {},
        teardown: async () => {},
      },
    });

    expect(result).toMatchObject({ success: true, output: 'complete review envelope' });
    expect(subprocessFactory).toHaveBeenCalledWith(
      'bwrap',
      [
        // The self-host isolated executable is exposed read-only ahead of the review binds.
        '--ro-bind-try', '/private/codex', '/private/codex',
        ...reviewProfile.profile.mountArgs,
        '--',
        '/private/codex',
        '--config', 'provider_state=/review/private/codex',
        'exec',
        '--config', 'sandbox_mode="workspace-write"',
        '--config', 'sandbox_workspace_write.network_access=true',
        '--config', 'approval_policy="on-request"',
        '--config', 'approvals_reviewer="auto_review"',
        '--config', 'shell_environment_policy.ignore_default_excludes=false',
        '--cd', '/review/source',
        '--json',
        '-',
      ],
      expect.objectContaining({
        input: `${baseOptions.systemPrompt}\n\n${baseOptions.prompt}`,
        env: expect.objectContaining({
          CODEX_HOME: '/review/private/codex/codex-home',
          TMPDIR: '/review/private/codex/tmp',
          XDG_CONFIG_HOME: '/review/private/codex/xdg-config',
        }),
      }),
    );
  });

  it('wraps Claude review invocation around the proved profile while retaining its private bookkeeping', async () => {
    const subprocessFactory = vi.fn<
      (file: string, args: string[], options: ExecaOptions) => ResultPromise
    >(() => Promise.resolve({ stdout: JSON.stringify({ type: 'result', result: 'complete review envelope' }), stderr: '', exitCode: 0, failed: false }) as any);
    const provider = new ClaudeProvider(undefined, subprocessFactory);

    const result = await provider.invoke({
      ...baseOptions,
      reviewAccess: claudeReviewProfile,
      selfHost: {
        executable: '/private/claude',
        args: ['--setting-sources', 'project'],
        env: {},
        teardown: async () => {},
      },
    });

    expect(result).toMatchObject({ success: true, output: 'complete review envelope' });
    expect(subprocessFactory).toHaveBeenCalledWith(
      'bwrap',
      [
        '--ro-bind-try', '/private/claude', '/private/claude',
        ...claudeReviewProfile.profile.mountArgs,
        '--',
        '/private/claude',
        '--setting-sources', 'project',
        '--session-id', expect.any(String),
        '--append-system-prompt', baseOptions.systemPrompt,
        '--print', '--output-format', 'stream-json', '--verbose',
      ],
      expect.objectContaining({
        input: baseOptions.prompt,
        env: expect.objectContaining({
          HOME: '/review/private/claude/home',
          CLAUDE_CONFIG_DIR: '/review/private/claude/claude-config',
          TMPDIR: '/review/private/claude/tmp',
          XDG_CONFIG_HOME: '/review/private/claude/xdg-config',
        }),
      }),
    );
  });

  it.each(['codex', 'claude'] as const)('refuses an unsupported %s review profile before launching a model', async (providerName) => {
    const subprocessFactory = vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0, failed: false }) as any);
    const runDoctor = vi.fn(async () => ({ stdout: '', exitCode: 0 }));
    const provider = providerName === 'codex'
      ? new CodexProvider(runDoctor, '/provider/codex', undefined, subprocessFactory)
      : new ClaudeProvider(undefined, subprocessFactory);

    const result = await provider.invoke({
      ...baseOptions,
      reviewAccess: {
        kind: 'unsupported',
        provider: providerName,
        capability: 'linux-read-only-review-boundary',
        recovery: 'install-bubblewrap-and-enable-nested-sandboxing',
        reason: 'nested sandbox is unavailable',
      },
    });

    expect(result).toMatchObject({ success: false, providerUnavailable: false });
    expect(result.output).toContain('nested sandbox is unavailable');
    expect(subprocessFactory).not.toHaveBeenCalled();
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it.each(['codex', 'claude'] as const)('refuses a %s invocation carrying another provider\'s ready profile', async (providerName) => {
    const subprocessFactory = vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0, failed: false }) as any);
    const runDoctor = vi.fn(async () => ({ stdout: '', exitCode: 0 }));
    const provider = providerName === 'codex'
      ? new CodexProvider(runDoctor, '/provider/codex', undefined, subprocessFactory)
      : new ClaudeProvider(undefined, subprocessFactory);
    const otherProfile = providerName === 'codex' ? claudeReviewProfile : reviewProfile;

    const result = await provider.invoke({ ...baseOptions, reviewAccess: otherProfile });

    expect(result).toMatchObject({ success: false, providerUnavailable: false });
    expect(result.output).toContain(`not ${providerName}`);
    expect(subprocessFactory).not.toHaveBeenCalled();
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it.each(['codex', 'claude'] as const)('keeps ordinary %s invocations unwrapped and writable', async (providerName) => {
    const subprocessFactory = vi.fn(() => Promise.resolve({
      stdout: providerName === 'codex' ? codexCompletion() : JSON.stringify({ type: 'result', result: 'ordinary result' }),
      stderr: '', exitCode: 0, failed: false,
    }) as any);
    const runDoctor = vi.fn(async () => ({
      stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
      exitCode: 0,
    }));
    const provider = providerName === 'codex'
      ? new CodexProvider(runDoctor, '/provider/codex', undefined, subprocessFactory)
      : new ClaudeProvider(undefined, subprocessFactory);

    await provider.invoke(baseOptions);

    const [executable, args] = subprocessFactory.mock.calls[0] as unknown as [string, readonly string[]];
    expect(executable).toBe(providerName === 'codex' ? '/provider/codex' : 'claude');
    expect(args).not.toContain('bwrap');
    if (providerName === 'codex') expect(args).toContain('sandbox_mode="workspace-write"');
  });
});
