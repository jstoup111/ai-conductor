// Covers: task:8, task:9
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions, SelfHostInvocation } from '../../src/execution/llm-provider.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
type CapturedSpawnOptions = { env?: NodeJS.ProcessEnv };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function preparedWorktree(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), 'git-guard-adapter-cell-'));
  roots.push(root);
  await initTestRepo(root);
  await prepareWorktree(root);
  const home = await mkdtemp(join(root, 'empty-operator-home-'));
  return { root, home };
}

function selfHost(home: string, provider: 'claude' | 'codex'): SelfHostInvocation {
  return {
    executable: `/isolated/bin/${provider}`,
    env: { HOME: home },
    args: [],
    teardown: async () => {},
  };
}

async function withEmptyOperatorHome<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
}

const invokeOptions = (cwd: string, selfHostInvocation?: SelfHostInvocation): InvokeOptions => ({
  prompt: 'Report the active git executable.',
  cwd,
  interactive: false,
  sessionId: 'adapter-cell-session',
  resume: false,
  ...(selfHostInvocation ? { selfHost: selfHostInvocation } : {}),
});

describe('git guard adapter cells', () => {
  it('Claude non-self-host dispatch records the prepared worktree guard at the start of child PATH', async () => {
    const { root, home } = await preparedWorktree();
    const calls: CapturedSpawnOptions[] = [];
    const spawn = vi.fn(async (_file: string, _args: readonly string[], options: CapturedSpawnOptions) => {
      calls.push(options);
      return {
      stdout: JSON.stringify({ type: 'result', result: 'complete' }), stderr: '', exitCode: 0,
      };
    });
    const provider = new ClaudeProvider(undefined, spawn as never);

    await withEmptyOperatorHome(home, () => provider.invoke(invokeOptions(root)));

    const options = calls[0];
    expect(options?.env?.HOME).toBe(home);
    expect(options?.env?.PATH?.split(':')[0]).toBe(join(root, '.pipeline', 'bin'));
  });

  it('Claude self-host dispatch records the prepared worktree guard at the start of child PATH', async () => {
    const { root, home } = await preparedWorktree();
    const calls: CapturedSpawnOptions[] = [];
    const spawn = vi.fn(async (_file: string, _args: readonly string[], options: CapturedSpawnOptions) => {
      calls.push(options);
      return {
      stdout: JSON.stringify({ type: 'result', result: 'complete' }), stderr: '', exitCode: 0,
      };
    });
    const provider = new ClaudeProvider(undefined, spawn as never);

    await provider.invoke(invokeOptions(root, selfHost(home, 'claude')));

    const options = calls[0];
    expect(options?.env?.HOME).toBe(home);
    expect(options?.env?.PATH?.split(':')[0]).toBe(join(root, '.pipeline', 'bin'));
  });

  it('Codex non-self-host dispatch records the prepared worktree guard at the start of child PATH', async () => {
    const { root, home } = await preparedWorktree();
    const calls: CapturedSpawnOptions[] = [];
    const spawn = vi.fn(async (_file: string, _args: readonly string[], options: CapturedSpawnOptions) => {
      calls.push(options);
      return {
      stdout: [
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'complete' } }),
        JSON.stringify({ type: 'turn.completed' }),
      ].join('\n'),
      stderr: '', exitCode: 0,
      };
    });
    const provider = new CodexProvider(
      vi.fn(async () => ({
        stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
        exitCode: 0,
      })),
      'codex',
      undefined,
      spawn as never,
    );

    await withEmptyOperatorHome(home, () => provider.invoke(invokeOptions(root)));

    const options = calls[0];
    expect(options?.env?.PATH?.split(':')[0]).toBe(join(root, '.pipeline', 'bin'));
  });

  it('Codex self-host dispatch records the prepared worktree guard at the start of child PATH', async () => {
    const { root, home } = await preparedWorktree();
    const calls: CapturedSpawnOptions[] = [];
    const spawn = vi.fn(async (_file: string, _args: readonly string[], options: CapturedSpawnOptions) => {
      calls.push(options);
      return {
      stdout: [
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'complete' } }),
        JSON.stringify({ type: 'turn.completed' }),
      ].join('\n'),
      stderr: '', exitCode: 0,
      };
    });
    const provider = new CodexProvider(
      vi.fn(async () => ({
        stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
        exitCode: 0,
      })),
      'codex',
      undefined,
      spawn as never,
    );

    await provider.invoke(invokeOptions(root, selfHost(home, 'codex')));

    const options = calls[0];
    expect(options?.env?.HOME).toBe(home);
    expect(options?.env?.PATH?.split(':')[0]).toBe(join(root, '.pipeline', 'bin'));
  });
});
