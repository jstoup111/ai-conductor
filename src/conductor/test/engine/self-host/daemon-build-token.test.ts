import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readDaemonBuildToken,
} from '../../../src/engine/self-host/daemon-build-token.js';

// Task 5 (TR-3, TR-2): daemon token reader — BuildAuthProvider seam
//
// The daemon maintains its own build auth token at a configured path, separate
// from operator OAuth. This module reads that token and classifies its state:
// - 'ok': token present and non-empty (trimmed)
// - 'missing': file doesn't exist, or is empty/whitespace-only
// - 'error': file exists but is unreadable (e.g., chmod 000)

describe('self-host/daemon-build-token — readDaemonBuildToken (TR-3, TR-2)', () => {
  let tmpDir: string;
  let tokenPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'daemon-token-'));
    tokenPath = join(tmpDir, 'build-token');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('happy path: non-empty file', () => {
    it('reads a non-empty token file and returns { state: ok, token } with content trimmed', async () => {
      const tokenContent = '  sk_test_abc123xyz  \n';
      const expectedToken = 'sk_test_abc123xyz';
      await writeFile(tokenPath, tokenContent, 'utf-8');

      const result = await readDaemonBuildToken(tokenPath);

      expect(result).toEqual({
        state: 'ok',
        token: expectedToken,
      });
    });

    it('trims leading and trailing whitespace from token', async () => {
      const tokenContent = '\n\n  sk_test_with_spaces  \n\n';
      const expectedToken = 'sk_test_with_spaces';
      await writeFile(tokenPath, tokenContent, 'utf-8');

      const result = await readDaemonBuildToken(tokenPath);

      expect(result.state).toBe('ok');
      expect(result.token).toBe(expectedToken);
    });

    it('returns the full token value as-is when no whitespace padding', async () => {
      const tokenContent = 'sk_test_exact_token_value';
      await writeFile(tokenPath, tokenContent, 'utf-8');

      const result = await readDaemonBuildToken(tokenPath);

      expect(result).toEqual({
        state: 'ok',
        token: tokenContent,
      });
    });
  });

  describe('missing file', () => {
    it('returns { state: missing } when token file does not exist', async () => {
      // Do not write the file
      const result = await readDaemonBuildToken(tokenPath);

      expect(result).toEqual({
        state: 'missing',
      });
    });
  });

  describe('empty/whitespace file', () => {
    it('returns { state: missing } when token file is empty', async () => {
      await writeFile(tokenPath, '', 'utf-8');

      const result = await readDaemonBuildToken(tokenPath);

      expect(result).toEqual({
        state: 'missing',
      });
    });

    it('returns { state: missing } when token file contains only whitespace', async () => {
      await writeFile(tokenPath, '   \n  \t  \n', 'utf-8');

      const result = await readDaemonBuildToken(tokenPath);

      expect(result).toEqual({
        state: 'missing',
      });
    });

    it('returns { state: missing } when token file contains only newlines', async () => {
      await writeFile(tokenPath, '\n\n\n', 'utf-8');

      const result = await readDaemonBuildToken(tokenPath);

      expect(result).toEqual({
        state: 'missing',
      });
    });
  });

  describe('permission error (EACCES)', () => {
    it('returns { state: error, detail } when file is unreadable due to permissions (chmod 000)', async () => {
      await writeFile(tokenPath, 'sk_test_unreadable_token', 'utf-8');
      await chmod(tokenPath, 0o000);

      const result = await readDaemonBuildToken(tokenPath);

      expect(result.state).toBe('error');
      expect(result.detail).toBeDefined();
      // The detail should name the path
      expect(result.detail).toContain(tokenPath);
    });

    it('error detail includes reference to the path for diagnostics', async () => {
      await writeFile(tokenPath, 'sk_test_token', 'utf-8');
      await chmod(tokenPath, 0o000);

      const result = await readDaemonBuildToken(tokenPath);

      expect(result.state).toBe('error');
      expect(typeof result.detail).toBe('string');
      expect(result.detail.length).toBeGreaterThan(0);
      expect(result.detail).toContain(tokenPath);
    });
  });

  describe('discriminated union return type', () => {
    it('ok state has token property', async () => {
      await writeFile(tokenPath, 'sk_test_token', 'utf-8');

      const result = await readDaemonBuildToken(tokenPath);

      if (result.state === 'ok') {
        expect(result.token).toBeDefined();
        expect(typeof result.token).toBe('string');
      } else {
        throw new Error('Expected ok state');
      }
    });

    it('missing state has no token or detail properties', async () => {
      const result = await readDaemonBuildToken(tokenPath);

      if (result.state === 'missing') {
        expect(result.token).toBeUndefined();
        expect(result.detail).toBeUndefined();
      } else {
        throw new Error('Expected missing state');
      }
    });

    it('error state has detail property', async () => {
      await writeFile(tokenPath, 'sk_test_token', 'utf-8');
      await chmod(tokenPath, 0o000);

      const result = await readDaemonBuildToken(tokenPath);

      if (result.state === 'error') {
        expect(result.detail).toBeDefined();
        expect(typeof result.detail).toBe('string');
      } else {
        throw new Error('Expected error state');
      }
    });
  });
});
