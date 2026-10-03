import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { PiProvider } from '../../src/execution/pi-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { ManagedSessionContext } from '../../src/execution/managed-session-context.js';

const context: ManagedSessionContext = {
  projectRoot: '/project', worktreeRoot: '/project/worktree', producerRoot: '/project/worktree/.pipeline/session-events',
  scope: { kind: 'feature', featureSlug: 'feature-a' }, dispatchId: 'dispatch-8', provider: 'claude',
};

const options: InvokeOptions = {
  prompt: 'Run.', sessionId: 'caller-session', resume: true, cwd: '/other-child-cwd',
  managedSessionContext: context,
  selfHost: { executable: 'isolated-provider', env: { CONDUCT_DAEMON_SESSION: 'unset', TMUX: 'forged' }, args: [], teardown: async () => {} },
};

function completeClaude() {
  return { stdout: JSON.stringify({ type: 'result', result: 'done' }), stderr: '', exitCode: 0, failed: false } as any;
}

function completeCodex() {
  return { stdout: `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } })}\n${JSON.stringify({ type: 'turn.completed' })}`, stderr: '', exitCode: 0, failed: false } as any;
}

function completePi() {
  return { stdout: JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }), stderr: '', exitCode: 0, failed: false } as any;
}

describe('managed session adapter environments', () => {
  it.each([
    ['claude', () => {
      const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
      return { provider: new ClaudeProvider(undefined, ((_file: string, args: readonly string[], launch: { env?: NodeJS.ProcessEnv }) => {
        calls.push({ args, env: launch.env }); return Promise.resolve(completeClaude());
      }) as never), calls };
    }],
    ['codex', () => {
      const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
      return { provider: new CodexProvider(vi.fn(async () => ({ stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }), exitCode: 0 })) as never, 'codex', undefined, ((_file: string, args: readonly string[], launch: { env?: NodeJS.ProcessEnv }) => {
        calls.push({ args, env: launch.env }); return Promise.resolve(completeCodex());
      }) as never), calls };
    }],
    ['pi', () => {
      const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
      return { provider: new PiProvider('pi', ((_file: string, args: readonly string[], launch: { env?: NodeJS.ProcessEnv }) => {
        calls.push({ args, env: launch.env }); return Promise.resolve(completePi());
      }) as never), calls };
    }],
  ] as const)('passes authoritative managed context to the %s subprocess after overlays', async (_provider, create) => {
    const { provider, calls } = create();
    const priorMarker = process.env.CONDUCT_DAEMON_SESSION;
    await provider.invoke(options);
    const env = calls[0]?.env;

    expect(env).toMatchObject({
      CONDUCT_DAEMON_SESSION: '1',
      CONDUCT_MANAGED_FEATURE: 'feature-a',
      CONDUCT_MANAGED_DISPATCH: 'dispatch-8',
    });
    expect(JSON.parse(env?.CONDUCT_MANAGED_SESSION_CONTEXT ?? '')).toMatchObject({ dispatchId: 'dispatch-8', scope: { kind: 'feature', featureSlug: 'feature-a' } });
    expect(env?.TMUX).toBeUndefined();
    expect(process.env.CONDUCT_DAEMON_SESSION).toBe(priorMarker);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(
      _provider === 'claude' ? ['--print'] : _provider === 'codex' ? ['--json'] : ['--no-session'],
    ));
  });
});
