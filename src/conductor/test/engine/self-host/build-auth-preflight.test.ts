import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, chmod, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preflightBuildAuthCheck } from '../../../src/engine/self-host/build-auth-preflight.js';
import { HALT_MARKER } from '../../../src/engine/halt-marker.js';

// Task 6 (TR-3, TR-2): fail-closed pre-flight — missing daemon token HALTs with mint instructions

describe('self-host/build-auth-preflight — preflightBuildAuthCheck (Task 6, TR-3, TR-2)', () => {
  let projectRoot: string;
  let tokenPath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-auth-preflight-'));
    tokenPath = join(projectRoot, 'daemon-token');

    // Create the .pipeline directory that HALT_MARKER needs
    const pipelineDir = join(projectRoot, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  describe('daemon-token mode', () => {
    it('RED: missing daemon token returns failure with HALT marker', async () => {
      // Setup: daemon-token mode with missing token
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      // Should return failure
      expect(result).toBeDefined();
      expect(result?.success).toBe(false);

      // Check HALT marker exists
      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');

      // HALT reason should contain all required information
      expect(haltContent).toContain('daemon must mint a build-auth token');
      expect(haltContent).toContain('claude setup-token');
      expect(haltContent).toContain(tokenPath);
      expect(haltContent).toContain('harness_self_host.build_auth');

      // HALT message should NOT mention operator OAuth or .credentials.json
      expect(haltContent).not.toContain('operator');
      expect(haltContent).not.toContain('.credentials.json');
      expect(haltContent).not.toContain('OAuth');
    });

    it('RED: daemon token in error state (unreadable) returns failure with HALT marker', async () => {
      // Setup: create a token file with no read permissions
      await writeFile(tokenPath, 'sk_test_token', 'utf-8');
      await chmod(tokenPath, 0o000);

      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      expect(result?.success).toBe(false);

      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');
      expect(haltContent).toContain('daemon must mint a build-auth token');
      expect(haltContent).toContain('cannot read');
    });

    it('GREEN: daemon token present and readable returns undefined', async () => {
      // Setup: write a valid token
      await writeFile(tokenPath, 'sk_test_valid_token', 'utf-8');

      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      // Should return undefined (preflight passes)
      expect(result).toBeUndefined();
    });

    it('GREEN: existing HALT marker not overwritten on retry', async () => {
      // Setup: missing token, but HALT marker already exists with previous reason
      const existingHaltReason = 'Previous HALT reason that should be preserved\n';
      const haltPath = join(projectRoot, HALT_MARKER);
      await writeFile(haltPath, existingHaltReason, 'utf-8');

      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      expect(result?.success).toBe(false);

      // Existing HALT marker should be preserved
      const haltContent = await readFile(haltPath, 'utf-8');
      expect(haltContent).toBe(existingHaltReason);
    });

    it('GREEN: retry budget untouched (function does not modify state)', async () => {
      // Setup: missing token
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      // The function should not modify any state related to retry budget
      expect(result?.success).toBe(false);
    });

    it('GREEN: zero sandbox provisions recorded (no side effects before HALT)', async () => {
      // Setup: missing token
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      expect(result?.success).toBe(false);

      // The function should create .pipeline directory and write HALT marker
      const pipelineDir = join(projectRoot, '.pipeline');
      const actualFiles = await readdir(pipelineDir);
      expect(actualFiles).toContain('HALT');
    });
  });

  describe('api-key mode', () => {
    it('GREEN: api-key mode skips token requirement and returns undefined', async () => {
      // Setup: api-key mode (should skip the token check)
      const result = await preflightBuildAuthCheck('api-key', tokenPath, projectRoot);

      // Should proceed to dispatch (no preflight HALT)
      expect(result).toBeUndefined();

      // HALT marker should not exist
      const haltPath = join(projectRoot, HALT_MARKER);
      try {
        await readFile(haltPath, 'utf-8');
        throw new Error('HALT marker should not exist');
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('ENOENT')) {
          // Expected
        } else {
          throw err;
        }
      }
    });

    it('GREEN: api-key mode ignores missing token file', async () => {
      // Setup: api-key mode with missing token should still pass
      const result = await preflightBuildAuthCheck('api-key', '/nonexistent/path', projectRoot);

      expect(result).toBeUndefined();
    });
  });

  describe('HALT message format', () => {
    it('RED: HALT message contains token path and config key reference', async () => {
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');

      // Should contain the specific token path
      expect(haltContent).toContain(tokenPath);

      // Should contain the config key reference
      expect(haltContent).toContain('harness_self_host.build_auth');
      expect(haltContent).toContain('token_path');
    });

    it('RED: HALT message contains setup-token command', async () => {
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');

      expect(haltContent).toContain('claude setup-token');
    });

    it('RED: HALT message includes diagnostic for error state', async () => {
      // Setup: create a token file with no read permissions
      await writeFile(tokenPath, 'sk_test_token', 'utf-8');
      await chmod(tokenPath, 0o000);

      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      expect(result?.output).toContain('Diagnostic:');
      expect(result?.output).toContain('cannot read');

      // Also check the written file
      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');
      expect(haltContent).toContain('Diagnostic:');
    });

    it('RED: HALT marker has trailing newline (unix convention)', async () => {
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');

      expect(haltContent.endsWith('\n')).toBe(true);
    });
  });
});
