// Covers: task:3, task:4, task:10
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

  it('preserves leading whitespace while trimming trailing command output whitespace', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: '  tok-123\n' });
    const resolver = createCredentialResolver(
      { kind: 'command', argv: ['credential-command'] },
      {},
      { commandRunner: runner },
    );

    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: '  tok-123' });
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
    vi.stubEnv('AI_CONDUCTOR_NO_REAL_EXEC', undefined);
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

  it('reports a non-zero exit by argv and exit code without stdout or stderr', async () => {
    const failure = Object.assign(new Error('command failed'), {
      code: 3,
      stdout: 'SENTINEL-OUT',
      stderr: 'SENTINEL-ERR',
    });
    const resolver = createCredentialResolver(
      { kind: 'command', argv: ['credential-command', '--token'] },
      {},
      { commandRunner: vi.fn().mockRejectedValue(failure) },
    );

    const result = await resolver.resolve();

    expect(result).toMatchObject({ kind: 'unavailable' });
    if (result.kind !== 'unavailable') throw new Error('expected unavailable credential');
    expect(result.reason).toContain('credential-command --token');
    expect(result.reason).toContain('exit code 3');
    expect(result.reason).not.toContain('SENTINEL-OUT');
    expect(result.reason).not.toContain('SENTINEL-ERR');
  });

  it('reports whitespace-only output by argv and empty output', async () => {
    const resolver = createCredentialResolver(
      { kind: 'command', argv: ['credential-command', '--token'] },
      {},
      { commandRunner: vi.fn().mockResolvedValue({ stdout: ' \n\t ' }) },
    );

    const result = await resolver.resolve();

    expect(result).toMatchObject({ kind: 'unavailable' });
    if (result.kind !== 'unavailable') throw new Error('expected unavailable credential');
    expect(result.reason).toContain('credential-command --token');
    expect(result.reason).toMatch(/empty output/i);
  });

  it('reports a timeout by argv and the ten-second limit', async () => {
    const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    const resolver = createCredentialResolver(
      { kind: 'command', argv: ['credential-command', '--token'] },
      {},
      { commandRunner: vi.fn().mockRejectedValue(timeout) },
    );

    const result = await resolver.resolve();

    expect(result).toMatchObject({ kind: 'unavailable' });
    if (result.kind !== 'unavailable') throw new Error('expected unavailable credential');
    expect(result.reason).toContain('credential-command --token');
    expect(result.reason).toMatch(/10 seconds/i);
  });

  it('reports a missing program by argv', async () => {
    const missing = Object.assign(new Error('not found'), { code: 'ENOENT' });
    const resolver = createCredentialResolver(
      { kind: 'command', argv: ['credential-command', '--token'] },
      {},
      { commandRunner: vi.fn().mockRejectedValue(missing) },
    );

    const result = await resolver.resolve();

    expect(result).toMatchObject({ kind: 'unavailable' });
    if (result.kind !== 'unavailable') throw new Error('expected unavailable credential');
    expect(result.reason).toContain('credential-command --token');
    expect(result.reason).toMatch(/ENOENT|missing program/i);
  });

  it('refuses production command execution under the no-real-exec kill switch', async () => {
    vi.stubEnv('AI_CONDUCTOR_NO_REAL_EXEC', '1');

    await expect(resolveCommandCredential({ kind: 'command', argv: ['credential-command'] })).resolves.toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('AI_CONDUCTOR_NO_REAL_EXEC'),
    });

    expect(execFile).not.toHaveBeenCalled();
  });
});
