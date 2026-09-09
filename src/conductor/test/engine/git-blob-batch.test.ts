// Covers: task:1, task:2
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { execa } from 'execa';
import { describe, expect, it, vi } from 'vitest';
import { readGitBlobs, type GitBlobBatchRunner } from '../../src/engine/git-blob-batch.js';

const execFile = promisify(execFileCb);

async function createRepository(files: ReadonlyMap<string, Uint8Array>): Promise<{
  dir: string;
  revision: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'git-blob-batch-'));
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFile('git', ['config', 'user.name', 'Test User'], { cwd: dir });

  for (const [path, content] of files) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await execFile('git', ['add', '.'], { cwd: dir });
  await execFile('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir });
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return { dir, revision: stdout.trim() };
}

async function singlePathBytes(dir: string, revision: string, path: string): Promise<Buffer> {
  const { stdout } = await execa('git', ['show', `${revision}:${path}`], {
    cwd: dir,
    encoding: 'buffer',
    stripFinalNewline: false,
  });
  return Buffer.from(stdout);
}

describe('engine/git-blob-batch', () => {
  it('returns byte-identical committed blobs for multi-line, empty, newline-free, and repeated-blank-line files', async () => {
    const files = new Map<string, Uint8Array>([
      ['multi-line.txt', Buffer.from('first\nsecond\nthird\n')],
      ['empty.txt', Buffer.alloc(0)],
      ['no-final-newline.txt', Buffer.from('last byte is e')],
      ['repeated-blank-lines.txt', Buffer.from('top\n\n\nbottom\n')],
    ]);
    const { dir, revision } = await createRepository(files);

    try {
      const paths = [...files.keys()];
      const contents = await readGitBlobs(dir, revision, paths);

      expect(Object.fromEntries(contents)).toEqual(Object.fromEntries(
        await Promise.all(paths.map(async (path) => [path, await singlePathBytes(dir, revision, path)])),
      ));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('uses a fixed number of runner invocations for hundreds of committed paths', async () => {
    const files = new Map(
      Array.from({ length: 400 }, (_, index) => [`corpus/${index}.txt`, Buffer.from(`file ${index}\n`)]),
    );
    const { dir, revision } = await createRepository(files);
    const runnerMock = vi.fn<GitBlobBatchRunner>(async (file, args, options) => ({
      stdout: Buffer.from((await execa(file, args, options)).stdout),
    }));
    const runner: GitBlobBatchRunner = runnerMock;

    try {
      const smallPaths = [...files.keys()].slice(0, 4);
      const smallResult = await readGitBlobs(dir, revision, smallPaths, { runner });
      const smallInvocationCount = runnerMock.mock.calls.length;
      runnerMock.mockClear();

      const largeResult = await readGitBlobs(dir, revision, [...files.keys()], { runner });

      expect({
        smallSize: smallResult.size,
        largeSize: largeResult.size,
        smallInvocationCount,
        largeInvocationCount: runnerMock.mock.calls.length,
      }).toEqual({
        smallSize: 4,
        largeSize: 400,
        smallInvocationCount: 1,
        largeInvocationCount: 1,
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('omits an absent path without changing neighboring committed blobs', async () => {
    const files = new Map<string, Uint8Array>([
      ['before.md', Buffer.from('before\n')],
      ['after.md', Buffer.from('after\n')],
    ]);
    const { dir, revision } = await createRepository(files);

    try {
      const contents = await readGitBlobs(dir, revision, ['before.md', 'absent.md', 'after.md']);

      expect(Object.fromEntries(contents)).toEqual({
        'before.md': await singlePathBytes(dir, revision, 'before.md'),
        'after.md': await singlePathBytes(dir, revision, 'after.md'),
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('omits a tree path instead of returning its raw tree bytes', async () => {
    const { dir, revision } = await createRepository(new Map([
      ['directory/file.md', Buffer.from('content\n')],
    ]));

    try {
      await expect(readGitBlobs(dir, revision, ['directory'])).resolves.toEqual(new Map());
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('reads a newline-bearing path through the single-path form without altering ordinary blobs', async () => {
    const newlinePath = 'newline\nname.md';
    const files = new Map<string, Uint8Array>([
      ['ordinary.md', Buffer.from('ordinary\n')],
      [newlinePath, Buffer.from('newline filename\n')],
    ]);
    const { dir, revision } = await createRepository(files);

    try {
      const contents = await readGitBlobs(dir, revision, ['ordinary.md', newlinePath]);

      expect(Object.fromEntries(contents)).toEqual(Object.fromEntries(
        await Promise.all([...files.keys()].map(async (path) => [path, await singlePathBytes(dir, revision, path)])),
      ));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('omits a newline-bearing directory instead of returning raw tree bytes from the fallback', async () => {
    const directory = 'directory\nname';
    const { dir, revision } = await createRepository(new Map([
      [`${directory}/file.md`, Buffer.from('content\n')],
    ]));

    try {
      await expect(readGitBlobs(dir, revision, [directory])).resolves.toEqual(new Map());
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('returns no blobs and does not invoke the runner for an empty request', async () => {
    const runner = vi.fn<GitBlobBatchRunner>();

    const contents = await readGitBlobs('/unused', 'HEAD', [], { runner });

    expect({ contents: Object.fromEntries(contents), invocations: runner.mock.calls.length }).toEqual({
      contents: {},
      invocations: 0,
    });
  });
});
