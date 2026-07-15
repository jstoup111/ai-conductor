/**
 * Story 7 (port-self-update-flow, T5) — conduct-ts spawns `bin/update --auto`
 * at startup, resolved relative to the harness root. Negative path: a missing
 * harness root, a missing `bin/update`, or a spawn/exec failure must be
 * logged and swallowed, never thrown — the pipeline must still boot.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { spawnAutoUpdateCheck, type AutoUpdateRunner } from '../../src/engine/auto-update-check.js';

const HARNESS = '/fake/harness';

describe('spawnAutoUpdateCheck', () => {
  it('spawns bin/update --auto rooted at the resolved harness root', async () => {
    const calls: Array<[string, string[]]> = [];
    const runner: AutoUpdateRunner = async (path, args) => {
      calls.push([path, args]);
      return { exitCode: 0 };
    };
    await spawnAutoUpdateCheck({ harnessRoot: HARNESS, runner, log: () => {} });
    expect(calls).toEqual([[join(HARNESS, 'bin', 'update'), ['--auto']]]);
  });

  it('logs and swallows a spawn/exec failure — never throws', async () => {
    const runner: AutoUpdateRunner = async () => {
      throw new Error('ENOENT: bin/update not found');
    };
    const log = vi.fn();
    await expect(
      spawnAutoUpdateCheck({ harnessRoot: HARNESS, runner, log }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('bin/update --auto failed');
  });

  it('logs and skips (never throws) when the harness root cannot be resolved', async () => {
    const runner = vi.fn();
    const log = vi.fn();
    await expect(
      spawnAutoUpdateCheck({ harnessRoot: null, runner, log }),
    ).resolves.toBeUndefined();
    expect(runner).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  });

  it('falls back to resolveHarnessRoot() when no harnessRoot override is given', async () => {
    // Real repo tree has a bin/install at the harness root, so this resolves
    // to a real path and the runner is invoked with it.
    const calls: Array<[string, string[]]> = [];
    const runner: AutoUpdateRunner = async (path, args) => {
      calls.push([path, args]);
      return { exitCode: 0 };
    };
    await spawnAutoUpdateCheck({ runner, log: () => {} });
    expect(calls).toHaveLength(1);
    expect(calls[0][0].endsWith(join('bin', 'update'))).toBe(true);
    expect(calls[0][1]).toEqual(['--auto']);
  });
});
