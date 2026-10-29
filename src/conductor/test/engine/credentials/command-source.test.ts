// Covers: task:3
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execFile }));

import { resolveCommandCredential } from '../../../src/engine/credentials/command-source.js';
import { createCredentialResolver } from '../../../src/engine/credentials/credential-resolver.js';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('command credential source', () => {
  it('resolves trimmed command output with its configured prefix', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: 'tok-123\n' });
    const resolver = createCredentialResolver(
      { kind: 'command', argv: ['credential-command'], prefix: 'Bearer ' },
      {},
      { commandRunner: runner },
    );

    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'Bearer tok-123' });
  });

  it('resolves trimmed command output without a prefix', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: 'tok-123\n' });
    const resolver = createCredentialResolver(
      { kind: 'command', argv: ['credential-command'] },
      {},
      { commandRunner: runner },
    );

    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'tok-123' });
  });

  it('expands only leading home-directory arguments and preserves shell-looking arguments literally', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: 'tok-123\n' });
    const resolver = createCredentialResolver(
      {
        kind: 'command',
        argv: ['credential-command', '~/Library/token.plist', 'a~b', '$(id)', 'a|b', 'x;y'],
      },
      { HOME: '/home/credential-user' },
      { commandRunner: runner },
    );

    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'tok-123' });
    expect(runner).toHaveBeenCalledWith(
      'credential-command',
      ['/home/credential-user/Library/token.plist', 'a~b', '$(id)', 'a|b', 'x;y'],
      expect.objectContaining({ shell: false, timeout: 10_000 }),
    );
  });

  it('uses execFile with literal argv and a tmux-scrubbed environment in the production adapter', async () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,1,0');
    vi.stubEnv('TMUX_PANE', '%42');
    execFile.mockImplementation((_program, _args, _options, callback) => {
      callback(null, 'tok-123\n', '');
      return {};
    });

    await expect(resolveCommandCredential({ kind: 'command', argv: ['credential-command', '$(id)'] })).resolves.toEqual({
      kind: 'value',
      value: 'tok-123',
    });

    expect(execFile).toHaveBeenCalledWith(
      'credential-command',
      ['$(id)'],
      expect.objectContaining({ shell: false, timeout: 10_000, env: expect.any(Object) }),
      expect.any(Function),
    );
    const environment = execFile.mock.calls[0]![2].env as NodeJS.ProcessEnv;
    expect(environment.TMUX).toBeUndefined();
    expect(environment.TMUX_PANE).toBeUndefined();
  });
});
