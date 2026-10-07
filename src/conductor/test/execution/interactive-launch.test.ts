// Covers: task:3, task:4, task:9, task:10
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

const isInteractiveTerminal = () => true;

describe('provider-agnostic interactive launch', () => {
  beforeEach(() => {
    spawnProcess.mockReset();
  });

  it('preserves Claude\'s REPL invocation form and resolves its exit', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>().mockResolvedValue({ exitCode: 0 });

    await expect(launchInteractiveSession(request('claude'), { spawn, isInteractiveTerminal })).resolves.toEqual({
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

  it('passes model and effort only through the catalog launch descriptor', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>().mockResolvedValue({ exitCode: 0 });
    await launchInteractiveSession({ ...request('claude'), model: 'sonnet', effort: 'medium' }, { spawn, isInteractiveTerminal });
    expect(spawn).toHaveBeenCalledWith('claude', ['--permission-mode', 'default', '--model', 'sonnet', '--effort', 'medium', openingPrompt], {
      cwd: '/workspace/harness/.worktrees/repair-halt', stdio: 'inherit',
    });
  });

  it('launches Codex as an attached TUI with its opening prompt positioned in argv', async () => {
    const child = new EventEmitter();
    spawnProcess.mockReturnValue(child);

    const launch = launchInteractiveSession(request('codex'), { isInteractiveTerminal });

    try {
      expect(spawnProcess).toHaveBeenCalledWith('codex', [openingPrompt], {
        cwd: '/workspace/harness/.worktrees/repair-halt',
        stdio: 'inherit',
      });
      expect(spawnProcess.mock.calls[0]?.[1]).not.toContain('exec');
    } finally {
      child.emit('exit', 0);
      await launch;
    }
  });

  it('reports an unregistered provider and never reaches the process boundary', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>();
    const report = vi.fn();

    await expect(launchInteractiveSession(request('unregistered-provider'), { spawn, report, isInteractiveTerminal }))
      .resolves.toEqual({
        kind: 'unavailable',
        provider: 'unregistered-provider',
      });

    expect(report).toHaveBeenCalledWith(expect.stringContaining('unregistered-provider'));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses launch without an attached interactive terminal before reaching the process boundary', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>().mockResolvedValue({ exitCode: 0 });
    const report = vi.fn();

    const outcome = await launchInteractiveSession(request('codex'), {
      spawn,
      report,
      isInteractiveTerminal: () => false,
    });

    expect({ outcome, reports: report.mock.calls, spawnCalls: spawn.mock.calls }).toEqual({
      outcome: { kind: 'unavailable', provider: 'codex' },
      reports: [[expect.stringContaining('interactive terminal')]],
      spawnCalls: [],
    });
  });

  it('reports a missing provider binary and resolves without marking the launch successful', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>()
      .mockRejectedValue(Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
    const report = vi.fn();

    await expect(launchInteractiveSession(request('codex'), { spawn, report, isInteractiveTerminal })).resolves.toEqual({
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

    const launch = launchInteractiveSession(request('codex'), { report, isInteractiveTerminal });

    expect(spawnProcess).toHaveBeenCalledWith('codex', [openingPrompt], {
      cwd: '/workspace/harness/.worktrees/repair-halt',
      stdio: 'inherit',
    });
    expect(spawnProcess.mock.calls[0]?.[1]).not.toContain('exec');
    child.emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));

    await expect(launch).resolves.toEqual({ kind: 'unavailable', provider: 'codex' });
    expect(report).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('rejects an ordinary process-launch failure for the monitor to handle', async () => {
    const spawn = vi.fn<InteractiveLaunchProcess>()
      .mockRejectedValue(Object.assign(new Error('spawn claude EACCES'), { code: 'EACCES' }));

    await expect(launchInteractiveSession(request('claude'), { spawn, isInteractiveTerminal }))
      .rejects.toThrow('spawn claude EACCES');

    expect(spawn).toHaveBeenCalledOnce();
  });
});
