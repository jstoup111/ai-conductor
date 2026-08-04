import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Live-provider daemon E2E smoke. This file is opt-in by name and by its
 * runtime gate so the ordinary suite and uncredentialed advisory runs remain
 * free of real Claude dispatches.
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
const killSwitch = process.env.DAEMON_E2E_LIVE_SMOKE === '0';
const shouldRun = claudeBinaryAvailable() && !killSwitch && !!hostToken;

describe.skipIf(!shouldRun)('daemon E2E with real Claude provider', () => {
  it('clears the real-exec guard before live dispatch', () => {
    // test/setup.ts enables this guard for the ordinary suite. This smoke is
    // its explicit exception; Task 4's real dispatch remains below this check.
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeUndefined();
  });
});
