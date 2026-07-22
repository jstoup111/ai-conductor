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
import type { ResolvedSelfHostConfig } from '../../src/engine/resolved-config.js';

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

    await dispatchBuildAuthStatus(
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
  });

  it('token missing: prints missing state + remediation, no probe attempted', async () => {
    const print = vi.fn();
    const readToken = vi.fn(async (): Promise<DaemonBuildTokenResult> => ({ state: 'missing' }));
    const probeLiveness = vi.fn();

    await dispatchBuildAuthStatus(
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
  });

  it('token present but probe returns invalid: prints invalid state + remediation', async () => {
    const print = vi.fn();
    const readToken = vi.fn(
      async (): Promise<DaemonBuildTokenResult> => ({ state: 'ok', token: 'sk-dead-token' }),
    );
    const probeLiveness = vi.fn(
      async (): Promise<TokenLivenessResult> => ({ verdict: 'invalid', detail: 'api_error_status 401' }),
    );

    await dispatchBuildAuthStatus(
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

    await dispatchBuildAuthStatus(
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

    await dispatchBuildAuthStatus(
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
  });

  it('api-key mode: prints api-key state, no probe attempted, no remediation', async () => {
    const print = vi.fn();
    const readToken = vi.fn();
    const probeLiveness = vi.fn();

    await dispatchBuildAuthStatus(
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
  });
});
