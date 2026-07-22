// test/engine/self-host/build-auth-message.test.ts — RED phase for Task 7
//
// Verifies buildAuthRemediationMessage produces a complete, safe remediation
// message: mint command, resolved token path, and the three known pitfalls
// (tty-only mint output, trailing whitespace, file permissions). Never
// contains actual token material.

import { describe, it, expect } from 'vitest';
import { buildAuthRemediationMessage } from '../../../src/engine/self-host/build-auth-message.js';
import { DAEMON_BUILD_TOKEN_MINT_COMMAND } from '../../../src/engine/self-host/daemon-build-token.js';

describe('buildAuthRemediationMessage', () => {
  it('includes the mint command', () => {
    const message = buildAuthRemediationMessage('/home/user/.daemon-token');
    expect(message).toContain(DAEMON_BUILD_TOKEN_MINT_COMMAND);
  });

  it('includes the resolved token path', () => {
    const resolvedPath = '/custom/override/path/token.txt';
    const message = buildAuthRemediationMessage(resolvedPath);
    expect(message).toContain(resolvedPath);
  });

  it('warns that mint output may only appear in an interactive terminal (tty-only pitfall)', () => {
    const message = buildAuthRemediationMessage('/home/user/.daemon-token');
    expect(message.toLowerCase()).toMatch(/interactive terminal|tty/);
  });

  it('warns about trailing whitespace in the stored token', () => {
    const message = buildAuthRemediationMessage('/home/user/.daemon-token');
    expect(message.toLowerCase()).toContain('trailing whitespace');
  });

  it('warns about file permissions issues', () => {
    const message = buildAuthRemediationMessage('/home/user/.daemon-token');
    expect(message.toLowerCase()).toContain('permission');
  });

  it('does not contain any actual token material', () => {
    const resolvedPath = '/home/user/.daemon-token';
    const message = buildAuthRemediationMessage(resolvedPath);
    // Message should not contain anything resembling a bearer/secret token value
    expect(message).not.toMatch(/sk-ant-[a-zA-Z0-9-]+/);
    expect(message).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
  });
});
