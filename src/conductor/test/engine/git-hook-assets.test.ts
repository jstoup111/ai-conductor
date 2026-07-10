import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } from '../../src/engine/git-hook-assets.js';

const execFileAsync = promisify(execFile);

describe('git-hook-assets — embedding hook scripts', () => {
  let tempDir: string;

  // Helper to run bash syntax check
  async function checkBashSyntax(script: string): Promise<number> {
    try {
      const tempFile = join(tempDir, `hook-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
      await writeFile(tempFile, script);
      await chmod(tempFile, 0o755);
      await execFileAsync('bash', ['-n', tempFile]);
      return 0;
    } catch (err) {
      const e = err as { code?: number };
      return e.code ?? 1;
    }
  }

  beforeEach(async () => {
    const prefix = join(tmpdir(), `git-hook-assets-test-`);
    tempDir = await mkdtemp(prefix);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PREPARE_COMMIT_MSG_HOOK', () => {
    it('is a non-empty string', () => {
      expect(typeof PREPARE_COMMIT_MSG_HOOK).toBe('string');
      expect(PREPARE_COMMIT_MSG_HOOK.length).toBeGreaterThan(0);
    });

    it('starts with #!/bin/bash', () => {
      expect(PREPARE_COMMIT_MSG_HOOK.startsWith('#!/bin/bash')).toBe(true);
    });

    it('passes bash syntax check (bash -n)', async () => {
      const code = await checkBashSyntax(PREPARE_COMMIT_MSG_HOOK);
      expect(code).toBe(0);
    });

    it('does not reference src/conductor/dist or conduct-ts', () => {
      expect(PREPARE_COMMIT_MSG_HOOK).not.toMatch(/src\/conductor\/dist/);
      expect(PREPARE_COMMIT_MSG_HOOK).not.toMatch(/conduct-ts/);
    });
  });

  describe('COMMIT_MSG_HOOK', () => {
    it('is a non-empty string', () => {
      expect(typeof COMMIT_MSG_HOOK).toBe('string');
      expect(COMMIT_MSG_HOOK.length).toBeGreaterThan(0);
    });

    it('starts with #!/bin/bash', () => {
      expect(COMMIT_MSG_HOOK.startsWith('#!/bin/bash')).toBe(true);
    });

    it('passes bash syntax check (bash -n)', async () => {
      const code = await checkBashSyntax(COMMIT_MSG_HOOK);
      expect(code).toBe(0);
    });

    it('does not reference src/conductor/dist or conduct-ts', () => {
      expect(COMMIT_MSG_HOOK).not.toMatch(/src\/conductor\/dist/);
      expect(COMMIT_MSG_HOOK).not.toMatch(/conduct-ts/);
    });
  });
});
