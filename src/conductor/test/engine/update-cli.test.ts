// Covers: task:1

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

vi.mock('execa', () => ({ execa: vi.fn() }));

import {
  detectUpdateCommand,
  dispatchUpdateCommand,
  realUpdateRunner,
  type UpdateRunner,
} from '../../src/engine/update-cli.js';

let harnessRoot: string;

beforeEach(async () => {
  harnessRoot = await mkdtemp(join(tmpdir(), 'update-cli-'));
  await mkdir(join(harnessRoot, 'bin'));
  await writeFile(join(harnessRoot, 'bin', 'update'), '');
  await mkdir(join(harnessRoot, '.git'));
});

afterEach(async () => {
  await rm(harnessRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('detectUpdateCommand', () => {
  it('detects a bare update command with no arguments', () => {
    expect(detectUpdateCommand(['node', 'ai-conductor', 'update'])).toEqual({ args: [] });
  });

  it('preserves arguments after update', () => {
    expect(detectUpdateCommand(['node', 'ai-conductor', 'update', '--set-channel', 'stable'])).toEqual({
      args: ['--set-channel', 'stable'],
    });
  });

  it('ignores other commands', () => {
    expect(detectUpdateCommand(['node', 'ai-conductor', 'inline'])).toBeNull();
  });

  it('dispatches the updater with the supplied arguments', async () => {
    const calls: Array<[string, string[]]> = [];
    const runner: UpdateRunner = async (path, args) => {
      calls.push([path, args]);
      return 0;
    };

    await expect(
      dispatchUpdateCommand(
        { args: ['--set-channel', 'stable'] },
        { harnessRoot, runner },
      ),
    ).resolves.toBe(0);
    expect(calls).toEqual([[join(harnessRoot, 'bin', 'update'), ['--set-channel', 'stable']]]);
  });

  it('dispatches a bare update with no arguments', async () => {
    const runner = vi.fn<UpdateRunner>().mockResolvedValue(0);

    await dispatchUpdateCommand({ args: [] }, { harnessRoot, runner });

    expect(runner).toHaveBeenCalledExactlyOnceWith(join(harnessRoot, 'bin', 'update'), []);
  });

  it('runs the attended updater with inherited stdio', async () => {
    const mockedExeca = vi.mocked(execa);
    mockedExeca.mockResolvedValue({ exitCode: 0 } as never);

    await realUpdateRunner('/fake/bin/update', ['--set-channel', 'stable']);

    expect(mockedExeca).toHaveBeenCalledExactlyOnceWith('/fake/bin/update', ['--set-channel', 'stable'], {
      stdio: 'inherit',
      reject: false,
    });
  });
});
