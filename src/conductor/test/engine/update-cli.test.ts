// Covers: task:1, task:2

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
import { harnessRootProbeCandidates } from '../../src/engine/install-freshness.js';

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

  it('propagates a non-zero updater exit without logging', async () => {
    const runner = vi.fn<UpdateRunner>().mockResolvedValue(3);
    const log = vi.fn();

    await expect(dispatchUpdateCommand({ args: [] }, { harnessRoot, runner, log })).resolves.toBe(3);

    expect(log).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledExactlyOnceWith(join(harnessRoot, 'bin', 'update'), []);
  });

  it('maps an updater terminated by a signal to exit code 1', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: undefined, signal: 'SIGINT' } as never);

    await expect(realUpdateRunner('/fake/bin/update', [])).resolves.toBe(1);
  });

  it('refuses an unresolved harness root before spawning and names every probe candidate', async () => {
    const runner = vi.fn<UpdateRunner>().mockResolvedValue(0);
    const log = vi.fn();

    await expect(dispatchUpdateCommand({ args: [] }, { harnessRoot: null, runner, log })).resolves.toBe(1);

    const message = log.mock.calls.flat().join('\n');
    for (const candidate of harnessRootProbeCandidates) expect(message).toContain(candidate);
    expect(runner).not.toHaveBeenCalled();
  });

  it('refuses a root with no updater before spawning and names its absolute updater path', async () => {
    const rootWithoutUpdater = await mkdtemp(join(tmpdir(), 'update-cli-no-updater-'));
    const runner = vi.fn<UpdateRunner>().mockResolvedValue(0);
    const log = vi.fn();
    await mkdir(join(rootWithoutUpdater, '.git'));

    try {
      await expect(
        dispatchUpdateCommand({ args: [] }, { harnessRoot: rootWithoutUpdater, runner, log }),
      ).resolves.toBe(1);

      expect(log.mock.calls.flat().join('\n')).toContain(join(rootWithoutUpdater, 'bin', 'update'));
      expect(runner).not.toHaveBeenCalled();
    } finally {
      await rm(rootWithoutUpdater, { recursive: true, force: true });
    }
  });

  it.each(['a regular file', 'absent'])(
    'refuses a root whose .git is %s before spawning',
    async (gitShape) => {
      const runner = vi.fn<UpdateRunner>().mockResolvedValue(0);
      const log = vi.fn();

      if (gitShape === 'a regular file') {
        await rm(join(harnessRoot, '.git'), { recursive: true });
        await writeFile(join(harnessRoot, '.git'), 'gitdir: /elsewhere');
      } else {
        await rm(join(harnessRoot, '.git'), { recursive: true });
      }

      await expect(dispatchUpdateCommand({ args: [] }, { harnessRoot, runner, log })).resolves.toBe(1);

      expect(log.mock.calls.flat().join('\n')).toContain(harnessRoot);
      expect(log.mock.calls.flat().join('\n')).toMatch(/not a git checkout/i);
      expect(runner).not.toHaveBeenCalled();
    },
  );
});
