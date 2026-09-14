// Covers: task:14
import { describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions, ResultPromise } from 'execa';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const reviewProfile = {
  kind: 'ready' as const,
  provider: 'codex' as const,
  profile: {
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
        env: { CODEX_HOME: '/review/private/codex' },
        teardown: async () => {},
      },
    });

    expect(result).toMatchObject({ success: true, output: 'complete review envelope' });
    expect(subprocessFactory).toHaveBeenCalledWith(
      'bwrap',
      [
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
        env: expect.objectContaining({ CODEX_HOME: '/review/private/codex' }),
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
        env: { CLAUDE_CONFIG_DIR: '/review/private/claude' },
        teardown: async () => {},
      },
    });

    expect(result).toMatchObject({ success: true, output: 'complete review envelope' });
    expect(subprocessFactory).toHaveBeenCalledWith(
      'bwrap',
      [
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
        env: expect.objectContaining({ CLAUDE_CONFIG_DIR: '/review/private/claude' }),
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
