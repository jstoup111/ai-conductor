// Covers: task:1, task:2, task:3
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

  it('a later round adds ids without overwriting an earlier count', async () => {
    const worktreeRoot = await createLinkedWorktree();

    await recordRestageWatermarks(worktreeRoot, 'stem-a', [{ id: '16', trailerCount: 3 }]);
    await recordRestageWatermarks(worktreeRoot, 'stem-a', [{ id: '19', trailerCount: 2 }]);
    await recordRestageWatermarks(worktreeRoot, 'stem-a', [{ id: '16', trailerCount: 5 }]);

    await expect(readRestageWatermarks(worktreeRoot, 'stem-a')).resolves.toEqual({
      kind: 'ok',
      tasks: { '16': 3, '19': 2 },
    });
  });

  it('two stems under one main root are isolated', async () => {
    const worktreeRoot = await createLinkedWorktree();

    await recordRestageWatermarks(worktreeRoot, 'stem-a', [{ id: '16', trailerCount: 3 }]);
    await recordRestageWatermarks(worktreeRoot, 'stem-b', [{ id: '19', trailerCount: 2 }]);

    await expect(readRestageWatermarks(worktreeRoot, 'stem-a')).resolves.toEqual({
      kind: 'ok',
      tasks: { '16': 3 },
    });
    await expect(readRestageWatermarks(worktreeRoot, 'stem-b')).resolves.toEqual({
      kind: 'ok',
      tasks: { '19': 2 },
    });
  });

  it('engine-state.json is byte-identical across record and read', async () => {
    const worktreeRoot = await createLinkedWorktree();
    const engineStatePath = join(worktreeRoot, '.pipeline', 'engine-state.json');
    const engineState = '{\n  "appendedRemediationTaskIds": ["rem-1"]\n}\n';
    await mkdir(join(worktreeRoot, '.pipeline'), { recursive: true });
    await writeFile(engineStatePath, engineState, 'utf8');

    await recordRestageWatermarks(worktreeRoot, 'stem-a', [{ id: '16', trailerCount: 3 }]);
    await readRestageWatermarks(worktreeRoot, 'stem-a');

    await expect(readFile(engineStatePath, 'utf8')).resolves.toBe(engineState);
  });

  it('returns corrupt with the file path when the watermark contains malformed JSON', async () => {
    const watermarkPath = join(mainRoot, '.daemon', 'restage-watermarks', 'stem-a.json');
    await mkdir(join(mainRoot, '.daemon', 'restage-watermarks'), { recursive: true });
    await writeFile(watermarkPath, '{ not json', 'utf8');

    await expect(readRestageWatermarks(mainRoot, 'stem-a')).resolves.toEqual({
      kind: 'corrupt',
      detail: expect.stringContaining(watermarkPath),
    });
  });

  it('returns corrupt with the file path when the watermark has the wrong shape', async () => {
    const watermarkPath = join(mainRoot, '.daemon', 'restage-watermarks', 'stem-a.json');
    await mkdir(join(mainRoot, '.daemon', 'restage-watermarks'), { recursive: true });
    await writeFile(watermarkPath, '{ "version": 1, "tasks": "nope" }', 'utf8');

    await expect(readRestageWatermarks(mainRoot, 'stem-a')).resolves.toEqual({
      kind: 'corrupt',
      detail: expect.stringContaining(watermarkPath),
    });
  });

  it('returns failed and writes no watermark when resolving the main root throws', async () => {
    await expect(recordRestageWatermarks(mainRoot, 'stem-a', [{ id: '16', trailerCount: 3 }], {
      resolveMainRepoRoot: async () => {
        throw new Error('main root unavailable');
      },
    })).resolves.toEqual({
      kind: 'failed',
      detail: expect.stringContaining('main root unavailable'),
    });

    await expect(stat(join(mainRoot, '.daemon', 'restage-watermarks'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
