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
  | { level: 'patch'; changedFiles?: string[] }
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
 * Detect MINOR additive surfaces in a change set.
 * MINOR signals when new additive surfaces are introduced:
 * - Added skill definitions (A skills/[name]/SKILL.md)
 * - Added hooks (A hooks/claude/[name].sh, Task 7)
 * - Added engine gates (Task 7-8)
 */
function detectMinorSurfaces(changed: ChangedFile[]): Array<{ kind: string; files: string[] }> {
  const signals: Array<{ kind: string; files: string[] }> = [];
  const adderFiles: Map<string, Set<string>> = new Map();

  for (const { status, path } of changed) {
    // Only added (A status) files trigger MINOR signals
    if (!status.startsWith('A')) {
      continue;
    }

    // MINOR: Added skill definitions
    if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) {
      if (!adderFiles.has('new skill')) {
        adderFiles.set('new skill', new Set());
      }
      adderFiles.get('new skill')!.add(path);
    }

    // MINOR: Task 7 — Added hooks (A hooks/claude/[name].sh)
    if (/^hooks\/claude\/[^/]+\.sh$/.test(path)) {
      if (!adderFiles.has('new hook')) {
        adderFiles.set('new hook', new Set());
      }
      adderFiles.get('new hook')!.add(path);
    }

    // TODO: Task 8 — Added engine gates
  }

  // Convert to signals array
  for (const [kind, files] of adderFiles) {
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
 *
 * Task 6: Signal accumulation
 *   - Collects ALL signals (major + minor) for diagnostic purposes
 *   - Reports the max level (MAJOR > MINOR > PATCH)
 */
export function classifyVersionSignal(changed: ChangedFile[] | null): VersionSignal {
  // Fail-closed: null or empty is undeterminable, never patch-proof.
  if (changed === null || changed.length === 0) {
    return {
      level: 'halt-undeterminable',
      reason: 'change set is null or empty; cannot determine version bump',
    };
  }

  // Task 6 — Signal accumulation: collect both MAJOR and MINOR
  const majorSignals = detectMajorSurfaces(changed);
  const minorSignals = detectMinorSurfaces(changed);

  // Precedence: MAJOR > MINOR > PATCH
  if (majorSignals.length > 0) {
    // Combine all signals for diagnostics
    const allSignals = [...majorSignals, ...minorSignals];
    return { level: 'major', signals: allSignals };
  }

  if (minorSignals.length > 0) {
    return { level: 'minor', signals: minorSignals };
  }

  // TODO: Task 7 — Additional MINOR detection and MINOR near-misses
  // TODO: Task 8 — MINOR near-misses (HARNESS.md, supporting files without SKILL.md)
  // TODO: Task 9 — PATCH allow-list matching (every path must match PATCH_SAFE_GLOBS)

  // Skeleton: return undeterminable for now (fail-closed by default).
  return {
    level: 'halt-undeterminable',
    reason: 'classifier skeleton incomplete; classification deferred to later tasks',
  };
}
