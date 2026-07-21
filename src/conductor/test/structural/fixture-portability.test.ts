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
 * Two additional matchers (Task 29):
 * - unref matcher: flags `.unref()` timer calls in src/engine/** unless commented out
 *   or annotated with `// portability-ok: <reason>`. Unref detaches timers from
 *   keeping the process alive; legitimate uses must be reasoned about explicitly
 *   since unref semantics/availability differ across runtimes.
 * - tmp-outside-target-dir matcher: flags hardcoded absolute `/tmp/...` (or
 *   `\tmp\...` on Windows-style paths) string literals used for file writes,
 *   which escape the sandboxed target directory and break portability/sandboxing.
 *   Using `os.tmpdir()` is the portable alternative and is not flagged.
 *
 * Task 26: Structural guard scaffolding + git-init matcher
 * Task 29: unref + tmp-outside-target-dir matchers; guard fully armed (un-skipped)
 *
 * All known violations from the initial 22-site worklist were fixed in Tasks 27-28.
 * The single legitimate `.unref()` call (src/engine/daemon-log.ts:197) is annotated
 * with a `// portability-ok:` marker. The tmp-outside-target-dir matcher currently
 * finds zero violations in src/engine/** (all tmp usage goes through `os.tmpdir()`).
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
  `await exec('git', ['init', '--bare', '-q'], { cwd: dir });`, // --bare without -b/--initial-branch, no marker
];

const KNOWN_GOOD_FIXTURES = [
  `await execa('git', ['init', '-b', 'main', '-q'], { cwd: dir });`, // with -b main
  `await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repoPath });`, // -b in middle
  `await exec('git', ['init', '--bare', '-b', 'main', '-q'], { cwd: dir });`, // --bare, pinned with -b
  `await exec('git', ['init', '--bare', '-q'], { cwd: dir }); // portability-ok: bare repo has no HEAD to matter`, // --bare, marker exemption
  `await git(['init', '-b', 'main']);`, // git() helper with -b
  `// await execa('git', ['init', '-q'], { cwd: dir });`, // commented out
  `  // await git('init', '-q');`, // commented out with indent
  `await execa('git', ['init', '-q'], { cwd: dir }); // portability-ok: explicit branch elsewhere`, // with marker and reason
  `await git('init', '-q'); // portability-ok: `, // empty reason marker
];

// Falsifiability fixtures for the unref matcher (src/engine/**)
const KNOWN_BAD_UNREF_FIXTURES = [
  `timer.unref();`, // bare unref call, no marker
  `if (typeof timer.unref === 'function') timer.unref();`, // guarded but no marker
  `this.pollTimer.unref();`, // member access unref, no marker
];

const KNOWN_GOOD_UNREF_FIXTURES = [
  `// timer.unref();`, // commented out
  `  // if (typeof timer.unref === 'function') timer.unref();`, // commented, indented
  `timer.unref(); // portability-ok: detaches poll timer from process exit`, // annotated
  `const x = 1; // no unref call here at all`, // no unref present
  `if (typeof timer.unref === 'function') timer.unref(); // portability-ok:`, // annotated, empty reason
];

// Falsifiability fixtures for the tmp-outside-target-dir matcher (src/engine/**)
const KNOWN_BAD_TMP_FIXTURES = [
  `await writeFile('/tmp/scratch.json', data);`, // hardcoded /tmp path
  `const dir = '/tmp/conduct-cache';`, // hardcoded /tmp assignment
  `await mkdir(\`/tmp/run-\${id}\`);`, // hardcoded /tmp template literal
];

const KNOWN_GOOD_TMP_FIXTURES = [
  `const dir = join(tmpdir(), 'conduct-mermaid');`, // uses os.tmpdir()
  `const tempDir = await mkdtemp(join(tmpdir(), 'task-status-'));`, // uses os.tmpdir()
  `// const dir = '/tmp/scratch.json';`, // commented out
  `const dir = '/tmp/scratch.json'; // portability-ok: dev-only debug shim, never runs in prod`, // annotated
  `const label = 'no tmp path here';`, // no /tmp path present
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
 * Precisely detect a real `-b <branch>` or `--initial-branch <branch>` flag token.
 * Deliberately does NOT match on `--bare`, which merely contains `-b` as a substring.
 */
function hasInitialBranchFlag(line: string): boolean {
  return /(^|\s|['"[,])(-b|--initial-branch)(\s|=|['"\]])/.test(line);
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
    const hasFlag = hasInitialBranchFlag(line);
    return { type: 'execa', hasFlag, markerPresent };
  }

  // Pattern 2: execFile('git', ['init', ...])
  if (line.includes("execFile('git', ['init'")) {
    const hasFlag = hasInitialBranchFlag(line);
    return { type: 'execFile', hasFlag, markerPresent };
  }

  // Pattern 3: exec('git', ['init', ...])
  if (line.includes("exec('git', ['init'")) {
    const hasFlag = hasInitialBranchFlag(line);
    return { type: 'exec', hasFlag, markerPresent };
  }

  // Pattern 4a: git(['init', ...]) — array form
  if (line.includes("git(['init'")) {
    const hasFlag = hasInitialBranchFlag(line);
    return { type: 'git-helper', hasFlag, markerPresent };
  }

  // Pattern 4b: git('init', ...) — variadic form (make sure it's not git-daemon or similar)
  if (line.includes("git('init'") && !line.includes('git-daemon')) {
    const hasFlag = hasInitialBranchFlag(line);
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
 * Detect a non-portable `.unref()` call on a line. Returns true if the line
 * calls `.unref()` and is not exempted by a `// portability-ok:` marker.
 * Callers are expected to have already skipped commented-out lines.
 */
function isUnrefViolation(line: string): boolean {
  if (!/\.unref\s*\(\s*\)/.test(line)) return false;
  if (line.includes('// portability-ok:')) return false;
  return true;
}

/**
 * Detect a hardcoded absolute `/tmp/...` path literal used outside the
 * sandboxed target directory. Returns true if the line contains a `/tmp/`
 * string literal and is not exempted by a `// portability-ok:` marker.
 * Callers are expected to have already skipped commented-out lines.
 */
function isTmpOutsideTargetDirViolation(line: string): boolean {
  if (!/['"`]\/tmp\//.test(line)) return false;
  if (line.includes('// portability-ok:')) return false;
  return true;
}

/**
 * Scan a file for non-portable unref() calls. Returns violations.
 */
async function scanFileForUnrefViolations(filePath: string): Promise<Violation[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommented(line)) continue;
    if (isUnrefViolation(line)) {
      violations.push({
        file: filePath,
        line: i + 1,
        content: line.trim(),
        reason: 'unref() call without // portability-ok: marker',
      });
    }
  }

  return violations;
}

/**
 * Scan a file for hardcoded /tmp paths outside the target directory. Returns violations.
 */
async function scanFileForTmpOutsideTargetDirViolations(filePath: string): Promise<Violation[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommented(line)) continue;
    if (isTmpOutsideTargetDirViolation(line)) {
      violations.push({
        file: filePath,
        line: i + 1,
        content: line.trim(),
        reason: 'hardcoded /tmp path without // portability-ok: marker (use os.tmpdir() instead)',
      });
    }
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

describe('Structural guard: fixture portability (git-init pattern)', () => {
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
      { fixture: `execFile('git', ['init', '--bare', '-q'])`, shouldViolate: true },
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

describe('Structural guard: unref matcher (src/engine/**)', () => {
  it('known-bad fixtures trigger violations', () => {
    for (const fixture of KNOWN_BAD_UNREF_FIXTURES) {
      expect(isCommented(fixture)).toBe(false);
      expect(isUnrefViolation(fixture)).toBe(true);
    }
  });

  it('known-good fixtures pass (no violations)', () => {
    for (const fixture of KNOWN_GOOD_UNREF_FIXTURES) {
      if (isCommented(fixture)) continue;
      expect(isUnrefViolation(fixture)).toBe(false);
    }
  });

  it('scans src/engine/** and reports zero unexplained unref violations', async () => {
    const engineDir = join(__dirname, '..', '..', 'src', 'engine');
    const files = await globTestFiles(engineDir);
    expect(files.length).toBeGreaterThan(0);

    const allViolations: Violation[] = [];
    for (const file of files) {
      allViolations.push(...(await scanFileForUnrefViolations(file)));
    }

    if (allViolations.length > 0) {
      console.log(`\n✗ Found ${allViolations.length} unref violations:\n`);
      for (const v of allViolations) {
        const relPath = relative(engineDir, v.file);
        console.log(`  ${relPath}:${v.line}`);
        console.log(`    ${v.content}`);
        console.log(`    ${v.reason}\n`);
      }
    }

    expect(allViolations).toHaveLength(
      0,
      'unref() calls must be commented out or carry a // portability-ok: marker'
    );
  });
});

describe('Structural guard: tmp-outside-target-dir matcher (src/engine/**)', () => {
  it('known-bad fixtures trigger violations', () => {
    for (const fixture of KNOWN_BAD_TMP_FIXTURES) {
      expect(isCommented(fixture)).toBe(false);
      expect(isTmpOutsideTargetDirViolation(fixture)).toBe(true);
    }
  });

  it('known-good fixtures pass (no violations)', () => {
    for (const fixture of KNOWN_GOOD_TMP_FIXTURES) {
      if (isCommented(fixture)) continue;
      expect(isTmpOutsideTargetDirViolation(fixture)).toBe(false);
    }
  });

  it('scans src/engine/** and reports zero unexplained tmp-outside-target-dir violations', async () => {
    const engineDir = join(__dirname, '..', '..', 'src', 'engine');
    const files = await globTestFiles(engineDir);
    expect(files.length).toBeGreaterThan(0);

    const allViolations: Violation[] = [];
    for (const file of files) {
      allViolations.push(...(await scanFileForTmpOutsideTargetDirViolations(file)));
    }

    if (allViolations.length > 0) {
      console.log(`\n✗ Found ${allViolations.length} tmp-outside-target-dir violations:\n`);
      for (const v of allViolations) {
        const relPath = relative(engineDir, v.file);
        console.log(`  ${relPath}:${v.line}`);
        console.log(`    ${v.content}`);
        console.log(`    ${v.reason}\n`);
      }
    }

    expect(allViolations).toHaveLength(
      0,
      'Hardcoded /tmp paths must use os.tmpdir() or carry a // portability-ok: marker'
    );
  });
});

describe('Structural guard: hasInitialBranchFlag matcher (git init --bare exemption)', () => {
  it('detects presence/absence of an initial-branch flag in a git init argv literal', () => {
    expect(hasInitialBranchFlag("['init', '--bare', '-q']")).toBe(false);
    expect(hasInitialBranchFlag("['init', '--bare', '-b', 'main']")).toBe(true);
    expect(hasInitialBranchFlag("['init', '--initial-branch', 'main']")).toBe(true);
    expect(hasInitialBranchFlag("['init']")).toBe(false);
  });

  it('a bare init with no branch-pin flag and no marker VIOLATES', () => {
    const line = `await execa('git', ['init', '--bare', '-q']);`;
    const pattern = extractGitInitPattern(line);
    expect(pattern).toBeTruthy();
    expect(pattern?.hasFlag).toBe(false);
    expect(pattern?.markerPresent).toBe(false);
  });

  it('a bare init with a -b branch-pin flag PASSES', () => {
    const line = `await execa('git', ['init', '--bare', '-b', 'main', '-q']);`;
    const pattern = extractGitInitPattern(line);
    expect(pattern).toBeTruthy();
    expect(pattern?.hasFlag).toBe(true);
  });

  it('a bare init with a trailing portability-ok marker PASSES (even empty reason)', () => {
    const line = `await execa('git', ['init', '--bare', '-q']); // portability-ok:`;
    const pattern = extractGitInitPattern(line);
    expect(pattern).toBeTruthy();
    expect(pattern?.markerPresent).toBe(true);
  });

  it('known-bad fixture count still holds (non-regression)', () => {
    const violations: typeof KNOWN_BAD_FIXTURES = [];

    for (const fixture of KNOWN_BAD_FIXTURES) {
      if (!isCommented(fixture)) {
        const pattern = extractGitInitPattern(fixture);
        if (pattern && !pattern.hasFlag && !pattern.markerPresent) {
          violations.push(fixture);
        }
      }
    }

    expect(violations.length).toBe(KNOWN_BAD_FIXTURES.length);
  });
});
