// ── Stale engine initialization (Tasks 8-9) ─────────────────────────────────
//
// Startup capture + handshake wiring for daemon auto-restart on stale engine.
// Extracted from daemon-cli so it can be tested, invoked, and driven independently.
//
// Task 8: Capture engine identity at startup and log ARMED/DISARMED status
// Task 9: Startup handshake — read, log, and clear RESTART_PENDING marker if present
//
// The initStaleEngineState function runs BEFORE the main dispatch loop to:
// 1. Capture the current engine identity (sha256 of dist/index.js)
// 2. Log ARMED or DISARMED status based on config flag + self-host mode
// 3. Read the RESTART_PENDING marker (if present)
// 4. Log the restart reason and fresh identity
// 5. Handle non-convergence suppression (target ≠ fresh identity)
// 6. Clear the marker before the scan runs
//
// This ensures dispatch parity: the handshake runs before dispatch decisions
// are made, and the marker is cleared before the first backlog scan, so the
// two boot paths (manual vs. post-engine-refresh) observe identical state.

import { captureEngineIdentity } from './engine-identity.js';
import {
  readRestartMarkerWithStatus,
  clearRestartMarker,
  recordSuppression,
  clearSuppression,
} from './restart-intent.js';

/**
 * Options passed to initStaleEngineState.
 */
export interface InitStaleEngineStateOpts {
  /** Path to the project root (.daemon, .worktrees relative to this). */
  repoPath: string;
  /** Path to the engine entry point (dist/index.js) to capture identity from. */
  entryPath: string;
  /** Whether stale-engine auto-restart is enabled in config (auto_restart_on_stale_engine flag). */
  flag: boolean;
  /** Logger function (e.g., log or console.log). */
  log?: (msg: string) => void;
}

/**
 * Initialize stale engine state at daemon startup.
 *
 * This function performs the startup handshake:
 * 1. Capture the current engine identity
 * 2. Log ARMED/DISARMED status
 * 3. If a RESTART_PENDING marker is present:
 *    a. Log the restart reason and identities
 *    b. Handle non-convergence suppression (if fresh ≠ target)
 *    c. Clear the marker
 * 4. Return the captured identity (or null if capture failed)
 *
 * The function is idempotent and gracefully handles missing/corrupt markers.
 * It must run BEFORE the first dispatch scan to ensure parity.
 */
export async function initStaleEngineState(opts: InitStaleEngineStateOpts): Promise<string | null> {
  const { repoPath, entryPath, flag, log: logFn } = opts;
  const log = logFn || (() => {});

  // Task 8: Capture engine identity at startup
  const engineIdentity = await captureEngineIdentity(entryPath);
  if (engineIdentity) {
    log(`daemon identity: ${engineIdentity}`);
  }

  // Log ARMED/DISARMED status
  // NOTE: We don't have access to self-host classification here, so we trust
  // that the flag passed in is already gated by (flag && isSelfHost).
  log(`${flag ? 'ARMED' : 'DISARMED'} — stale-engine auto-restart`);

  // Task 9: Startup handshake — check for restart marker and log if present
  // If engineIdentity is null, the check was disabled (capture failed), so skip handshake.
  if (engineIdentity !== null) {
    const markerStatus = await readRestartMarkerWithStatus(repoPath, log);

    if (markerStatus.kind === 'present') {
      const marker = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${marker.fromIdentity} to ${marker.targetIdentity}, fresh ${engineIdentity}`,
      );

      // Task 10: Suppression — record when fresh identity differs from target
      // (non-convergence at boot). This prevents restart loops when the engine
      // identity hasn't reached the target yet.
      if (engineIdentity !== marker.targetIdentity) {
        log(
          `suppressing restart loop — target was ${marker.targetIdentity}, now ${engineIdentity}`,
        );
        await recordSuppression(engineIdentity, repoPath, log);
      } else {
        // Task 4: On convergence (fresh === target), clear any pre-existing suppression.
        // This allows future restarts to proceed if the engine diverges again.
        await clearSuppression(repoPath, log);
      }

      // Clear the marker before the dispatch loop begins
      // This ensures both boot paths observe the same on-disk state
      await clearRestartMarker(repoPath, log);
    }
  }

  return engineIdentity;
}
