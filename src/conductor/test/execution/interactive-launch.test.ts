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

  it.each([
    {
      provider: 'claude',
      exitCode: 0,
      executable: 'claude',
      args: ['--permission-mode', 'default', openingPrompt],
    },
    {
      provider: 'codex',
      exitCode: 23,
      executable: 'codex',
      args: [openingPrompt],
    },
  ])('uses $provider\'s interactive invocation form and resolves its exit', async ({
    provider,
    exitCode,
    executable,
    args,
  }) => {
    const spawn = vi.fn<InteractiveLaunchProcess>().mockResolvedValue({ exitCode });

    await expect(launchInteractiveSession(request(provider), { spawn })).resolves.toEqual({
      kind: 'exited',
      exitCode,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(executable, args, {
      cwd: '/workspace/harness/.worktrees/repair-halt',
      stdio: 'inherit',
    });
    const [, spawnedArgs, spawnedOptions] = spawn.mock.calls[0]!;
    expect(spawnedArgs).not.toContain('--resume');
    expect(spawnedOptions).not.toHaveProperty('input');
    expect(spawnedOptions).not.toHaveProperty('streamConsumer');
    expect(spawnedOptions).not.toHaveProperty('resume');
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
    const child = new EventEmitter();
    const report = vi.fn();
    spawnProcess.mockReturnValue(child);

    const launch = launchInteractiveSession(request('codex'), { report });

    expect(spawnProcess).toHaveBeenCalledWith('codex', [openingPrompt], {
      cwd: '/workspace/harness/.worktrees/repair-halt',
      stdio: 'inherit',
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
