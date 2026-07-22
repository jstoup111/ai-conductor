// engine/build-auth-cli.ts — `conduct build-auth-status` CLI verb (Task 8, FR-1)
//
// Reports the resolved daemon build-auth mode and token state as a single
// human-readable status line, plus remediation guidance (Task 7) for any
// non-clean state. In daemon-token mode with a token present, probes
// liveness (Task 6) by exercising the real dispatch auth path.
//
// Non-clean states: missing, unreadable, invalid, unverifiable.
// Clean states: valid (daemon-token, token present + live), api-key (no
// daemon-owned token to check).

import { resolveSelfHostConfig, type ResolvedSelfHostConfig } from '../engine/resolved-config.js';
import { readDaemonBuildToken, type DaemonBuildTokenResult } from './self-host/daemon-build-token.js';
import { verifyTokenLiveness, type TokenLivenessResult } from './self-host/token-liveness.js';
import { buildAuthRemediationMessage } from './self-host/build-auth-message.js';
import type { HarnessConfig } from '../types/config.js';

export type BuildAuthStatusDispatch = { kind: 'status' };

/**
 * Parse argv for the `build-auth-status` subcommand.
 *   conduct build-auth-status [anything] → {kind:'status'}
 *   (any other sub)                      → null
 */
export function detectBuildAuthStatusCommand(argv: string[]): BuildAuthStatusDispatch | null {
  const sub = argv[2];
  if (sub !== 'build-auth-status') return null;
  return { kind: 'status' };
}

export interface BuildAuthStatusDispatchDeps {
  print?: (msg: string) => void;
  config?: HarnessConfig;
  resolveSelfHostConfig?: (config?: HarnessConfig) => ResolvedSelfHostConfig;
  readDaemonBuildToken?: (path: string) => Promise<DaemonBuildTokenResult>;
  verifyTokenLiveness?: (options: { token: string }) => Promise<TokenLivenessResult>;
}

/**
 * Dispatch the `build-auth-status` subcommand.
 *
 * Resolves mode + token path via `resolveSelfHostConfig`. In api-key mode,
 * there is no daemon-owned token to check — reports mode only. In
 * daemon-token mode, reads the token file and classifies:
 *   - missing / unreadable → non-clean, remediation printed, no probe.
 *   - present → probes liveness; valid → clean; invalid/unverifiable →
 *     non-clean, remediation printed.
 *
 * Exit code: 0 for clean states (valid daemon-token, or api-key mode); 1 for
 * any non-clean state (missing, unreadable, invalid, unverifiable).
 */
export async function dispatchBuildAuthStatus(
  _cmd: BuildAuthStatusDispatch,
  deps: BuildAuthStatusDispatchDeps = {},
): Promise<number> {
  const {
    print = console.log,
    config,
    resolveSelfHostConfig: resolveSelfHost = resolveSelfHostConfig,
    readDaemonBuildToken: readToken = readDaemonBuildToken,
    verifyTokenLiveness: probeLiveness = verifyTokenLiveness,
  } = deps;

  const selfHost = resolveSelfHost(config);
  const { buildAuthMode, buildAuthTokenPath } = selfHost;

  if (buildAuthMode !== 'daemon-token') {
    print(`build-auth-status: mode=${buildAuthMode} state=api-key (no daemon-owned token to check)`);
    return 0;
  }

  const tokenResult = await readToken(buildAuthTokenPath);

  if (tokenResult.state === 'missing') {
    print(`build-auth-status: mode=${buildAuthMode} state=missing path=${buildAuthTokenPath}`);
    print(buildAuthRemediationMessage(buildAuthTokenPath));
    return 1;
  }

  if (tokenResult.state === 'error') {
    print(`build-auth-status: mode=${buildAuthMode} state=unreadable path=${buildAuthTokenPath}`);
    print(buildAuthRemediationMessage(buildAuthTokenPath));
    return 1;
  }

  // tokenResult.state === 'ok' — probe liveness.
  const liveness = await probeLiveness({ token: tokenResult.token });

  if (liveness.verdict === 'valid') {
    print(`build-auth-status: mode=${buildAuthMode} state=valid path=${buildAuthTokenPath}`);
    return 0;
  }

  // invalid or unverifiable — non-clean, remediation.
  print(
    `build-auth-status: mode=${buildAuthMode} state=${liveness.verdict} path=${buildAuthTokenPath}` +
      (liveness.detail ? ` (${liveness.detail})` : ''),
  );
  print(buildAuthRemediationMessage(buildAuthTokenPath));
  return 1;
}
