// Covers: task:1
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readRestageWatermarks,
  recordRestageWatermarks,
} from '../../src/engine/restage-watermark';
import { __resetResolveCacheForTests } from '../../src/engine/park-marker';

const execFile = promisify(execFileCb);

describe('restage watermark store', () => {
  let mainRoot: string;

  async function git(args: string[], cwd = mainRoot): Promise<void> {
    await execFile('git', args, { cwd });
  }

  async function createLinkedWorktree(): Promise<string> {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test User']);
    await writeFile(join(mainRoot, 'README.md'), '# fixture\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'initial']);
    const worktreeRoot = join(mainRoot, '.worktrees', 'feature');
    await mkdir(join(mainRoot, '.worktrees'), { recursive: true });
    await git(['worktree', 'add', '-b', 'feature', worktreeRoot, 'main']);
    return worktreeRoot;
  }

  beforeEach(async () => {
    mainRoot = await mkdtemp(join(tmpdir(), 'restage-watermark-'));
    __resetResolveCacheForTests();
  });

  afterEach(async () => {
    await rm(mainRoot, { recursive: true, force: true });
    __resetResolveCacheForTests();
  });

  it('record then read round-trips id → count at the main root', async () => {
    const worktreeRoot = await createLinkedWorktree();

    await recordRestageWatermarks(worktreeRoot, 'stem-a', [
      { id: '16', trailerCount: 3 },
      { id: '21', trailerCount: 1 },
    ]);

    await expect(readRestageWatermarks(worktreeRoot, 'stem-a')).resolves.toEqual({
      kind: 'ok',
      tasks: { '16': 3, '21': 1 },
    });
    const watermarkPath = join(mainRoot, '.daemon', 'restage-watermarks', 'stem-a.json');
    expect(watermarkPath.startsWith(mainRoot)).toBe(true);
    expect(watermarkPath.startsWith(worktreeRoot)).toBe(false);
    await expect(readFile(watermarkPath, 'utf8')).resolves.toBe(
      '{\n  "version": 1,\n  "tasks": {\n    "16": 3,\n    "21": 1\n  }\n}\n',
    );
  });

  it('returns absent when the stem has no watermark file', async () => {
    const worktreeRoot = await createLinkedWorktree();

    await expect(readRestageWatermarks(worktreeRoot, 'missing-stem')).resolves.toEqual({
      kind: 'absent',
    });
  });
});
