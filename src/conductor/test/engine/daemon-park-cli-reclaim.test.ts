import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  detectDaemonParkCommand,
  dispatchDaemonPark,
} from '../../src/engine/daemon-park-cli.js';

const execFile = promisify(execFileCb);
const roots: string[] = [];

describe('engine/daemon-park-cli reclaim-worktree', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('removes one retained worktree from a nested cwd after printing its resolved path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-reclaim-worktree-'));
    roots.push(root);
    const git = (args: string[], cwd = root) => execFile('git', args, { cwd });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(root, 'README.md'), '# fixture\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'fixture']);

    const slug = 'retained-feature';
    const worktreePath = join(root, '.worktrees', slug);
    await mkdir(join(root, 'nested', 'operator'), { recursive: true });
    await git(['worktree', 'add', '-q', '-b', `feat/${slug}`, worktreePath, 'main']);
    const out: string[] = [];

    const command = detectDaemonParkCommand([
      'node',
      'conduct',
      'daemon',
      'reclaim-worktree',
      slug,
    ]);
    const code = command
      ? await dispatchDaemonPark(command, {
          cwd: join(root, 'nested', 'operator'),
          out: (line) => out.push(line),
        })
      : -1;

    const exists = await access(worktreePath).then(
      () => true,
      () => false,
    );
    expect({ code, exists, out }).toEqual({
      code: 0,
      exists: false,
      out: [
        `Reclaiming retained worktree: ${worktreePath}`,
        `Removed retained worktree '${slug}': ${worktreePath}`,
      ],
    });
  });

  it('rejects a traversal slug before it can escape the retained-worktree directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-reclaim-traversal-'));
    roots.push(root);
    const git = (args: string[], cwd = root) => execFile('git', args, { cwd });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(root, 'README.md'), '# fixture\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'fixture']);

    const outsidePath = join(root, 'outside-retained-dir');
    await git(['worktree', 'add', '-q', '-b', 'feat/outside', outsidePath, 'main']);
    const out: string[] = [];
    const code = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: '../outside-retained-dir' },
      { cwd: root, out: (line) => out.push(line) },
    );

    const exists = await access(outsidePath).then(
      () => true,
      () => false,
    );
    expect({ code, exists, out }).toEqual({
      code: 1,
      exists: true,
      out: ["Could not reclaim-worktree '../outside-retained-dir': invalid-slug"],
    });
  });
});
