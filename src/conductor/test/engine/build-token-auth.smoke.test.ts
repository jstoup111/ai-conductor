import { describe, it, expect, afterEach } from 'vitest';
import { execa } from 'execa';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTH_FAILURE_RE } from '../../src/execution/claude-provider.js';

/**
 * Real-binary smoke test for TR-5: prove that `CLAUDE_CODE_OAUTH_TOKEN` auth
 * works end-to-end with the real Claude CLI from a fresh config directory.
 * This complements the acceptance specs' real-binary validation by testing the
 * token-only auth path (no .credentials.json, no operator OAuth involvement).
 *
 * Scenarios:
 * (a) Valid token + fresh empty CLAUDE_CONFIG_DIR → exit 0, no auth failure
 * (b) Token unset, same dir → exit non-zero, matches AUTH_FAILURE_RE
 * (c) Corrupted token value + same dir → exit non-zero, matches AUTH_FAILURE_RE
 *
 * Guarded: skipped when no CLAUDE_CODE_OAUTH_TOKEN is available in the
 * environment (e.g., CI without setup-token), or when the kill-switch
 * BUILD_TOKEN_AUTH_SMOKE=0 is set (e.g., production-spawn disabled).
 */

function claudeBinaryAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const hostToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const killSwitch = process.env.BUILD_TOKEN_AUTH_SMOKE === '0';
const binaryAvailable = claudeBinaryAvailable();
const shouldRun = binaryAvailable && !killSwitch && !!hostToken;

describe.skipIf(!shouldRun)(
  'claude CLI CLAUDE_CODE_OAUTH_TOKEN auth (real binary)',
  () => {
    afterEach(() => {
      // Clean up any .pipeline state created by the Claude binary.
      const pipelinePath = join(process.cwd(), '.pipeline');
      rmSync(pipelinePath, { recursive: true, force: true });
    });

    it(
      '(a) valid token + fresh empty CLAUDE_CONFIG_DIR → exit 0',
      async () => {
        const emptyConfigDir = await mkdtemp(join(tmpdir(), 'claude-token-auth-'));
        try {
          const result = await execa(
            'claude',
            ['-p', 'say ok', '--print'],
            {
              reject: false,
              env: {
                ...process.env,
                CLAUDE_CONFIG_DIR: emptyConfigDir,
                CLAUDE_CODE_OAUTH_TOKEN: hostToken!,
              },
            },
          );

          expect(result.exitCode).toBe(0);
          const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
          expect(AUTH_FAILURE_RE.test(output)).toBe(false);
        } finally {
          await rm(emptyConfigDir, { recursive: true, force: true });
        }
      },
      30_000,
    );

    it(
      '(b) token unset, fresh empty CLAUDE_CONFIG_DIR → matches AUTH_FAILURE_RE',
      async () => {
        const emptyConfigDir = await mkdtemp(join(tmpdir(), 'claude-token-unset-'));
        try {
          // Create env without CLAUDE_CODE_OAUTH_TOKEN
          const env = { ...process.env };
          delete env.CLAUDE_CODE_OAUTH_TOKEN;

          const result = await execa(
            'claude',
            ['-p', 'say ok', '--print'],
            {
              reject: false,
              env: {
                ...env,
                CLAUDE_CONFIG_DIR: emptyConfigDir,
              },
            },
          );

          expect(result.exitCode).not.toBe(0);
          const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
          expect(AUTH_FAILURE_RE.test(output)).toBe(true);
        } finally {
          await rm(emptyConfigDir, { recursive: true, force: true });
        }
      },
      30_000,
    );

    it(
      '(c) corrupted token value, fresh empty CLAUDE_CONFIG_DIR → matches AUTH_FAILURE_RE',
      async () => {
        const emptyConfigDir = await mkdtemp(join(tmpdir(), 'claude-token-corrupt-'));
        try {
          const result = await execa(
            'claude',
            ['-p', 'say ok', '--print'],
            {
              reject: false,
              env: {
                ...process.env,
                CLAUDE_CONFIG_DIR: emptyConfigDir,
                CLAUDE_CODE_OAUTH_TOKEN: 'invalid-token-xyz-definitely-not-real',
              },
            },
          );

          expect(result.exitCode).not.toBe(0);
          const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
          expect(AUTH_FAILURE_RE.test(output)).toBe(true);
        } finally {
          await rm(emptyConfigDir, { recursive: true, force: true });
        }
      },
      30_000,
    );
  },
);
