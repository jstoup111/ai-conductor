// Covers: task:3, task:6
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execa: vi.fn() }));

vi.mock('execa', () => ({ execa: mocks.execa }));

import {
  ENGINE_DIFF_RENAME_LIMIT,
  PINNED_ENGINE_GIT_CONFIG,
  withPinnedGitConfig,
} from '../../src/engine/git-pinned-config.js';
import { makeGitRunner, performRebase, startFeatureReplay, type GitRunner } from '../../src/engine/rebase.js';

const pinnedEntries = Object.entries(PINNED_ENGINE_GIT_CONFIG);

function pinnedEnvironment(_env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    pinnedEntries.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ) as NodeJS.ProcessEnv;
}

describe('engine git pinned config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('appends the immutable engine config after existing credential config without rewriting it', () => {
    const input: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!gh auth git-credential',
    };

    const result = withPinnedGitConfig(input);

    expect(result).toMatchObject({
      ...input,
      GIT_CONFIG_COUNT: String(2 + pinnedEntries.length),
      ...Object.fromEntries(pinnedEntries.flatMap(([key, value], index) => [
        [`GIT_CONFIG_KEY_${index + 2}`, key],
        [`GIT_CONFIG_VALUE_${index + 2}`, value],
      ])),
    });
    expect(input).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!gh auth git-credential',
    });
  });

  it('pins every policy key, including the named rename limit', () => {
    expect(ENGINE_DIFF_RENAME_LIMIT).toBe(1000);
    expect(PINNED_ENGINE_GIT_CONFIG).toEqual({
      'rebase.updateRefs': 'false',
      'rebase.rebaseMerges': 'false',
      'rebase.autoSquash': 'false',
      'merge.renames': 'true',
      'merge.directoryRenames': 'conflict',
      'diff.renameLimit': String(ENGINE_DIFF_RENAME_LIMIT),
    });
  });

  it.each([
    ['rebase', ['rebase', '--autostash', 'main']],
    ['merge', ['merge', '--ff-only', 'origin/main']],
    ['merge-tree', ['merge-tree', '--write-tree', 'main', 'HEAD']],
    ['cherry-pick', ['cherry-pick', 'deadbeef']],
    ['commit-tree after global config', ['-c', 'author.name=Engine', 'commit-tree', 'deadbeef']],
  ])('pins every engine replay subcommand without changing its argv', async (_name, args) => {
    await makeGitRunner('/fixture')(args);

    expect(mocks.execa).toHaveBeenCalledWith('git', args, {
      cwd: '/fixture',
      reject: false,
      env: expect.objectContaining({
        GIT_CONFIG_COUNT: String(pinnedEntries.length),
        ...pinnedEnvironment({}),
      }),
    });
  });

  it('leaves non-replay git commands ambient', async () => {
    await makeGitRunner('/fixture')(['rev-parse', 'HEAD']);

    expect(mocks.execa).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], {
      cwd: '/fixture',
      reject: false,
    });
  });

  it('merges invocation-local environment before pinning a replay command', async () => {
    await makeGitRunner('/fixture')(['commit-tree', 'deadbeef'], {
      env: {
        GIT_AUTHOR_NAME: 'Replay Author',
        GIT_COMMITTER_NAME: 'Replay Committer',
      },
    });

    expect(mocks.execa).toHaveBeenCalledWith('git', ['commit-tree', 'deadbeef'], {
      cwd: '/fixture',
      reject: false,
      env: expect.objectContaining({
        GIT_AUTHOR_NAME: 'Replay Author',
        GIT_COMMITTER_NAME: 'Replay Committer',
        GIT_CONFIG_COUNT: String(pinnedEntries.length),
        ...pinnedEnvironment({}),
      }),
    });
  });

  it('keeps the injected performRebase and startFeatureReplay command argv unchanged', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { exitCode: 0, stdout: 'true\n', stderr: '' };
      if (args[0] === 'remote') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-list' && args[1] === '--count') return { exitCode: 0, stdout: '1\n', stderr: '' };
      if (args[0] === 'rev-list' && args[1] === '--merges') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${'b'.repeat(40)}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(performRebase(git, '/fixture', 'main')).resolves.toMatchObject({ kind: 'noop' });
    await expect(startFeatureReplay(git, 'main', 'base')).resolves.toMatchObject({
      kind: 'started', rebaseArgs: ['rebase', '--autostash', 'main'],
    });

    expect(calls.filter((args) => args[0] === 'rebase')).toEqual([
      ['rebase', '--autostash', 'main'],
      ['rebase', '--autostash', 'main'],
    ]);
  });
});
