import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { HarnessConfig } from '../types/config.js';
import { isAttributionEnforcementActive } from './config.js';

// #505 TS-2: inline build-work attribution enforcement — predicate + marker
// file helpers. The marker file is written by the engine right before a
// build-work step dispatches and removed right after, so a session hook that
// fires mid-step (outside the engine's own dispatch) can tell "this commit
// happened while dispatched build work was in flight" from "this is
// unattributed session activity" without needing IPC.

/**
 * Whether inline build-work attribution enforcement is configured to be
 * active at `now`. Thin wrapper over the config module's cutover predicate —
 * kept here so callers that only care about "is enforcement on" don't need to
 * import the (larger) config module directly. Absent cutover → false.
 */
export function isEnforcementConfigured(config: HarnessConfig, now: Date = new Date()): boolean {
  return isAttributionEnforcementActive(config.attribution_enforcement_cutover, now);
}

/**
 * Path to the build-step-active marker file, relative to `root`.
 * Pure function — does not touch the filesystem.
 */
export function markerPath(root: string): string {
  if (!root) {
    throw new Error('markerPath requires a non-empty root path');
  }
  return join(root, '.pipeline', 'build-step-active');
}

/**
 * Write the build-step-active marker, creating the `.pipeline` directory if
 * necessary. Content is a plain ISO-8601 timestamp so shell/bash hooks can
 * read it without needing a JSON or YAML parser.
 */
export function writeBuildStepMarker(root: string, now: Date = new Date()): void {
  const path = markerPath(root);
  mkdirSync(join(root, '.pipeline'), { recursive: true });
  writeFileSync(path, `${now.toISOString()}\n`, 'utf8');
}

/**
 * Remove the build-step-active marker. Idempotent — does nothing (does not
 * throw) if the marker is already absent.
 */
export function removeBuildStepMarker(root: string): void {
  const path = markerPath(root);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}
