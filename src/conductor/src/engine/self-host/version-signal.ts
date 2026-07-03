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
 * Detect MAJOR breaking surfaces in a change set.
 * Refined from classifyBreakingSurfaces to exclude hooks with A (added) status,
 * which are MINOR signals (Task 7).
 */
function detectMajorSurfaces(changed: ChangedFile[]): Array<{ kind: string; files: string[] }> {
  const signals: Array<{ kind: string; files: string[] }> = [];
  const breakingFiles: Map<string, Set<string>> = new Map();

  for (const { status, path, origPath } of changed) {
    const removedOrRenamed = status.startsWith('D') || status.startsWith('R');
    // Inspect BOTH the destination and (for a rename/copy) the source path, so a
    // move into OR out of a breaking surface is caught on either side.
    for (const p of origPath ? [path, origPath] : [path]) {
      if (p === 'bin/conduct') {
        if (!breakingFiles.has('bin/conduct CLI')) {
          breakingFiles.set('bin/conduct CLI', new Set());
        }
        breakingFiles.get('bin/conduct CLI')!.add(path);
      }
      if (p === 'bin/install') {
        if (!breakingFiles.has('skill symlink targets')) {
          breakingFiles.set('skill symlink targets', new Set());
        }
        breakingFiles.get('skill symlink targets')!.add(path);
      }
      // MAJOR: exclude A status hooks (they are MINOR — Task 7)
      if ((p.startsWith('hooks/') || p.includes('/hooks/')) && !status.startsWith('A')) {
        if (!breakingFiles.has('hook wiring')) {
          breakingFiles.set('hook wiring', new Set());
        }
        breakingFiles.get('hook wiring')!.add(path);
      }
      if (/(^|\/)settings(\.local)?\.json$/.test(p)) {
        if (!breakingFiles.has('settings.json schema')) {
          breakingFiles.set('settings.json schema', new Set());
        }
        breakingFiles.get('settings.json schema')!.add(path);
      }
      if (p.startsWith('skills/') && removedOrRenamed) {
        if (!breakingFiles.has('skill symlink targets')) {
          breakingFiles.set('skill symlink targets', new Set());
        }
        breakingFiles.get('skill symlink targets')!.add(path);
      }
    }
  }

  // Convert to signals array
  for (const [kind, files] of breakingFiles) {
    signals.push({ kind, files: [...files] });
  }

  return signals;
}

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

  // Task 5 — MAJOR surface detection
  const majorSignals = detectMajorSurfaces(changed);
  if (majorSignals.length > 0) {
    return { level: 'major', signals: majorSignals };
  }

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
