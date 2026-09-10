import { describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import {
  confirmUntrackedRebasePaths,
  moveRebaseUntrackedPathsToQuarantine,
  parseUntrackedOverwriteRefusal,
  REBASE_UNTRACKED_QUARANTINE_DIR,
  type GitRunner,
} from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

const refusal = [
  'error: The following untracked working tree files would be overwritten by checkout:',
  '\tgenerated/a.txt',
  '\tnested/generated/b.txt',
  'Please move or remove them before you switch branches.',
].join('\n');

describe('engine/rebase — refusal before rebase starts', () => {
  it('parses only the tab-indented paths in Git’s untracked-overwrite refusal', () => {
    expect(parseUntrackedOverwriteRefusal(refusal)).toEqual([
      'generated/a.txt',
      'nested/generated/b.txt',
    ]);
    expect(parseUntrackedOverwriteRefusal('error: cannot rebase: You have unstaged changes.')).toEqual([]);
    expect(parseUntrackedOverwriteRefusal('fatal: could not detach HEAD')).toEqual([]);
    expect(parseUntrackedOverwriteRefusal('')).toEqual([]);
  });

  it('accepts only relative paths Git confirms are untracked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rebase-start-blocked-'));
    try {
      await writeFile(join(root, 'ok.txt'), 'safe\n');
      const calls: string[][] = [];
      const git: GitRunner = async (args) => {
        calls.push(args);
        return args.at(-1) === 'ok.txt'
          ? { exitCode: 0, stdout: '?? ok.txt\0', stderr: '' }
          : { exitCode: 0, stdout: ' M not-untracked.txt\0', stderr: '' };
      };

      await expect(confirmUntrackedRebasePaths(git, root, ['ok.txt'])).resolves.toEqual(['ok.txt']);
      await expect(confirmUntrackedRebasePaths(git, root, ['/tmp/nope'])).rejects.toThrow('/tmp/nope');
      await expect(confirmUntrackedRebasePaths(git, root, ['../nope'])).rejects.toThrow('../nope');
      await expect(confirmUntrackedRebasePaths(git, root, ['not-untracked.txt'])).rejects.toThrow('not-untracked.txt');
      expect(calls).toContainEqual(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'ok.txt']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('moves confirmed paths beneath the pipeline quarantine without overwriting an existing entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rebase-start-blocked-'));
    try {
      await writeFile(join(root, 'nested.txt'), 'original bytes\n');
      const quarantine = await moveRebaseUntrackedPathsToQuarantine(root, ['nested.txt']);
      expect(quarantine).toBe(join(root, REBASE_UNTRACKED_QUARANTINE_DIR));
      await expect(access(join(root, 'nested.txt'))).rejects.toThrow();
      await expect(readFile(join(quarantine, 'nested.txt'), 'utf8')).resolves.toBe('original bytes\n');

      await writeFile(join(root, 'first.txt'), 'first\n');
      await writeFile(join(root, 'second.txt'), 'second\n');
      await writeFile(join(quarantine, 'second.txt'), 'already here\n');
      await expect(moveRebaseUntrackedPathsToQuarantine(root, ['first.txt', 'second.txt']))
        .rejects.toThrow('second.txt');
      await expect(readFile(join(root, 'first.txt'), 'utf8')).resolves.toBe('first\n');
      await expect(readFile(join(quarantine, 'second.txt'), 'utf8')).resolves.toBe('already here\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('moves an untracked collision aside and retries the rebase once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rebase-start-blocked-git-'));
    const g = (args: string[]) => execFile('git', args, { cwd: root });
    try {
      await g(['init', '-q', '-b', 'main']);
      await g(['config', 'user.email', 't@example.test']);
      await g(['config', 'user.name', 'Test']);
      await writeFile(join(root, 'initial.txt'), 'initial\n');
      await g(['add', '.']);
      await g(['commit', '-q', '-m', 'initial']);

      await g(['checkout', '-q', '-b', 'feature']);
      await writeFile(join(root, 'feature.txt'), 'feature\n');
      await g(['add', 'feature.txt']);
      await g(['commit', '-q', '-m', 'feature']);
      await g(['checkout', '-q', 'main']);
      await writeFile(join(root, 'generated.txt'), 'base version\n');
      await g(['add', 'generated.txt']);
      await g(['commit', '-q', '-m', 'base']);
      await g(['checkout', '-q', 'feature']);
      await writeFile(join(root, 'generated.txt'), 'untracked version\n');

      const outcome = await (await import('../../src/engine/rebase.js')).performRebase(
        (await import('../../src/engine/rebase.js')).makeGitRunner(root),
        root,
        'main',
      );

      expect(outcome.kind).not.toBe('conflict_halt');
      await expect(readFile(join(root, 'generated.txt'), 'utf8')).resolves.toBe('base version\n');
      await expect(
        readFile(join(root, REBASE_UNTRACKED_QUARANTINE_DIR, 'generated.txt'), 'utf8'),
      ).resolves.toBe('untracked version\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
