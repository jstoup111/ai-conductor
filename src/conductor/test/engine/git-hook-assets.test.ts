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

  describe('Regression lock: no dist/CLI dependencies (#403 class)', () => {
    /**
     * Task 17: No-dist-dependency regression lock
     *
     * Hooks must be pure bash + POSIX tools, with no dependency on:
     * - Compiled engine (dist/)
     * - CLI tool (conduct/conduct-ts)
     * - Package managers (npm/npx)
     *
     * Allowlist: git, node -e, POSIX tools (test, grep, cat, sed, etc.)
     *
     * This locks the #403-class bug: accidental introduction of engine or CLI
     * dependencies into hook scripts, which breaks git workflows when the engine
     * is not available (e.g., before a build, or in CI without node_modules).
     */

    const FORBIDDEN_PATTERNS = [
      { pattern: /\bdist\//, name: 'dist/ reference' },
      { pattern: /\bconduct\b/, name: 'conduct CLI invocation' },
      { pattern: /\bnpm\b/, name: 'npm invocation' },
      { pattern: /\bnpx\b/, name: 'npx invocation' },
    ];

    it('PREPARE_COMMIT_MSG_HOOK does not reference dist/, conduct, npm, or npx', () => {
      for (const { pattern, name } of FORBIDDEN_PATTERNS) {
        expect(
          PREPARE_COMMIT_MSG_HOOK,
          `PREPARE_COMMIT_MSG_HOOK should not contain ${name}`
        ).not.toMatch(pattern);
      }
    });

    it('COMMIT_MSG_HOOK does not reference dist/, conduct, npm, or npx', () => {
      for (const { pattern, name } of FORBIDDEN_PATTERNS) {
        expect(
          COMMIT_MSG_HOOK,
          `COMMIT_MSG_HOOK should not contain ${name}`
        ).not.toMatch(pattern);
      }
    });

    it('both hooks do not spawn CLI tools like conduct, npm, or npx', () => {
      /**
       * Check for invocations of forbidden CLI tools.
       * We look for word boundaries to catch:
       * - `conduct ...` or `$(conduct ...)`
       * - `npm ...` or `$(npm ...)`
       * - `npx ...` or `$(npx ...)`
       *
       * Note: `require()` inside `node -e` strings is allowed (not a CLI invocation).
       * We're checking for shell invocations of these tools, which would be executed
       * outside the `node -e` context.
       */
      const forbiddenCliPatterns = [
        /\bconduct\b/,
        /\bnpm\b/,
        /\bnpx\b/,
      ];

      // For each hook, check against forbidden patterns
      for (const { hookName, hook } of [
        { hookName: 'PREPARE_COMMIT_MSG_HOOK', hook: PREPARE_COMMIT_MSG_HOOK },
        { hookName: 'COMMIT_MSG_HOOK', hook: COMMIT_MSG_HOOK },
      ]) {
        for (const forbiddenPattern of forbiddenCliPatterns) {
          expect(hook, `${hookName} should not invoke ${forbiddenPattern.source}`).not.toMatch(forbiddenPattern);
        }
      }
    });
  });
});
