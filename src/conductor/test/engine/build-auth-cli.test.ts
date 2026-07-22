// test/engine/build-auth-cli.test.ts — RED phase for Task 8 (FR-1)
//
// Covers `conduct build-auth-status`: detect/dispatch pair reporting the
// resolved build-auth mode + token state, with liveness probing for
// daemon-token mode and remediation guidance for any non-clean state.

import { describe, it, expect, vi } from 'vitest';
import {
  detectBuildAuthStatusCommand,
  dispatchBuildAuthStatus,
} from '../../src/engine/build-auth-cli.js';
import type { TokenLivenessResult } from '../../src/engine/self-host/token-liveness.js';
import type { DaemonBuildTokenResult } from '../../src/engine/self-host/daemon-build-token.js';
import {
  resolveSelfHostConfig,
  DEFAULT_BUILD_AUTH_MODE,
  type ResolvedSelfHostConfig,
} from '../../src/engine/resolved-config.js';

function baseSelfHost(overrides: Partial<ResolvedSelfHostConfig> = {}): ResolvedSelfHostConfig {
  return {
    activation: 'auto',
    skillRelinkPreflight: true,
    sandboxBuildEnv: true,
    versionApprovalGate: true,
    releaseArtifactGate: true,
    versionFreeze: null,
    authParkTimeoutMinutes: 60,
    buildAuthMode: 'daemon-token',
    buildAuthTokenPath: '/home/test/.ai-conductor/build-auth',
    ...overrides,
  };
}

describe('detectBuildAuthStatusCommand', () => {
  it('matches argv containing build-auth-status', () => {
    expect(detectBuildAuthStatusCommand(['node', 'conduct', 'build-auth-status'])).not.toBeNull();
  });

  it('matches with additional trailing argv', () => {
    expect(
      detectBuildAuthStatusCommand(['node', 'conduct', 'build-auth-status', '--foo']),
    ).not.toBeNull();
  });

  it('returns null for unrelated argv', () => {
    expect(detectBuildAuthStatusCommand(['node', 'conduct', 'daemon'])).toBeNull();
    expect(detectBuildAuthStatusCommand(['node', 'conduct'])).toBeNull();
  });
});

describe('dispatchBuildAuthStatus', () => {
  it('daemon-token mode with a valid-looking token: probes liveness, prints valid, no remediation', async () => {
    const print = vi.fn();
    const readToken = vi.fn(
      async (): Promise<DaemonBuildTokenResult> => ({ state: 'ok', token: 'sk-live-token' }),
    );
    const probeLiveness = vi.fn(
      async (): Promise<TokenLivenessResult> => ({ verdict: 'valid' }),
    );

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost(),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(probeLiveness).toHaveBeenCalledTimes(1);
    const output = print.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/valid/i);
    expect(output).not.toMatch(/mint/i); // no remediation message
    expect(exitCode).toBe(0);
  });

  it('token missing: prints missing state + remediation, no probe attempted', async () => {
    const print = vi.fn();
    const readToken = vi.fn(async (): Promise<DaemonBuildTokenResult> => ({ state: 'missing' }));
    const probeLiveness = vi.fn();

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost(),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(probeLiveness).not.toHaveBeenCalled();
    const output = print.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/missing/i);
    expect(output).toMatch(/mint/i);
    expect(exitCode).not.toBe(0);
  });

  it('token present but probe returns invalid: prints invalid state + remediation', async () => {
    const print = vi.fn();
    const readToken = vi.fn(
      async (): Promise<DaemonBuildTokenResult> => ({ state: 'ok', token: 'sk-dead-token' }),
    );
    const probeLiveness = vi.fn(
      async (): Promise<TokenLivenessResult> => ({ verdict: 'invalid', detail: 'api_error_status 401' }),
    );

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost(),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(probeLiveness).toHaveBeenCalledTimes(1);
    const output = print.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/invalid/i);
    expect(output).toMatch(/mint/i);
    expect(exitCode).not.toBe(0);
  });

  it('token unreadable (fs error): prints unreadable state + remediation, no probe attempted', async () => {
    const print = vi.fn();
    const readToken = vi.fn(
      async (): Promise<DaemonBuildTokenResult> => ({
        state: 'error',
        detail: 'cannot read daemon build token: /path (EACCES)',
      }),
    );
    const probeLiveness = vi.fn();

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost(),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(probeLiveness).not.toHaveBeenCalled();
    const output = print.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/unreadable/i);
    expect(output).toMatch(/mint/i);
    expect(exitCode).not.toBe(0);
  });

  it('probe returns unverifiable: prints unverifiable state + remediation', async () => {
    const print = vi.fn();
    const readToken = vi.fn(
      async (): Promise<DaemonBuildTokenResult> => ({ state: 'ok', token: 'sk-token' }),
    );
    const probeLiveness = vi.fn(
      async (): Promise<TokenLivenessResult> => ({
        verdict: 'unverifiable',
        detail: 'liveness probe timed out',
      }),
    );

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost(),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(probeLiveness).toHaveBeenCalledTimes(1);
    const output = print.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/unverifiable/i);
    expect(output).toMatch(/mint/i);
    // Strict: unverifiable is NOT a pass — the operator must be able to
    // script on this exit code, so it must be non-zero, same as invalid.
    expect(exitCode).not.toBe(0);
  });

  it('api-key mode: prints api-key state, no probe attempted, no remediation', async () => {
    const print = vi.fn();
    const readToken = vi.fn();
    const probeLiveness = vi.fn();

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost({ buildAuthMode: 'api-key' }),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(readToken).not.toHaveBeenCalled();
    expect(probeLiveness).not.toHaveBeenCalled();
    const output = print.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/api-key/i);
    expect(exitCode).toBe(0);
  });

  it('api-key mode: exit code 0 even when no token file exists at all (readToken would report missing)', async () => {
    const print = vi.fn();
    // Even if invoked, readToken reporting "missing" must not affect the
    // api-key-mode result — but it should never be invoked in the first
    // place (asserted below).
    const readToken = vi.fn(async (): Promise<DaemonBuildTokenResult> => ({ state: 'missing' }));
    const probeLiveness = vi.fn();

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost({ buildAuthMode: 'api-key' }),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(readToken).not.toHaveBeenCalled();
    expect(probeLiveness).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });

  it('no self-host config present at all: defaults to daemon-token mode at the default token path', async () => {
    const print = vi.fn();
    const readToken = vi.fn(async (): Promise<DaemonBuildTokenResult> => ({ state: 'ok', token: 'sk-live' }));
    const probeLiveness = vi.fn(async (): Promise<TokenLivenessResult> => ({ verdict: 'valid' }));

    // Real resolveSelfHostConfig with no config block supplied — exercises
    // the actual default-resolution path, not a stubbed baseSelfHost().
    const resolved = resolveSelfHostConfig(undefined);
    expect(resolved.buildAuthMode).toBe(DEFAULT_BUILD_AUTH_MODE);
    expect(resolved.buildAuthMode).toBe('daemon-token');

    const exitCode = await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => resolved,
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );

    expect(readToken).toHaveBeenCalledWith(resolved.buildAuthTokenPath);
    expect(exitCode).toBe(0);
  });
});

describe('Task 11: credential confidentiality sweep', () => {
  const TOKEN_FIXTURE = 'zqx9RmTt7pLk3vEwYbNcGhJdSfAoXu2M';

  async function capturedOutput(
    readToken: () => Promise<DaemonBuildTokenResult>,
    probeLiveness: () => Promise<TokenLivenessResult>,
    mode: ResolvedSelfHostConfig['buildAuthMode'] = 'daemon-token',
  ): Promise<string> {
    const print = vi.fn();
    await dispatchBuildAuthStatus(
      { kind: 'status' },
      {
        print,
        resolveSelfHostConfig: () => baseSelfHost({ buildAuthMode: mode }),
        readDaemonBuildToken: readToken,
        verifyTokenLiveness: probeLiveness,
      },
    );
    return print.mock.calls.map((c) => c[0]).join('\n');
  }

  it('valid state: printed output never contains the token', async () => {
    const output = await capturedOutput(
      async () => ({ state: 'ok', token: TOKEN_FIXTURE }),
      async () => ({ verdict: 'valid' }),
    );
    expect(output).not.toContain(TOKEN_FIXTURE);
  });

  it('invalid state: printed output never contains the token', async () => {
    const output = await capturedOutput(
      async () => ({ state: 'ok', token: TOKEN_FIXTURE }),
      async () => ({ verdict: 'invalid', detail: 'api_error_status 401' }),
    );
    expect(output).not.toContain(TOKEN_FIXTURE);
  });

  it('missing state: printed output never contains the token', async () => {
    const output = await capturedOutput(
      async () => ({ state: 'missing' }),
      async () => ({ verdict: 'valid' }),
    );
    expect(output).not.toContain(TOKEN_FIXTURE);
  });

  it('unreadable state: printed output never contains the token', async () => {
    const output = await capturedOutput(
      async () => ({
        state: 'error',
        detail: `cannot read daemon build token: /path (${TOKEN_FIXTURE})`,
      }),
      async () => ({ verdict: 'valid' }),
    );
    expect(output).not.toContain(TOKEN_FIXTURE);
  });

  it('unverifiable state: printed output never contains the token', async () => {
    const output = await capturedOutput(
      async () => ({ state: 'ok', token: TOKEN_FIXTURE }),
      async () => ({ verdict: 'unverifiable', detail: 'liveness probe timed out' }),
    );
    expect(output).not.toContain(TOKEN_FIXTURE);
  });
});
