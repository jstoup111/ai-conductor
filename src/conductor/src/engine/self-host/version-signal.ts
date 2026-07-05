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
 * - Added engine gates (Task 8)
 */
function detectMinorSurfaces(changed: ChangedFile[]): Array<{ kind: string; files: string[] }> {
  const signals: Array<{ kind: string; files: string[] }> = [];
  const additiveFiles: Map<string, Set<string>> = new Map();

  for (const { status, path } of changed) {
    // Only added (A status) files trigger MINOR signals
    if (!status.startsWith('A')) {
      continue;
    }

    // MINOR: Added skill definitions
    if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) {
      if (!additiveFiles.has('new skill')) {
        additiveFiles.set('new skill', new Set());
      }
      additiveFiles.get('new skill')!.add(path);
    }

    // MINOR: Task 7 — Added hooks (A hooks/claude/*.sh)
    if (/^hooks\/claude\/[^/]+\.sh$/.test(path)) {
      if (!additiveFiles.has('new hook')) {
        additiveFiles.set('new hook', new Set());
      }
      additiveFiles.get('new hook')!.add(path);
    }

    // MINOR: Task 8 — Added engine gates (A src/conductor/src/engine/self-host/new-gate.ts)
    if (/^src\/conductor\/src\/engine\/self-host\/[^/]+\.ts$/.test(path)) {
      if (!additiveFiles.has('new engine gate')) {
        additiveFiles.set('new engine gate', new Set());
      }
      additiveFiles.get('new engine gate')!.add(path);
    }
  }

  // Convert to signals array
  for (const [kind, files] of additiveFiles) {
    signals.push({ kind, files: [...files] });
  }

  return signals;
}

/**
 * Check if a path matches any glob pattern in PATCH_SAFE_GLOBS.
 * Supports simple glob patterns:
 * - Exact matches: README.md
 * - Directory with /** suffix: .docs/**, test/**, src/conductor/src/**
 */
function pathMatchesPatchGlob(path: string, globs: string[]): boolean {
  for (const glob of globs) {
    if (glob.endsWith('/**')) {
      // Directory pattern: match if path starts with the directory
      const dir = glob.slice(0, -3); // Remove /**
      if (path === dir || path.startsWith(dir + '/')) {
        return true;
      }
    } else {
      // Exact match
      if (path === glob) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Collect paths classified by MAJOR or MINOR rules.
 */
function getClassifiedPaths(majorSignals: Array<{ kind: string; files: string[] }>,
                            minorSignals: Array<{ kind: string; files: string[] }>): Set<string> {
  const classified = new Set<string>();

  for (const signal of majorSignals) {
    for (const file of signal.files) {
      classified.add(file);
    }
  }

  for (const signal of minorSignals) {
    for (const file of signal.files) {
      classified.add(file);
    }
  }

  return classified;
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
 *
 * Task 8: MINOR near-misses
 *   - HARNESS.md changes are undeterminable (additivity undecidable)
 *   - Skills supporting files (non-SKILL.md) without SKILL.md are unclassified
 *
 * Task 9: PATCH fail-closed
 *   - Every path must match PATCH_SAFE_GLOBS or be classified MAJOR/MINOR
 *   - Any unclassified path triggers halt-undeterminable (fail-closed)
 */
export function classifyVersionSignal(changed: ChangedFile[] | null): VersionSignal {
  // Fail-closed: null or empty is undeterminable, never patch-proof.
  if (changed === null || changed.length === 0) {
    return {
      level: 'halt-undeterminable',
      reason: 'change set is null or empty; cannot determine version bump',
    };
  }

  // Task 8 — HARNESS.md near-miss: any change to HARNESS.md is undeterminable
  // because we can't reason about additivity at the whole-file level.
  for (const { path } of changed) {
    if (path === 'HARNESS.md') {
      return {
        level: 'halt-undeterminable',
        reason: 'HARNESS.md changes; additivity is undecidable at the whole-file level',
      };
    }
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

  // Task 9 — PATCH fail-closed: every path must be classifiable
  // Collect all paths classified by MAJOR/MINOR rules
  const classifiedPaths = getClassifiedPaths(majorSignals, minorSignals);

  // Check each path: must match PATCH_SAFE_GLOBS or be already classified
  const unclassifiedPaths: string[] = [];
  for (const { path } of changed) {
    if (!classifiedPaths.has(path) && !pathMatchesPatchGlob(path, PATCH_SAFE_GLOBS)) {
      unclassifiedPaths.push(path);
    }
  }

  // Fail-closed: if ANY path is unclassified, halt
  if (unclassifiedPaths.length > 0) {
    return {
      level: 'halt-undeterminable',
      reason: `unclassified path(s) in change set: ${unclassifiedPaths.join(', ')}`,
    };
  }

  // All paths classified: return PATCH (lowest priority)
  return { level: 'patch' };
}
