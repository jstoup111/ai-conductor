// self-host/version-signal.ts — SemverSignalClassifier (TR-2).
//
// Pure function to classify a change set into semantic version signals.
// Precedence: undeterminable > MAJOR > MINOR > PATCH.
// - MAJOR: breaking surfaces (bin/conduct, hooks, skill symlink targets, settings)
// - MINOR: additive surfaces (new skills, new hooks, new engine gates)
// - PATCH: only when EVERY path matches PATCH_SAFE_GLOBS allow-list
// - undeterminable: null/empty change set or any unclassified path (fail-closed)

import type { ChangedFile } from './release-gate.js';

/** Glob patterns for paths that are safe to change in a PATCH version bump. */
export const PATCH_SAFE_GLOBS = [
  'README.md',
  '.docs/**',
  'test/**',
  'src/conductor/src/**',
];

export type VersionSignal =
  | { level: 'patch' }
  | { level: 'minor' | 'major'; signals: Array<{ kind: string; files: string[] }> }
  | { level: 'halt-undeterminable'; reason: string };

/**
 * Classify a change set into a semantic version signal.
 * Returns PATCH when all files match PATCH_SAFE_GLOBS, MINOR/MAJOR when
 * specific surfaces are touched, or undeterminable (halt-worthy) when the
 * change set is null/empty or contains unclassified paths.
 *
 * Precedence:
 *   undeterminable > MAJOR > MINOR > PATCH
 */
export function classifyVersionSignal(changed: ChangedFile[] | null): VersionSignal {
  // Fail-closed: null or empty is undeterminable, never patch-proof.
  if (changed === null || changed.length === 0) {
    return {
      level: 'halt-undeterminable',
      reason: 'change set is null or empty; cannot determine version bump',
    };
  }

  // TODO: Task 5 — MAJOR surface detection (reuse classifyBreakingSurfaces)
  // TODO: Task 6 — mixed-signal precedence (collect all, report max level)
  // TODO: Task 7 — MINOR signal detection (added SKILL.md, added hooks, added gates)
  // TODO: Task 8 — MINOR near-misses (HARNESS.md, supporting files without SKILL.md)
  // TODO: Task 9 — PATCH allow-list matching (every path must match PATCH_SAFE_GLOBS)

  // Skeleton: return undeterminable for now (fail-closed by default).
  return {
    level: 'halt-undeterminable',
    reason: 'classifier skeleton incomplete; classification deferred to later tasks',
  };
}
