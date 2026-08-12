// self-host/build-auth-preflight.ts — daemon build-auth token preflight check
//
// Task 6 (TR-3, TR-2): fail-closed pre-flight — missing daemon token HALTs with mint instructions
//
// Before any sandbox provisioning or build step execution, validate that the
// daemon token exists (in daemon-token mode). If missing or unreadable, write
// a HALT marker with mint instructions. For api-key mode, skip the check.

import { access as accessFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HALT_MARKER, writeHaltMarker } from '../halt-marker.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { readDaemonBuildToken } from './daemon-build-token.js';
import { buildAuthRemediationMessage } from './build-auth-message.js';
import type { StepRunResult } from '../conductor.js';

/**
 * Pre-flight daemon build-auth token check (Task 6, TR-2/TR-3).
 * Called before sandbox provisioning for self-host builds in daemon-token mode.
 * If the token file is missing or unreadable: HALT immediately with mint instructions.
 * For api-key mode: skip the check (environment variable injection happens at runtime).
 * Returns undefined if the check passes (caller proceeds normally); otherwise returns
 * a StepRunResult with success=false + HALT marker written.
 * Preserves existing HALT markers on retry (never overwrites).
 */
export async function preflightBuildAuthCheck(
  buildAuthMode: string,
  buildAuthTokenPath: string,
  projectRoot: string,
  events?: ConductorEventEmitter,
): Promise<StepRunResult | undefined> {
  // API-key mode: skip token requirement (env var injection at runtime)
  if (buildAuthMode !== 'daemon-token') {
    return undefined;
  }

  // Daemon-token mode: check token exists and is readable
  const tokenState = await readDaemonBuildToken(buildAuthTokenPath);

  // Token is present and readable — proceed normally
  if (tokenState.state === 'ok') {
    return undefined;
  }

  // Token is missing or unreadable — HALT with the shared remediation message
  // (Task 12: renders buildAuthRemediationMessage output, not a separately-assembled string)
  let haltReason = buildAuthRemediationMessage(buildAuthTokenPath);

  // If token is in error state (unreadable), add diagnostic detail
  if (tokenState.state === 'error') {
    haltReason += `\n\nDiagnostic: ${tokenState.detail}\n`;
  }

  // Only write the HALT marker if it doesn't already exist (preserve on retry).
  // This matches the pattern in preflightCredentialsCheck.
  const haltPath = join(projectRoot, HALT_MARKER);
  const haltExists = await accessFile(haltPath).then(() => true).catch(() => false);
  if (!haltExists) {
    const markerWrite = await writeHaltMarker(projectRoot, haltReason + '\n', 'needs-human', events);
    if (markerWrite.status === 'failed') {
      haltReason += `\n\nHALT marker write failed: ${markerWrite.reason}`;
    }
  }

  return {
    success: false,
    output: haltReason,
  };
}
