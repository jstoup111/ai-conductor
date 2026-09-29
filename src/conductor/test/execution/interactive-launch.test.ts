// Covers: task:9
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnProcess } = vi.hoisted(() => ({ spawnProcess: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnProcess }));

import {
  launchInteractiveSession,
  type InteractiveLaunchProcess,
} from '../../src/execution/interactive-launch.js';

const openingPrompt = [
  'Resolve the halted feature.',
  'Project: /workspace/harness',
  'Feature: repair-halt',
  'Reason: test failure',
  'Classification: mechanical',
].join('\n');

function request(provider: string) {
  return {
    provider,
    openingPrompt,
    cwd: '/workspace/harness/.worktrees/repair-halt',
  };
}

describe('provider-agnostic interactive launch', () => {
  beforeEach(() => {
    spawnProcess.mockReset();
  });

  it('preserves Claude\'s REPL invocation form and resolves its exit', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>().mockResolvedValue({ exitCode: 0 });

    await expect(launchInteractiveSession(request('claude'), { spawn })).resolves.toEqual({
      kind: 'exited',
      exitCode: 0,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('claude', ['--permission-mode', 'default', openingPrompt], {
      cwd: '/workspace/harness/.worktrees/repair-halt',
      stdio: 'inherit',
    });
    const [, spawnedArgs, spawnedOptions] = spawn.mock.calls[0]!;
    expect(spawnedArgs).not.toContain('--resume');
    expect(spawnedOptions).not.toHaveProperty('input');
    expect(spawnedOptions).not.toHaveProperty('streamConsumer');
    expect(spawnedOptions).not.toHaveProperty('resume');
  });

  it('launches the default Codex adapter as bounded exec with its opening prompt on stdin', async () => {
    const stdin = { end: vi.fn(), write: vi.fn() };
    const child = Object.assign(new EventEmitter(), { stdin });
    spawnProcess.mockReturnValue(child);

    const launch = launchInteractiveSession(request('codex'));

    try {
      expect({
        executable: spawnProcess.mock.calls[0]?.[0],
        args: spawnProcess.mock.calls[0]?.[1],
        options: spawnProcess.mock.calls[0]?.[2],
        promptWrites: [...stdin.write.mock.calls, ...stdin.end.mock.calls],
      }).toEqual({
        executable: 'codex',
        args: ['exec'],
        options: {
          cwd: '/workspace/harness/.worktrees/repair-halt',
          stdio: ['pipe', 'inherit', 'inherit'],
        },
        promptWrites: expect.arrayContaining([[openingPrompt]]),
      });
    } finally {
      child.emit('exit', 0);
      child.emit('close', 0);
      await launch;
    }
  });

  it('reports an unregistered provider and never reaches the process boundary', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>();
    const report = vi.fn();

    await expect(launchInteractiveSession(request('unregistered-provider'), { spawn, report }))
      .resolves.toEqual({
        kind: 'unavailable',
        provider: 'unregistered-provider',
      });

    expect(report).toHaveBeenCalledWith(expect.stringContaining('unregistered-provider'));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports a missing provider binary and resolves without marking the launch successful', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>()
      .mockRejectedValue(Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
    const report = vi.fn();

    await expect(launchInteractiveSession(request('codex'), { spawn, report })).resolves.toEqual({
      kind: 'unavailable',
      provider: 'codex',
    });

    expect(report).toHaveBeenCalledWith(expect.stringContaining('codex'));
    expect(report).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('reports ENOENT from the mocked default process adapter without treating it as an exit', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: { end: vi.fn(), write: vi.fn() },
    });
    const report = vi.fn();
    spawnProcess.mockReturnValue(child);

    const launch = launchInteractiveSession(request('codex'), { report });

    expect(spawnProcess).toHaveBeenCalledWith('codex', ['exec'], {
      cwd: '/workspace/harness/.worktrees/repair-halt',
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));

    await expect(launch).resolves.toEqual({ kind: 'unavailable', provider: 'codex' });
    expect(report).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('rejects an ordinary process-launch failure for the monitor to handle', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>()
      .mockRejectedValue(Object.assign(new Error('spawn claude EACCES'), { code: 'EACCES' }));

    await expect(launchInteractiveSession(request('claude'), { spawn }))
      .rejects.toThrow('spawn claude EACCES');

    expect(spawn).toHaveBeenCalledOnce();
  });
});
