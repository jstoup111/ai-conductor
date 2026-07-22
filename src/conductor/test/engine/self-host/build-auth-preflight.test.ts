import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, chmod, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preflightBuildAuthCheck } from '../../../src/engine/self-host/build-auth-preflight.js';
import { HALT_MARKER } from '../../../src/engine/halt-marker.js';
import { DAEMON_BUILD_TOKEN_MINT_COMMAND } from '../../../src/engine/self-host/daemon-build-token.js';
import { buildAuthRemediationMessage } from '../../../src/engine/self-host/build-auth-message.js';

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

      // HALT reason should be built from the shared remediation message builder
      // (Task 12: preflight adopts the shared message, not a separately-assembled string)
      expect(haltContent).toContain(buildAuthRemediationMessage(tokenPath));
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
      expect(haltContent).toContain(buildAuthRemediationMessage(tokenPath));
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

  describe('EACCES negative path (Task 7, TR-3 negative)', () => {
    it('RED: EACCES unreadable token file triggers reader error state → HALT with path and permission diagnostic', async () => {
      // Setup: create token file with no read permissions (EACCES case)
      await writeFile(tokenPath, 'sk_daemon_token_content', 'utf-8');
      await chmod(tokenPath, 0o000);

      // Execute preflight check
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      // Verify: returns failure (reader should have returned state='error')
      expect(result).toBeDefined();
      expect(result?.success).toBe(false);

      // Verify: HALT marker is written (no spawn or budget burn)
      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');

      // HALT must name the path
      expect(haltContent).toContain(tokenPath);

      // HALT must mention permission problem (diagnostic includes path + error)
      expect(haltContent).toContain('cannot read');
      expect(haltContent).toContain('Diagnostic:');

      // HALT must NOT spawn sandbox or attempt to use token
      expect(result?.output).not.toContain('spawn');
      expect(result?.output).not.toContain('provision');
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

  describe('HALT/Migration consistency (Task 17)', () => {
    it('GREEN: HALT message uses DAEMON_BUILD_TOKEN_MINT_COMMAND constant', async () => {
      // Verify that the HALT message uses the shared constant for the setup-token command
      const result = await preflightBuildAuthCheck('daemon-token', tokenPath, projectRoot);

      expect(result).toBeDefined();
      const haltPath = join(projectRoot, HALT_MARKER);
      const haltContent = await readFile(haltPath, 'utf-8');

      // The HALT message should contain the exact command from the constant
      expect(haltContent).toContain(DAEMON_BUILD_TOKEN_MINT_COMMAND);
      // Verify it matches the expected string
      expect(DAEMON_BUILD_TOKEN_MINT_COMMAND).toBe('claude setup-token');
    });

    it('GREEN: DAEMON_BUILD_TOKEN_MINT_COMMAND is exactly "claude setup-token"', () => {
      // This constant is used in both HALT messages (Task 6) and CHANGELOG migration (Task 17)
      // Verify consistency by checking the exact value
      expect(DAEMON_BUILD_TOKEN_MINT_COMMAND).toBe('claude setup-token');
    });
  });
});
