/**
 * Structural test: fixture portability guard
 *
 * Ensures test fixtures across src/conductor/test/** use portable git init patterns,
 * specifically by requiring `git init -b <default-branch>` to avoid implicit default
 * branch differences across systems (init.defaultBranch configuration).
 *
 * This guard:
 * - Recursively globs src/conductor/test/**\/*.ts
 * - Detects git init calls in all four exec shapes: execa, execFile, exec, and local git() helper
 * - Flags violations unless:
 *   - The line contains `-b` flag (explicit branch specified)
 *   - The line contains `--bare` flag (bare repos don't have default branches)
 *   - The line is commented out
 *   - The line carries a `// portability-ok: <reason>` marker (even empty reason)
 * - Includes falsifiability fixtures (known-bad and known-good patterns)
 *
 * Task 26: Structural guard scaffolding + git-init matcher
 * Currently skipped (.skip-gated) to keep tree green mid-plan.
 * Expected violations when enabled: ~22 sites (fixed in Tasks 27-28)
 *
 * Un-skip in Task 29 after violations are fixed.
 * Expected worklist (22 violations found in initial scan):
 * - acceptance/engineer-authoring.test.ts
 * - acceptance/engineer-isolation.test.ts
 * - acceptance/rekick-shipped-skip.acceptance.test.ts
 * - acceptance/shipped-work-dedup.acceptance.test.ts
 * - acceptance/task-status-third-writers-eliminated.acceptance.test.ts
 * - engine/autoheal-warn-once.test.ts
 * - engine/daemon-backlog.test.ts
 * - engine/engineer/authoring-guards.test.ts
 * - engine/engineer/authoring.test.ts
 * - engine/engineer/cross-repo-isolation.test.ts
 * - engine/engineer/engineer-cli-handoff-branch-evidence.test.ts
 * - engine/engineer/engineer-cli-handoff-writeback-failure.test.ts
 * - engine/engineer/engineer-cli-land-owner.test.ts
 * - engine/engineer/intake-marker.test.ts
 * - engine/engineer/isolation.test.ts
 * - engine/engineer/land-spec.test.ts
 * - engine/engineer/track-marker.test.ts
 * - integration/empty-ledger-replay-guard.integration.test.ts
 * - integration/gate-loop.test.ts (2x)
 * - integration/remediation-extends-plan.test.ts
 * - integration/task-status-gate-recompute.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = new URL('.', import.meta.url).pathname;

// ──────────────────────────────────────────────────────────────────────────────
// Falsifiability fixtures: known-bad and known-good patterns
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fixtures to verify the detector works correctly. These are embedded strings
 * that would be flagged/exempt if they appeared in a real test file.
 */
const KNOWN_BAD_FIXTURES = [
  `await execa('git', ['init', '-q'], { cwd: dir });`, // execa array form, no -b
  `await execFile('git', ['init', '-q'], { cwd: repoPath });`, // execFile, no -b
  `await exec('git', ['init', '-q'], { cwd: dir });`, // exec, no -b
  `await git(['init', '-q']);`, // local git() helper array form
  `await git('init', '-q');`, // local git() helper variadic form
];

const KNOWN_GOOD_FIXTURES = [
  `await execa('git', ['init', '-b', 'main', '-q'], { cwd: dir });`, // with -b main
  `await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repoPath });`, // -b in middle
  `await exec('git', ['init', '--bare', '-q'], { cwd: dir });`, // --bare, no -b needed
  `await git(['init', '-b', 'main']);`, // git() helper with -b
  `// await execa('git', ['init', '-q'], { cwd: dir });`, // commented out
  `  // await git('init', '-q');`, // commented out with indent
  `await execa('git', ['init', '-q'], { cwd: dir }); // portability-ok: explicit branch elsewhere`, // with marker and reason
  `await git('init', '-q'); // portability-ok: `, // empty reason marker
];

// ──────────────────────────────────────────────────────────────────────────────
// Detector logic
// ──────────────────────────────────────────────────────────────────────────────

interface Violation {
  file: string;
  line: number;
  content: string;
  reason: string;
}

/**
 * Detect if a line is commented out (ignoring leading whitespace and common patterns)
 */
function isCommented(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//');
}

/**
 * Extract git init patterns from a line. Returns the init invocation if found, null otherwise.
 * Handles: execa, execFile, exec, and local git() calls.
 */
function extractGitInitPattern(line: string): {
  type: 'execa' | 'execFile' | 'exec' | 'git-helper';
  hasFlag: boolean; // true if -b or --bare is present
  markerPresent: boolean; // true if // portability-ok: is present
} | null {
  // Check for portability-ok marker early
  const markerPresent = line.includes('// portability-ok:');

  // Pattern 1: execa('git', ['init', ...])
  if (line.includes("execa('git', ['init'")) {
    const hasFlag = line.includes('-b') || line.includes('--bare');
    return { type: 'execa', hasFlag, markerPresent };
  }

  // Pattern 2: execFile('git', ['init', ...])
  if (line.includes("execFile('git', ['init'")) {
    const hasFlag = line.includes('-b') || line.includes('--bare');
    return { type: 'execFile', hasFlag, markerPresent };
  }

  // Pattern 3: exec('git', ['init', ...])
  if (line.includes("exec('git', ['init'")) {
    const hasFlag = line.includes('-b') || line.includes('--bare');
    return { type: 'exec', hasFlag, markerPresent };
  }

  // Pattern 4a: git(['init', ...]) — array form
  if (line.includes("git(['init'")) {
    const hasFlag = line.includes('-b') || line.includes('--bare');
    return { type: 'git-helper', hasFlag, markerPresent };
  }

  // Pattern 4b: git('init', ...) — variadic form (make sure it's not git-daemon or similar)
  if (line.includes("git('init'") && !line.includes('git-daemon')) {
    const hasFlag = line.includes('-b') || line.includes('--bare');
    return { type: 'git-helper', hasFlag, markerPresent };
  }

  return null;
}

/**
 * Scan a file for non-portable git init patterns. Returns violations.
 */
async function scanFileForViolations(filePath: string): Promise<Violation[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip commented lines
    if (isCommented(line)) {
      continue;
    }

    const pattern = extractGitInitPattern(line);
    if (!pattern) {
      continue; // Not a git init pattern
    }

    // If pattern has -b or --bare, it's OK
    if (pattern.hasFlag) {
      continue;
    }

    // If pattern has portability-ok marker, it's OK (even with empty reason)
    if (pattern.markerPresent) {
      continue;
    }

    // Violation found
    violations.push({
      file: filePath,
      line: lineNum,
      content: line.trim(),
      reason: `git init without -b flag in ${pattern.type} call`,
    });
  }

  return violations;
}

/**
 * Recursively glob all TypeScript files in a directory tree
 */
async function globTestFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe.skip('Structural guard: fixture portability (git-init pattern)', () => {
  it('known-bad fixtures trigger violations', () => {
    const violations: typeof KNOWN_BAD_FIXTURES = [];

    for (const fixture of KNOWN_BAD_FIXTURES) {
      if (!isCommented(fixture)) {
        const pattern = extractGitInitPattern(fixture);
        if (pattern && !pattern.hasFlag && !pattern.markerPresent) {
          violations.push(fixture);
        }
      }
    }

    // All known-bad fixtures should trigger violations
    expect(violations).toHaveLength(KNOWN_BAD_FIXTURES.length);
  });

  it('known-good fixtures pass (no violations)', () => {
    const violations: typeof KNOWN_GOOD_FIXTURES = [];

    for (const fixture of KNOWN_GOOD_FIXTURES) {
      if (!isCommented(fixture)) {
        const pattern = extractGitInitPattern(fixture);
        if (pattern && !pattern.hasFlag && !pattern.markerPresent) {
          violations.push(fixture);
        }
      }
    }

    // No known-good fixtures should trigger violations
    expect(violations).toHaveLength(0);
  });

  it('detects all four exec shapes correctly', () => {
    const testCases = [
      { fixture: `execa('git', ['init', '-q'])`, shouldViolate: true },
      { fixture: `execa('git', ['init', '-b', 'main', '-q'])`, shouldViolate: false },
      { fixture: `execFile('git', ['init', '-q'])`, shouldViolate: true },
      { fixture: `execFile('git', ['init', '--bare', '-q'])`, shouldViolate: false },
      { fixture: `exec('git', ['init', '-q'])`, shouldViolate: true },
      { fixture: `exec('git', ['init', '-q', '-b', 'main'])`, shouldViolate: false },
      { fixture: `git(['init', '-q'])`, shouldViolate: true },
      { fixture: `git(['init', '-q', '-b', 'main'])`, shouldViolate: false },
      { fixture: `git('init', '-q')`, shouldViolate: true },
      { fixture: `git('init', '-q', '-b', 'main')`, shouldViolate: false },
    ];

    for (const { fixture, shouldViolate } of testCases) {
      const pattern = extractGitInitPattern(fixture);
      if (shouldViolate) {
        expect(pattern).toBeTruthy(`${fixture} should be detected`);
        expect(pattern?.hasFlag).toBe(false);
        expect(pattern?.markerPresent).toBe(false);
      } else {
        if (pattern) {
          expect(pattern.hasFlag || pattern.markerPresent).toBe(
            true,
            `${fixture} should not violate`
          );
        }
      }
    }
  });

  it('respects comment-line exemption', () => {
    const testCases = [
      { line: `// await execa('git', ['init', '-q'])`, shouldViolate: false },
      { line: `  // git('init', '-q')`, shouldViolate: false },
      { line: `await execa('git', ['init', '-q'])`, shouldViolate: true },
    ];

    for (const { line, shouldViolate } of testCases) {
      if (isCommented(line)) {
        expect(shouldViolate).toBe(false);
      } else {
        const pattern = extractGitInitPattern(line);
        if (shouldViolate) {
          expect(pattern).toBeTruthy();
          expect(pattern?.hasFlag).toBe(false);
        }
      }
    }
  });

  it('respects portability-ok marker (even empty reason)', () => {
    const testCases = [
      { line: `await git('init', '-q'); // portability-ok: fixture uses init.defaultBranch`, shouldViolate: false },
      { line: `await git('init', '-q'); // portability-ok: `, shouldViolate: false },
      { line: `await git('init', '-q'); // portability-ok:`, shouldViolate: false },
      { line: `await git('init', '-q')`, shouldViolate: true },
    ];

    for (const { line, shouldViolate } of testCases) {
      if (isCommented(line)) {
        expect(shouldViolate).toBe(false);
      } else {
        const pattern = extractGitInitPattern(line);
        if (shouldViolate) {
          expect(pattern?.markerPresent).toBe(false);
        } else {
          // Should either have -b flag or portability-ok marker
          if (pattern) {
            expect(pattern.hasFlag || pattern.markerPresent).toBe(true);
          }
        }
      }
    }
  });

  it('scans real test tree and reports violations', async () => {
    // Scan src/conductor/test/ directory recursively
    const testDir = join(__dirname, '..');
    const currentFile = __filename;
    let files = await globTestFiles(testDir);

    // Exclude the test file itself to avoid false positives from fixtures
    files = files.filter((f) => f !== currentFile);

    expect(files.length).toBeGreaterThan(0);

    const allViolations: Violation[] = [];

    for (const file of files) {
      const violations = await scanFileForViolations(file);
      allViolations.push(...violations);
    }

    // Should find ~16-20 violations on current tree (before Tasks 27-28 fix them)
    if (allViolations.length > 0) {
      console.log(`\n✗ Found ${allViolations.length} fixture-portability violations:\n`);
      for (const v of allViolations) {
        const relPath = relative(testDir, v.file);
        console.log(`  ${relPath}:${v.line}`);
        console.log(`    ${v.content}`);
        console.log(`    ${v.reason}\n`);
      }
    }

    // Expected to fail: list violations for the worklist (Tasks 27-28 will fix these)
    expect(allViolations).toHaveLength(0, 'Fixture portability violations must be fixed (see list above)');
  });
});
