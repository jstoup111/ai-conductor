// Covers: task:21
import { describe, expect, it } from 'vitest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

describe('rewind command parser fallthrough', () => {
  it.each([
    ['repeated --child', ['rewind', '--to', 'build', '--child', '2', '--child', '3']],
    ['missing --child value', ['rewind', '--to', 'build', '--child']],
    ['extra positional token', ['rewind', '--to', 'build', 'extra']],
  ])('rejects %s before creating pipeline or daemon state', async (_name, args) => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-preboot-'));
    try {
      const conductorRoot = resolve(import.meta.dirname, '../..');
      const entry = join(conductorRoot, 'src', 'index.ts');
      const tsxLoader = join(conductorRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
      await expect(execFileP(process.execPath, ['--import', tsxLoader, entry, ...args], { cwd: root }))
        .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("error: unknown command 'rewind'") });
      await expect(access(join(root, '.pipeline'))).rejects.toThrow();
      await expect(access(join(root, '.daemon'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
