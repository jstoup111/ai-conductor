import { describe, expect, it, vi } from 'vitest';

import { discoverSmokeFiles } from '../../src/engine/smoke-runner.js';

describe('discoverSmokeFiles', () => {
  it('isolates discovery, then restores the caller environment and cleans up after success', async () => {
    const close = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const createVitest = vi.fn(async (_mode: 'test', _options: { config: string; root: string }) => {
      expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBeUndefined();
      expect(process.env.TMPDIR).toBe('isolated-discovery-root');
      return {
      globTestFiles: async () => [],
      close,
      };
    });
    const previousRunRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    const previousTmpdir = process.env.TMPDIR;
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = 'parent-run-root';
    process.env.TMPDIR = 'parent-tmpdir';

    try {
      await expect(discoverSmokeFiles('vitest.smoke.config.ts', {
        createTempDir: async () => 'isolated-discovery-root',
        createVitest,
        remove,
      })).resolves.toEqual([]);

      expect(createVitest).toHaveBeenCalledWith('test', {
        config: expect.any(String),
        root: process.cwd(),
      });
      expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBe('parent-run-root');
      expect(process.env.TMPDIR).toBe('parent-tmpdir');
      expect(close).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('isolated-discovery-root', { recursive: true, force: true });
    } finally {
      if (previousRunRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousRunRoot;
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });

  it('restores the caller environment, closes Vitest, and cleans up when discovery fails', async () => {
    const close = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const previousRunRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    const previousTmpdir = process.env.TMPDIR;
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = 'parent-run-root';
    process.env.TMPDIR = 'parent-tmpdir';

    try {
      await expect(discoverSmokeFiles('vitest.smoke.config.ts', {
        createTempDir: async () => 'isolated-discovery-root',
        createVitest: async () => {
          expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBeUndefined();
          expect(process.env.TMPDIR).toBe('isolated-discovery-root');
          return {
            globTestFiles: async () => { throw new Error('discovery failed'); },
            close,
          };
        },
        remove,
      })).rejects.toThrow('discovery failed');

      expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBe('parent-run-root');
      expect(process.env.TMPDIR).toBe('parent-tmpdir');
      expect(close).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('isolated-discovery-root', { recursive: true, force: true });
    } finally {
      if (previousRunRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousRunRoot;
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });
});
